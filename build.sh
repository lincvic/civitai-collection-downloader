#!/bin/bash

# Civitai Collection Downloader - Build Script
# This script packages the extension as .zip and optionally .crx

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
EXTENSION_NAME="civitai-collection-downloader"
VERSION=$(grep '"version"' manifest.json | sed 's/.*"version": "\(.*\)".*/\1/')
BUILD_DIR="build"
DIST_DIR="dist"

echo -e "${GREEN}Building Civitai Collection Downloader v${VERSION}${NC}"
echo "=================================================="

# Create build directories
mkdir -p "$BUILD_DIR"
mkdir -p "$DIST_DIR"

# Clean previous builds
rm -rf "$BUILD_DIR"/*
rm -f "$DIST_DIR/${EXTENSION_NAME}-${VERSION}.zip"
rm -f "$DIST_DIR/${EXTENSION_NAME}-${VERSION}.crx"

# Files to include in the build
FILES=(
    "manifest.json"
    "background.js"
    "content.js"
    "popup"
    "utils"
    "icons"
)

echo -e "${YELLOW}Copying files...${NC}"

# Copy files to build directory
for file in "${FILES[@]}"; do
    if [ -e "$file" ]; then
        cp -r "$file" "$BUILD_DIR/"
        echo "  ✓ $file"
    else
        echo -e "  ${RED}✗ $file (not found)${NC}"
    fi
done

# Create ZIP file
echo -e "${YELLOW}Creating ZIP package...${NC}"
cd "$BUILD_DIR"
zip -r "../$DIST_DIR/${EXTENSION_NAME}-${VERSION}.zip" . -x "*.DS_Store" -x "*__MACOSX*"
cd ..

echo -e "${GREEN}✓ Created: $DIST_DIR/${EXTENSION_NAME}-${VERSION}.zip${NC}"

# Check if we should build .crx
if [ "$1" == "--crx" ]; then
    echo -e "${YELLOW}Building .crx file...${NC}"
    
    # Check for private key
    KEY_FILE="key.pem"
    if [ ! -f "$KEY_FILE" ]; then
        echo -e "${YELLOW}No key.pem found. Generating new private key...${NC}"
        openssl genrsa -out "$KEY_FILE" 2048
        echo -e "${GREEN}✓ Generated: $KEY_FILE${NC}"
        echo -e "${RED}⚠ Keep this key safe! You need it to update the extension.${NC}"
    fi
    
    # Try to find Chrome/Chromium
    CHROME=""
    if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
        CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    elif [ -x "/Applications/Chromium.app/Contents/MacOS/Chromium" ]; then
        CHROME="/Applications/Chromium.app/Contents/MacOS/Chromium"
    elif command -v google-chrome &> /dev/null; then
        CHROME="google-chrome"
    elif command -v chromium &> /dev/null; then
        CHROME="chromium"
    elif command -v chromium-browser &> /dev/null; then
        CHROME="chromium-browser"
    fi
    
    if [ -n "$CHROME" ]; then
        echo "Using Chrome at: $CHROME"
        
        # Pack extension
        "$CHROME" --pack-extension="$(pwd)/$BUILD_DIR" --pack-extension-key="$(pwd)/$KEY_FILE"
        
        # Move the .crx file
        if [ -f "$BUILD_DIR.crx" ]; then
            mv "$BUILD_DIR.crx" "$DIST_DIR/${EXTENSION_NAME}-${VERSION}.crx"
            echo -e "${GREEN}✓ Created: $DIST_DIR/${EXTENSION_NAME}-${VERSION}.crx${NC}"
        fi
    else
        echo -e "${RED}Chrome/Chromium not found. Cannot build .crx file.${NC}"
        echo "To build .crx manually:"
        echo "  1. Open Chrome and go to chrome://extensions/"
        echo "  2. Enable Developer mode"
        echo "  3. Click 'Pack extension'"
        echo "  4. Select the 'build' folder"
        exit 1
    fi
fi

echo ""
echo -e "${GREEN}Build complete!${NC}"
echo ""
echo "Output files:"
echo "  📦 $DIST_DIR/${EXTENSION_NAME}-${VERSION}.zip"
if [ -f "$DIST_DIR/${EXTENSION_NAME}-${VERSION}.crx" ]; then
    echo "  📦 $DIST_DIR/${EXTENSION_NAME}-${VERSION}.crx"
fi
echo ""
echo "Installation:"
echo "  1. Go to chrome://extensions/"
echo "  2. Enable 'Developer mode' (toggle in top right)"
echo "  3. Either:"
echo "     - Click 'Load unpacked' → select the 'build' folder"
echo "     - Or extract the ZIP and select that folder"
echo ""
echo "For distribution:"
echo "  - Upload ZIP to Chrome Web Store"
echo "  - Share ZIP for others to 'Load unpacked'"
echo ""
echo -e "${YELLOW}Note: .crx files cannot be installed directly in Chrome anymore.${NC}"
echo ""
