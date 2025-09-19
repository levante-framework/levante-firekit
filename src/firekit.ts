/* eslint-disable @typescript-eslint/no-non-null-assertion */
import _get from 'lodash/get';
import _isEmpty from 'lodash/isEmpty';
import {
  AuthError,
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  ProviderId,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  getIdToken,
  getRedirectResult,
  isSignInWithEmailLink,
  linkWithCredential,
  linkWithPopup,
  linkWithRedirect,
  onAuthStateChanged,
  onIdTokenChanged,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  unlink,
} from 'firebase/auth';
import {
  Unsubscribe,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  updateDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable, HttpsCallableResult } from 'firebase/functions';

import { AuthPersistence, MarkRawConfig, emptyOrgList, initializeFirebaseProject } from './firestore/util';
import {
  Assessment,
  FirebaseProject,
  Name,
  OrgLists,
  RoarConfig,
  StartTaskResult,
  UserDataInAdminDb,
  Legal,
} from './interfaces';
import { UserInput } from './firestore/app/user';
import { RoarAppkit } from './firestore/app/appkit';
import { RoarTaskVariant, FirestoreVariantData, FirestoreTaskData, TaskVariantBase } from './firestore/app/task';

enum AuthProviderType {
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

export interface ChildData {
  email: string;
  password: string;
  userData: CreateUserInput;
  familyId: string;
  orgCode: string;
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

interface LevanteUserData {
  id: string;
  userType: string;
  childId: string;
  parentId: string;
  teacherId: string;
  month: string;
  year: string;
  group: string[];
}

interface LevanteSurveyResponses {
  [key: string]: string;
}

interface UpdateTaskVariantData {
  taskId: string;
  data: FirestoreTaskData | FirestoreVariantData;
  variantId?: string;
}

export interface Emulators {
  auth: {
    host: string;
    port: number;
  };
  firestore: {
    host: string;
    port: number;
  };
  functions: {
    host: string;
    port: number;
  };
  ui: {
    host: string;
    port: number;
  };
  hub: {
    host: string;
    port: number;
  };
  logging: {
    host: string;
    port: number;
  };
}

export class RoarFirekit {
  admin?: FirebaseProject;
  currentAssignments?: CurrentAssignments;
  oAuthAccessToken?: string;
  roarAppUserInfo?: UserInput;
  roarConfig: RoarConfig;
  emulatorConfig?: Emulators;
  userData?: UserDataInAdminDb;
  listenerUpdateCallback: (...args: unknown[]) => void;
  private _admin?: boolean;
  private _adminClaimsListener?: Unsubscribe;
  private _adminOrgs?: Record<string, string[]>;
  private _adminTokenListener?: Unsubscribe;
  private _authPersistence: AuthPersistence;
  private _identityProviderType?: AuthProviderType;
  private _identityProviderId?: string;
  private _idTokenReceived?: boolean;
  private _idTokens: { admin?: string; app?: string };
  private _initialized: boolean;
  private _markRawConfig: MarkRawConfig;
  private _roarUid?: string;
  private _superAdmin?: boolean;
  private _verboseLogging?: boolean;
  /**
   * Create a RoarFirekit. This expects an object with keys `roarConfig`,
   * where `roarConfig` is a [[RoarConfig]] object.
   * @param {{roarConfig: RoarConfig }=} destructuredParam
   *     roarConfig: The ROAR firebase config object
   */
  constructor({
    roarConfig,
    verboseLogging = false,
    authPersistence = AuthPersistence.session,
    markRawConfig = {},
    listenerUpdateCallback,
    emulatorConfig,
  }: {
    roarConfig: RoarConfig;
    emulatorConfig?: Emulators;
    dbPersistence: boolean;
    authPersistence?: AuthPersistence;
    markRawConfig?: MarkRawConfig;
    verboseLogging: boolean;
    listenerUpdateCallback?: (...args: unknown[]) => void;
  }) {
    this.roarConfig = roarConfig;
    this.emulatorConfig = emulatorConfig;
    this._verboseLogging = verboseLogging;
    this._authPersistence = authPersistence;
    this._markRawConfig = markRawConfig;
    this._initialized = false;
    this._idTokens = {};
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    this.listenerUpdateCallback = listenerUpdateCallback ?? (() => {});
  }

  private _getProviderIds() {
    return {
      ...ProviderId,
      ROAR_ADMIN_PROJECT: `oidc.${this.roarConfig.admin.projectId}`,
    };
  }

  private _scrubAuthProperties() {
    this.userData = undefined;
    this.roarAppUserInfo = undefined;
    this._adminOrgs = undefined;
    this._superAdmin = undefined;
    this.currentAssignments = undefined;
    this.oAuthAccessToken = undefined;
    this._adminClaimsListener = undefined;
    this._adminTokenListener = undefined;
    this._idTokens = {};
  }

  async init() {
    this.admin = await initializeFirebaseProject(
      this.roarConfig.admin,
      'admin',
      this.emulatorConfig,
      this._authPersistence,
      this._markRawConfig,
    );

    this._initialized = true;

    onAuthStateChanged(this.admin.auth, async (user) => {
      this.verboseLog('onAuthStateChanged triggered for admin auth');
      if (this.admin) {
        if (user) {
          this.verboseLog('admin firebase instance and user are defined');
          this.admin.user = user;
          this._adminClaimsListener = this._listenToClaims(this.admin);
          this.verboseLog('adminClaimsListener instance set up using listenToClaims');
          this._adminTokenListener = this._listenToTokenChange(this.admin, 'admin');
          this.verboseLog('adminTokenListener instance set up using listenToClaims');
          this.verboseLog('[admin] Attempting to fire user.getIdToken(), existing token is', this._idTokens.admin);
          user.getIdToken().then((idToken) => {
            this.verboseLog('in .then() for user.getIdToken() with new token', idToken);
            this._idTokens.admin = idToken;
            this.verboseLog(`Updated internal admin token to ${idToken}`);
          });
          this._roarUid = await this.getRoarUid();
        } else {
          this.verboseLog('User for admin is undefined.');
          this.admin.user = undefined;
          this._roarUid = undefined;
        }
      }
      this.verboseLog('[admin] Call this.listenerUpdateCallback()');
      this.listenerUpdateCallback();
    });

    return this;
  }

