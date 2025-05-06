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
      emulatorHost: process.env.FIREBASE_EMULATOR_HOST || 'localhost'
    },
    app: {
      // Emulator config
      useEmulators: true,
      emulatorHost: process.env.FIREBASE_EMULATOR_HOST || 'localhost'
    }
  },
  production: {
    // Production config without emulators
  }
};

// Choose config based on NODE_ENV or USE_FIREBASE_EMULATORS
const getConfig = () => {
  if (process.env.USE_FIREBASE_EMULATORS === 'true') {
    return config.emulators;
  }
  
  return process.env.NODE_ENV === 'production' 
    ? config.production 
    : config.development;
};

export default getConfig(); 