# Contributing to SubTrackr

First off, thank you for considering contributing to SubTrackr! It's people like you who make it a great tool for the community.

## 🚀 Quick Start

1.  **Fork** the repository.
2.  **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/SubTrackr.git`
3.  **Install dependencies**: `npm install`
4.  **Create a branch** for your fix/feature: `git checkout -b feat/your-feature-name`
5.  **Make your changes** and ensure they follow our code style.
6.  **Run tests**: `npm test`
7.  **Commit your changes**: `git commit -m "feat: add some amazing feature"`
8.  **Push to your fork**: `git push origin feat/your-feature-name`
9.  **Submit a Pull Request**.

## 🛠 Development Setup

SubTrackr is built with **Expo** and **React Native**.

-   **Node.js**: Ensure you have Node.js 18+ installed.
-   **Expo Go**: Download the Expo Go app on your iOS or Android device to test.
-   **Start the dev server**: `npm start`

## 🎨 Code Style

We use **ESLint** and **Prettier** to maintain code quality.

-   Run linting: `npm run lint`
-   Auto-fix linting issues: `npm run lint:fix`
-   Format code: `npm run format`

### Guidelines:
-   Use TypeScript for all new files.
-   Follow the existing project structure in `src/`.
-   Ensure components are accessible by adding proper `accessibilityLabel` and `accessibilityRole`.

## 📝 Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):
-   `feat:` for new features.
-   `fix:` for bug fixes.
-   `docs:` for documentation changes.
-   `style:` for code style changes (formatting, etc.).
-   `refactor:` for code changes that neither fix a bug nor add a feature.

## 🧪 Testing

Always add tests for new functionality.
-   Run all tests: `npm test`
-   Run tests with coverage: `npm test:coverage`

## 🤝 Pull Request Process

1.  Link the issue your PR addresses in the description (e.g., `Closes #123`).
2.  Provide a clear description of the changes.
3.  Include screenshots or videos for UI changes if possible.
4.  Wait for a maintainer to review your PR.

---
Happy coding! 🚀