  private verboseLog(...logStatement: unknown[]) {
    if (this._verboseLogging) {
      console.log('[RoarFirekit] ', ...logStatement);
    } else return;
  }

  public get initialized() {
    return this._initialized;
  }

  /**
   * Verifies if the RoarFirekit instance has been initialized.
   *
   * This method checks if the RoarFirekit instance has been initialized by checking the `_initialized` property.
   * If the instance has not been initialized, it throws an error with a descriptive message.
   *
   * @throws {Error} - If the RoarFirekit instance has not been initialized.
   *
   */
  private _verifyInit() {
    if (!this._initialized) {
      throw new Error('RoarFirekit has not been initialized. Use the `init` method.');
    }
  }

  //           +--------------------------------+
  // ----------|  Begin Authentication Methods  |----------
  //           +--------------------------------+

  /**
   * Verifies if the user is authenticated in the application.
   *
   * This method checks if the user is authenticated in both the admin and assessment Firebase projects.
   * If the user is authenticated in both projects, the method returns without throwing an error.
   * If the user is not authenticated in either project, the method throws an error with the message 'User is not authenticated.'
   *
   * @throws {Error} - Throws an error if the user is not authenticated.
   */
  private _verifyAuthentication() {
    this._verifyInit();
    if (this.admin!.user === undefined) {
      throw new Error('User is not authenticated.');
    }
    return true;
  }

  private _verifyAdmin() {
    if (!this.superAdmin && !this._admin) {
      throw new Error('User is not an administrator.');
    }
  }

