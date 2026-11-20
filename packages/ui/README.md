# `@subtrackr/ui`

Shared React Native design-system components and tokens.

## Storybook

Stories are kept next to the package source in `src/stories/` and are discovered
by the repository's `.storybook/main.js` configuration. The Card
stories cover all visual variants, padding choices, and accessibility props.
EmptyState stories show its default, action, no-content, and missing-handler
states. Use the controls panel to explore the component props interactively;
the Docs tab describes the component contract and notable conditional behavior.

When adding a shared component, include stories for each public visual variant,
important optional/conditional states, and meaningful accessibility props. Keep
examples representative of subscription management screens.
