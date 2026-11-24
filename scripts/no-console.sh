#!/usr/bin/env bash
# Pre-push guard: blocks commits with console.log/console.debug/console.info in app code
# Usage: ./scripts/no-console.sh

set -euo pipefail

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Only check the app/ directory (React Native/Expo app) - "app code" per issue
# Exclude backend/, contracts/, node_modules, dist, build, .git, coverage, test files
EXCLUDE_DIRS=("node_modules" "dist" "build" ".git" "coverage" ".next" ".expo" ".turbo" "backend" "contracts")
EXCLUDE_PATTERNS=("*.test.ts" "*.test.tsx" "*.spec.ts" "*.spec.tsx" "*.stories.tsx" "*.d.ts")

# Build find command exclusions
FIND_EXCLUDE=()
for dir in "${EXCLUDE_DIRS[@]}"; do
    FIND_EXCLUDE+=(-path "*/$dir/*" -prune -o)
done

for pattern in "${EXCLUDE_PATTERNS[@]}"; do
    FIND_EXCLUDE+=(-name "$pattern" -prune -o)
done

# Find TypeScript/JavaScript files in app/ directory (main app code)
FILES=$(find app \( "${FIND_EXCLUDE[@]}" -true \) -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) -print 2>/dev/null)

if [[ -z "$FILES" ]]; then
    echo -e "${GREEN}No app files to check${NC}"
    exit 0
fi

# Check for console.log, console.debug, console.info (but allow console.warn, console.error)
VIOLATIONS=$(echo "$FILES" | xargs grep -nE "console\.(log|debug|info)\s*\(" 2>/dev/null || true)

if [[ -n "$VIOLATIONS" ]]; then
    echo -e "${RED}❌ Pre-push check failed: console.log/debug/info found in app code${NC}"
    echo ""
    echo "$VIOLATIONS" | while IFS= read -r line; do
        file=$(echo "$line" | cut -d: -f1)
        lineno=$(echo "$line" | cut -d: -f2)
        content=$(echo "$line" | cut -d: -f3-)
        echo -e "  ${YELLOW}$file:$lineno${NC} - $content"
    done
    echo ""
    echo -e "${RED}Remove console.log/debug/info statements before pushing.${NC}"
    echo -e "${YELLOW}Allowed: console.warn, console.error${NC}"
    exit 1
fi

echo -e "${GREEN}✅ No console.log/debug/info found in app code${NC}"
exit 0