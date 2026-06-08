module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [0, 'always'],
    'body-max-line-length': [0, 'always'],
    'subject-case': [0, 'always'],
    'type-empty': [0, 'always'],
    'subject-empty': [0, 'always'],
  },
};
