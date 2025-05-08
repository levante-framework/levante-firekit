/**
 * Mock data provider for development mode
 * This file provides mock data for various Firebase services when running in development mode
 */

// Test user ID that will be updated at runtime
// It will be filled with the actual UID from the emulator after user creation
export let TEST_USER_ID: string = '';

// Test user email that will be used for login
export const TEST_USER_EMAIL: string = 'test@example.com';

/**
 * Set the test user ID at runtime
 * This function updates the TEST_USER_ID at runtime
 * @param {string} uid - The user ID to set
 * @returns {string} The set user ID
 */
export const setTestUserId = (uid: string): string => {
  console.log('Setting test user ID to:', uid);
  TEST_USER_ID = uid;
  
  // Output for easy console access
  console.log('============================================');
  console.log('TEST USER CONFIGURED: Copy this to use in console if needed');
  console.log(`TEST_USER_ID = '${uid}';`);
  console.log(`window.setEmulatorTestUserId('${uid}');`);
  console.log('============================================');
  
  return uid;
};

/**
 * Check if the current environment is development mode
 * @returns {boolean} True if in development mode
 */
export const isDevMode = (): boolean => {
  // @ts-ignore - Vite-specific property
  return import.meta.env.DEV === true;
};

/**
 * Check if the provided user ID matches the test user ID
 * @param {string} uid - User ID to check
 * @returns {boolean} True if the user ID matches the test user
 */
export const isTestUser = (uid: string): boolean => {
  return uid === TEST_USER_ID;
};

// Export a default object with all helper functions
export default {
  TEST_USER_ID,
  TEST_USER_EMAIL,
  setTestUserId,
  isDevMode,
  isTestUser
}; 