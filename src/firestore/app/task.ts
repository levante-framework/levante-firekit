import {
  CollectionReference,
  DocumentReference,
  Firestore,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  getDoc,
} from 'firebase/firestore';
import { mergeGameParams, removeUndefined, replaceValues } from '../util';

export interface TaskVariantBase {
  taskId: string;
  taskName?: string;
  taskDescription?: string;
  taskImage?: string;
  taskURL?: string;
  taskVersion?: string;
  gameConfig?: object;
  external?: boolean;
  variantName: string;
  variantParams: { [key: string]: unknown };
  registered?: boolean;
  db: Firestore;
}

export interface TaskVariantForAssessment extends TaskVariantBase {
  variantId: string;
}


export interface FirestoreTaskData {
  name?: string;
  description?: string | null;
  image?: string;
  taskURL?: string;
  gameConfig?: object;
  external?: boolean;
  lastUpdated: ReturnType<typeof serverTimestamp>;
  registered?: boolean;
  testData?: boolean;
  demoData?: boolean;
  createdAt?: ReturnType<typeof serverTimestamp>;
  updatedAt: ReturnType<typeof serverTimestamp>;
}

export interface TaskData extends FirestoreTaskData {
  id: string;
}

export interface FirestoreVariantData {
  name?: string;
  description?: string | null;
  taskURL?: string;
  external?: boolean;
  params: { [key: string]: unknown };
  lastUpdated: ReturnType<typeof serverTimestamp>;
  registered?: boolean;
  createdAt?: ReturnType<typeof serverTimestamp>;
  updatedAt: ReturnType<typeof serverTimestamp>;
}


/**
 * Class representing a ROAR task.
 */
export class RoarTaskVariant {
  db: Firestore;
  taskId: string;
  taskName?: string;
  taskDescription?: string;
  taskImage?: string;
  taskURL?: string;
  taskVersion?: string;
  gameConfig?: object;
  registered?: boolean;
  external?: boolean;
  taskRef: DocumentReference;
  variantId?: string;
  variantName?: string;
  variantParams: { [key: string]: unknown };
  variantRef: DocumentReference | undefined;
  variantsCollectionRef: CollectionReference;
  /** Create a ROAR task
   * @param {TaskVariantInput} input
   * @param {Firestore} input.db - The assessment Firestore instance to which this task'data will be written
   * @param {string} input.taskId - The ID of the parent task. Should be a short initialism, e.g. "swr" or "sre"
   * @param {string} input.taskName - The name of the parent task
   * @param {string} input.taskDescription - The description of the task
   * @param {string} input.variantName - The name of the task variant
   * @param {string} input.variantDescription - The description of the variant
   * @param {object} input.variantParams - The parameters of the task variant
   */
  constructor({
    db,
    taskId,
    taskName,
    taskDescription,
    taskImage,
    taskURL,
    gameConfig,
    taskVersion = undefined,
    registered,
    external,
    variantName,
    variantParams = {},
  }: TaskVariantBase) {
    this.db = db;
    this.taskId = taskId.toLowerCase();
    this.taskName = taskName;
    this.taskDescription = taskDescription;
    this.taskImage = taskImage;
    this.taskURL = taskURL;
    this.taskVersion = taskVersion;
    this.gameConfig = gameConfig;
    this.registered = registered;
    this.external = external;
    this.variantName = variantName;
    this.variantParams = variantParams;
    this.taskRef = doc(this.db, 'tasks', this.taskId);
    this.variantsCollectionRef = collection(this.taskRef, 'variants');
    this.variantId = undefined;
    this.variantRef = undefined;
  }

  /**
   * Push the trial and trial variant to Firestore
   * @method
   * @async
   */
  async toFirestore() {
    // Check if task document exists to determine if we should set createdAt
    const taskDocSnap = await getDoc(this.taskRef);
    const taskExists = taskDocSnap.exists();

    // Push/update the task using the user provided task ID
    const taskData: FirestoreTaskData = {
      name: this.taskName,
      description: this.taskDescription,
      image: this.taskImage,
      taskURL: this.taskURL,
      gameConfig: this.gameConfig,
      registered: this.registered,
      external: this.external,
      lastUpdated: serverTimestamp(),
      updatedAt: serverTimestamp(),
      // Only set createdAt if this is a new document
      ...((!taskExists) && { createdAt: serverTimestamp() }),
    };

    try {
      await setDoc(this.taskRef, removeUndefined(taskData), { merge: true });
    } catch (error) {
      console.error('RoarTaskVariant toFirestore: error saving task to firestore', {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCode: (error as any)?.code,
        taskId: this.taskId,
        taskRefPath: this.taskRef?.path,
      });
      throw error;
    }

    // Check to see if variant exists already by querying for a match on the params.
    const q = query(
      this.variantsCollectionRef,
      where('params', '==', this.variantParams),
      orderBy('updatedAt', 'desc'),
      limit(1),
    );
    const querySnapshot = await getDocs(q);

    let foundVariantWithCurrentParams = false;

    // If this query snapshot yielded results, then we can use it and
    // update the timestamp
    querySnapshot.forEach((docRef) => {
      this.variantId = docRef.id;
      this.variantRef = doc(this.variantsCollectionRef, this.variantId);
      foundVariantWithCurrentParams = true;

      updateDoc(
        this.variantRef,
        removeUndefined({
          lastUpdated: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    if (!foundVariantWithCurrentParams) {
      // Create new variant with both createdAt and updatedAt
      const variantData: FirestoreVariantData = {
        name: this.variantName,
        taskURL: this.taskURL,
        registered: this.registered,
        external: this.external,
        params: this.variantParams,
        lastUpdated: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      this.variantRef = doc(this.variantsCollectionRef);
      await setDoc(this.variantRef, removeUndefined(variantData));
      this.variantId = this.variantRef.id;
    }
  }

  /**
   * Update variant params in Firestore
   * @method
   * @param {object} newParams - The parameters of the task variant
   * @async
   */
  async updateTaskParams(newParams: { [key: string]: unknown }) {
    if (this.variantRef === undefined) {
      throw new Error(
        'Cannot update task params before writing task to Firestore. Please call `.toFirestore()` first.',
      );
    }

    const oldParams = replaceValues(this.variantParams);
    const cleanParams = replaceValues(newParams);

    // Only allow updating the task params if we are updating previously null values.
    const { merged } = mergeGameParams(oldParams, cleanParams);

    this.variantParams = merged;
    await this.toFirestore();
  }
}