  /**
   * Listens for changes in the user's custom claims and updates the internal state accordingly.
   *
   * This method sets up a snapshot listener on the user's custom claims document in the admin Firebase project.
   * When the listener detects changes in the claims, it updates the internal state of the `RoarAuth` instance.
   * It also refreshes the user's ID token if the claims have been updated.
   *
   * @param {FirebaseFirestore.Firestore} firekit.db - The Firestore database instance for the admin Firebase project.
   * @param {FirebaseAuth.User} firekit.user - The user object for the admin Firebase project.
   * @returns {FirebaseFirestore.Unsubscribe} - The unsubscribe function to stop listening for changes in the user's custom claims.
   * @throws {FirebaseError} - If there is an error setting up the snapshot listener.
   */
  private _listenToClaims(firekit: FirebaseProject) {
    this.verboseLog('entry point to listenToClaims');
    this._verifyInit();
    if (firekit.user) {
      this.verboseLog('firekit.user is defined');
      let unsubscribe;
      this.verboseLog('About to try setting up the claims listener');
      try {
        this.verboseLog('Beginning onSnapshot definition');
        unsubscribe = onSnapshot(
          doc(firekit.db, 'userClaims', firekit.user!.uid),
          async (doc) => {
            this.verboseLog('In onSnapshot call for listenToClaims');
            const data = doc.data();
            this._adminOrgs = data?.claims?.adminOrgs;
            this._superAdmin = data?.claims?.super_admin;

            if (this.roarConfig.admin.projectId.includes('levante')) {
              this._admin = data?.claims?.admin || false;
            }

            this.verboseLog('about to check for existance of data.lastUpdated');
            if (data?.lastUpdated) {
              this.verboseLog('lastUpdate exists.');
              const lastUpdated = new Date(data!.lastUpdated);
              this.verboseLog(
                'Checking for firekit.claimsLastUpdated existance or outdated (< lastUpdated from retrieved data)',
              );
              if (!firekit.claimsLastUpdated || lastUpdated > firekit.claimsLastUpdated) {
                this.verboseLog(
                  "Firekit's last updated either does not exist or is outdated. Await getIdToken and update firekit's claimsLastUpdated field.",
                );
                // Update the user's ID token and refresh claimsLastUpdated.
                await getIdToken(firekit.user!, true);
                firekit.claimsLastUpdated = lastUpdated;
              }
            }
            this.verboseLog('Call listenerUpdateCallback from listenToClaims');
            this.listenerUpdateCallback();
          },
          (error) => {
            throw error;
          },
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        this.verboseLog('Attempt to set up claims listener failed. Error is', error);
        if (error.code !== 'permission-denied') {
          throw error;
        }
      }
      return unsubscribe;
    }
  }

  /**
   * Forces a refresh of the ID token for the admin Firebase user.
   *
   * This method retrieves the ID token for the admin Firebase user
   * and refreshes it. It ensures that the token is up-to-date and valid.
   *
   * @returns {Promise<void>} - A promise that resolves when the ID tokens are refreshed successfully.
   * @throws {FirebaseError} - If an error occurs while refreshing the ID tokens.
   */
  async forceIdTokenRefresh() {
    this.verboseLog('Entry point for forceIdTokenRefresh');
    this._verifyAuthentication();
    await getIdToken(this.admin!.user!, true);
  }

  /**
   * Listens for changes in the ID token of the specified Firebase project and updates the corresponding token.
   *
   * This method sets up a listener to track changes in the ID token of the specified Firebase project (admin).
   * When the ID token changes, it retrieves the new ID token and updates the corresponding token in the `_idTokens` object.
   * It also calls the `listenerUpdateCallback` function to notify any listeners of the token update.
   *
   * @param {FirebaseProject} firekit - The Firebase project to listen for token changes.
   * @param {'admin'} _type - The type of Firebase project ('admin').
   * @returns {firebase.Unsubscribe} - A function to unsubscribe from the listener.
   * @private
   */
  private _listenToTokenChange(firekit: FirebaseProject, _type: 'admin') {
    this.verboseLog('Entry point for listenToTokenChange, called with', _type);
    this._verifyInit();
    this.verboseLog('Checking for existance of tokenListener with type', _type);
    if (!this._adminTokenListener && _type === 'admin') {
      this.verboseLog('Token listener does not exist, create now.');
      return onIdTokenChanged(firekit.auth, async (user) => {
        this.verboseLog('onIdTokenChanged body');
        if (user) {
          this.verboseLog('user exists, await user.getIdTokenResult(false)');
          const idTokenResult = await user.getIdTokenResult(false);
          this.verboseLog('Returned with token', idTokenResult);
          if (_type === 'admin') {
            this.verboseLog('Type is admin, set idTokenRecieved flag');
            this._idTokenReceived = true;
          }
          this.verboseLog(`Setting idTokens.${_type} to token`, idTokenResult.token);
          this._idTokens[_type] = idTokenResult.token;
        }
        this.verboseLog('Calling listenerUpdateCallback from listenToTokenChange', _type);
        this.listenerUpdateCallback();
      });
    }
    return this._adminTokenListener;
  }

  /**
   * Sets the UID custom claims for the admin and assessment UIDs in the Firebase projects.
   *
   * This method is responsible for associating the admin and assessment UIDs in the Firebase projects.
   * It calls the setUidClaims cloud function in the admin Firebase project.
   * If the cloud function execution is successful, it refreshes the ID tokens for both projects.
   *
   * @returns {Promise<any>} - A promise that resolves with the result of the setUidClaims cloud function execution.
   * @param {object} input - An object containing the required parameters
   * @param {string} input.identityProviderId - The identity provider ID for the user (optional).
   * @param {AuthProviderType} input.identityProviderType - The type of the identity provider (optional).
   * @throws {Error} - If the setUidClaims cloud function execution fails, an Error is thrown.
   */
  private async _setUidCustomClaims({
    identityProviderId = undefined,
    identityProviderType = undefined,
  }: {
    identityProviderId?: string;
    identityProviderType?: AuthProviderType;
  } = {}) {
    this.verboseLog('Entry point to setUidCustomClaims');
    this._verifyAuthentication();

    this.verboseLog('Calling cloud function for setUidClaims');
    const setUidClaims = httpsCallable(this.admin!.functions, 'setUidClaims');
    const result = await setUidClaims({
      identityProviderId,
      identityProviderType,
    });
    this.verboseLog('setUidClaims returned with result', result);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (_get(result.data as any, 'status') !== 'ok') {
      this.verboseLog('Error in calling setUidClaims cloud function', result.data);
      throw new Error('Failed to set UIDs in the admin and assessment Firebase projects.');
    }

    await this.forceIdTokenRefresh();

    this.verboseLog('Returning result from setUidCustomClaims', result);
    return result;
  }

  /**
   * Checks if the given email address is available for a new user registration.
   *
   * This method verifies if the given email address is not already associated with
   * a user in the admin Firebase project. It returns a promise that resolves with
   * a boolean value indicating whether the email address is available or not.
   *
   * @param {string} email - The email address to check.
   * @returns {Promise<boolean>} - A promise that resolves with a boolean value indicating whether the email address is available or not.
   * @throws {FirebaseError} - If an error occurs while checking the email availability.
   */
  async isEmailAvailable(email: string): Promise<boolean> {
    this._verifyInit();
    const signInMethods = await fetchSignInMethodsForEmail(this.admin!.auth, email);
    return signInMethods.length === 0;
  }

  /**
   * Fetches the list of providers associated with the given user's email address.
   *
   * This method retrieves the list of providers associated with the given user's email address
   * from the admin Firebase project. The list of providers includes the authentication methods
   * that the user has used to sign in with their email address.
   *
   * @param {string} email - The email address of the user.
   * @returns {Promise<string[]>} - A promise that resolves with an array of provider IDs.
   * @throws {FirebaseError} - If an error occurs while fetching the email authentication methods.
   */
  async fetchEmailAuthMethods(email: string): Promise<string[]> {
    this._verifyInit();
    return fetchSignInMethodsForEmail(this.admin!.auth, email).then((signInMethods) => {
      const providerMap: Record<string, string> = {
        [EmailAuthProvider.EMAIL_PASSWORD_SIGN_IN_METHOD]: 'password',
        [EmailAuthProvider.EMAIL_LINK_SIGN_IN_METHOD]: 'link',
        'google.com': 'google',
      };

      return signInMethods
        .filter((method): method is keyof typeof providerMap => method in providerMap)
        .map((method) => providerMap[method]);
    });
  }

  /**
   * Registers a new user with the provided email and password.
   *
   * This method creates a new user in both the admin and assessment Firebase projects.
   * It first creates the user in the admin project and then in the assessment project.
   * After successful user creation, it sets the UID custom claims by calling the `_setUidCustomClaims` method.
   *
   * @param {object} params - The parameters for registering a new user.
   * @param {string} params.email - The email address of the new user.
   * @param {string} params.password - The password of the new user.
   * @returns {Promise<void>} - A promise that resolves when the user registration is complete.
   * @throws {AuthError} - If the user registration fails, the promise will be rejected with an AuthError.
   */
  async registerWithEmailAndPassword({ email, password }: { email: string; password: string }) {
    this._verifyInit();
    return createUserWithEmailAndPassword(this.admin!.auth, email, password)
      .then(() => {
        this._identityProviderType = AuthProviderType.EMAIL;
        return this._setUidCustomClaims();
      })
      .catch((error: AuthError) => {
        console.log('Error creating user', error);
        console.log(error.code);
        console.log(error.message);
        throw error;
      });
  }

  /**
   * Initiates a login process using an email and password.
   *
   * This method signs in the user with the provided email and password in both the admin and assessment Firebase projects.
   * It first signs in the user in the admin project and then in the assessment project. After successful sign-in, it sets
   * the UID custom claims by calling the `_setUidCustomClaims` method.
   *
   * @param {object} params - The parameters for initiating the login process.
   * @param {string} params.email - The email address of the user.
   * @param {string} params.password - The password of the user.
   * @returns {Promise<void>} - A promise that resolves when the login process is complete.
   * @throws {AuthError} - If the login process fails, the promise will be rejected with an AuthError.
   */
  async logInWithEmailAndPassword({ email, password }: { email: string; password: string }) {
    this._verifyInit();
    return signInWithEmailAndPassword(this.admin!.auth, email, password)
      .then(async (adminUserCredential) => {
        this._identityProviderType = AuthProviderType.EMAIL;
      })
      .then(() => {
        return this._setUidCustomClaims();
      })
      .catch((error: AuthError) => {
        console.error('Error signing in', error);
        throw error;
      });
  }

  /**
   * Link the current user with email and password credentials.
   *
   * This method creates a credential using the provided email and password, and then links the user's account with the current user in both the admin and app Firebase projects.
   *
   * @param {string} email - The email of the user to link.
   * @param {string} password - The password of the user to link.
   *
   * @returns {Promise<void>} - A promise that resolves when the user is successfully linked with the specified authentication provider.
   */
  async linkEmailPasswordWithAuthProvider(email: string, password: string) {
    this._verifyAuthentication();

    const emailCredential = EmailAuthProvider.credential(email, password);
    return linkWithCredential(this.admin!.auth!.currentUser!, emailCredential).catch((error: AuthError) => {
      console.error('Error linking email and password', error);
      throw error;
    });
  }

  /**
   * Initiates the login process with an email link.
   *
   * This method sends a sign-in link to the specified email address. The user
   * can click on the link to sign in to their account. The sign-in process is
   * handled in a separate browser window or tab.
   *
   * @param {object} params - The parameters for initiating the login process.
   * @param {string} params.email - The email address to send the sign-in link to.
   * @param {string} params.redirectUrl - The URL to redirect the user to after they click on the sign-in link.
   * @returns {Promise<void>} - A promise that resolves when the sign-in link is sent successfully.
   */
  async initiateLoginWithEmailLink({ email, redirectUrl }: { email: string; redirectUrl: string }) {
    this._verifyInit();
    const actionCodeSettings = {
      url: redirectUrl,
      handleCodeInApp: true,
    };

    try {
      await sendSignInLinkToEmail(this.admin!.auth, email, actionCodeSettings);
    } catch (error) {
      console.error('Error sending sign in link:', error);
      throw error;
    }
  }

  /**
   * Check if the given email link is a sign-in with email link.
   *
   * This method checks if the given email link is a valid sign-in with email link
   * for the admin Firebase project. It returns a promise that resolves with a boolean
   * value indicating whether the email link is valid or not.
   *
   * @param {string} emailLink - The email link to check.
   * @returns {Promise<boolean>} - A promise that resolves with a boolean value indicating whether the email link is valid or not.
   */
  async isSignInWithEmailLink(emailLink: string) {
    this._verifyInit();
    return isSignInWithEmailLink(this.admin!.auth, emailLink);
  }

  async signInWithEmailLink({ email, emailLink }: { email: string; emailLink: string }) {
    this._verifyInit();
    return signInWithEmailLink(this.admin!.auth, email, emailLink)
      .then(async (userCredential) => {
        this._identityProviderType = AuthProviderType.EMAIL;
        const roarProviderIds = this._getProviderIds();
        const roarAdminProvider = new OAuthProvider(roarProviderIds.ROAR_ADMIN_PROJECT);
        const roarAdminIdToken = await getIdToken(userCredential.user);
        const roarAdminCredential = roarAdminProvider.credential({
          idToken: roarAdminIdToken,
        });
        return roarAdminCredential;
      })
      .then((credential) => {
        if (credential) {
          return this._setUidCustomClaims();
        }
      });
  }

  /**
   * Handle the sign-in process in a popup window.
   *
   * This method handles the sign-in process in a popup window from from an
   * external identity provider.  It retrieves the user's credentials from the
   * popup result and authenticates the user to the admin Firebase project
   * using these credentials.
   *
   * The identity provider token is generally mean to be one-time use only.
   * Because of this, the external identity provider's credential cannot be
   * reused in the assessment project. To authenticate into the assessment
   * project, we ask the admin Firebase project itself to mint a new credential
   * for the assessment project. Thus, the external identity providers are used
   * only in the admin Firebase project. And the admin Firebase project acts as
   * an "external" identity provider for the assessment project.
   *
   * Therefore, the workflow for this method is as follows:
   * 1. Authenticate into the external provider using a popup window.
   * 2. Retrieve the external identity provider's credential from the popup result.
   * 3. Authenticate into the admin Firebase project with this credential.
   * 4. Generate a new "external" credential from the admin Firebase project.
   * 5. Authenticate into the assessment Firebase project with the admin project's "external" credential.
   * 6. Set UID custom claims by calling setUidCustomClaims().
   *
   * @param {AuthProviderType} provider - The authentication provider to use. It can be one of the following:
   * - AuthProviderType.GOOGLE
   *
   * @returns {Promise<UserCredential | null>} - A promise that resolves with the user's credential or null.
   */
  async signInWithPopup(provider: AuthProviderType) {
    this._verifyInit();
    const allowedProviders = [AuthProviderType.GOOGLE];

    let authProvider;
    if (provider === AuthProviderType.GOOGLE) {
      authProvider = new GoogleAuthProvider();
    } else {
      throw new Error(`provider must be one of ${allowedProviders.join(', ')}. Received ${provider} instead.`);
    }

    const allowedErrors = ['auth/cancelled-popup-request', 'auth/popup-closed-by-user'];
    const swallowAllowedErrors = (error: AuthError) => {
      if (!allowedErrors.includes(error.code)) {
        throw error;
      }
    };

    let oAuthAccessToken: string | undefined;

    return signInWithPopup(this.admin!.auth, authProvider)
      .then(async (adminUserCredential) => {
        this._identityProviderType = provider;

        if (provider === AuthProviderType.GOOGLE) {
          const credential = GoogleAuthProvider.credentialFromResult(adminUserCredential);
          // This gives you a Google Access Token. You can use it to access Google APIs.
          // TODO: Find a way to put this in the onAuthStateChanged handler
          oAuthAccessToken = credential?.accessToken;
          return credential;
        }
      })
      .catch(swallowAllowedErrors)
      .then((credential) => {
        if (credential) {
          const claimsParams = {
            identityProviderId: this._identityProviderId,
            identityProviderType: this._identityProviderType,
          };
          return this._setUidCustomClaims(claimsParams);
        }
      });
  }

  /**
   * Link the current user with the specified authentication provider using a popup window.
   *
   * This method opens a popup window to allow the user to sign in with the specified authentication provider.
   * It then links the user's account with the current user in both the admin and app Firebase projects.
   *
   * @param {AuthProviderType} provider - The authentication provider to link with. It can be one of the following:
   * - AuthProviderType.GOOGLE
   *
   * @returns {Promise<void>} - A promise that resolves when the user is successfully linked with the specified authentication provider.
   *
   * @throws {Error} - If the specified provider is not one of the allowed providers, an error is thrown.
   */
  async linkAuthProviderWithPopup(provider: AuthProviderType) {
    this._verifyAuthentication();
    const allowedProviders = [AuthProviderType.GOOGLE];

    let authProvider;
    if (provider === AuthProviderType.GOOGLE) {
      authProvider = new GoogleAuthProvider();
    } else {
      throw new Error(`provider must be one of ${allowedProviders.join(', ')}. Received ${provider} instead.`);
    }

    const allowedErrors = ['auth/cancelled-popup-request', 'auth/popup-closed-by-user'];
    const swallowAllowedErrors = (error: AuthError) => {
      if (!allowedErrors.includes(error.code)) {
        throw error;
      }
    };

    let oAuthAccessToken: string | undefined;

    return linkWithPopup(this.admin!.auth!.currentUser!, authProvider)
      .then(async (adminUserCredential) => {
        this._identityProviderType = provider;
        if (provider === AuthProviderType.GOOGLE) {
          const credential = GoogleAuthProvider.credentialFromResult(adminUserCredential);
          // This gives you a Google Access Token. You can use it to access Google APIs.
          // TODO: Find a way to put this in the onAuthStateChanged handler
          oAuthAccessToken = credential?.accessToken;
          return credential;
        }
      })
      .catch(swallowAllowedErrors)
      .then((credential) => {
        if (credential) {
          const claimsParams = {
            identityProviderId: this._identityProviderId,
            identityProviderType: this._identityProviderType,
          };
          return this._setUidCustomClaims(claimsParams);
        }
      });
  }

  /**
   * Initiates a redirect sign-in flow with the specified authentication provider.
   *
   * This method triggers a redirect to the authentication provider's sign-in page.
   * After the user successfully signs in, they will be redirected back to the application.
   *
   * If the linkToAuthenticatedUser parameter is set to true, an existing user
   * must already be authenticated and the user's account will be linked with
   * the new provider.
   *
   * @param {AuthProviderType} provider - The authentication provider to initiate the sign-in flow with.
   * It can be one of the following: AuthProviderType.GOOGLE.
   * @param {boolean} linkToAuthenticatedUser - Whether to link an authenticated user's account with the new provider.
   *
   * @returns {Promise<void>} - A promise that resolves when the redirect sign-in flow is initiated.
   * @throws {Error} - If the specified provider is not one of the allowed providers, an error is thrown.
   */
  async initiateRedirect(provider: AuthProviderType, linkToAuthenticatedUser = false) {
    this.verboseLog('Entry point for initiateRedirect');
    this._verifyInit();

    if (linkToAuthenticatedUser) {
      this._verifyAuthentication();
    }

    const allowedProviders = [AuthProviderType.GOOGLE];

    let authProvider;
    this.verboseLog('Attempting sign in with AuthProvider', provider);
    if (provider === AuthProviderType.GOOGLE) {
      authProvider = new GoogleAuthProvider();
      this.verboseLog('Google AuthProvider object:', authProvider);
    } else {
      throw new Error(`provider must be one of ${allowedProviders.join(', ')}. Received ${provider} instead.`);
    }

    this.verboseLog('Calling signInWithRedirect from initiateRedirect with provider', authProvider);
    if (linkToAuthenticatedUser) {
      return linkWithRedirect(this.admin!.auth!.currentUser!, authProvider);
    }
    return signInWithRedirect(this.admin!.auth, authProvider);
  }

  /**
   * Handle the sign-in process from a redirect result.
   *
   * This method handles the sign-in process after a user has been redirected
   * from an external identity provider.  It retrieves the user's credentials
   * from the redirect result and authenticates the user to the admin Firebase
   * project using the credentials.
   *
   * The identity provider token is generally mean to be one-time use only.
   * Because of this, the external identity provider's credential cannot be
   * reused in the assessment project. To authenticate into the assessment
   * project, we ask the admin Firebase project itself to mint a new credential
   * for the assessment project. Thus, the external identity providers are used
   * only in the admin Firebase project. And the admin Firebase project acts as
   * an "external" identity provider for the assessment project.
   *
   * Therefore, the workflow for this method is as follows:
   * 1. Get the redirect result from the admin Firebase project.
   * 2. Retrieve the external identity provider's credential from the redirect result.
   * 3. Authenticate into the admin Firebase project with this credential.
   * 4. Generate a new "external" credential from the admin Firebase project.
   * 5. Authenticate into the assessment Firebase project with the admin project's "external" credential.
   * 6. Set UID custom claims by calling setUidCustomClaims().
   *
   * @param {() => void} enableCookiesCallback - A callback function to be invoked when the enable cookies error occurs.
   * @returns {Promise<{ status: 'ok' } | null>} - A promise that resolves with an object containing the status 'ok' if the sign-in is successful,
   * or resolves with null if the sign-in is not successful.
   */
  async signInFromRedirectResult(enableCookiesCallback: () => void) {
    this._verifyInit();
    this.verboseLog('Entry point for signInFromRedirectResult');
    const catchEnableCookiesError = (error: AuthError) => {
      this.verboseLog('Catching error, checking if it is the enableCookies error');
      if (error.code == 'auth/web-storage-unsupported') {
        this.verboseLog('Error was known enableCookies error, invoking enableCookiesCallback()');
        enableCookiesCallback();
      } else {
        this.verboseLog('It was not the known enableCookies error', error);
        throw error;
      }
    };

    let oAuthAccessToken: string | undefined;
    let authProvider: AuthProviderType | undefined;

    this.verboseLog('calling getRedirect result from signInFromRedirect');
    return getRedirectResult(this.admin!.auth)
      .then(async (adminUserCredential) => {
        this.verboseLog('Then block for getRedirectResult');
        if (adminUserCredential !== null) {
          this.verboseLog('adminUserCredential is not null');
          const providerId = adminUserCredential.providerId;
          const roarProviderIds = this._getProviderIds();
          this.verboseLog('providerId is', providerId);
          this.verboseLog('roarProviderIds are', roarProviderIds);
          if (providerId === roarProviderIds.GOOGLE) {
            this.verboseLog('ProviderId is google, calling credentialFromResult with ', adminUserCredential);
            const credential = GoogleAuthProvider.credentialFromResult(adminUserCredential);
            // This gives you a Google Access Token. You can use it to access Google APIs.
            // TODO: Find a way to put this in the onAuthStateChanged handler
            authProvider = AuthProviderType.GOOGLE;
            this._identityProviderType = authProvider;
            oAuthAccessToken = credential?.accessToken;
            this.verboseLog('oAuthAccessToken = ', oAuthAccessToken);
            this.verboseLog('returning credential from first .then() ->', credential);
            return credential;
          }
        }
        return null;
      })
      .catch(catchEnableCookiesError)
      .then((credential) => {
        this.verboseLog('Attempting to set uid custom claims using credential', credential);
        if (credential) {
          this.verboseLog('Calling setUidCustomClaims with creds', credential);
          const claimsParams = {
            identityProviderId: this._identityProviderId,
            identityProviderType: this._identityProviderType,
          };
          return this._setUidCustomClaims(claimsParams);
        }
        return null;
      });
  }

  /**
   * Unlinks the specified authentication provider from the current user.
   *
   * This method only unlinks the specified provider from the user in the admin Firebase project.
   * The roarProciderIds.ROAR_ADMIN_PROJECT provider is maintained in the assessment Firebase project.
   *
   * @param {AuthProviderType} provider - The authentication provider to unlink.
   * It can be one of the following: AuthProviderType.GOOGLE
   * @returns {Promise<void>} - A promise that resolves when the provider is unlinked.
   * @throws {Error} - If the provided provider is not one of the allowed providers.
   */
  async unlinkAuthProvider(provider: AuthProviderType) {
    this._verifyAuthentication();

    const allowedProviders = [AuthProviderType.GOOGLE];
    const roarProviderIds = this._getProviderIds();

    let providerId: string;
    if (provider === AuthProviderType.GOOGLE) {
      providerId = roarProviderIds.GOOGLE;
    } else {
      throw new Error(`provider must be one of ${allowedProviders.join(', ')}. Received ${provider} instead.`);
    }

    return unlink(this.admin!.auth!.currentUser!, providerId);
  }

  /**
   * Sign out the current user from both the assessment (aka app) Firebase project and the admin Firebase project.
   *
   * This method clears the authentication properties and signs out the user from both the app (aka assessment) and admin Firebase projects.
   *
   * @returns {Promise<void>} - A promise that resolves when the user is successfully signed out.
   */
  async signOut() {
    this._verifyAuthentication();
    if (this._adminClaimsListener) this._adminClaimsListener();
    if (this._adminTokenListener) this._adminTokenListener();
    this._scrubAuthProperties();
    await signOut(this.admin!.auth);
  }

  //           +--------------------------------+
  // ----------|   End Authentication Methods   |----------
  //           +--------------------------------+

  //           +--------------------------------+
  // ----------| Begin Methods to Read User and |----------
  // ----------| Assignment/Administration Data |----------
  //           +--------------------------------+

  public get superAdmin() {
    return this._superAdmin;
  }

  public get idTokenReceived() {
    return this._idTokenReceived;
  }

  public get idTokens() {
    return this._idTokens;
  }

  public get restConfig() {
    return {
      admin: {
        headers: { Authorization: `Bearer ${this._idTokens.admin}` },
      },
    };
  }

  public get adminOrgs() {
    return this._adminOrgs;
  }

  public get dbRefs() {
    if (this.admin?.user) {
      return {
        admin: {
          user: doc(this.admin.db, 'users', this.roarUid!),
          assignments: collection(this.admin.db, 'users', this.roarUid!, 'assignments'),
          runs: collection(this.admin.db, 'users', this.roarUid!, 'runs'),
          tasks: collection(this.admin.db, 'tasks'),
        },
      };
    } else {
      return undefined;
    }
  }

  // Not used, but could be used for task dictionary query in dashboard
  public async getTasksDictionary() {
    this._verifyAuthentication();
    const taskDocs = await getDocs(this.dbRefs!.admin.tasks);

    // Create a map with document IDs as keys and document data as values
    const taskMap = taskDocs.docs.reduce((acc, doc) => {
      acc[doc.id] = doc.data();
      return acc;
    }, {} as Record<string, object>);

    return taskMap;
  }

  public async getAdministrations({
    testData = false,
    restrictToOpenAdministrations = false,
  }: {
    testData: boolean;
    restrictToOpenAdministrations: boolean;
  }) {
    this._verifyAuthentication();
    const getAdministrationCallable = httpsCallable(this.admin!.functions, 'getAdministrations');
    const response = (await getAdministrationCallable({
      testData,
      restrictToOpenAdministrations,
    })) as HttpsCallableResult<{ status: string; data?: unknown }>;

    if (_get(response.data, 'status') !== 'ok') {
      throw new Error('Failed to retrieve administration IDs.');
    }

    return response.data.data ?? [];
  }

  async getLegalDoc(docName: string) {
    const docRef = doc(this.admin!.db, 'legal', docName);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      const gitHubUrl = `https://raw.githubusercontent.com/${_get(data, 'gitHubOrg')}/${_get(
        data,
        'gitHubRepository',
      )}/${_get(data, 'currentCommit')}/${_get(data, 'fileName')}`;
      try {
        const response = await fetch(gitHubUrl);
        const legalText = await response.text();
        return {
          text: legalText,
          version: _get(data, 'currentCommit'),
        };
      } catch (e) {
        throw new Error('Error retrieving consent document from GitHub.');
      }
    } else {
      return null;
    }
  }

