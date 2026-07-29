import { convertTrialToFirestore } from './run';

const DB_NAME = 'levante-offline';
const DB_VERSION = 1;
const STORE_RUNS = 'runs';

const requiredTrialFields = ['assessment_stage', 'correct'];

export interface OfflineAppkitInput {
  localUserId: string;
  assessmentPid?: string;
  assignmentId?: string;
  taskId: string;
  variantId?: string;
  variantParams?: Record<string, unknown>;
  packId?: string;
  roarUid?: string;
}

export interface OfflineRunRecord {
  localRunId: string;
  localUserId: string;
  roarUid?: string;
  assessmentPid?: string;
  assignmentId?: string;
  taskId: string;
  variantId?: string;
  packId?: string;
  startedAt: string;
  finishedAt?: string;
  completed: boolean;
  aborted: boolean;
  startMetadata: Record<string, unknown>;
  finishMetadata: Record<string, unknown>;
  trials: Record<string, unknown>[];
}

export interface OfflineExport {
  version: 1;
  exportedAt: string;
  packId?: string;
  runs: OfflineRunRecord[];
}

export interface OfflineRunHandle {
  completed: boolean;
  aborted: boolean;
  localRunId: string;
}

function createLocalId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_RUNS)) {
        db.createObjectStore(STORE_RUNS, { keyPath: 'localRunId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function idbPutRun(record: OfflineRunRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_RUNS, 'readwrite');
    tx.objectStore(STORE_RUNS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write offline run'));
  });
  db.close();
}

async function idbGetAllRuns(): Promise<OfflineRunRecord[]> {
  const db = await openDb();
  const runs = await new Promise<OfflineRunRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_RUNS, 'readonly');
    const request = tx.objectStore(STORE_RUNS).getAll();
    request.onsuccess = () => resolve((request.result as OfflineRunRecord[]) || []);
    request.onerror = () => reject(request.error ?? new Error('Failed to read offline runs'));
  });
  db.close();
  return runs;
}

async function idbClearRuns(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_RUNS, 'readwrite');
    tx.objectStore(STORE_RUNS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to clear offline runs'));
  });
  db.close();
}

/**
 * Firekit-compatible app kit for air-gapped / offline collection.
 * Duck-types the RoarAppkit surface used by core-tasks trialSaving:
 * startRun, writeTrial, finishRun, run.completed.
 */
export class OfflineAppkit {
  firebaseProject = undefined;
  run?: OfflineRunHandle;
  _taskInfo: { taskId: string; variantId?: string; variantParams: Record<string, unknown> };

  private input: OfflineAppkitInput;
  private started = false;
  private record: OfflineRunRecord | null = null;
  private persistEnabled: boolean;

  constructor(input: OfflineAppkitInput, options: { persist?: boolean } = {}) {
    this.input = input;
    this.persistEnabled = options.persist !== false && typeof indexedDB !== 'undefined';
    this._taskInfo = {
      taskId: input.taskId,
      variantId: input.variantId,
      variantParams: input.variantParams || {},
    };
  }

  async startRun(additionalRunMetadata: { [key: string]: unknown } = {}) {
    const localRunId = createLocalId('run');
    this.record = {
      localRunId,
      localUserId: this.input.localUserId,
      roarUid: this.input.roarUid,
      assessmentPid: this.input.assessmentPid,
      assignmentId: this.input.assignmentId,
      taskId: this.input.taskId,
      variantId: this.input.variantId,
      packId: this.input.packId,
      startedAt: new Date().toISOString(),
      completed: false,
      aborted: false,
      startMetadata: { ...additionalRunMetadata },
      finishMetadata: {},
      trials: [],
    };
    this.run = { completed: false, aborted: false, localRunId };
    this.started = true;
    await this.persist();
    return true;
  }

  async writeTrial(trialData: Record<string, unknown>) {
    if (!this.started || !this.record || !this.run) {
      throw new Error('Run has not been started yet. Use the startRun method first.');
    }
    if (this.run.aborted) {
      return;
    }
    if (!requiredTrialFields.every((key) => key in trialData && trialData[key] != undefined)) {
      throw new Error(
        'All ROAR trials saved offline must have the following reserved keys: ' +
          `${requiredTrialFields}.` +
          'The current trial is missing the following required keys: ' +
          `${requiredTrialFields.filter((key) => !(key in trialData))}.`,
      );
    }

    const cleaned = convertTrialToFirestore(trialData) as Record<string, unknown>;
    this.record.trials.push({
      ...cleaned,
      taskId: this.input.taskId,
      localTrialIndex: this.record.trials.length,
      createdAt: new Date().toISOString(),
    });
    await this.persist();
  }

  async finishRun(finishingMetaData: { [key: string]: unknown } = {}) {
    if (!this.started || !this.record || !this.run) {
      throw new Error('Run has not been started yet. Use the startRun method first.');
    }
    this.record.completed = true;
    this.record.finishedAt = new Date().toISOString();
    this.record.finishMetadata = { ...finishingMetaData };
    this.run.completed = true;
    await this.persist();
    return true;
  }

  abortRun() {
    if (!this.started || !this.record || !this.run) {
      return;
    }
    this.run.aborted = true;
    this.record.aborted = true;
    void this.persist();
  }

  getCurrentRun() {
    return this.record;
  }

  static async exportAll(packId?: string): Promise<OfflineExport> {
    const runs = await OfflineAppkit.loadAll();
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      packId,
      runs,
    };
  }

  static async loadAll(): Promise<OfflineRunRecord[]> {
    if (typeof indexedDB === 'undefined') {
      return [];
    }
    return idbGetAllRuns();
  }

  static async clearAll(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      return;
    }
    await idbClearRuns();
  }

  private async persist() {
    if (!this.persistEnabled || !this.record) {
      return;
    }
    await idbPutRun(this.record);
  }
}
