import { MergedRoarConfig } from '../interfaces';
import { EmulatorFirebaseConfig } from '../firestore/util';

// Merged database configuration for project-merge-1 branch
const mergedConfig: MergedRoarConfig = {
  merged: {
    projectId: 'hs-levante-admin-dev', // Matches firebase-functions project ID
    apiKey: 'demo-api-key',
    siteKey: 'demo-site-key',
    useEmulators: true,
    emulatorHost: '127.0.0.1',
    emulatorPorts: {
      db: 8180,      // Matches firebase-functions firestore port
      auth: 9199,    // Matches firebase-functions auth port  
      functions: 5002, // Matches firebase-functions functions port
    },
  } as EmulatorFirebaseConfig,
};

// Helper function to check if we should use merged architecture
export const shouldUseMergedArchitecture = (): boolean => {
  // Check environment variables
  if (typeof process !== 'undefined' && 
      typeof process.env !== 'undefined' && 
      process.env.USE_MERGED_DATABASE === 'true') {
    return true;
  }
  
  // Check window object (browser environment)
  if (typeof window !== 'undefined' && 
      (window as any).USE_MERGED_DATABASE === true) {
    return true;
  }
  
  // Check localStorage
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem('useMergedDatabase');
      if (stored === 'true') return true;
    } catch (e) {
      // Ignore localStorage errors
    }
  }
  
  return false;
};

// Helper function to get merged config with environment overrides
export const getMergedConfig = (): MergedRoarConfig => {
  const config = { ...mergedConfig };
  
  // Override with environment variables if available
  if (typeof process !== 'undefined' && typeof process.env !== 'undefined') {
    if (process.env.FIREBASE_PROJECT_ID) {
      config.merged.projectId = process.env.FIREBASE_PROJECT_ID;
    }
    if (process.env.FIREBASE_API_KEY) {
      config.merged.apiKey = process.env.FIREBASE_API_KEY;
    }
    if (process.env.FIREBASE_EMULATOR_HOST) {
      config.merged.emulatorHost = process.env.FIREBASE_EMULATOR_HOST;
    }
  }
  
  return config;
};

export default mergedConfig; 