  async updateConsentStatus(docName: string, consentVersion: string, params = {}) {
    console.log(`Updating consent status for ${this.dbRefs!.admin.user.path}.`);
    if (!_isEmpty(params) && _get(params, 'dateSigned')) {
      return await updateDoc(this.dbRefs!.admin.user, {
        [`legal.${docName}.${consentVersion}`]: arrayUnion(params),
      });
    } else {
      return await updateDoc(this.dbRefs!.admin.user, {
        [`legal.${docName}.${consentVersion}`]: arrayUnion({ dateSigned: new Date() }),
      });
    }
  }

  public get roarUid() {
    return this._roarUid;
  }

  public async getRoarUid() {
    const userClaimsRef = doc(this.admin!.db, 'userClaims', this.admin!.user!.uid);
    const userClaims = await getDoc(userClaimsRef).then((doc) => {
      if (!doc.exists()) {
        throw new Error('User claims document does not exist.');
      }
      return doc.data();
    });

    let _roarUid: string | undefined;
    if (!_isEmpty(userClaims) && userClaims.claims.roarUid) {
      _roarUid = userClaims.claims.roarUid;
    } else {
      _roarUid = this.admin?.user?.uid;
    }

    this._roarUid = _roarUid;
    return _roarUid;
  }

  async startAssessment(administrationId: string, taskId: string, taskVersion: string, targetUid?: string) {
    this._verifyAuthentication();

    const uid = targetUid ?? this.roarUid ?? (await this.getRoarUid());

    if (!uid) {
      throw new Error('Could not determine user ID');
    }

    try {
      const startTaskCloudFunction = httpsCallable(this.admin!.functions, 'startTask');
      const result = (await startTaskCloudFunction({
        administrationId,
        taskId,
        targetUid: uid,
      })) as HttpsCallableResult<StartTaskResult>;

      if (this.roarAppUserInfo === undefined) {
        this.roarAppUserInfo = {
          db: this.admin!.db,
          roarUid: uid,
          assessmentUid: this.admin!.user!.uid,
          assessmentPid: result.data.assessmentPid,
          userType: result.data.userData.userType,
        };
      }

      const taskInfo = {
        db: this.admin!.db,
        taskId,
        // This is fine being hardcoded to undefined since this field does not exist on the assignment document which is where we get the task info from.
        // When this is defined, it actually breaks starting the task (permissions error). Can probably be removed.
        taskName: undefined,
        taskVersion,
        variantName: result.data.taskInfo.variantName,
        variantParams: result.data.taskInfo.variantParams,
        variantId: result.data.taskInfo.variantId,
      };

      const app = new RoarAppkit({
        firebaseProject: this.admin,
        userInfo: this.roarAppUserInfo!,
        assigningOrgs: result.data.assigningOrgs,
        readOrgs: result.data.readOrgs,
        assignmentId: administrationId,
        taskInfo,
      });

      return app;
    } catch (error) {
      console.error('Error starting task: ', error);
      throw error;
    }
  }

