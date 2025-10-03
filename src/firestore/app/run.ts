import {
  FieldValue,
  arrayUnion,
  collection,
  doc,
  DocumentReference,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import _intersection from 'lodash/intersection';
import _mapValues from 'lodash/mapValues';
import _pick from 'lodash/pick';
import _set from 'lodash/set';
import dot from 'dot-object';
import { RoarTaskVariant } from './task';
import { RoarAppUser } from './user';
import { OrgLists } from '../../interfaces';
import { removeUndefined } from '../util';
import { FirebaseError } from '@firebase/util';

/**
 * Convert a trial data to allow storage on Cloud Firestore.
 *
 * This function leaves all other trial data intact but converts
 * any URL object to a string.
 *
 * @function
 * @param {Object} trialData - Trial data to convert
 * @returns {Object} Converted trial data
 */
export const convertTrialToFirestore = (trialData: object): object => {
  return removeUndefined(
    Object.fromEntries(
      Object.entries(trialData).map(([key, value]) => {
        if (value instanceof URL) {
          return [key, value.toString()];
        } else if (typeof value === 'object' && value !== null) {
          return [key, convertTrialToFirestore(value)];
        } else {
          return [key, value];
        }
      }),
    ),
  );
};

const requiredTrialFields = ['assessment_stage', 'correct'];

interface SummaryScores {
  thetaEstimate: number | null;
  thetaSE: number | null;
  numAttempted: number;
  numCorrect: number;
  numIncorrect: number;
}

export interface RawScores {
  [key: string]: {
    practice: SummaryScores;
    test: SummaryScores;
  };
}

export interface ComputedScores {
  [key: string]: unknown;
}

interface RunScores {
  raw: RawScores;
  computed: ComputedScores;
}

export interface RunInput {
  user: RoarAppUser;
  task: RoarTaskVariant;
  assigningOrgs?: OrgLists;
  readOrgs?: OrgLists;
  assignmentId?: string;
  runId?: string;
  testData?: boolean;
  demoData?: boolean;
}

interface ScoreUpdate {
  [key: string]: number | FieldValue | null | undefined;
}

type ThetaValue = number | null | undefined;
const castToTheta = (value: ThetaValue) => {
  if (value === undefined || value === null) {
    return null;
  }
  return value as number;
};

/**
 * Class representing a ROAR run.
 *
 * A run is a globally unique collection of successive trials that constitute
 * one user "running" through a single assessment one time.
 */
export class RoarRun {
  user: RoarAppUser;
  task: RoarTaskVariant;
  runRef: DocumentReference;
  assigningOrgs?: OrgLists;
  readOrgs?: OrgLists;
  assignmentId?: string;
  started: boolean;
  completed: boolean;
  aborted: boolean;
  testData: boolean;
  demoData: boolean;
  scores: RunScores;
  /** Create a ROAR run
   * @param {RunInput} input
   * @param {RoarAppUser} input.user - The user running the task
   * @param {RoarTaskVariant} input.task - The task variant being run
   * @param {OrgLists} input.assigningOrgs - The IDs of the orgs to which this run belongs
   * @param {OrgLists} input.readOrgs - The IDs of the orgs which can read this run
   * @param {string} input.assignmentId = The ID of the assignment
   * @param {string} input.runId = The ID of the run. If undefined, a new run will be created.
   * @param {string} input.testData = Boolean flag indicating test data
   * @param {string} input.demoData = Boolean flag indicating demo data
   */
  constructor({
    user,
    task,
    assigningOrgs,
    readOrgs,
    assignmentId,
    runId,
    testData = false,
    demoData = false,
  }: RunInput) {
    this.user = user;
    this.task = task;
    this.assigningOrgs = assigningOrgs;
    this.readOrgs = readOrgs ?? assigningOrgs;
    this.assignmentId = assignmentId;
    this.testData = testData;
    this.demoData = demoData;

    if (runId) {
      this.runRef = doc(this.user.userRef, 'runs', runId);
    } else {
      this.runRef = doc(collection(this.user.userRef, 'runs'));
    }

    if (!this.task.taskRef) {
      throw new Error('Task refs not set. Please use the task.setRefs method first.');
    }
    this.started = false;
    this.completed = false;
    this.aborted = false;

    this.scores = {
      raw: {},
      computed: {},
    };
  }

  /**
   * Create a new run on Firestore
   * @method
   * @async
   */
  async startRun(additionalRunMetadata?: { [key: string]: unknown }) {
    await this.user.checkUserExists();

    if (!this.task.variantRef) {
      await this.task.toFirestore();
    }

    const userDocSnap = await getDoc(this.user.userRef);
    if (!userDocSnap.exists()) {
      // This should never happen because of ``this.user.checkUserExists`` above. But just in case:
      throw new Error('User does not exist');
    }

    if (this.assigningOrgs) {
      const userDocData = userDocSnap.data();
      const userOrgs = _pick(userDocData, Object.keys(this.assigningOrgs));
      for (const orgName of Object.keys(userOrgs)) {
        this.assigningOrgs[orgName] = _intersection(userOrgs[orgName]?.current, this.assigningOrgs[orgName]);
        if (this.readOrgs) {
          this.readOrgs[orgName] = _intersection(userOrgs[orgName]?.current, this.readOrgs[orgName]);
        }
      }
    }

    const userDocData = _pick(userDocSnap.data(), [
      'grade',
      'assessmentPid',
      'assessmentUid',
      'birthMonth',
      'birthYear',
      'schoolLevel',
    ]);

    // Grab the testData and demoData flags from the user document.
    const { testData: isTestUser, demoData: isDemoUser } = userDocSnap.data();

    // Update testData and demoData for this instance based on the test/demo
    // flags for the user and task.
    // Explanation: The constructor input flags could be passed in for a normal
    // (non-test) user who is just taking a test assessment. But if the entire user
    // is a test or demo user, then we want those flags to propagate to ALL
    // of their runs, regardless of what the constructor input flags were.
    // Likewise for the test and demo flags for the task.
    // We also want to update the internal state because we will use it later in
    // the `writeTrial` method.
    if (isTestUser) this.testData = true;
    if (isDemoUser) this.demoData = true;

    const runData = {
      ...additionalRunMetadata,
      id: this.runRef.id,
      assignmentId: this.assignmentId ?? null,
      assigningOrgs: this.assigningOrgs ?? null,
      readOrgs: this.readOrgs ?? null,
      taskId: this.task.taskId,
      taskVersion: this.task.taskVersion,
      variantId: this.task.variantId,
      completed: false,
      timeStarted: serverTimestamp(),
      timeFinished: null,
      reliable: false,
      userData: userDocData,
      // Use conditional spreading to add the testData flag only if it exists on
      // the userDoc and is true.
      // Explaination: We use the && operator to return the object only when
      // condition is true. If the object is returned then it will be spread
      // into runData.
      ...(this.testData && { testData: true }),
      // Same for demoData
      ...(this.demoData && { demoData: true }),
    };

    await setDoc(this.runRef, removeUndefined(runData))
      .then(() => {
        return updateDoc(this.user.userRef, {
          tasks: arrayUnion(this.task.taskId),
          variants: arrayUnion(this.task.variantId),
        });
      })
      .then(() => this.user.updateFirestoreTimestamp());

    this.started = true;
  }

  /**
   * Add engagement flags to a run.
   * @method
   * @async
   * @param {string[]} engagementFlags - Engagement flags to add to the run
   * @param {boolean} markAsReliable - Whether or not to mark the run as reliable, defaults to false
   * @param {Object} reliableByBlock - Stores the reliability of the run by block
   * This is an optional parameter that needs only to be passed in for block scoped tasks
   * For Example: {DEL: false, FSM: true, LSM: false}
   *
   * Please note that calling this function with a new set of engagement flags will
   * overwrite the previous set.
   */
  async addEngagementFlags(engagementFlags: string[], markAsReliable = false, reliableByBlock = undefined) {
    if (!this.started) {
      throw new Error('Run has not been started yet. Use the startRun method first.');
    }

    const engagementObj = engagementFlags.reduce((acc: { [x: string]: unknown }, flag) => {
      acc[flag] = true;
      return acc;
    }, {});

    if (!this.aborted) {
      // In cases that the run is non-block-scoped and should only have the reliable attribute stored
      if (reliableByBlock === undefined) {
        return await updateDoc(this.runRef, { engagementFlags: engagementObj, reliable: markAsReliable });
      }
      // In cases we want to store reliability by block, we need to store the reliable attribute as well as the reliableByBlock attribute
      else {
        return await updateDoc(this.runRef, {
          engagementFlags: engagementObj,
          reliable: markAsReliable,
          reliableByBlock: reliableByBlock,
        });
      }
    } else {
      throw new Error('Run has already been aborted.');
    }
  }

  /**
   * Mark this run as complete on Firestore
   * @method
   * @async
   * @param {Object} [finishingMetaData={}] - Optional metadata to include when marking the run as complete.
   * @returns {Promise<boolean | undefined>} - Resolves when the run has been marked as complete.
   * @throws {Error} - Throws an error if the run has not been started yet.
   */
  async finishRun(finishingMetaData: { [key: string]: unknown } = {}): Promise<boolean | undefined> {
    if (!this.started) {
      throw new Error('Run has not been started yet. Use the startRun method first.');
    }

    if (!this.aborted) {
      const finishingData = {
        ...finishingMetaData,
        completed: true,
        timeFinished: serverTimestamp(),
      };

      return await updateDoc(this.runRef, finishingData)
        .then(() => this.user.updateFirestoreTimestamp())
        .then(() => (this.completed = true));
    }
  }

  /**
   * Abort this run, preventing it from completing
   * @method
   */
  abortRun() {
    if (!this.started) {
      throw new Error('Run has not been started yet. Use the startRun method first.');
    }

    this.aborted = true;
  }

  /**
   * Add a new trial to this run on Firestore
   * @method
   * @async
   * @param {*} trialData - An object containing trial data.
   */
  async writeTrial(
    trialData: Record<string, unknown>,
    computedScoreCallback?: (rawScores: RawScores) => Promise<ComputedScores>,
  ) {
    if (!this.started) {
      throw new Error('Run has not been started yet. Use the startRun method first.');
    }
    if (!this.aborted) {
      // Check that the trial has all of the required reserved keys
      if (
        !requiredTrialFields.every((key) => {
          return key in trialData && trialData[key] != undefined;
        })
      ) {
        throw new Error(
          'All ROAR trials saved to Firestore must have the following reserved keys: ' +
            `${requiredTrialFields}.` +
            'The current trial is missing the following required keys: ' +
            `${requiredTrialFields.filter((key) => !(key in trialData))}.`,
        );
      }

      const trialRef = doc(collection(this.runRef, 'trials'));

      return setDoc(trialRef, {
        ...convertTrialToFirestore(trialData),
        taskId: this.task.taskId,
        ...(this.testData && { testData: true }),
        ...(this.demoData && { demoData: true }),
        serverTimestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
        // Trial documents are never updated, but for standardization, adding this field. 
        updatedAt: serverTimestamp(),
      })
        .then(async () => {
          // Only update scores if the trial was a test or a practice response.
          if (trialData.assessment_stage === 'test_response' || trialData.assessment_stage === 'practice_response') {
            // Here we update the scores for this run. We create scores for each subtask in the task.
            // E.g., ROAR-PA has three subtasks: FSM, LSM, and DEL. Each subtask has its own score.
            // Conversely, ROAR-SWR has no subtasks. It's scores are stored in the 'total' score field.
            // If no subtask is specified, the scores for the 'total' subtask will be updated.
            const defaultSubtask = 'composite';
            const subtask = (trialData.subtask || defaultSubtask) as string;

            const stage = trialData.assessment_stage.split('_')[0] as 'test' | 'practice';

            let scoreUpdate: ScoreUpdate = {};
            if (subtask in this.scores.raw) {
              // Then this subtask has already been added to this run.
              // Simply update the block's scores.
              this.scores.raw[subtask][stage] = {
                thetaEstimate: castToTheta(trialData.thetaEstimate as ThetaValue),
                thetaSE: castToTheta(trialData.thetaSE as ThetaValue),
                numAttempted: (this.scores.raw[subtask][stage]?.numAttempted || 0) + 1,
                // For the next two, use the unary + operator to convert the boolean value to 0 or 1.
                numCorrect: (this.scores.raw[subtask][stage]?.numCorrect || 0) + +Boolean(trialData.correct),
                numIncorrect: (this.scores.raw[subtask][stage]?.numIncorrect || 0) + +!trialData.correct,
              };

              // And populate the score update for Firestore.
              scoreUpdate = {
                [`scores.raw.${subtask}.${stage}.thetaEstimate`]: castToTheta(trialData.thetaEstimate as ThetaValue),
                [`scores.raw.${subtask}.${stage}.thetaSE`]: castToTheta(trialData.thetaSE as ThetaValue),
                [`scores.raw.${subtask}.${stage}.numAttempted`]: increment(1),
                [`scores.raw.${subtask}.${stage}.numCorrect`]: trialData.correct ? increment(1) : undefined,
                [`scores.raw.${subtask}.${stage}.numIncorrect`]: trialData.correct ? undefined : increment(1),
              };

              if (subtask !== defaultSubtask) {
                this.scores.raw[defaultSubtask][stage] = {
                  numAttempted: (this.scores.raw[defaultSubtask][stage]?.numAttempted || 0) + 1,
                  // For the next two, use the unary + operator to convert the boolean value to 0 or 1.
                  numCorrect: (this.scores.raw[defaultSubtask][stage]?.numCorrect || 0) + +Boolean(trialData.correct),
                  numIncorrect: (this.scores.raw[defaultSubtask][stage]?.numIncorrect || 0) + +!trialData.correct,
                  thetaEstimate: null,
                  thetaSE: null,
                };

                scoreUpdate = {
                  ...scoreUpdate,
                  [`scores.raw.${defaultSubtask}.${stage}.numAttempted`]: increment(1),
                  [`scores.raw.${defaultSubtask}.${stage}.numCorrect`]: trialData.correct ? increment(1) : undefined,
                  [`scores.raw.${defaultSubtask}.${stage}.numIncorrect`]: trialData.correct ? undefined : increment(1),
                };
              }
            } else {
              // This is the first time this subtask has been added to this run.
              // Initialize the subtask scores.
              _set(this.scores.raw, [subtask, stage], {
                thetaEstimate: castToTheta(trialData.thetaEstimate as ThetaValue),
                thetaSE: castToTheta(trialData.thetaSE as ThetaValue),
                numAttempted: 1,
                numCorrect: trialData.correct ? 1 : 0,
                numIncorrect: trialData.correct ? 0 : 1,
              });

              // And populate the score update for Firestore.
              scoreUpdate = {
                [`scores.raw.${subtask}.${stage}.thetaEstimate`]: castToTheta(trialData.thetaEstimate as ThetaValue),
                [`scores.raw.${subtask}.${stage}.thetaSE`]: castToTheta(trialData.thetaSE as ThetaValue),
                [`scores.raw.${subtask}.${stage}.numAttempted`]: 1,
                [`scores.raw.${subtask}.${stage}.numCorrect`]: trialData.correct ? 1 : 0,
                [`scores.raw.${subtask}.${stage}.numIncorrect`]: trialData.correct ? 0 : 1,
              };

              if (subtask !== defaultSubtask) {
                _set(this.scores.raw, [defaultSubtask, stage], {
                  numAttempted: 1,
                  numCorrect: trialData.correct ? 1 : 0,
                  numIncorrect: trialData.correct ? 0 : 1,
                  thetaEstimate: null,
                  thetaSE: null,
                });

                scoreUpdate = {
                  ...scoreUpdate,
                  [`scores.raw.${defaultSubtask}.${stage}.numAttempted`]: increment(1),
                  [`scores.raw.${defaultSubtask}.${stage}.numCorrect`]: trialData.correct ? increment(1) : undefined,
                  [`scores.raw.${defaultSubtask}.${stage}.numIncorrect`]: trialData.correct ? undefined : increment(1),
                };
              }
            }

            if (computedScoreCallback) {
              // Use the user-provided callback to compute the computed scores.
              this.scores.computed = await computedScoreCallback(this.scores.raw);
            } else {
              // If no computedScoreCallback is provided, we default to
              // numCorrect - numIncorrect for each subtask.
              this.scores.computed = _mapValues(this.scores.raw, (subtaskScores) => {
                const numCorrect = subtaskScores.test?.numCorrect || 0;
                const numIncorrect = subtaskScores.test?.numIncorrect || 0;
                return numCorrect - numIncorrect;
              });
            }

            // And use dot-object to convert the computed scores into dotted-key/value pairs.
            // First nest the computed scores into `scores.computed` so that they get updated
            // in the correct location.
            const fullUpdatePath = {
              scores: {
                computed: this.scores.computed,
              },
            };
            scoreUpdate = {
              ...scoreUpdate,
              ...dot.dot(fullUpdatePath),
            };

            return updateDoc(this.runRef, removeUndefined(scoreUpdate)).catch((error: FirebaseError) => {
              // Catch the "Unsupported field value: undefined" error and
              // provide a more helpful error message to the ROAR app developer.
              if (error.message.toLowerCase().includes('unsupported field value: undefined')) {
                throw new Error(
                  'The computed or normed scores that you provided contained an undefined value. ' +
                    'Firestore does not support storing undefined values. ' +
                    'Please remove this value or convert it to ``null``.',
                );
              }
              throw error;
            });
          }
        })
        .then(() => this.user.updateFirestoreTimestamp());
    }
  }
}
