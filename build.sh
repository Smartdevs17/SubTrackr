#!/bin/bash

# SubTrackr Android Build Script
# This script builds an Android APK without using EAS
# and automatically renames the APK to "subtrackr"
#
# Usage: ./build.sh [options]
# Options:
#   --clean     Clean all build artifacts before building
#   --install   Automatically install on connected device
#   --help      Show this help message

set -e  # Exit on any error

# Parse command line arguments
CLEAN_BUILD=false
AUTO_INSTALL=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --clean)
      CLEAN_BUILD=true
      shift
      ;;
    --install)
      AUTO_INSTALL=true
      shift
      ;;
    --help)
      echo "🚀 SubTrackr Android Build Script"
      echo "=================================="
      echo ""
      echo "Usage: ./build.sh [options]"
      echo ""
      echo "Options:"
      echo "  --clean     Clean all build artifacts before building"
      echo "  --install   Automatically install on connected device"
      echo "  --help      Show this help message"
      echo ""
      echo "Examples:"
      echo "  ./build.sh              # Standard build"
      echo "  ./build.sh --clean      # Clean build"
      echo "  ./build.sh --install    # Build and install"
      echo "  ./build.sh --clean --install  # Clean build and install"
      echo ""
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

echo "🚀 SubTrackr Android Build Script"
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

# Check if Expo CLI is installed
if ! command -v expo &> /dev/null; then
    print_error "Expo CLI is not installed. Installing now..."
    npm install -g @expo/cli
fi

# Check if Android SDK is available
if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
    print_warning "Android SDK environment variables not set."
    print_warning "Make sure you have Android Studio installed and SDK configured."
    print_warning "You may need to set ANDROID_HOME or ANDROID_SDK_ROOT."
fi

# Clean previous builds if requested
if [ "$CLEAN_BUILD" = true ]; then
    print_status "Cleaning all build artifacts..."
    rm -rf android/
    rm -rf ios/
    rm -rf dist/
    rm -rf .expo/
    rm -rf builds/
else
    print_status "Cleaning previous builds..."
    rm -rf android/
    rm -rf ios/
    rm -rf dist/
    rm -rf .expo/
fi

# Install dependencies
print_status "Installing dependencies..."
npm install

# Check if we need to eject
if [ ! -d "android" ]; then
    print_status "Ejecting to bare React Native..."
    npx expo prebuild --platform android --clean
else
    print_status "Using existing Android project..."
fi

# Build the APK
print_status "Building Android APK..."
cd android

# Clean the project
print_status "Cleaning Android project..."
./gradlew clean

# Build debug APK
print_status "Building debug APK..."
./gradlew assembleDebug

# Check if build was successful
if [ $? -eq 0 ]; then
    print_success "Android build completed successfully!"
else
    print_error "Android build failed!"
    exit 1
fi

# Go back to project root
cd ..

# Find the generated APK
APK_PATH=$(find android/app/build/outputs/apk/debug/ -name "*.apk" | head -n 1)

if [ -z "$APK_PATH" ]; then
    print_error "Could not find generated APK!"
    exit 1
fi

# Create output directory
mkdir -p builds

# Rename and copy APK
APK_NAME="subtrackr.apk"
FINAL_APK_PATH="builds/$APK_NAME"

print_status "Renaming APK to: $APK_NAME"
cp "$APK_PATH" "$FINAL_APK_PATH"

# Get APK info
APK_SIZE=$(du -h "$FINAL_APK_PATH" | cut -f1)
BUILD_DATE=$(date '+%Y-%m-%d %H:%M:%S')

print_success "Build completed successfully!"
echo ""
echo "📱 APK Details:"
echo "   Name: $APK_NAME"
echo "   Size: $APK_SIZE"
echo "   Location: $FINAL_APK_PATH"
echo "   Built: $BUILD_DATE"
echo ""

# Optional: Install on connected device
if [ "$AUTO_INSTALL" = true ] || command -v adb &> /dev/null; then
    DEVICES=$(adb devices | grep -v "List of devices" | grep "device$" | wc -l)
    if [ $DEVICES -gt 0 ]; then
        echo "📱 Connected devices detected:"
        adb devices | grep -v "List of devices"
        echo ""
        
        if [ "$AUTO_INSTALL" = true ]; then
            print_status "Auto-installing APK on device..."
            adb install "$FINAL_APK_PATH"
            if [ $? -eq 0 ]; then
                print_success "APK installed successfully on device!"
            else
                print_error "Failed to install APK on device."
            fi
        else
            read -p "Do you want to install the APK on a connected device? (y/N): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                print_status "Installing APK on device..."
                adb install "$FINAL_APK_PATH"
                if [ $? -eq 0 ]; then
                    print_success "APK installed successfully on device!"
                else
                    print_error "Failed to install APK on device."
                fi
            fi
        fi
    fi
else
    print_warning "ADB not found. Cannot install on device automatically."
fi

echo ""
print_success "🎉 SubTrackr Android build completed!"
print_status "Your APK is ready at: $FINAL_APK_PATH"
echo ""
print_status "Next steps:"
echo "   1. Test the APK on a device"
echo "   2. Share with team members"
echo "   3. Submit to hackathon judges"
echo ""

# Optional: Open builds folder
if command -v open &> /dev/null; then
    read -p "Open builds folder? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        open builds/
    fi
fi
