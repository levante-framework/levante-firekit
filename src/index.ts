import { RoarFirekit } from './firekit';
import { RoarMergedFirekit } from './mergedFirekit';
import configService from './config';
import { getMergedConfig, shouldUseMergedArchitecture } from './config/mergedConfig';
import { AuthPersistence } from './firestore/util';
import { RoarConfig, MergedRoarConfig } from './interfaces';

// Add global type declarations for window properties
declare global {
  interface Window {
    FIREBASE_EMULATOR_MODE?: boolean;
    FIREBASE_AUTH_EMULATOR_HOST?: string;
    FIRESTORE_EMULATOR_HOST?: string;
    FUNCTIONS_EMULATOR_HOST?: string;
    USE_MERGED_DATABASE?: boolean;
  }
}

export { RoarFirekit } from './firekit';
export { RoarMergedFirekit } from './mergedFirekit';
export { RoarAppkit } from './firestore/app/appkit';
export { RoarAppUser } from './firestore/app/user';
export { RoarTaskVariant } from './firestore/app/task';
export { emptyOrg, emptyOrgList, getTreeTableOrgs, initializeFirebaseProject, AuthPersistence } from './firestore/util';

export async function createFirekit({
  useEmulators = false,
  emulatorHost = 'localhost',
  emulatorPorts = {
    db: undefined,
    auth: undefined,
    functions: undefined
  },
  authPersistence = AuthPersistence.session,
  verboseLogging = false,
  customConfig = null,
  useMergedDatabase = false
}: {
  useEmulators?: boolean;
  emulatorHost?: string;
  emulatorPorts?: {
    db?: number;
    auth?: number;
    functions?: number;
  };
  authPersistence?: AuthPersistence;
  verboseLogging?: boolean;
  customConfig?: RoarConfig | MergedRoarConfig | null;
  useMergedDatabase?: boolean;
} = {}) {
  
  // Check if we should use merged database architecture
  const shouldUseMerged = useMergedDatabase || shouldUseMergedArchitecture();
  
  if (verboseLogging) {
    console.log('[Firekit] Using merged database architecture:', shouldUseMerged);
  }

  if (shouldUseMerged) {
    // Use merged database architecture
    return await createMergedFirekit({
      useEmulators,
      emulatorHost,
      emulatorPorts,
      authPersistence,
      verboseLogging,
      customConfig: customConfig as MergedRoarConfig | null
    });
  } else {
    // Use legacy dual database architecture
    return createLegacyFirekit({
      useEmulators,
      emulatorHost,
      emulatorPorts,
      authPersistence,
      verboseLogging,
      customConfig: customConfig as RoarConfig | null
    });
  }
}

