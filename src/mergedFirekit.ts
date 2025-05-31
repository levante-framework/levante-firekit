import { 
  Auth, 
  User, 
  UserCredential, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  Unsubscribe,
  AuthError,
  signInWithPopup,
  GoogleAuthProvider,
  linkWithPopup,
  unlink,
  sendPasswordResetEmail
} from 'firebase/auth';

import {
  Firestore,
  doc,
  collection,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  writeBatch,
  runTransaction,
  Transaction,
  DocumentReference,
  CollectionReference,
  DocumentSnapshot,
  serverTimestamp,
  arrayUnion,
  FieldValue
} from 'firebase/firestore';

import { Functions, httpsCallable } from 'firebase/functions';
import { FirebaseStorage } from 'firebase/storage';

import { MergedRoarConfig, FirebaseProject, UserDataInAdminDb, UserType, Assessment, OrgLists, Legal, Name, StudentData, UserRecord, ExternalUserData } from './interfaces';
import { initializeFirebaseProject, AuthPersistence as AuthPersistenceEnum, MarkRawConfig } from './firestore/util';
import { roarEmail, isRoarAuthEmail, isEmailAvailable, isUsernameAvailable, fetchEmailAuthMethods } from './auth';

// Enum for authentication provider types
enum AuthProviderType {
  CLEVER = 'clever',
  CLASSLINK = 'classlink', 
  GOOGLE = 'google',
  EMAIL = 'email',
  USERNAME = 'username',
  PASSWORD = 'password',
}

interface CreateUserInput {
  email: string;
  password?: string;
  activationCode?: string;
  dob: string;
  grade: string;
  pid?: string;
  ell_status?: boolean;
  iep_status?: boolean;
  frl_status?: boolean;
  state_id?: string;
  gender?: string;
  hispanic_ethnicity?: string;
  race?: string[];
  home_language?: string[];
  name?: {
    first?: string;
    middle?: string;
    last?: string;
  };
  username?: string;
  unenroll?: boolean;
  schools: { id: string } | null;
  districts: { id: string } | null;
  classes: { id: string } | null;
  families: { id: string } | null;
  groups: { id: string } | null;
}

interface CurrentAssignments {
  assigned: string[];
  started: string[];
  completed: string[];
}

export interface RequestConfig {
  headers: { Authorization: string };
  baseURL: string;
}

/**
 * RoarMergedFirekit - Single Firebase project architecture
 * 
 * This class replaces the dual admin/app Firebase project architecture
 * with a single merged Firebase project that contains both admin and
 * assessment data in the same database.
 */
export class RoarMergedFirekit {
  // Single Firebase project instead of separate admin/app
  project?: FirebaseProject;
  currentAssignments?: CurrentAssignments;
  oAuthAccessToken?: string;
  roarConfig: MergedRoarConfig;
  userData?: UserDataInAdminDb;
  listenerUpdateCallback: (...args: unknown[]) => void;
  
  // Private properties
  private _admin?: boolean;
  private _adminClaimsListener?: Unsubscribe;
  private _adminOrgs?: Record<string, string[]>;
  private _authStateListener?: Unsubscribe;
  private _authPersistence: AuthPersistenceEnum;
  private _identityProviderType?: AuthProviderType;
  private _identityProviderId?: string;
  private _idTokenReceived?: boolean;
  private _idToken?: string;
  private _initialized: boolean;
  private _markRawConfig: MarkRawConfig;
  private _roarUid?: string;
  private _superAdmin?: boolean;
  private _verboseLogging?: boolean;

  constructor({
    roarConfig,
    verboseLogging = false,
    authPersistence = AuthPersistenceEnum.session,
    markRawConfig = {},
    listenerUpdateCallback,
  }: {
    roarConfig: MergedRoarConfig;
    verboseLogging?: boolean;
    authPersistence?: AuthPersistenceEnum;
    markRawConfig?: MarkRawConfig;
    listenerUpdateCallback?: (...args: unknown[]) => void;
  }) {
    this.roarConfig = roarConfig;
    this._verboseLogging = verboseLogging;
    this._authPersistence = authPersistence;
    this._markRawConfig = markRawConfig;
    this.listenerUpdateCallback = listenerUpdateCallback || (() => {});
    this._initialized = false;
    this._idTokenReceived = false;
  }

  private verboseLog(...logStatement: unknown[]) {
    if (this._verboseLogging) {
      console.log('[RoarMergedFirekit]', ...logStatement);
    }
  }

  public get initialized() {
    return this._initialized;
  }

  private _verifyInit() {
    if (!this._initialized) {
      throw new Error(
        'RoarMergedFirekit has not been initialized. Please call the init() method before using other methods.',
      );
    }
  }

  async init() {
    this.verboseLog('Initializing RoarMergedFirekit...');
    
    try {
      // Initialize single Firebase project
      this.project = await initializeFirebaseProject(
        this.roarConfig.merged,
        'merged-project',
        this._authPersistence,
        this._markRawConfig,
      );

      this.verboseLog('Firebase project initialized:', this.project.firebaseApp.name);

      // Set up auth state listener
      this._setupAuthStateListener();

      this._initialized = true;
      this.verboseLog('RoarMergedFirekit initialization complete');
      
      return this;
    } catch (error) {
      console.error('Error initializing RoarMergedFirekit:', error);
      throw error;
    }
  }

