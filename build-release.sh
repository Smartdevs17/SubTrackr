#!/bin/bash

# SubTrackr Release Build Script
# This script builds a release APK with bundled JavaScript for physical device testing

set -e  # Exit on any error

echo "🚀 SubTrackr Release Build Script"
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -f "app.json" ]; then
    print_error "This doesn't appear to be a SubTrackr project directory."
    print_error "Please run this script from the project root."
    exit 1
fi

echo ""
print_status "Starting release build process..."

# Step 1: Ensure we have a clean prebuild
print_status "Step 1: Ensuring clean prebuild..."
if [ ! -d "android" ]; then
    print_status "Android directory not found. Running prebuild..."
    npx expo prebuild --platform android --clean
else
    print_status "Android directory exists. Cleaning and rebuilding..."
    rm -rf android/
    npx expo prebuild --platform android --clean
fi

print_success "Prebuild completed successfully!"

# Step 2: Bundle JavaScript for release
print_status "Step 2: Bundling JavaScript for release..."
mkdir -p android/app/src/main/assets

# Create the bundle directory
print_status "Creating bundle directory..."
mkdir -p android/app/src/main/assets

# Bundle the JavaScript using Expo export
print_status "Bundling JavaScript code using Expo export..."
npx expo export --platform android --output-dir android/app/src/main/assets --clear

if [ $? -eq 0 ]; then
    print_success "JavaScript bundled successfully!"
    
    # Check if the bundle was created and copy it to the right location
    if [ -f "android/app/src/main/assets/index.android.bundle" ]; then
        print_success "Bundle found in expected location!"
    else
        print_status "Looking for bundle in exported files..."
        # Find the bundle file that Expo export created (including .hbc files)
        BUNDLE_FILE=$(find android/app/src/main/assets -name "*.bundle" -o -name "*.js" -o -name "*.hbc" | head -n 1)
        if [ -n "$BUNDLE_FILE" ]; then
            print_status "Found bundle: $BUNDLE_FILE"
            # Copy it to the expected location with the right name
            cp "$BUNDLE_FILE" "android/app/src/main/assets/index.android.bundle"
            print_success "Bundle copied to expected location!"
        else
            print_error "No bundle file found after Expo export!"
            exit 1
        fi
    fi
else
    print_error "Failed to bundle JavaScript!"
    exit 1
fi

# Step 3: Build release APK
print_status "Step 3: Building release APK..."
cd android

# Clean the project
print_status "Cleaning Android project..."
./gradlew clean

# Build release APK
print_status "Building release APK..."
./gradlew assembleRelease

# Check if build was successful
if [ $? -eq 0 ]; then
    print_success "Release APK built successfully!"
else
    print_error "Release APK build failed!"
    cd ..
    exit 1
fi

# Go back to project root
cd ..

# Step 4: Create builds directory and copy APK
print_status "Step 4: Organizing build output..."
mkdir -p builds

# Find the generated release APK
APK_PATH=$(find android/app/build/outputs/apk/release/ -name "*.apk" | head -n 1)

if [ -z "$APK_PATH" ]; then
    print_error "Could not find generated release APK!"
    exit 1
fi

# Rename and copy APK
APK_NAME="subtrackr-release.apk"
FINAL_APK_PATH="builds/$APK_NAME"

print_status "Copying release APK to: $APK_NAME"
cp "$APK_PATH" "$FINAL_APK_PATH"

# Get APK info
APK_SIZE=$(du -h "$FINAL_APK_PATH" | cut -f1)
BUNDLE_SIZE=$(du -h android/app/src/main/assets/index.android.bundle 2>/dev/null | cut -f1 || echo "N/A")
BUILD_DATE=$(date '+%Y-%m-%d %H:%M:%S')

echo ""
print_success "🎉 Release build completed successfully!"
echo ""
echo "📱 Release APK Details:"
echo "   Name: $APK_NAME"
echo "   Size: $APK_SIZE"
echo "   Location: $FINAL_APK_PATH"
echo "   Built: $BUILD_DATE"
echo "   JS Bundle: $BUNDLE_SIZE"
echo ""

print_status "What was built:"
echo "   ✅ Clean prebuild with native code"
echo "   ✅ JavaScript bundled for release"
echo "   ✅ Release APK with bundled JS"
echo "   ✅ Ready for physical device testing"
echo ""

print_status "Next steps:"
echo "   1. Install $APK_NAME on your device"
echo "   2. App should work without Metro bundler"
echo "   3. Test all features on physical device"
echo "   4. Share with hackathon judges"
echo ""

print_success "Your SubTrackr release APK is ready for device testing! 🚀📱"
print_warning "Note: This APK contains bundled JavaScript and will work offline!"
