#!/bin/bash

# Start Firebase emulator for merged database architecture
# This script starts the emulator for the project-merge-1 branch

echo "=== Starting Firebase Emulator for Merged Database Architecture ==="
echo "This will start emulators for the project-merge-1 branch"
echo ""

# Set environment variables for merged database
export USE_MERGED_DATABASE=true
export FIREBASE_PROJECT_ID=demo-gse-roar-merged
export FIREBASE_EMULATOR_HOST=127.0.0.1

# Navigate to the merged firebase directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
FIREBASE_DIR="$PROJECT_ROOT/firebase/merged"

echo "Project root: $PROJECT_ROOT"
echo "Firebase directory: $FIREBASE_DIR"

# Check if firebase directory exists
if [ ! -d "$FIREBASE_DIR" ]; then
    echo "Error: Firebase merged directory not found at $FIREBASE_DIR"
    echo "Please ensure the merged firebase configuration exists."
    exit 1
fi

# Change to firebase directory
cd "$FIREBASE_DIR"

echo "Starting Firebase emulators..."
echo "- Auth: 127.0.0.1:9199"
echo "- Firestore: 127.0.0.1:8180"
echo "- Functions: 127.0.0.1:5102"
echo "- UI: 127.0.0.1:4040"
echo ""

# Start the emulators
firebase emulators:start --project demo-gse-roar-merged

echo "Firebase emulators stopped." 