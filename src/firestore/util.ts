import { getApp, initializeApp } from 'firebase/app';
import {
  Auth,
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence,
} from 'firebase/auth';
// import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from 'firebase/app-check';
import { connectFirestoreEmulator, Firestore, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, Functions, getFunctions } from 'firebase/functions';
import { FirebaseStorage, getStorage } from 'firebase/storage';
import { FirebasePerformance, getPerformance } from 'firebase/performance';
import _chunk from 'lodash/chunk';
import _difference from 'lodash/difference';
import _flatten from 'lodash/flatten';
import _get from 'lodash/get';
import _invert from 'lodash/invert';
import _isEmpty from 'lodash/isEmpty';
import _isEqual from 'lodash/isEqual';
import _isPlainObject from 'lodash/isPlainObject';
import _mergeWith from 'lodash/mergeWith';
import _remove from 'lodash/remove';
import { markRaw } from 'vue';
import { str as crc32 } from 'crc-32';
import { OrgListKey, OrgLists } from '../interfaces';

/** Remove null attributes from an object
 * @function
 * @param {Object} obj - Object to remove null attributes from
 * @returns {Object} Object with null attributes removed
 */
export const removeNull = (obj: object): object => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== null));
};

/** Remove undefined attributes from an object
 * @function
 * @param {Object} obj - Object to remove undefined attributes from
 * @returns {Object} Object with undefined attributes removed
 */
export const removeUndefined = (obj: object): object => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
};

/** Recursively replace values in an object
 * @function
 * @param {Object} obj - Object to recursively replace values in
 * @param {unknown} valueToReplace - Value to replace
 * @param {unknown} replacementValue - Replacement value
 * @returns {Object} Object with values recursively replaced
 */
export const replaceValues = (
  obj: { [key: string]: unknown },
  valueToReplace: unknown = undefined,
  replacementValue: unknown = null,
): { [key: string]: unknown } => {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      if (_isPlainObject(value)) {
        return [key, replaceValues(value as { [key: string]: unknown }, valueToReplace, replacementValue)];
      }
      return [key, value === valueToReplace ? replacementValue : value];
    }),
  );
};

export interface CommonFirebaseConfig {
  projectId: string;
  apiKey: string;
  siteKey: string;
  debugToken?: string;
  useEmulators?: boolean;
  emulatorHost?: string;
  emulatorPorts?: {
    db?: number;
    auth?: number;
    functions?: number;
  };
}

export interface EmulatorFirebaseConfig extends CommonFirebaseConfig {
  emulatorPorts: {
    db: number;
    auth: number;
    functions: number;
  };
}

export interface LiveFirebaseConfig extends CommonFirebaseConfig {
  authDomain: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

export type FirebaseConfig = LiveFirebaseConfig | EmulatorFirebaseConfig;

export const safeInitializeApp = (config: LiveFirebaseConfig, name: string) => {
  try {
    const app = getApp(name);
    if (!_isEqual(app.options, config)) {
      throw new Error(`There is an existing firebase app named ${name} with different configuration options.`);
    }
    return app;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error.code === 'app/no-app') {
      return initializeApp(config, name);
    } else {
      throw error;
    }
  }
};

// export const initializeAppCheckWithRecaptcha = (app: FirebaseApp, siteKey: string, debugToken: string | undefined) => {
//   const hostname = window.location.hostname;
//
//   // Use the DEBUG reCAPTCHA key for local development
//   // This allows us to bypass the reCAPTCHA domain verification
//   // Debug token is a private key passed in from a .env file and should not be exposed
//   if (hostname === 'localhost') {
//     try {
//       // eslint-disable-next-line @typescript-eslint/no-explicit-any
//       (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
//     } catch (error) {
//       throw new Error(`Error setting App Check debug token: ${error}`);
//     }
//   }
//
//   try {
//     return initializeAppCheck(app, {
//       provider: new ReCaptchaEnterpriseProvider(siteKey as string),
//       isTokenAutoRefreshEnabled: true,
//     });
//   } catch (error) {
//     throw new Error(`Error initializing App Check with reCAPTCHA provider: ${error}`);
//   }
// };

export enum AuthPersistence {
  local = 'local',
  session = 'session',
  none = 'none',
}

export interface MarkRawConfig {
  auth?: boolean;
  db?: boolean;
  functions?: boolean;
}

