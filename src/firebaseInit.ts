import { createFirekit, RoarFirekit } from 'levante-firekit';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { setActivePinia } from 'pinia';
import { createPinia } from 'pinia';
import { markRaw } from 'vue';
import { useUserStore } from './store/user';
import { useAuthStore } from './store/auth';
import { FirebaseConfig, AuthPersistence } from 'levante-firekit';
import router from './router';
import { getInactivityDuration } from './config/inactivityConfig';

// Existing firebase configuration
const FIREBASE_CONFIG_ADMIN = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY_ADMIN,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN_ADMIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID_ADMIN,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET_ADMIN,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID_ADMIN,
  appId: import.meta.env.VITE_FIREBASE_APP_ID_ADMIN,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID_ADMIN,
  siteKey: import.meta.env.VITE_FIREBASE_RECAPTCHA_SITE_KEY_ADMIN
};

const FIREBASE_CONFIG_APP = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY_APP,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN_APP,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID_APP,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET_APP,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID_APP,
  appId: import.meta.env.VITE_FIREBASE_APP_ID_APP,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID_APP,
  siteKey: import.meta.env.VITE_FIREBASE_RECAPTCHA_SITE_KEY_APP
};

// New configuration with emulator settings
const customConfig = {
  admin: {
    ...FIREBASE_CONFIG_ADMIN,
    useEmulators: false // Will be overridden by the createFirekit function if needed
  },
  app: {
    ...FIREBASE_CONFIG_APP,
    useEmulators: false // Will be overridden by the createFirekit function if needed
  }
};

// Create a single firebase service instance to be reused
let firekitInstance: RoarFirekit | null = null;

/**
 * Get or initialize the Firebase service
 * @param options Configuration options for Firebase
 * @returns Initialized RoarFirekit instance
 */
export async function getFirekit({
  useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true',
  emulatorHost = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || 'localhost',
  forceRefresh = false
} = {}) {
  // Return existing instance if it exists and no refresh is requested
  if (firekitInstance && !forceRefresh) {
    return firekitInstance;
  }

  console.log(`Initializing Firebase${useEmulators ? ' with emulators' : ''}`);

  // Create new firekit instance
  firekitInstance = await createFirekit({
    useEmulators,
    emulatorHost,
    authPersistence: AuthPersistence.session,
    verboseLogging: import.meta.env.DEV,
    customConfig
  });

  return firekitInstance;
}

// Setup auth listener to update stores
export function setupAuthListener() {
  if (!firekitInstance) {
    console.error('Firebase not initialized. Call getFirekit() first.');
    return;
  }

  // Ensure pinia is active
  try {
    setActivePinia(createPinia());
  } catch (error) {
    // Pinia might already be initialized, which is fine
  }

  const userStore = useUserStore();
  const authStore = useAuthStore();

  // Listen for auth state changes on both admin and assessment projects
  if (firekitInstance.admin) {
    onAuthStateChanged(firekitInstance.admin.auth, (user) => {
      authStore.setAdminUser(user ? markRaw(user) : null);
      if (!user) {
        router.push('/auth/login');
      }
    });
  }

  if (firekitInstance.app) {
    onAuthStateChanged(firekitInstance.app.auth, (user) => {
      authStore.setAppUser(user ? markRaw(user) : null);
    });
  }

  // Set the configured inactivity timeout
  const inactivityDuration = getInactivityDuration();
  authStore.setInactivityDuration(inactivityDuration);
}

// Function to sign out and reset the instance
export async function signOutAndReset() {
  if (firekitInstance?.app?.user || firekitInstance?.admin?.user) {
    try {
      await firekitInstance.signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }
  
  // Force refresh the instance
  firekitInstance = null;
}

// Toggle between emulators and production
export async function toggleEmulators(useEmulators: boolean) {
  // Sign out before switching
  await signOutAndReset();
  
  // Get a fresh instance with the desired configuration
  return getFirekit({
    useEmulators,
    forceRefresh: true
  });
}

// Initialize Firebase on app startup
export async function initializeFirebase() {
  const firekit = await getFirekit();
  setupAuthListener();
  return firekit;
}

export default {
  getFirekit,
  setupAuthListener,
  signOutAndReset,
  toggleEmulators,
  initializeFirebase
}; 