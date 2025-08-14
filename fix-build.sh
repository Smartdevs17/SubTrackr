#!/bin/bash

# SubTrackr Build Fix Script
# This script fixes common build issues with Expo SDK 53 and React Native

set -e  # Exit on any error

echo "🔧 SubTrackr Build Fix Script"
echo "=============================="

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
print_status "Starting build fix process..."

# Step 1: Clean everything
print_status "Step 1: Cleaning project..."
rm -rf node_modules/
rm -rf android/
rm -rf ios/
rm -rf .expo/
rm -rf dist/
rm -rf builds/
rm -f package-lock.json
rm -f yarn.lock

print_success "Project cleaned successfully!"

# Step 2: Update package.json with compatible versions
print_status "Step 2: Updating package.json with compatible versions..."

# Create a backup
cp package.json package.json.backup

# Update the problematic dependencies
cat > package.json << 'EOF'
{
  "name": "subtrackr",
  "version": "1.0.0",
  "main": "index.ts",
  "scripts": {
    "start": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "web": "expo start --web"
  },
  "dependencies": {
    "@react-native-async-storage/async-storage": "2.1.2",
    "@react-native-community/netinfo": "11.4.1",
    "@react-navigation/bottom-tabs": "^6.5.11",
    "@react-navigation/native": "^6.1.9",
    "@react-navigation/native-stack": "^6.9.17",
    "@reown/appkit-ethers-react-native": "^1.3.0",
    "@superfluid-finance/sdk-core": "^0.9.0",
    "@walletconnect/core": "^2.21.8",
    "@walletconnect/react-native-compat": "^2.21.8",
    "@walletconnect/utils": "^2.21.8",
    "@walletconnect/web3wallet": "^1.16.1",
    "ethers": "^5.8.0",
    "expo": "~53.0.20",
    "expo-application": "~6.1.5",
    "expo-status-bar": "~2.2.3",
    "react": "19.0.0",
    "react-native": "0.79.5",
    "react-native-gesture-handler": "~2.20.2",
    "react-native-get-random-values": "~1.11.0",
    "react-native-modal": "14.0.0-rc.1",
    "react-native-qrcode-svg": "^6.3.15",
    "react-native-safe-area-context": "4.12.0",
    "react-native-screens": "~4.1.0",
    "react-native-svg": "15.11.2",
    "zustand": "^4.5.2"
  },
  "devDependencies": {
    "@babel/core": "^7.25.2",
    "@expo/cli": "^0.24.20",
    "@types/react": "~19.0.10",
    "typescript": "~5.8.3"
  },
  "private": true
}
EOF

print_success "package.json updated successfully!"

# Step 3: Install dependencies
print_status "Step 3: Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    print_success "Dependencies installed successfully!"
else
    print_error "Failed to install dependencies!"
    exit 1
fi

# Step 4: Clear Expo cache
print_status "Step 4: Clearing Expo cache..."
npx expo install --fix

print_success "Expo cache cleared and dependencies fixed!"

# Step 5: Prebuild with clean slate
print_status "Step 5: Prebuilding project..."
npx expo prebuild --platform android --clean

if [ $? -eq 0 ]; then
    print_success "Project prebuilt successfully!"
else
    print_error "Prebuild failed!"
    exit 1
fi

# Step 6: Test build
print_status "Step 6: Testing build..."
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
    cd ..
    exit 1
fi

# Go back to project root
cd ..

# Step 7: Create builds directory and copy APK
print_status "Step 7: Organizing build output..."
mkdir -p builds

# Find the generated APK
APK_PATH=$(find android/app/build/outputs/apk/debug/ -name "*.apk" | head -n 1)

if [ -z "$APK_PATH" ]; then
    print_error "Could not find generated APK!"
    exit 1
fi

# Rename and copy APK
APK_NAME="subtrackr.apk"
FINAL_APK_PATH="builds/$APK_NAME"

print_status "Renaming APK to: $APK_NAME"
cp "$APK_PATH" "$FINAL_APK_PATH"

# Get APK info
APK_SIZE=$(du -h "$FINAL_APK_PATH" | cut -f1)
BUILD_DATE=$(date '+%Y-%m-%d %H:%M:%S')

echo ""
print_success "🎉 Build fix completed successfully!"
echo ""
echo "📱 APK Details:"
echo "   Name: $APK_NAME"
echo "   Size: $APK_SIZE"
echo "   Location: $FINAL_APK_PATH"
echo "   Built: $BUILD_DATE"
echo ""

print_status "What was fixed:"
echo "   ✅ Cleaned all build artifacts"
echo "   ✅ Updated package.json with compatible versions"
echo "   ✅ Reinstalled dependencies"
echo "   ✅ Cleared Expo cache"
echo "   ✅ Prebuilt project from scratch"
echo "   ✅ Successfully built Android APK"
echo ""

print_status "Next steps:"
echo "   1. Test the APK on a device"
echo "   2. Use ./build.sh for future builds"
echo "   3. Share with hackathon judges"
echo ""

print_success "Your SubTrackr app is now ready for hackathon submission! 🚀✨"
