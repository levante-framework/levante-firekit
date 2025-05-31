# Merged Database Architecture

This document explains the new merged database architecture that consolidates the previously separate admin and assessment Firebase projects into a single project.

## Overview

The merged database architecture replaces the dual admin/app Firebase project setup with a single Firebase project that contains both admin and assessment data. This simplifies authentication, reduces complexity, and aligns with the `project-merge-1` branch of the firebase-functions repository.

## Key Changes

### Before (Legacy Dual Database)
- **Two Firebase projects**: `admin` and `app` (assessment)
- **Complex authentication**: Users must authenticate to both projects
- **Separate databases**: Admin data in admin project, assessment data in app project
- **Dual configuration**: Requires separate configs for admin and app

### After (Merged Database)
- **Single Firebase project**: All data in one project
- **Simple authentication**: Users authenticate to one project only
- **Unified database**: Admin and assessment data in the same Firestore database
- **Single configuration**: One Firebase project configuration

## Usage

### Environment Variables

To use the merged database architecture, set these environment variables:

```bash
export USE_MERGED_DATABASE=true
export FIREBASE_PROJECT_ID=demo-gse-roar-merged
export FIREBASE_EMULATOR_HOST=127.0.0.1
```

### Code Usage

```javascript
import { createFirekit } from '@levante-framework/firekit';

// Create firekit instance with merged database
const firekit = await createFirekit({
  useEmulators: true,
  emulatorHost: '127.0.0.1',
  emulatorPorts: {
    db: 8180,
    auth: 9199,
    functions: 5102
  },
  verboseLogging: true,
  useMergedDatabase: true  // Enable merged database architecture
});

// Use firekit normally - authentication and database operations
// are now simplified to work with a single Firebase project
const userCredential = await firekit.logInWithEmailAndPassword({
  email: 'user@example.com',
  password: 'password123'
});

// Access database references (all in one project now)
const dbRefs = firekit.dbRefs;
console.log('Available collections:', Object.keys(dbRefs));
```

### Browser Usage

In browser environments, you can also enable merged database mode via localStorage:

```javascript
// Enable merged database mode
localStorage.setItem('useMergedDatabase', 'true');

// Or set window property
window.USE_MERGED_DATABASE = true;
```

## Database Schema

The merged database contains all collections in a single Firestore database:

```
/users/{userId}                    # User profiles (admin + assessment data)
  /runs/{runId}                    # Assessment runs (moved from app project)
  /assignments/{assignmentId}      # User assignments

/tasks/{taskId}                    # Task definitions (moved from app project)
  /variants/{variantId}            # Task variants

/administrations/{adminId}         # Administrations
/districts/{districtId}            # Districts
/schools/{schoolId}                # Schools  
/classes/{classId}                 # Classes
/groups/{groupId}                  # Groups
/families/{familyId}               # Families
/legal/{docId}                     # Legal documents
/surveyResponses/{responseId}      # Survey responses
```

## Emulator Configuration

### Starting the Merged Emulator

Use the provided script to start the Firebase emulator for merged database:

```bash
./scripts/start-merged-emulator.sh
```

This starts emulators on:
- **Auth**: 127.0.0.1:9199
- **Firestore**: 127.0.0.1:8180  
- **Functions**: 127.0.0.1:5102
- **UI**: 127.0.0.1:4040

### Manual Emulator Start

You can also start the emulator manually:

```bash
cd firebase/merged
firebase emulators:start --project demo-gse-roar-merged
```

## Testing

Test the merged database architecture:

```bash
# Build the project first
npm run build

# Run the test script
node test-merged-emulator.js
```

The test script will:
1. Create a firekit instance with merged database
2. Test user registration/authentication
3. Verify database references are accessible
4. Confirm the architecture is working correctly

## Migration from Legacy Architecture

The library automatically detects which architecture to use based on:

1. **Explicit parameter**: `useMergedDatabase: true`
2. **Environment variable**: `USE_MERGED_DATABASE=true`
3. **Window property**: `window.USE_MERGED_DATABASE = true`
4. **localStorage**: `localStorage.setItem('useMergedDatabase', 'true')`

If none of these are set, it defaults to the legacy dual database architecture for backward compatibility.

## Firestore Security Rules

The merged database uses unified security rules that handle both admin and assessment data:

- Users can read/write their own data
- Admins can access all user data
- Tasks and administrations require admin permissions to modify
- Assessment runs are user-specific with admin oversight

## Benefits

1. **Simplified Authentication**: Single sign-on instead of dual project authentication
2. **Reduced Complexity**: One Firebase project instead of two
3. **Better Performance**: No cross-project authentication flows
4. **Easier Development**: Single emulator setup
5. **Unified Data Model**: All related data in one database
6. **Simplified Deployment**: One project to deploy and manage

## Backward Compatibility

The library maintains full backward compatibility. Existing code using the legacy dual database architecture will continue to work unchanged. The merged architecture is opt-in via the configuration options described above.

## Files Added/Modified

### New Files
- `src/mergedFirekit.ts` - New RoarMergedFirekit class
- `src/config/mergedConfig.ts` - Configuration for merged database
- `firebase/merged/` - Firebase configuration for merged project
- `scripts/start-merged-emulator.sh` - Script to start merged emulator
- `test-merged-emulator.js` - Test script for merged architecture

### Modified Files
- `src/index.ts` - Updated to support both architectures
- `src/interfaces.ts` - Added MergedRoarConfig interface

This architecture is designed to work with the `project-merge-1` branch of the firebase-functions repository and provides a foundation for future development with a simplified, unified database structure. 