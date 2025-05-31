#!/usr/bin/env node

/**
 * Test script for merged database architecture
 * This script tests the new RoarMergedFirekit with the Firebase emulator
 */

const { createFirekit } = require('./lib/index.js');

// Set environment variables to use merged database
process.env.USE_MERGED_DATABASE = 'true';
process.env.FIREBASE_PROJECT_ID = 'hs-levante-admin-dev'; // Matches firebase-functions project
process.env.FIREBASE_EMULATOR_HOST = '127.0.0.1';

async function testMergedArchitecture() {
  console.log('=== Testing Merged Database Architecture ===');
  console.log('');
  
  try {
    console.log('Creating Firekit instance with merged database...');
    
    // Create firekit instance with merged database
    const firekit = await createFirekit({
      useEmulators: true,
      emulatorHost: '127.0.0.1',
      emulatorPorts: {
        db: 8180,      // Matches firebase-functions firestore port
        auth: 9199,    // Matches firebase-functions auth port
        functions: 5002 // Matches firebase-functions functions port
      },
      verboseLogging: true,
      useMergedDatabase: true
    });
    
    console.log('✅ Firekit instance created successfully');
    console.log('Firekit type:', firekit.constructor.name);
    console.log('Using emulators:', firekit.isUsingEmulators());
    console.log('');
    
    // Test basic authentication
    console.log('Testing authentication...');
    
    const testEmail = 'test@example.com';
    const testPassword = 'password123';
    
    try {
      // Try to register a test user
      console.log(`Attempting to register user: ${testEmail}`);
      const userCredential = await firekit.registerWithEmailAndPassword({
        email: testEmail,
        password: testPassword
      });
      
      console.log('✅ User registered successfully');
      console.log('User UID:', userCredential.user.uid);
      console.log('');
      
      // Test database references
      console.log('Testing database references...');
      const dbRefs = firekit.dbRefs;
      console.log('✅ Database references accessible');
      console.log('Available collections:', Object.keys(dbRefs));
      console.log('');
      
      // Sign out
      console.log('Signing out...');
      await firekit.signOut();
      console.log('✅ User signed out successfully');
      console.log('');
      
    } catch (authError) {
      if (authError.code === 'auth/email-already-in-use') {
        console.log('ℹ️  User already exists, trying to sign in...');
        
        const userCredential = await firekit.logInWithEmailAndPassword({
          email: testEmail,
          password: testPassword
        });
        
        console.log('✅ User signed in successfully');
        console.log('User UID:', userCredential.user.uid);
        
        // Test database references
        console.log('Testing database references...');
        const dbRefs = firekit.dbRefs;
        console.log('✅ Database references accessible');
        console.log('Available collections:', Object.keys(dbRefs));
        
        await firekit.signOut();
        console.log('✅ User signed out successfully');
      } else {
        throw authError;
      }
    }
    
    console.log('🎉 All tests passed! Merged database architecture is working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

// Run the test
testMergedArchitecture().catch(console.error); 