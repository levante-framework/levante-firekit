import {
  DocumentData,
  DocumentReference,
  Firestore,
  arrayUnion,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import _extend from 'lodash/extend';
import { UserType } from '../../interfaces';
import { removeUndefined } from '../util';

export interface UserInfo {
  roarUid?: string;
  assessmentUid: string;
  assessmentPid?: string;
  userType?: UserType;
  userMetadata?: { [key: string]: unknown };
  testData?: boolean;
  demoData?: boolean;
  offlineEnabled?: boolean;
  offlineTasks?: string[];
  offlineAdministrations?: string[];
}

export interface UserInput extends UserInfo {
  db: Firestore;
}

export interface UserUpdateInput {
  /** These are keys that all users can update */
  tasks?: string[];
  variants?: string[];
  /** And these are keys that only guest users will be able to create/update */
  assessmentPid?: string;
  [key: string]: unknown;
}

/** This interface holds data that the user can update on Firestore */
interface FirestoreUserUpdate {
  /** These are keys that all users can update */
  tasks?: ReturnType<typeof arrayUnion>;
  variants?: ReturnType<typeof arrayUnion>;
  lastUpdated?: ReturnType<typeof serverTimestamp>;
  /** And these are keys that only guest users will be able to create/update */
  assessmentPid?: string;
  [key: string]: unknown;
}

/** Class representing a ROAR user */
export class RoarAppUser {
  db: Firestore;
  roarUid?: string;
  assessmentUid: string;
  assessmentPid?: string;
  userData?: DocumentData;
  userType: UserType;
  onFirestore?: boolean;
  userRef: DocumentReference;
  userMetadata: { [key: string]: unknown };
  testData: boolean;
  demoData: boolean;
  offlineEnabled: boolean;
  offlineTasks: string[];
  offlineAdministrations: string[];
  /** Create a ROAR user
   * @param {object} input
   * @param {Firestore} input.db - The assessment Firestore instance to which this user's data will be written
   * @param {string} input.roarUid - The ROAR ID of the user
   * @param {string} input.assessmentUid - The assessment firebase UID of the user
   * @param {string} input.assessmentPid - The assessment PID of the user
   * @param {string} input.userType - The user type. Must be either 'admin', 'educator', 'student', 'caregiver', 'guest', or 'researcher.'
   * @param {object} input.userMetadata - An object containing additional user metadata
   * @param {string} input.testData = Boolean flag indicating test data
   * @param {string} input.demoData = Boolean flag indicating demo data
   * @param {string} input.offlineEnabled = Boolean flag indicating whether user has enrolled in Offline ROAR
   * @param {string[]} input.offlineTasks = Array of task IDs that user will need access to offline
   * @param {string[]} input.offlineAdministrations = Array of administration IDs that user will need access to offline
   */
  constructor({
    db,
    roarUid,
    assessmentUid,
    assessmentPid,
    userType = UserType.guest,
    userMetadata = {},
    testData = false,
    demoData = false,
    offlineEnabled = false,
    offlineTasks = [],
    offlineAdministrations = [],
  }: UserInput) {
    const allowedUserCategories = Object.values(UserType);
    if (!allowedUserCategories.includes(userType)) {
      throw new Error(`User category must be one of ${allowedUserCategories.join(', ')}.`);
    }

    if (roarUid === undefined && userType !== UserType.guest) {
      throw new Error('All non-guest LEVANTE users must be created with a LEVANTE UID.');
    }

    if (userType === UserType.guest && roarUid !== undefined) {
      throw new Error('Guest LEVANTE users cannot have a LEVANTE UID.');
    }

    if (userType !== UserType.guest && assessmentPid === undefined) {
      throw new Error('All non-guest LEVANTE users must have an assessment PID on instantiation.');
    }

    this.db = db;
    this.roarUid = roarUid;
    this.assessmentPid = assessmentPid;
    this.assessmentUid = assessmentUid;
    this.userType = userType;
    this.userMetadata = userMetadata;
    this.testData = testData;
    this.demoData = demoData;
    this.offlineEnabled = offlineEnabled;
    this.offlineTasks = offlineTasks;
    this.offlineAdministrations = offlineAdministrations;

    if (userType === UserType.guest) {
      this.userRef = doc(this.db, 'guests', this.assessmentUid);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.userRef = doc(this.db, 'users', this.roarUid!);
    }
  }

  async init() {
    const docSnap = await getDoc(this.userRef);
    this.onFirestore = docSnap.exists();

    if (this.onFirestore) {
      // If so, retrieve their data.
      this.userData = docSnap.data();
    } else {
      // Otherwise allow them to create their own data ONLY if they are a guest.
      await this._setUserData();
    }
  }

  private async _setUserData() {
    if (this.userType !== UserType.guest) {
      throw new Error('Cannot set user data on a non-guest LEVANTE user.');
    }

    this.userData = removeUndefined({
      ...this.userMetadata,
      assessmentPid: this.assessmentPid,
      assessmentUid: this.assessmentUid,
      userType: this.userType,
    });

    await setDoc(this.userRef, {
      ...this.userData,
      created: serverTimestamp(),
    });

    this.onFirestore = true;
  }

  async checkUserExists() {
    if (!this.onFirestore) {
      await this.init();
    }

    if (!this.onFirestore) {
      throw new Error('This non-guest user is not in Firestore.');
    }
  }

  /**
   * Update the user's data (both locally and in Firestore)
   * @param {object} input
   * @param {string[]} input.tasks - The tasks to be added to the user doc
   * @param {string[]} input.variants - The variants to be added to the user doc
   * @param {string} input.assessmentPid - The assessment PID of the user
   * @param {*} input.userMetadata - Any additional user metadata
   * @method
   * @async
   */
  async updateUser({ tasks, variants, assessmentPid, ...userMetadata }: UserUpdateInput): Promise<void> {
    this.checkUserExists();

    let userData: FirestoreUserUpdate = {
      lastUpdated: serverTimestamp(),
    };

    if (tasks) userData.tasks = arrayUnion(...tasks);
    if (variants) userData.variants = arrayUnion(...variants);

    if (this.userType === UserType.guest) {
      if (assessmentPid) userData.assessmentPid = assessmentPid;
      userData = {
        ...userMetadata,
        ...userData,
      };
    }

    this.userData = _extend(this.userData, {
      ...userMetadata,
      tasks,
      variants,
      assessmentPid,
    });

    return await updateDoc(this.userRef, removeUndefined(userData));
  }

  /**
   * Update the user's "lastUpdated" timestamp
   * @method
   * @async
   */
  async updateFirestoreTimestamp() {
    this.checkUserExists();
    return updateDoc(this.userRef, {
      lastUpdated: serverTimestamp(),
    });
  }
}