type FirebaseProduct = Auth | Firestore | Functions | FirebaseStorage;

export const initializeFirebaseProject = async (
  config: FirebaseConfig,
  name: string,
  authPersistence = AuthPersistence.session,
  markRawConfig: MarkRawConfig = {},
) => {
  const optionallyMarkRaw = <T extends FirebaseProduct>(productKey: string, productInstance: T): T => {
    if (_get(markRawConfig, productKey)) {
      return markRaw(productInstance);
    } else {
      return productInstance;
    }
  };

  // Check if environment variable is set to override config
  const useEmulatorsEnv = typeof process !== 'undefined' && process.env.USE_FIREBASE_EMULATORS === 'true';
  
  if ((config as EmulatorFirebaseConfig).emulatorPorts) {
    // Existing code for EmulatorFirebaseConfig
    const app = initializeApp({ projectId: config.projectId, apiKey: config.apiKey }, name);
    const ports = (config as EmulatorFirebaseConfig).emulatorPorts;
    const auth = optionallyMarkRaw('auth', getAuth(app));
    const db = optionallyMarkRaw('db', getFirestore(app));
    const functions = optionallyMarkRaw('functions', getFunctions(app));
    const storage = optionallyMarkRaw('storage', getStorage(app));

    connectFirestoreEmulator(db, '127.0.0.1', ports.db);
    connectFunctionsEmulator(functions, '127.0.0.1', ports.functions);

    const originalInfo = console.info;
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    console.info = () => {};
    connectAuthEmulator(auth, `http://127.0.0.1:${ports.auth}`);
    console.info = originalInfo;

    return {
      firebaseApp: app,
      auth,
      db,
      functions,
      storage,
    };
  } else {
    // Existing code for production configuration
    const { ...appConfig } = config as LiveFirebaseConfig;
    const app = safeInitializeApp(appConfig as LiveFirebaseConfig, name);

    let performance: FirebasePerformance | undefined = undefined;
    try {
      performance = getPerformance(app);
    } catch (error: any) {
      if (error.code !== 'performance/FB not default') {
        throw error;
      }
    }

    const kit = {
      firebaseApp: app,
      auth: optionallyMarkRaw('auth', getAuth(app)),
      db: optionallyMarkRaw('db', getFirestore(app)),
      functions: optionallyMarkRaw('functions', getFunctions(app)),
      storage: optionallyMarkRaw('storage', getStorage(app)),
      perf: performance,
    };

    // Connect to emulators if specified in config OR if env var is set
    if (config.useEmulators || useEmulatorsEnv) {
      const host = config.emulatorHost || process.env.FIREBASE_EMULATOR_HOST || 'localhost';
      console.log(`Connecting ${name} project to Firebase emulators on ${host}`);
      
      // Get port numbers from environment variables, config, or use defaults
      const dbPort = 
        process.env.FIREBASE_FIRESTORE_EMULATOR_PORT ? 
        parseInt(process.env.FIREBASE_FIRESTORE_EMULATOR_PORT, 10) : 
        (config.emulatorPorts?.db || 8080);
        
      const functionsPort = 
        process.env.FIREBASE_FUNCTIONS_EMULATOR_PORT ? 
        parseInt(process.env.FIREBASE_FUNCTIONS_EMULATOR_PORT, 10) : 
        (config.emulatorPorts?.functions || 5001);
        
      const authPort = 
        process.env.FIREBASE_AUTH_EMULATOR_PORT ? 
        parseInt(process.env.FIREBASE_AUTH_EMULATOR_PORT, 10) : 
        (config.emulatorPorts?.auth || 9099);
      
      // Connect to emulators with the configured ports
      connectFirestoreEmulator(kit.db, host, dbPort);
      connectFunctionsEmulator(kit.functions, host, functionsPort);
      
      // Suppress the "Auth emulator" console info message
      const originalInfo = console.info;
      console.info = () => {};
      connectAuthEmulator(kit.auth, `http://${host}:${authPort}`, { disableWarnings: true });
      console.info = originalInfo;
      
      console.log(`Connected to emulators - Firestore: ${dbPort}, Functions: ${functionsPort}, Auth: ${authPort}`);
    }

    // Auth state persistence is set with ``setPersistence`` and specifies how a
    // user session is persisted on a device. We choose in session persistence by
    // default because many students will access the ROAR on shared devices in the
    // classroom.
    if (authPersistence === AuthPersistence.session) {
      await setPersistence(kit.auth, browserSessionPersistence);
    } else if (authPersistence === AuthPersistence.local) {
      await setPersistence(kit.auth, browserLocalPersistence);
    } else if (authPersistence === AuthPersistence.none) {
      await setPersistence(kit.auth, inMemoryPersistence);
    }

    return kit;
  }
};

