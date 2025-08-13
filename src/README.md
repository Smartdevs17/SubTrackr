# SubTrackr - Source Code Documentation

## 📁 Project Structure

This directory contains the complete source code for the SubTrackr application, organized according to the architecture outlined in the main README.

## 🏗️ Architecture Overview

### Component Hierarchy
1. **Screens** (`/screens`) - Main app screens and user interfaces
2. **Components** (`/components`) - Reusable UI components organized by domain
3. **Navigation** (`/navigation`) - App navigation configuration and routing
4. **Store** (`/store`) - State management using Zustand
5. **Types** (`/types`) - TypeScript type definitions and interfaces
6. **Utils** (`/utils`) - Helper functions and constants
7. **Services** (`/services`) - External service integrations (to be implemented)
8. **Hooks** (`/hooks`) - Custom React hooks (to be implemented)

## 🎨 Design System

### Color Palette
- **Primary**: `#6366f1` (Indigo) - Main brand color
- **Secondary**: `#8b5cf6` (Purple) - Secondary actions
- **Accent**: `#06b6d4` (Cyan) - Crypto/Web3 elements
- **Success**: `#10b981` (Emerald) - Positive states
- **Warning**: `#f59e0b` (Amber) - Warning states
- **Error**: `#ef4444` (Red) - Error states
- **Background**: `#0f172a` (Dark slate) - App background
- **Surface**: `#1e293b` (Slate 800) - Card/surface backgrounds
- **Text**: `#f8fafc` (Slate 50) - Primary text color

### Typography Scale
- **H1**: 32px - Main titles
- **H2**: 24px - Section headers
- **H3**: 20px - Subsection headers
- **Body**: 16px - Regular text
- **Caption**: 14px - Secondary text
- **Small**: 12px - Fine print

### Spacing System
- **xs**: 4px - Minimal spacing
- **sm**: 8px - Small spacing
- **md**: 16px - Medium spacing
- **lg**: 24px - Large spacing
- **xl**: 32px - Extra large spacing
- **xxl**: 48px - Maximum spacing

## 🔧 Implementation Status

### ✅ Completed
- [x] Project folder structure
- [x] Design system constants
- [x] TypeScript type definitions
- [x] Basic screen components
- [x] Common UI components
- [x] Navigation structure
- [x] State management stores
- [x] Utility functions

### 🚧 In Progress
- [ ] Service layer implementation
- [ ] Custom React hooks
- [ ] Advanced UI components
- [ ] Web3 integration

### 📋 To Do
- [ ] Firebase integration
- [ ] Push notifications
- [ ] Analytics dashboard
- [ ] Crypto payment flows
- [ ] Testing suite
- [ ] Performance optimization

## 🚀 Getting Started

### Prerequisites
- Node.js 16+
- React Native / Expo
- TypeScript knowledge

### Development Setup
1. Navigate to the project root
2. Install dependencies: `npm install`
3. Start the development server: `npm start`

### Code Style
- Use TypeScript for all new code
- Follow the established component patterns
- Use the design system constants for styling
- Implement proper error handling
- Add JSDoc comments for complex functions

## 📱 Component Usage Examples

### Using the Button Component
```tsx
import { Button } from '../components/common/Button';

<Button
  title="Connect Wallet"
  onPress={handleConnect}
  variant="crypto"
  size="large"
  fullWidth
/>
```

### Using the Card Component
```tsx
import { Card } from '../components/common/Card';

<Card variant="elevated" padding="large">
  <Text>Card content goes here</Text>
</Card>
```

### Using the Store
```tsx
import { useSubscriptionStore } from '../store';

const { subscriptions, addSubscription } = useSubscriptionStore();
```

## 🔗 Related Files

- **Main README**: `/README.md` - Project overview and setup
- **Package Config**: `/package.json` - Dependencies and scripts
- **App Entry**: `/App.tsx` - Main app component
- **TypeScript Config**: `/tsconfig.json` - TypeScript configuration

## 🤝 Contributing

When adding new features:
1. Follow the established folder structure
2. Use the design system constants
3. Implement proper TypeScript types
4. Add error handling and loading states
5. Update this documentation

## 📞 Support

For questions about the codebase architecture or implementation details, refer to the main project documentation or create an issue in the project repository.
