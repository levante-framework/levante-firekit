import { MergedRoarConfig } from '../interfaces';
import { EmulatorFirebaseConfig, LiveFirebaseConfig } from '../firestore/util';

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

// Live Firebase configuration for merged database
const mergedLiveConfig: MergedRoarConfig = {
  merged: {
    // Replace these with your actual Firebase project configuration
    projectId: 'your-live-project-id',
    apiKey: 'your-live-api-key',
    authDomain: 'your-live-project-id.firebaseapp.com',
    storageBucket: 'your-live-project-id.appspot.com',
    messagingSenderId: 'your-sender-id',
    appId: 'your-app-id',
    siteKey: 'your-site-key',
    useEmulators: false,
  } as LiveFirebaseConfig,
};

// Helper function to check if emulators are actually running
const checkEmulatorsRunning = async (): Promise<boolean> => {
  try {
    // Check if Auth emulator is running on port 9199
    const authResponse = await fetch('http://127.0.0.1:9199', { 
      method: 'GET',
      mode: 'cors'
    });
    
    if (authResponse.ok) {
      const authText = await authResponse.text();
      // Firebase Auth emulator returns JSON with "authEmulator" key
      if (authText.includes('authEmulator')) {
        console.log('[Firekit] Detected running Firebase Auth emulator on port 9199');
        return true;
      }
    }
  } catch (error) {
    // Emulator not running or not accessible
    console.log('[Firekit] No Firebase emulator detected on port 9199');
  }
  
  return false;
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

// Helper function to check if we should use emulators
const shouldUseEmulators = async (): Promise<boolean> => {
  // Check environment variables first (highest priority)
  if (typeof process !== 'undefined' && 
      typeof process.env !== 'undefined' && 
      process.env.USE_FIREBASE_EMULATORS === 'true') {
    return true;
  }
  
  // Check window object (browser environment)
  if (typeof window !== 'undefined' && 
      (window as any).FIREBASE_EMULATOR_MODE === true) {
    return true;
  }
  
  // Check localStorage
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem('useEmulators');
      if (stored === 'true') return true;
    } catch (e) {
      // Ignore localStorage errors
    }
  }
  
  // AUTOMATIC DETECTION: Check if emulators are actually running
  const emulatorsRunning = await checkEmulatorsRunning();
  if (emulatorsRunning) {
    console.log('[Firekit] Automatically detected running Firebase emulators - using emulator mode');
    return true;
  }
  
  return false;
};

// Helper function to get merged config with environment overrides
export const getMergedConfig = async (): Promise<MergedRoarConfig> => {
  // Choose between emulator and live config
  const useEmulators = await shouldUseEmulators();
  const config = useEmulators ? { ...mergedConfig } : { ...mergedLiveConfig };
  
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
    if (process.env.USE_FIREBASE_EMULATORS === 'true') {
      config.merged.useEmulators = true;
    }
  }
  
  return config;
};

export default mergedConfig; 