  async completeAssessment(administrationId: string, taskId: string, targetUid?: string) {
    this._verifyAuthentication();

    const cloudCompleteTask = httpsCallable(this.admin!.functions, 'completeTask');

    const userId = targetUid ?? this.roarUid ?? (await this.getRoarUid());
    if (!userId) {
      throw new Error('Could not determine user ID');
    }

    const result = await cloudCompleteTask({ administrationId, taskId, userId });
    return result;
  }

  // These are all methods that will be important for admins, but not necessary for students
  /**
   * Create or update an administration
   *
   * @param input input object
   * @param input.name The administration name
   * @param input.assessments The list of assessments for this administration
   * @param input.dateOpen The start date for this administration
   * @param input.dateClose The end date for this administration
   * @param input.sequential Whether or not the assessments in this
   *                         administration must be taken sequentially
   * @param input.orgs The orgs assigned to this administration
   * @param input.tags Metadata tags for this administration
   * @param input.administrationId Optional ID of an existing administration. If
   *                               provided, this method will update an
   *                               existing administration.
   */
  async upsertAdministration({
    name,
    publicName,
    normalizedName,
    assessments,
    dateOpen,
    dateClose,
    sequential = true,
    orgs = emptyOrgList(),
    tags = [],
    administrationId,
    isTestData = false,
    legal,
  }: {
    name: string;
    publicName?: string;
    normalizedName: string;
    assessments: Assessment[];
    dateOpen: Date;
    dateClose: Date;
    sequential: boolean;
    orgs: OrgLists;
    tags: string[];
    administrationId?: string;
    isTestData: boolean;
    legal: Legal;
  }) {
    this._verifyAuthentication();
    this._verifyAdmin();

    if ([name, dateOpen, dateClose, assessments].some((param) => param === undefined || param === null)) {
      throw new Error('The parameters name, dateOpen, dateClose, and assessments are required');
    }

    if (dateClose < dateOpen) {
      throw new Error(
        `The end date cannot be before the start date: ${dateClose.toISOString()} < ${dateOpen.toISOString()}`,
      );
    }

    // Call the Cloud Function
    const upsertAdministrationFunction = httpsCallable(this.admin!.functions, 'upsertAdministration');

    try {
      // Pass all arguments directly to the cloud function
      const result = await upsertAdministrationFunction({
        name,
        publicName,
        normalizedName,
        assessments,
        dateOpen: dateOpen.toISOString(), // Convert to ISO string
        dateClose: dateClose.toISOString(), // Convert to ISO string
        sequential,
        orgs,
        tags,
        administrationId,
        isTestData,
        legal,
      });
      // You might want to log or use the result if the cloud function returns data
      this.verboseLog('upsertAdministration cloud function called successfully:', result);
      // Assuming the cloud function returns the administration ID or similar relevant data
      return result.data;
    } catch (error) {
      console.error('Error calling upsertAdministration cloud function', error);
      // Re-throw the error or handle it as appropriate for the application
      throw error;
    }
  }

