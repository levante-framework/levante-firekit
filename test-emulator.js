const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInAnonymously } = require('firebase/auth');

// Import the configuration from your project
const baseConfig = require('./src/config/firebaseLevante').default;

// Set environment variables 
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9199';

async function testEmulator() {
  console.log('Testing emulator connection...');
  
  try {
    // Get the base config
    const appBaseConfig = baseConfig.app;
    
    // Initialize Firebase app
    const firebaseApp = initializeApp({
      apiKey: appBaseConfig.apiKey,
      authDomain: appBaseConfig.authDomain,
      projectId: appBaseConfig.projectId,
      storageBucket: appBaseConfig.storageBucket,
      messagingSenderId: appBaseConfig.messagingSenderId,
      appId: appBaseConfig.appId
    });
    
    console.log('Firebase app initialized');
    
    // Get Firebase Auth
    const auth = getAuth(firebaseApp);
    
    // Connect to Auth emulator
    console.log('Connecting to Auth emulator at 127.0.0.1:9199');
    connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true });
    
    console.log('Successfully connected to Auth emulator');
    
    // Try a basic operation
    console.log('Attempting to sign in anonymously...');
    const userCredential = await signInAnonymously(auth);
    
    console.log('Successfully signed in anonymously:', userCredential.user.uid);
    console.log('Emulator connection test passed!');
  } catch (error) {
    console.error('Error testing emulator connection:', error);
  }
}

testEmulator(); 