// Create merged database firekit
async function createMergedFirekit({
  useEmulators = false,
  emulatorHost = 'localhost',
  emulatorPorts = {
    db: undefined,
    auth: undefined,
    functions: undefined
  },
  authPersistence = AuthPersistence.session,
  verboseLogging = false,
  customConfig = null
}: {
  useEmulators?: boolean;
  emulatorHost?: string;
  emulatorPorts?: {
    db?: number;
    auth?: number;
    functions?: number;
  };
  authPersistence?: AuthPersistence;
  verboseLogging?: boolean;
  customConfig?: MergedRoarConfig | null;
}) {
  console.log('[createMergedFirekit] Starting with config:', {
    useEmulators,
    emulatorHost,
    emulatorPorts,
    hasCustomConfig: !!customConfig,
    customConfig: customConfig
  });
  
  const roarConfig = customConfig || await getMergedConfig();
  
  console.log('[createMergedFirekit] Final roarConfig:', roarConfig);
  
  // Override emulator settings if specified
  if (useEmulators) {
    roarConfig.merged.useEmulators = true;
    roarConfig.merged.emulatorHost = emulatorHost;
    
    if (!('emulatorPorts' in roarConfig.merged)) {
      (roarConfig.merged as any).emulatorPorts = {};
    }
    
    if (emulatorPorts.db !== undefined) {
      (roarConfig.merged as any).emulatorPorts.db = emulatorPorts.db;
    }
    if (emulatorPorts.auth !== undefined) {
      (roarConfig.merged as any).emulatorPorts.auth = emulatorPorts.auth;
    }
    if (emulatorPorts.functions !== undefined) {
      (roarConfig.merged as any).emulatorPorts.functions = emulatorPorts.functions;
    }
    
    console.log('[createMergedFirekit] Updated roarConfig with emulator settings:', roarConfig);
  }

  console.log('[createMergedFirekit] Creating RoarMergedFirekit instance...');
  const firekit = new RoarMergedFirekit({
    roarConfig,
    verboseLogging,
    authPersistence,
    markRawConfig: {},
    listenerUpdateCallback: () => {}
  });

  console.log('[createMergedFirekit] Calling firekit.init()...');
  const initializedFirekit = await firekit.init();
  
  console.log('[createMergedFirekit] Firekit initialized:', {
    type: initializedFirekit.constructor.name,
    initialized: initializedFirekit.initialized,
    hasAuth: !!initializedFirekit.auth,
    hasAdmin: !!initializedFirekit.admin,
    hasApp: !!initializedFirekit.app,
    hasProject: !!(initializedFirekit as any).project,
    projectAuth: !!(initializedFirekit as any).project?.auth,
    projectDb: !!(initializedFirekit as any).project?.db,
    projectFunctions: !!(initializedFirekit as any).project?.functions,
    hasSignInFromRedirectResult: typeof initializedFirekit.signInFromRedirectResult === 'function',
    hasGetRedirectResult: typeof initializedFirekit.getRedirectResult === 'function',
    availableMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(initializedFirekit)).filter(name => 
      name.includes('signIn') || name.includes('auth') || name.includes('redirect')
    )
  });
  
  return initializedFirekit;
}

