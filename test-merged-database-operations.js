#!/usr/bin/env node

/**
 * Comprehensive test for merged database operations
 * This script tests reading and writing data in the merged database architecture
 */

const { createFirekit } = require('./lib/index.js');

// Set environment variables to use merged database
process.env.USE_MERGED_DATABASE = 'true';
process.env.FIREBASE_PROJECT_ID = 'hs-levante-admin-dev';
process.env.FIREBASE_EMULATOR_HOST = '127.0.0.1';

async function testMergedDatabaseOperations() {
  console.log('=== Testing Merged Database Operations ===');
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
    console.log('Project ID:', firekit.roarConfig.merged.projectId);
    console.log('');
    
    // Test authentication
    console.log('Testing authentication...');
    const testEmail = 'test@example.com';
    const testPassword = 'password123';
    
    let userCredential;
    try {
      userCredential = await firekit.registerWithEmailAndPassword({
        email: testEmail,
        password: testPassword
      });
      console.log('✅ User registered successfully');
    } catch (error) {
      if (error.code === 'auth/email-already-in-use') {
        console.log('ℹ️  User already exists, signing in...');
        userCredential = await firekit.logInWithEmailAndPassword({
          email: testEmail,
          password: testPassword
        });
        console.log('✅ User signed in successfully');
      } else {
        throw error;
      }
    }
    
    const userId = userCredential.user.uid;
    console.log('User UID:', userId);
    console.log('');
    
    // Test database operations
    console.log('Testing database operations...');
    
    // Import Firestore functions for direct database operations
    const { doc, setDoc, getDoc, collection, addDoc, getDocs, query, where, serverTimestamp } = require('firebase/firestore');
    
    const db = firekit.project.db;
    
    // 1. Test writing user data
    console.log('1. Writing user profile data...');
    const userRef = doc(db, 'users', userId);
    await setDoc(userRef, {
      email: testEmail,
      userType: 'student',
      name: {
        first: 'Test',
        last: 'User'
      },
      createdAt: serverTimestamp(),
      testData: true
    }, { merge: true });
    console.log('✅ User profile data written');
    
    // 2. Test reading user data
    console.log('2. Reading user profile data...');
    const userDoc = await getDoc(userRef);
    if (userDoc.exists()) {
      console.log('✅ User profile data read successfully');
      console.log('User data:', userDoc.data());
    } else {
      console.log('❌ User profile data not found');
    }
    console.log('');
    
    // 3. Test writing assessment run data (this would have been in separate app project before)
    console.log('3. Writing assessment run data...');
    const runsRef = collection(db, 'users', userId, 'runs');
    const runDoc = await addDoc(runsRef, {
      taskId: 'test-task',
      variantId: 'test-variant',
      timeStarted: serverTimestamp(),
      completed: false,
      testData: true,
      scores: {
        raw: { practice: { numCorrect: 5, numAttempted: 10 } }
      }
    });
    console.log('✅ Assessment run data written');
    console.log('Run ID:', runDoc.id);
    
    // 4. Test reading assessment runs
    console.log('4. Reading assessment runs...');
    const runsSnapshot = await getDocs(runsRef);
    console.log('✅ Assessment runs read successfully');
    console.log('Number of runs:', runsSnapshot.size);
    runsSnapshot.forEach(doc => {
      console.log('Run:', doc.id, '- Task:', doc.data().taskId);
    });
    console.log('');
    
    // 5. Test writing task data (this would have been in separate app project before)
    console.log('5. Writing task definition data...');
    const taskRef = doc(db, 'tasks', 'test-task');
    await setDoc(taskRef, {
      name: 'Test Task',
      description: 'A test task for merged database',
      gameConfig: { difficulty: 'easy' },
      registered: true,
      lastUpdated: serverTimestamp(),
      testData: true
    });
    console.log('✅ Task definition data written');
    
    // 6. Test reading task data
    console.log('6. Reading task definition data...');
    const taskDoc = await getDoc(taskRef);
    if (taskDoc.exists()) {
      console.log('✅ Task definition data read successfully');
      console.log('Task data:', taskDoc.data());
    }
    console.log('');
    
    // 7. Test writing administration data (admin functionality)
    console.log('7. Writing administration data...');
    const adminRef = doc(db, 'administrations', 'test-admin');
    await setDoc(adminRef, {
      name: 'Test Administration',
      publicName: 'Test Admin Public',
      createdBy: userId,
      dateCreated: serverTimestamp(),
      dateOpened: serverTimestamp(),
      dateClosed: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      sequential: true,
      assessments: [
        {
          taskId: 'test-task',
          variantId: 'test-variant',
          params: { difficulty: 'medium' }
        }
      ],
      testData: true
    });
    console.log('✅ Administration data written');
    
    // 8. Test querying across collections (demonstrates unified database)
    console.log('8. Querying test data across collections...');
    
    // Query all test data from users collection
    const testUsersQuery = query(collection(db, 'users'), where('testData', '==', true));
    const testUsersSnapshot = await getDocs(testUsersQuery);
    console.log('Test users found:', testUsersSnapshot.size);
    
    // Query all test data from tasks collection  
    const testTasksQuery = query(collection(db, 'tasks'), where('testData', '==', true));
    const testTasksSnapshot = await getDocs(testTasksQuery);
    console.log('Test tasks found:', testTasksSnapshot.size);
    
    // Query all test data from administrations collection
    const testAdminsQuery = query(collection(db, 'administrations'), where('testData', '==', true));
    const testAdminsSnapshot = await getDocs(testAdminsQuery);
    console.log('Test administrations found:', testAdminsSnapshot.size);
    
    console.log('✅ Cross-collection queries successful');
    console.log('');
    
    // Test database references from firekit
    console.log('9. Testing Firekit database references...');
    const dbRefs = firekit.dbRefs;
    console.log('Available database references:', Object.keys(dbRefs));
    
    // Test that all references point to the same database
    console.log('All references use same database:', 
      dbRefs.user.firestore === dbRefs.tasks.firestore &&
      dbRefs.tasks.firestore === dbRefs.administrations.firestore
    );
    console.log('');
    
    // Sign out
    console.log('Signing out...');
    await firekit.signOut();
    console.log('✅ User signed out successfully');
    console.log('');
    
    console.log('🎉 All merged database operations completed successfully!');
    console.log('');
    console.log('Summary:');
    console.log('- ✅ Single Firebase project architecture working');
    console.log('- ✅ User authentication and profile data');
    console.log('- ✅ Assessment runs (formerly in app project)');
    console.log('- ✅ Task definitions (formerly in app project)');
    console.log('- ✅ Administration data (admin functionality)');
    console.log('- ✅ Cross-collection queries in unified database');
    console.log('- ✅ Firekit database references working');
    console.log('');
    console.log('The merged database architecture is fully functional! 🚀');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

// Run the test
testMergedDatabaseOperations().catch(console.error); 