  /**
   * Delete an administration
   *
   * @param administrationId The administration ID to delete
   */
  async deleteAdministration(administrationId: string) {
    this._verifyAuthentication();
    if (!this._superAdmin) {
      throw new Error('You must be a super admin to delete an administration.');
    }

    const cloudDeleteAdministration = httpsCallable(this.admin!.functions, 'deleteAdministration');
    const result = await cloudDeleteAdministration({ administrationId });
    return result;
  }

  /**
   * Send a password reset email to the specified user's email address.
   *
   * This will reset the password in the admin Firebase project. The assessment
   * Firebase project remains unchanged because we use the admin project's
   * credentials to authenticate into the assessment project.
   *
   * @param {string} email - The email address of the user to send the password reset email to.
   * @returns A promise that resolves when the password reset email is sent.
   */
  async sendPasswordResetEmail(email: string) {
    return sendPasswordResetEmail(this.admin!.auth, email).then(() => {
      this.verboseLog('Password reset email sent to', email);
    });
  }

  async createAdministrator(
    email: string,
    name: Name,
    targetOrgs: OrgLists,
    targetAdminOrgs: OrgLists,
    isTestData = false,
  ) {
    this._verifyAuthentication();
    this._verifyAdmin();

    const cloudCreateAdministrator = httpsCallable(this.admin!.functions, 'createAdministratorAccount');
    const adminResponse = await cloudCreateAdministrator({
      email,
      name,
      orgs: targetOrgs,
      adminOrgs: targetAdminOrgs,
      isTestData,
    });

    if (_get(adminResponse.data as string, 'status') !== 'ok') {
      throw new Error('Failed to create administrator user account.');
    }
  }

