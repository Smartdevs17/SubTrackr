#!/bin/bash

echo "🎨 SubTrackr Design System - Verification Script"
echo "================================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check function
check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1"
        return 0
    else
        echo -e "${RED}✗${NC} $1"
        return 1
    fi
}

# Check directory
check_dir() {
    if [ -d "$1" ]; then
        echo -e "${GREEN}✓${NC} $1/"
        return 0
    else
        echo -e "${RED}✗${NC} $1/"
        return 1
    fi
}

echo "Checking Design System Structure..."
echo ""

# Check directories
echo "Directories:"
check_dir "src/design-system"
check_dir "src/design-system/tokens"
check_dir "src/design-system/components"
check_dir "src/design-system/utils"
check_dir "src/design-system/types"
check_dir "src/design-system/__tests__"
check_dir "src/design-system/stories"
check_dir ".storybook"

echo ""
echo "Token Files:"
check_file "src/design-system/tokens/index.ts"
check_file "src/design-system/tokens/colors.ts"
check_file "src/design-system/tokens/spacing.ts"
check_file "src/design-system/tokens/typography.ts"
check_file "src/design-system/tokens/borderRadius.ts"
check_file "src/design-system/tokens/shadows.ts"
check_file "src/design-system/tokens/animations.ts"

echo ""
echo "Component Files:"
check_file "src/design-system/components/index.ts"
check_file "src/design-system/components/Button.tsx"
check_file "src/design-system/components/Input.tsx"
check_file "src/design-system/components/Card.tsx"
check_file "src/design-system/components/Modal.tsx"
check_file "src/design-system/components/Toast.tsx"

echo ""
echo "Utility Files:"
check_file "src/design-system/utils/index.ts"
check_file "src/design-system/utils/platform.ts"
check_file "src/design-system/utils/rtl.ts"
check_file "src/design-system/utils/fontScaling.ts"

echo ""
echo "Type Files:"
check_file "src/design-system/types/design-tokens.ts"

echo ""
echo "Test & Story Files:"
check_file "src/design-system/__tests__/Button.test.tsx"
check_file "src/design-system/__tests__/visualRegression.e2e.ts"
check_file "src/design-system/stories/Button.stories.tsx"

echo ""
echo "Configuration Files:"
check_file ".storybook/main.js"
check_file ".storybook/preview.js"

echo ""
echo "Documentation Files:"
check_file "QUICK_START.md"
check_file "DESIGN_SYSTEM_SETUP.md"
check_file "DESIGN_SYSTEM.md"
check_file "DESIGN_SYSTEM_INTEGRATION.md"
check_file "DESIGN_SYSTEM_IMPLEMENTATION.md"
check_file "WCAG_COMPLIANCE.md"

echo ""
echo "================================================"
echo -e "${GREEN}✓ Design System Verification Complete${NC}"
echo ""
echo "📚 Documentation:"
echo "  - Start with: QUICK_START.md"
echo "  - Setup: DESIGN_SYSTEM_SETUP.md"
echo "  - Full docs: DESIGN_SYSTEM.md"
echo "  - Integration: DESIGN_SYSTEM_INTEGRATION.md"
echo "  - Accessibility: WCAG_COMPLIANCE.md"
echo ""
echo "🚀 Next Steps:"
echo "  1. Read QUICK_START.md (5 min)"
echo "  2. Read DESIGN_SYSTEM_SETUP.md (10 min)"
echo "  3. Run: npm run storybook (optional)"
echo "  4. Start integration with high-impact screens"
echo ""