// Create legacy dual database firekit
function createLegacyFirekit({
  useEmulators = false,
  emulatorHost = 'localhost',
  emulatorPorts = {
    db: undefined,
    auth: undefined,
    functions: undefined
  },
  authPersistence = AuthPersistence.session,
  verboseLogging = false,
  customConfig = null
}: {
  useEmulators?: boolean;
  emulatorHost?: string;
  emulatorPorts?: {
    db?: number;
    auth?: number;
    functions?: number;
  };
  authPersistence?: AuthPersistence;
  verboseLogging?: boolean;
  customConfig?: RoarConfig | null;
}) {
  // Check for emulator settings in multiple places
  const checkEmulatorMode = () => {
    // Check parameter
    if (useEmulators) return true;
    
    // Check window object
    if (typeof window !== 'undefined') {
      if (window.FIREBASE_EMULATOR_MODE) return true;
      
      // Check localStorage as well (used by EmulatorToggle)
      try {
        const localStorageValue = window.localStorage.getItem('useEmulators');
        if (localStorageValue === 'true') return true;
      } catch (e) {
        // Ignore localStorage errors
      }
    }
    
    // Check process.env
    if (typeof process !== 'undefined' && 
        typeof process.env !== 'undefined' && 
        process.env.USE_FIREBASE_EMULATORS === 'true') {
      return true;
    }
    
    // Default is false
    return false;
  };
  
  // Get emulator settings from various sources
  const getEmulatorSettings = () => {
    const settings = {
      host: emulatorHost,
      ports: {
        db: emulatorPorts.db,
        auth: emulatorPorts.auth,
        functions: emulatorPorts.functions
      }
    };
    
    // Try to get from localStorage if in browser environment
    if (typeof window !== 'undefined') {
      try {
        const storedHost = window.localStorage.getItem('emulatorHost');
        if (storedHost) settings.host = storedHost;
        
        const storedDbPort = window.localStorage.getItem('firestorePort');
        if (storedDbPort) settings.ports.db = parseInt(storedDbPort, 10);
        
        const storedAuthPort = window.localStorage.getItem('authPort');
        if (storedAuthPort) settings.ports.auth = parseInt(storedAuthPort, 10);
        
        const storedFunctionsPort = window.localStorage.getItem('functionsPort');
        if (storedFunctionsPort) settings.ports.functions = parseInt(storedFunctionsPort, 10);
      } catch (e) {
        // Ignore localStorage errors
        console.warn('Error reading emulator settings from localStorage:', e);
      }
    }
    
    // Check if already set in window globals
    if (typeof window !== 'undefined') {
      if (window.FIREBASE_AUTH_EMULATOR_HOST) {
        const parts = window.FIREBASE_AUTH_EMULATOR_HOST.split(':');
        if (parts.length === 2) {
          settings.host = parts[0];
          settings.ports.auth = parseInt(parts[1], 10);
        }
      }
      
      if (window.FIRESTORE_EMULATOR_HOST) {
        const parts = window.FIRESTORE_EMULATOR_HOST.split(':');
        if (parts.length === 2) {
          settings.ports.db = parseInt(parts[1], 10);
        }
      }
      
      if (window.FUNCTIONS_EMULATOR_HOST) {
        const parts = window.FUNCTIONS_EMULATOR_HOST.split(':');
        if (parts.length === 2) {
          settings.ports.functions = parseInt(parts[1], 10);
        }
      }
    }
    
    // Set defaults for missing values
    if (!settings.host) settings.host = 'localhost';
    if (!settings.ports.db) settings.ports.db = 8080;
    if (!settings.ports.auth) settings.ports.auth = 9099;
    if (!settings.ports.functions) settings.ports.functions = 5001;
    
    return settings;
  };
  
  // Determine whether to use emulators based on all sources
  const shouldUseEmulators = checkEmulatorMode();
  
  if (verboseLogging) {
    console.log('[Firekit] Emulator mode:', shouldUseEmulators);
  }
  
  // Force emulator configuration if we should use emulators
  if (shouldUseEmulators) {
    const emulatorSettings = getEmulatorSettings();
    
    if (verboseLogging) {
      console.log('[Firekit] Using emulator settings:', emulatorSettings);
    }
    
    // Safely set process.env variables if available
    if (typeof window !== 'undefined') {
      // In browser environment, set window properties that firebaseInit.ts can read
      window.FIREBASE_EMULATOR_MODE = true;
      if (emulatorSettings.ports.auth !== undefined) {
        window.FIREBASE_AUTH_EMULATOR_HOST = `${emulatorSettings.host}:${emulatorSettings.ports.auth}`;
      }
      if (emulatorSettings.ports.db !== undefined) {
        window.FIRESTORE_EMULATOR_HOST = `${emulatorSettings.host}:${emulatorSettings.ports.db}`;
      }
      if (emulatorSettings.ports.functions !== undefined) {
        window.FUNCTIONS_EMULATOR_HOST = `${emulatorSettings.host}:${emulatorSettings.ports.functions}`;
      }
      
      if (verboseLogging) {
        console.log('[Firekit] Set window emulator settings:', {
          FIREBASE_EMULATOR_MODE: window.FIREBASE_EMULATOR_MODE,
          FIREBASE_AUTH_EMULATOR_HOST: window.FIREBASE_AUTH_EMULATOR_HOST,
          FIRESTORE_EMULATOR_HOST: window.FIRESTORE_EMULATOR_HOST,
          FUNCTIONS_EMULATOR_HOST: window.FUNCTIONS_EMULATOR_HOST
        });
      }
    }
    
    // Set Node.js environment variables if we're in a Node.js environment
    if (typeof process !== 'undefined' && typeof process.env !== 'undefined') {
      process.env.USE_FIREBASE_EMULATORS = 'true';
      process.env.FIREBASE_EMULATOR_HOST = emulatorSettings.host;
      process.env.FIREBASE_AUTH_EMULATOR_HOST = `${emulatorSettings.host}:${emulatorSettings.ports.auth}`;
      if (emulatorSettings.ports.db !== undefined) {
        process.env.FIREBASE_FIRESTORE_EMULATOR_PORT = emulatorSettings.ports.db.toString();
      }
      if (emulatorSettings.ports.auth !== undefined) {
        process.env.FIREBASE_AUTH_EMULATOR_PORT = emulatorSettings.ports.auth.toString();
      }
      if (emulatorSettings.ports.functions !== undefined) {
        process.env.FIREBASE_FUNCTIONS_EMULATOR_PORT = emulatorSettings.ports.functions.toString();
      }
      
      if (verboseLogging) {
        console.log('[Firekit] Set process.env emulator settings:', {
          USE_FIREBASE_EMULATORS: process.env.USE_FIREBASE_EMULATORS,
          FIREBASE_EMULATOR_HOST: process.env.FIREBASE_EMULATOR_HOST,
          FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
          FIREBASE_FIRESTORE_EMULATOR_PORT: process.env.FIREBASE_FIRESTORE_EMULATOR_PORT,
          FIREBASE_AUTH_EMULATOR_PORT: process.env.FIREBASE_AUTH_EMULATOR_PORT,
          FIREBASE_FUNCTIONS_EMULATOR_PORT: process.env.FIREBASE_FUNCTIONS_EMULATOR_PORT
        });
      }
    }

    // Use provided custom config or get from config service
    const roarConfig = customConfig || configService;

    // Add emulator configuration to roarConfig
    if (roarConfig && 'admin' in roarConfig && 'app' in roarConfig) {
      const typedConfig = roarConfig as RoarConfig;
      // Add emulator configuration to both admin and app configs
      if (typedConfig.admin) {
        typedConfig.admin.useEmulators = true;
        typedConfig.admin.emulatorHost = emulatorSettings.host;
        if (!('emulatorPorts' in typedConfig.admin)) {
          (typedConfig.admin as any).emulatorPorts = {};
        }
        // Use the emulatorSettings values
        if (emulatorSettings.ports.db !== undefined) {
          (typedConfig.admin as any).emulatorPorts.db = emulatorSettings.ports.db;
        }
        if (emulatorSettings.ports.auth !== undefined) {
          (typedConfig.admin as any).emulatorPorts.auth = emulatorSettings.ports.auth;
        }
        if (emulatorSettings.ports.functions !== undefined) {
          (typedConfig.admin as any).emulatorPorts.functions = emulatorSettings.ports.functions;
        }
      }
      
      if (typedConfig.app) {
        typedConfig.app.useEmulators = true;
        typedConfig.app.emulatorHost = emulatorSettings.host;
        if (!('emulatorPorts' in typedConfig.app)) {
          (typedConfig.app as any).emulatorPorts = {};
        }
        // Use the emulatorSettings values
        if (emulatorSettings.ports.db !== undefined) {
          (typedConfig.app as any).emulatorPorts.db = emulatorSettings.ports.db;
        }
        if (emulatorSettings.ports.auth !== undefined) {
          (typedConfig.app as any).emulatorPorts.auth = emulatorSettings.ports.auth;
        }
        if (emulatorSettings.ports.functions !== undefined) {
          (typedConfig.app as any).emulatorPorts.functions = emulatorSettings.ports.functions;
        }
      }
    }

    // Create firekit instance with the config
    const firekit = new RoarFirekit({
      roarConfig: roarConfig as RoarConfig,
      verboseLogging,
      authPersistence,
      dbPersistence: true,
      markRawConfig: {},
      listenerUpdateCallback: () => {}
    });

    return firekit.init();
  } else {
    // Non-emulator mode (production)
    const roarConfig = customConfig || configService;
    
    const firekit = new RoarFirekit({
      roarConfig: roarConfig as RoarConfig,
      verboseLogging,
      authPersistence,
      dbPersistence: true,
      markRawConfig: {},
      listenerUpdateCallback: () => {}
    });

    return firekit.init();
  }
}

export default RoarFirekit;
