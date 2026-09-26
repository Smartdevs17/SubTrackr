# SubTrackr Code Style & Formatting Guidelines

To maintain visual clarity, code style consistency, and minimize Git diff noise, this project automatically enforces strict code formatting.

## Style Rules

- **Engine**: Prettier & ESLint
- **Language Targets**: TypeScript (\.ts\, \.tsx\), JavaScript (\.js\), JSON (\.json\), Markdown (\.md\)
- **Formatting Constraints**: Configured automatically via \.prettierrc\ and \.eslintrc.json\.

## Local Development Workflows

Before submitting a Pull Request, run the local styling script blocks to verify adherence:

\\\ash

# Check if any files contain formatting errors

npm run format:check

# Manually write styling fixes across all directories

npm run format:write
\\\

## Continuous Integration (CI) Actions

- Every Pull Request triggers an automated style validation step.
- If formatting violations are detected, the CI runner will automatically attempt to run the formatter, commit the stylistic corrections directly back to your branch, and exit safely with clean error feedback logs.