  /**
   * Upserts an organization in the database.
   *
   * @param orgData The organization data to upsert.
   * @returns The upserted organization id.
   */
  async upsertOrg(orgData: {
    id?: string;
    type: 'districts' | 'schools' | 'classes' | 'groups';
    [key: string]: unknown;
  }) {
    this._verifyAuthentication();
    this._verifyAdmin();

    const cloudUpsertOrg = httpsCallable(this.admin!.functions, 'upsertOrg');
    return await cloudUpsertOrg({ orgData });
  }

  async registerTaskVariant({
    taskId,
    taskName,
    taskDescription,
    taskImage,
    taskURL,
    gameConfig,
    variantName,
    variantParams = {},
    registered,
  }: TaskVariantBase) {
    this._verifyAuthentication();
    this._verifyAdmin();

    const task = new RoarTaskVariant({
      db: this.admin!.db,
      taskId,
      taskName,
      taskDescription,
      taskImage,
      taskURL,
      gameConfig,
      variantName,
      variantParams,
      registered,
    });

    await task.toFirestore();

    return task;
  }

  async updateTaskOrVariant(updateData: UpdateTaskVariantData) {
    this._verifyAuthentication();
    this._verifyAdmin();

    let docRef;
    let dataType: string;
    const { data } = updateData;

    if (updateData.variantId) {
      docRef = doc(this.admin!.db, 'tasks', updateData.taskId, 'variants', updateData.variantId);
      dataType = 'variant';
    } else {
      docRef = doc(this.admin!.db, 'tasks', updateData.taskId);
      dataType = 'task';
    }

    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }).then(() => {
      console.log(`Successfully updated ${dataType} data.`);
    });
  }