export const emptyOrg = () => {
  return {
    current: [],
    all: [],
    dates: {},
  };
};

export const emptyOrgList = (): OrgLists => {
  return {
    districts: [],
    schools: [],
    classes: [],
    groups: [],
    families: [],
  };
};

/**
 * Merge new game parameters with old parameters with constraints
 *
 * The constraints are:
 * - no new parameters may be added,
 * - no old parameters may be removed,
 * - any parameters that have been changed must have had ``null`` values in ``oldParams``
 *
 * @param oldParams - Old game parameters
 * @param newParams - New game parameters
 * @returns merged game parameters
 */
export const mergeGameParams = (oldParams: { [key: string]: unknown }, newParams: { [key: string]: unknown }) => {
  let keysAdded = false;
  const customizer = (oldValue: unknown, newValue: unknown, key: string) => {
    if (oldValue === null) {
      return newValue;
    }
    if (_isEqual(oldValue, newValue)) {
      return newValue;
    }
    if (oldValue === undefined && newValue !== undefined) {
      keysAdded = true;
      return newValue;
    } else {
      throw new Error(`Attempted to change previously non-null value with key ${key}`);
    }
  };

  const merged = _mergeWith({ ...oldParams }, newParams, customizer);
  const differentKeys = _difference(Object.keys(merged), Object.keys(newParams));
  if (!_isEmpty(differentKeys)) {
    throw new Error(`Detected deleted keys: ${differentKeys.join(', ')}`);
  }

  return {
    keysAdded,
    merged,
  };
};

export const crc32String = (inputString: string) => {
  const modulo = (a: number, b: number) => {
    return a - Math.floor(a / b) * b;
  };

  const toUint32 = (x: number) => {
    return modulo(x, Math.pow(2, 32));
  };

  return toUint32(crc32(inputString)).toString(16);
};

interface Node {
  id: string;
  [key: string]: unknown;
}

interface OrgNodes {
  districts?: Node[];
  schools?: Node[];
  classes?: Node[];
  groups?: Node[];
  families?: Node[];
}

interface TreeTableNode {
  key: string;
  data: Node;
  children?: TreeTableNode[];
}

const treeTableFormat = (orgs: Node[], orgType: string, startIndex = 0) => {
  return orgs.map((element, index) => ({
    key: (index + startIndex).toString(),
    data: {
      ...element,
      orgType,
    },
  })) as TreeTableNode[];
};

