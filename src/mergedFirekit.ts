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
  signInWithRedirect,
  GoogleAuthProvider,
  linkWithPopup,
  unlink,
  sendPasswordResetEmail,
  getRedirectResult,
  sendSignInLinkToEmail,
  signInWithEmailLink
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
      console.log('[RoarMergedFirekit] Starting project initialization with config:', this.roarConfig.merged);
      
      // Initialize single Firebase project
      this.project = await initializeFirebaseProject(
        this.roarConfig.merged,
        'merged-project',
        this._authPersistence,
        this._markRawConfig,
      );

      console.log('[RoarMergedFirekit] Project initialized successfully:', {
        appName: this.project.firebaseApp.name,
        hasAuth: !!this.project.auth,
        hasDb: !!this.project.db,
        hasFunctions: !!this.project.functions,
        hasStorage: !!this.project.storage
      });

      this.verboseLog('Firebase project initialized:', this.project.firebaseApp.name);

      // Set up auth state listener
      console.log('[RoarMergedFirekit] Setting up auth state listener...');
      this._setupAuthStateListener();

      this._initialized = true;
      console.log('[RoarMergedFirekit] Initialization complete, firekit marked as initialized');
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

  async signInFromRedirectResult(enableCookiesCallback?: () => void) {
    this._verifyInit();
    
    try {
      // For merged architecture, we can use getRedirectResult from Firebase Auth
      const result = await getRedirectResult(this.project!.auth);
      this.verboseLog('Redirect result:', result?.user?.uid);
      return result;
    } catch (error) {
      console.error('Redirect result error:', error);
      if (enableCookiesCallback && (error as AuthError)?.code === 'auth/web-storage-unsupported') {
        enableCookiesCallback();
      }
      throw error;
    }
  }

  async getRedirectResult(enableCookiesCallback?: () => void) {
    // Alias for signInFromRedirectResult for backward compatibility
    return this.signInFromRedirectResult(enableCookiesCallback);
  }

  async signInWithPopup(provider: string) {
    this._verifyInit();
    
    try {
      let authProvider;
      if (provider === 'google') {
        authProvider = new GoogleAuthProvider();
      } else {
        throw new Error(`Unsupported provider: ${provider}`);
      }
      
      const result = await signInWithPopup(this.project!.auth, authProvider);
      this.verboseLog('Popup sign in successful:', result.user.uid);
      return result;
    } catch (error) {
      console.error('Popup sign in error:', error);
      throw error;
    }
  }

  async initiateRedirect(provider: string) {
    this._verifyInit();
    
    try {
      let authProvider;
      if (provider === 'google') {
        authProvider = new GoogleAuthProvider();
      } else {
        throw new Error(`Unsupported provider: ${provider}`);
      }
      
      await signInWithRedirect(this.project!.auth, authProvider);
      this.verboseLog('Redirect initiated for provider:', provider);
    } catch (error) {
      console.error('Redirect initiation error:', error);
      throw error;
    }
  }

  async forceIdTokenRefresh() {
    this._verifyInit();
    
    if (!this.project?.user) {
      throw new Error('User must be authenticated to refresh token');
    }
    
    try {
      const idTokenResult = await this.project.user.getIdTokenResult(true);
      this._idToken = idTokenResult.token;
      this.verboseLog('ID token refreshed');
      return idTokenResult;
    } catch (error) {
      console.error('Token refresh error:', error);
      throw error;
    }
  }

  async sendPasswordResetEmail(email: string) {
    this._verifyInit();
    
    try {
      await sendPasswordResetEmail(this.project!.auth, email);
      this.verboseLog('Password reset email sent to:', email);
    } catch (error) {
      console.error('Password reset error:', error);
      throw error;
    }
  }

  async createStudentWithEmailPassword(email: string, password: string, userData: any) {
    // For now, delegate to registerWithEmailAndPassword
    // This would need full implementation for student-specific logic
    this.verboseLog('Creating student with email/password:', email);
    return this.registerWithEmailAndPassword({ email, password });
  }

  async createUsers(userData: any) {
    this._verifyAdmin();
    
    // This would need full implementation for bulk user creation
    // For now, throw an error indicating it needs implementation
    throw new Error('createUsers method needs full implementation for merged architecture');
  }

  async getLegalDoc(docName: string) {
    this._verifyInit();
    
    try {
      const docRef = doc(this.project!.db, 'legal', docName);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        this.verboseLog('Legal document retrieved:', docName);
        return docSnap.data();
      } else {
        throw new Error(`Legal document not found: ${docName}`);
      }
    } catch (error) {
      console.error('Error getting legal document:', error);
      throw error;
    }
  }

  async completeAssessment(adminId: string, taskId: string) {
    this._verifyAuthentication();
    
    // This would need full implementation for assessment completion
    // For now, just log the action
    this.verboseLog('Completing assessment:', { adminId, taskId });
    
    // Placeholder implementation - would need to update assignment status
    // and potentially trigger cloud functions
    return Promise.resolve();
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

  public get restConfig() {
    // Always ensure we have a valid base URL, regardless of initialization state
    let baseURL;
    
    // Check if we have emulator configuration
    const useEmulators = this.roarConfig?.merged?.useEmulators;
    const emulatorPorts = this.roarConfig?.merged?.emulatorPorts;
    const projectId = this.roarConfig?.merged?.projectId;
    
    if (useEmulators && emulatorPorts?.db && projectId) {
      const host = this.roarConfig.merged.emulatorHost || 'localhost';
      const port = emulatorPorts.db;
      baseURL = `http://${host}:${port}/v1/projects/${projectId}/databases/(default)/documents`;
    } else if (projectId) {
      baseURL = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    } else {
      // Fallback - this should not happen but prevents undefined baseURL
      console.warn('[RoarMergedFirekit] restConfig: No projectId available, using fallback baseURL');
      baseURL = 'https://firestore.googleapis.com/v1/projects/unknown/databases/(default)/documents';
    }

    // Create headers object, only include Authorization if we have a token
    const headers: Record<string, string> = {};
    if (this._idToken) {
      headers.Authorization = `Bearer ${this._idToken}`;
    }

    const config = {
      headers: headers,
      baseURL: baseURL,
    };

    return {
      admin: config,
      app: config,
    };
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

  // Direct auth getter for backward compatibility
  public get auth() {
    return this.project?.auth;
  }

  // Backward compatibility getters for dual-database architecture
  public get admin() {
    return {
      auth: this.project?.auth,
      db: this.project?.db,
      functions: this.project?.functions,
      storage: this.project?.storage,
    };
  }

  public get app() {
    return {
      auth: this.project?.auth,
      db: this.project?.db,
      functions: this.project?.functions,
      storage: this.project?.storage,
    };
  }

  async initiateLoginWithEmailLink({ email, redirectUrl }: { email: string; redirectUrl: string }) {
    this._verifyInit();
    
    try {
      const actionCodeSettings = {
        url: redirectUrl,
        handleCodeInApp: true,
      };
      
      await sendSignInLinkToEmail(this.project!.auth, email, actionCodeSettings);
      this.verboseLog('Email link sent to:', email);
    } catch (error) {
      console.error('Email link initiation error:', error);
      throw error;
    }
  }

  async signInWithEmailLink({ email, emailLink }: { email: string; emailLink: string }) {
    this._verifyInit();
    
    try {
      const result = await signInWithEmailLink(this.project!.auth, email, emailLink);
      this.verboseLog('Email link sign in successful:', result.user.uid);
      return result;
    } catch (error) {
      console.error('Email link sign in error:', error);
      throw error;
    }
  }
} 