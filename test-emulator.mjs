import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';

// Set environment variables 
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9199';

async function testEmulator() {
  console.log('Testing emulator connection...');
  
  try {
    // Initialize Firebase app with minimal config
    const firebaseConfig = {
      apiKey: "demo-api-key",
      projectId: "demo-project"
    };
    
    // Initialize Firebase app
    const app = initializeApp(firebaseConfig, `test-app-${Date.now()}`);
    console.log('Firebase app initialized');
    
    // Get Firebase Auth
    const auth = getAuth(app);
    
    // Connect to Auth emulator
    console.log('Connecting to Auth emulator at http://127.0.0.1:9199');
    
    // Suppress verbose info logs
    const originalInfo = console.info;
    console.info = () => {};
    
    connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true });
    
    // Restore info logs
    console.info = originalInfo;
    
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

// Run the test
testEmulator(); 