export const getTreeTableOrgs = (inputOrgs: OrgNodes) => {
  const { districts = [], schools = [], classes = [], groups = [], families = [] } = inputOrgs;

  const ttDistricts = treeTableFormat(districts, 'district');
  const ttSchools = treeTableFormat(schools, 'school');
  const ttClasses = treeTableFormat(classes, 'class');

  let topLevelOrgs: TreeTableNode[] = [];

  if (districts.length) {
    topLevelOrgs = ttDistricts;
    for (const _school of ttSchools) {
      const districtId = _school.data.districtId;
      const districtIndex = topLevelOrgs.findIndex((district) => district.data.id === districtId);

      // This will return all classes for this school and also remove them from the classes array.
      // At the end, we will add any left over classes as orphaned classes
      const classesForThisSchool = _remove(ttClasses, (c) => c.data.schoolId === _school.data.id);

      if (districtIndex !== -1) {
        const _district = topLevelOrgs[districtIndex];
        if (_district.children === undefined) {
          topLevelOrgs[districtIndex].children = [
            {
              ..._school,
              key: `${_district.key}-0`,
              // This next pattern is a bit funky. It conditionally adds a children field
              // but only if there are any classes for this school.
              ...(classesForThisSchool.length > 0 && {
                children: classesForThisSchool.map((element, index) => ({
                  key: `${_district.key}-0-${index}`,
                  data: element.data,
                })),
              }),
            },
          ];
        } else {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          topLevelOrgs[districtIndex].children!.push({
            ..._school,
            key: `${_district.key}-${_district.children.length}`,
            ...(classesForThisSchool.length > 0 && {
              children: classesForThisSchool.map((element, index) => ({
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                key: `${_district.key}-${_district.children!.length}-${index}`,
                data: element.data,
              })),
            }),
          });
        }
      } else {
        topLevelOrgs.push({
          ..._school,
          key: `${topLevelOrgs.length}`,
          ...(classesForThisSchool.length > 0 && {
            children: classesForThisSchool.map((element, index) => ({
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              key: `${topLevelOrgs.length}-${index}`,
              data: element.data,
            })),
          }),
        });
      }
    }

    // We have now gone through all of the schools and removed any classes that
    // belong to the supplied schools. If there are any schools left, they
    // should either be direct descendants of a district (rare) or they should
    // be at the top level.
    for (const _class of ttClasses) {
      const districtId = _class.data.districtId;
      const districtIndex = topLevelOrgs.findIndex((district) => district.data.id === districtId);
      if (districtIndex !== -1) {
        // Add this class as a direct descendant of the district
        const _district = topLevelOrgs[districtIndex];
        if (_district.children === undefined) {
          topLevelOrgs[districtIndex].children = [
            {
              key: `${_district.key}-0`,
              data: _class.data,
            },
          ];
        } else {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          topLevelOrgs[districtIndex].children!.push({
            key: `${_district.key}-${_district.children.length}`,
            data: _class.data,
          });
        }
      } else {
        // Add this class to the top-level orgs
        topLevelOrgs.push({
          key: `${topLevelOrgs.length}`,
          data: _class.data,
        });
      }
    }
  } else if (schools.length) {
    topLevelOrgs = ttSchools;
    for (const _class of ttClasses) {
      const schoolId = _class.data.schoolId;
      const schoolIndex = topLevelOrgs.findIndex((school) => school.data.id === schoolId);
      if (schoolIndex !== -1) {
        const _school = topLevelOrgs[schoolIndex];
        if (_school.children === undefined) {
          topLevelOrgs[schoolIndex].children = [
            {
              ..._class,
              key: `${_school.key}-0`,
            },
          ];
        } else {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          topLevelOrgs[schoolIndex].children!.push({
            ..._class,
            key: `${_school.key}-${_school.children.length}`,
          });
        }
      } else {
        topLevelOrgs.push({
          ..._class,
          key: `${topLevelOrgs.length}`,
        });
      }
    }
  } else if (classes.length) {
    topLevelOrgs = ttClasses;
  }

  const ttGroups = treeTableFormat(groups, 'group', topLevelOrgs.length);
  topLevelOrgs.push(...ttGroups);

  const ttFamilies = treeTableFormat(families, 'family', topLevelOrgs.length);
  topLevelOrgs.push(...ttFamilies);

  return topLevelOrgs;
};

export const chunkOrgLists = ({ orgs, chunkSize = 30 }: { orgs?: OrgLists; chunkSize: number }) => {
  if (!orgs) return [undefined];

  const orgPairs = _flatten(
    Object.entries(orgs).map(([orgType, orgIds]) => {
      return orgIds.map((orgId: string) => [orgType, orgId]);
    }),
  );

  if (orgPairs.length <= chunkSize) return [orgs];

  const chunkedOrgs = _chunk(orgPairs, chunkSize);
  return chunkedOrgs.map((chunk) => {
    const orgChunk = emptyOrgList();
    for (const [orgType, orgId] of chunk) {
      orgChunk[orgType as OrgListKey].push(orgId);
    }

    return orgChunk;
  });
};

const plurals = {
  group: 'groups',
  district: 'districts',
  school: 'schools',
  class: 'classes',
  family: 'families',
  administration: 'administrations',
  user: 'users',
  assignment: 'assignments',
  run: 'runs',
  trial: 'trials',
};

export const pluralizeFirestoreCollection = (singular: string) => {
  if (Object.values(plurals).includes(singular)) return singular;

  const plural = plurals[singular as keyof typeof plurals];
  if (plural) return plural;

  throw new Error(`There is no plural Firestore collection for the ${singular}`);
};

export const singularizeFirestoreCollection = (plural: string) => {
  if (Object.values(_invert(plurals)).includes(plural)) return plural;

  const singular = _invert(plurals)[plural];
  if (singular) return singular;

  throw new Error(`There is no Firestore collection ${plural}`);
};