  // LEVANTE
  async createUsers(userData: LevanteUserData) {
    this._verifyAuthentication();
    this._verifyAdmin();

    const cloudCreateUsers = httpsCallable(this.admin!.functions, 'createUsers');

    const result = await cloudCreateUsers({ userData });
    return result;
  }

  async saveSurveyResponses(surveyResponses: LevanteSurveyResponses) {
    this._verifyAuthentication();

    const cloudSaveSurveyResponses = httpsCallable(this.admin!.functions, 'saveSurveyResponses');
    try {
      const result = await cloudSaveSurveyResponses({ surveyResponses });
      return result;
    } catch (error) {
      console.error('Error saving survey responses in firekit', error);
      throw error;
    }
  }

  async linkUsers(users: LevanteUserData[]) {
    this._verifyAuthentication();
    this._verifyAdmin();

    const cloudLinkUsers = httpsCallable(this.admin!.functions, 'linkUsers');

    const result = await cloudLinkUsers({ users });
    return result;
  }

  // Needs more work. Not being used.
  async editUsers(
    users: {
      uid: string;
      month: string;
      year: string;
      group: string;
      district: string;
      school: string;
      class: string;
    }[],
  ) {
    this._verifyAuthentication();
    this._verifyAdmin();

    const cloudEditUsers = httpsCallable(this.admin!.functions, 'editUsers');
    const result = await cloudEditUsers({ users });
    return result;
  }
}