  private _setupAuthStateListener() {
    if (!this.project) return;

    this._authStateListener = onAuthStateChanged(this.project.auth, async (user) => {
      this.verboseLog('Auth state changed:', user?.uid);
      
      if (user) {
        this.project!.user = user;
        this._roarUid = user.uid;
        
        // Get user claims and data
        await this._updateUserClaims();
        await this._loadUserData();
      } else {
        this.project!.user = undefined;
        this._roarUid = undefined;
        this.userData = undefined;
        this._admin = false;
        this._superAdmin = false;
      }
      
      this.listenerUpdateCallback();
    });
  }

  private async _updateUserClaims() {
    if (!this.project?.user) return;

    try {
      const idTokenResult = await this.project.user.getIdTokenResult(true);
      this._idToken = idTokenResult.token;
      this._idTokenReceived = true;
      
      // Extract custom claims
      this._admin = idTokenResult.claims.admin === true;
      this._superAdmin = idTokenResult.claims.superAdmin === true;
      
      this.verboseLog('Updated user claims:', {
        admin: this._admin,
        superAdmin: this._superAdmin,
      });
    } catch (error) {
      console.error('Error updating user claims:', error);
    }
  }

  private async _loadUserData() {
    if (!this._roarUid || !this.project) return;

    try {
      const userDoc = await getDoc(doc(this.project.db, 'users', this._roarUid));
      if (userDoc.exists()) {
        this.userData = userDoc.data() as UserDataInAdminDb;
        this.verboseLog('Loaded user data for:', this._roarUid);
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  }

  // Authentication methods
  async registerWithEmailAndPassword({ email, password }: { email: string; password: string }) {
    this._verifyInit();
    
    try {
      const userCredential = await createUserWithEmailAndPassword(this.project!.auth, email, password);
      this.verboseLog('User registered:', userCredential.user.uid);
      return userCredential;
    } catch (error) {
      console.error('Registration error:', error);
      throw error;
    }
  }

  async logInWithEmailAndPassword({ email, password }: { email: string; password: string }) {
    this._verifyInit();
    
    try {
      const userCredential = await signInWithEmailAndPassword(this.project!.auth, email, password);
      this.verboseLog('User logged in:', userCredential.user.uid);
      return userCredential;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  async logInWithUsernameAndPassword({ username, password }: { username: string; password: string }) {
    const email = roarEmail(username);
    return this.logInWithEmailAndPassword({ email, password });
  }

  async signOut() {
    this._verifyInit();
    
    try {
      await signOut(this.project!.auth);
      this.verboseLog('User signed out');
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  }

  // User management methods
  async isUsernameAvailable(username: string): Promise<boolean> {
    this._verifyInit();
    return isUsernameAvailable(this.project!.auth, username);
  }

  async isEmailAvailable(email: string): Promise<boolean> {
    this._verifyInit();
    return isEmailAvailable(this.project!.auth, email);
  }

  async fetchEmailAuthMethods(email: string) {
    this._verifyInit();
    return fetchEmailAuthMethods(this.project!.auth, email);
  }

  isRoarAuthEmail(email: string) {
    return isRoarAuthEmail(email);
  }

  // Getters
  public get superAdmin() {
    return this._superAdmin;
  }

  public get idTokenReceived() {
    return this._idTokenReceived;
  }

  public get idToken() {
    return this._idToken;
  }

  public get roarUid() {
    return this._roarUid;
  }

  public get dbRefs() {
    this._verifyInit();
    
    if (!this._roarUid) {
      throw new Error('User must be authenticated to access database references');
    }

    // Single database references - all data in one project
    return {
      user: doc(this.project!.db, 'users', this._roarUid),
      assignments: collection(this.project!.db, 'users', this._roarUid, 'assignments'),
      runs: collection(this.project!.db, 'users', this._roarUid, 'runs'),
      tasks: collection(this.project!.db, 'tasks'),
      administrations: collection(this.project!.db, 'administrations'),
      districts: collection(this.project!.db, 'districts'),
      schools: collection(this.project!.db, 'schools'),
      classes: collection(this.project!.db, 'classes'),
      groups: collection(this.project!.db, 'groups'),
      families: collection(this.project!.db, 'families'),
      legal: collection(this.project!.db, 'legal'),
    };
  }

  public isUsingEmulators() {
    return this.roarConfig.merged.useEmulators === true;
  }

  // Simplified authentication check - only one project to check
  private _isAuthenticated() {
    return this.project?.user !== undefined;
  }

  isAdmin() {
    return this._admin === true;
  }

  private _verifyAuthentication() {
    if (!this._isAuthenticated()) {
      throw new Error('User must be authenticated to perform this action');
    }
  }

  private _verifyAdmin() {
    this._verifyAuthentication();
    if (!this.isAdmin()) {
      throw new Error('User must be an admin to perform this action');
    }
  }

  // Placeholder methods for compatibility - these would need full implementation
  async getMyData(targetUid?: string) {
    this._verifyAuthentication();
    // Implementation would go here
    return this.userData;
  }

  async startAssignment(administrationId: string, transaction?: Transaction, targetUid?: string) {
    this._verifyAuthentication();
    // Implementation would go here
  }

  async completeAssignment(administrationId: string, transaction?: Transaction) {
    this._verifyAuthentication();
    // Implementation would go here
  }

  // Add other methods as needed...
} 