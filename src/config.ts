const config = {
  development: {
    admin: {
      // Development config
      useEmulators: false,
    },
    app: {
      // Development config
      useEmulators: false,
    }
  },
  emulators: {
    admin: {
      // Emulator config
      useEmulators: true,
      emulatorHost: typeof process !== 'undefined' && 
                    typeof process.env !== 'undefined' && 
                    process.env.FIREBASE_EMULATOR_HOST || 'localhost'
    },
    app: {
      // Emulator config
      useEmulators: true,
      emulatorHost: typeof process !== 'undefined' && 
                    typeof process.env !== 'undefined' && 
                    process.env.FIREBASE_EMULATOR_HOST || 'localhost'
    }
  },
  production: {
    // Production config without emulators
  }
};

// Choose config based on NODE_ENV or USE_FIREBASE_EMULATORS
const getConfig = () => {
  // Check if emulators are requested through process.env
  const useEmulators = typeof process !== 'undefined' && 
                       typeof process.env !== 'undefined' && 
                       process.env.USE_FIREBASE_EMULATORS === 'true';
  
  // Check if window indicates emulator mode (browser)
  const windowEmulators = typeof window !== 'undefined' && window.FIREBASE_EMULATOR_MODE;

  if (useEmulators || windowEmulators) {
    return config.emulators;
  }
  
  const isProduction = typeof process !== 'undefined' && 
                       typeof process.env !== 'undefined' && 
                       process.env.NODE_ENV === 'production';
                       
  return isProduction ? config.production : config.development;
};

export default getConfig(); 