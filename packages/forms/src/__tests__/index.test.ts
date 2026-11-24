import { validateForm, formSchema, field, getFieldError, hasFieldError, FieldError } from '../index';

describe('@subtrackr/forms', () => {
  const loginSchema = formSchema([
    field.email('email', 'Email', { required: true }),
    field.password('password', 'Password', { required: true, minLength: 8 }),
  ]);

  const profileSchema = formSchema([
    field.string('firstName', 'First Name', { required: true, minLength: 1, maxLength: 50 }),
    field.string('lastName', 'Last Name', { required: true, minLength: 1, maxLength: 50 }),
    field.number('age', 'Age', { required: true, min: 13, max: 120, integer: true }),
    field.string('bio', 'Bio', { maxLength: 500 }),
    field.string('username', 'Username', {
      required: true,
      pattern: /^[a-zA-Z0-9_]+$/,
      patternMessage: 'Username can only contain letters, numbers, and underscores.',
    }),
  ]);

  describe('validateForm - happy path', () => {
    it('validates a correct login form', () => {
      const result = validateForm(loginSchema, {
        email: 'user@example.com',
        password: 'secret123',
      });
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.values.email).toBe('user@example.com');
      expect(result.values.password).toBe('secret123');
    });

    it('validates a correct profile form with all fields', () => {
      const result = validateForm(profileSchema, {
        firstName: 'John',
        lastName: 'Doe',
        age: 30,
        bio: 'Software developer',
        username: 'johndoe',
      });
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.values.firstName).toBe('John');
      expect(result.values.age).toBe(30);
    });

    it('validates optional fields when omitted', () => {
      const result = validateForm(profileSchema, {
        firstName: 'Jane',
        lastName: 'Smith',
        age: 25,
        username: 'janesmith',
      });
      expect(result.ok).toBe(true);
      expect(result.values.bio).toBe('');
    });

    it('coerces number strings to numbers', () => {
      const result = validateForm(profileSchema, {
        firstName: 'Test',
        lastName: 'User',
        age: '25',
        username: 'testuser',
      });
      expect(result.ok).toBe(true);
      expect(typeof result.values.age).toBe('number');
      expect(result.values.age).toBe(25);
    });

    it('trims string fields by default when trim is true', () => {
      const schema = formSchema([
        field.string('name', 'Name', { required: true, trim: true }),
      ]);
      const result = validateForm(schema, { name: '  John  ' });
      expect(result.ok).toBe(true);
      expect(result.values.name).toBe('John');
    });
  });

  describe('validateForm - required field failures', () => {
    it('fails when required field is missing', () => {
      const result = validateForm(loginSchema, { password: 'secret123' });
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('email');
      expect(result.errors[0].code).toBe('REQUIRED');
    });

    it('fails when required field is empty string', () => {
      const result = validateForm(loginSchema, { email: '', password: 'secret123' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].field).toBe('email');
      expect(result.errors[0].code).toBe('REQUIRED');
    });

    it('fails when required field is whitespace only', () => {
      const result = validateForm(loginSchema, { email: '   ', password: 'secret123' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('REQUIRED');
    });

    it('reports multiple missing required fields', () => {
      const result = validateForm(loginSchema, {});
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(2);
      const fields = result.errors.map((e) => e.field).sort();
      expect(fields).toEqual(['email', 'password']);
    });

    it('includes received value in error for debugging', () => {
      const result = validateForm(loginSchema, { email: '', password: 'secret123' });
      expect(result.errors[0].received).toBe('');
    });
  });

  describe('validateForm - string validation', () => {
    it('fails minLength', () => {
      const schema = formSchema([field.string('name', 'Name', { required: true, minLength: 3 })]);
      const result = validateForm(schema, { name: 'Ab' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('MIN_LENGTH');
    });

    it('fails maxLength', () => {
      const schema = formSchema([field.string('name', 'Name', { maxLength: 10 })]);
      const result = validateForm(schema, { name: 'This is way too long' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('MAX_LENGTH');
    });

    it('fails pattern mismatch', () => {
      const schema = formSchema([
        field.string('code', 'Code', {
          required: true,
          pattern: /^[A-Z]{3}$/,
          patternMessage: 'Code must be 3 uppercase letters.',
        }),
      ]);
      const result = validateForm(schema, { code: 'abc' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('PATTERN_MISMATCH');
      expect(result.errors[0].message).toBe('Code must be 3 uppercase letters.');
    });

    it('passes pattern when value matches', () => {
      const schema = formSchema([
        field.string('code', 'Code', { required: true, pattern: /^[A-Z]{3}$/ }),
      ]);
      const result = validateForm(schema, { code: 'ABC' });
      expect(result.ok).toBe(true);
    });

    it('uses default pattern message when custom not provided', () => {
      const schema = formSchema([
        field.string('code', 'Code', { required: true, pattern: /^[A-Z]{3}$/ }),
      ]);
      const result = validateForm(schema, { code: 'abc' });
      expect(result.errors[0].message).toContain('format is invalid');
    });
  });

  describe('validateForm - number validation', () => {
    it('fails when value is not a number', () => {
      const schema = formSchema([field.number('age', 'Age', { required: true })]);
      const result = validateForm(schema, { age: 'not-a-number' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('INVALID_NUMBER');
    });

    it('fails min value', () => {
      const schema = formSchema([field.number('age', 'Age', { required: true, min: 18 })]);
      const result = validateForm(schema, { age: 16 });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('MIN_VALUE');
    });

    it('fails max value', () => {
      const schema = formSchema([field.number('age', 'Age', { required: true, max: 65 })]);
      const result = validateForm(schema, { age: 70 });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('MAX_VALUE');
    });

    it('fails integer constraint', () => {
      const schema = formSchema([field.number('count', 'Count', { required: true, integer: true })]);
      const result = validateForm(schema, { count: 3.14 });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('NOT_INTEGER');
    });

    it('passes integer constraint with whole number', () => {
      const schema = formSchema([field.number('count', 'Count', { required: true, integer: true })]);
      const result = validateForm(schema, { count: 5 });
      expect(result.ok).toBe(true);
    });

    it('coerces numeric string to number', () => {
      const schema = formSchema([field.number('age', 'Age', { required: true, min: 18 })]);
      const result = validateForm(schema, { age: '25' });
      expect(result.ok).toBe(true);
      expect(result.values.age).toBe(25);
    });

    it('handles NaN from invalid number string', () => {
      const schema = formSchema([field.number('age', 'Age', { required: true })]);
      const result = validateForm(schema, { age: 'abc' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('INVALID_NUMBER');
    });
  });

  describe('validateForm - email validation', () => {
    it('passes valid email', () => {
      const schema = formSchema([field.email('email', 'Email', { required: true })]);
      const result = validateForm(schema, { email: 'user@example.com' });
      expect(result.ok).toBe(true);
    });

    it('fails invalid email format', () => {
      const schema = formSchema([field.email('email', 'Email', { required: true })]);
      const result = validateForm(schema, { email: 'not-an-email' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('INVALID_EMAIL');
    });

    it('fails missing @', () => {
      const schema = formSchema([field.email('email', 'Email', { required: true })]);
      const result = validateForm(schema, { email: 'userexample.com' });
      expect(result.ok).toBe(false);
    });

    it('fails missing domain', () => {
      const schema = formSchema([field.email('email', 'Email', { required: true })]);
      const result = validateForm(schema, { email: 'user@' });
      expect(result.ok).toBe(false);
    });

    it('allows empty when not required', () => {
      const schema = formSchema([field.email('email', 'Email', { required: false })]);
      const result = validateForm(schema, { email: '' });
      expect(result.ok).toBe(true);
    });
  });

  describe('validateForm - password validation', () => {
    it('passes valid password with all requirements', () => {
      const schema = formSchema([
        field.password('pwd', 'Password', {
          required: true,
          minLength: 8,
          requireUppercase: true,
          requireLowercase: true,
          requireDigit: true,
          requireSpecial: true,
        }),
      ]);
      const result = validateForm(schema, { pwd: 'Secure1!' });
      expect(result.ok).toBe(true);
    });

    it('fails minLength', () => {
      const schema = formSchema([
        field.password('pwd', 'Password', { required: true, minLength: 10 }),
      ]);
      const result = validateForm(schema, { pwd: 'Short1!' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('MIN_LENGTH');
    });

    it('fails missing uppercase', () => {
      const schema = formSchema([
        field.password('pwd', 'Password', { required: true, requireUppercase: true }),
      ]);
      const result = validateForm(schema, { pwd: 'lowercase1!' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('REQUIRE_UPPERCASE');
    });

    it('fails missing lowercase', () => {
      const schema = formSchema([
        field.password('pwd', 'Password', { required: true, requireLowercase: true }),
      ]);
      const result = validateForm(schema, { pwd: 'UPPERCASE1!' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('REQUIRE_LOWERCASE');
    });

    it('fails missing digit', () => {
      const schema = formSchema([
        field.password('pwd', 'Password', { required: true, requireDigit: true }),
      ]);
      const result = validateForm(schema, { pwd: 'NoDigits!' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('REQUIRE_DIGIT');
    });

    it('fails missing special character', () => {
      const schema = formSchema([
        field.password('pwd', 'Password', { required: true, requireSpecial: true }),
      ]);
      const result = validateForm(schema, { pwd: 'NoSpecial1' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('REQUIRE_SPECIAL');
    });

    it('reports multiple password requirement failures at once', () => {
      const schema = formSchema([
        field.password('pwd', 'Password', {
          required: true,
          minLength: 10,
          requireUppercase: true,
          requireLowercase: true,
          requireDigit: true,
          requireSpecial: true,
        }),
      ]);
      const result = validateForm(schema, { pwd: 'weak' });
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
      const codes = result.errors.map((e) => e.code).sort();
      expect(codes).toContain('MIN_LENGTH');
      expect(codes).toContain('REQUIRE_UPPERCASE');
      expect(codes).toContain('REQUIRE_LOWERCASE');
      expect(codes).toContain('REQUIRE_DIGIT');
      expect(codes).toContain('REQUIRE_SPECIAL');
    });
  });

  describe('validateForm - custom validator', () => {
    it('runs custom validator and fails on error message', () => {
      const schema = formSchema([
        field.string('username', 'Username', {
          required: true,
          validate: (v) => (v === 'admin' ? 'Username cannot be "admin"' : undefined),
        }),
      ]);
      const result = validateForm(schema, { username: 'admin' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('CUSTOM_VALIDATION');
      expect(result.errors[0].message).toBe('Username cannot be "admin"');
    });

    it('passes when custom validator returns undefined', () => {
      const schema = formSchema([
        field.string('username', 'Username', {
          required: true,
          validate: (v) => (v === 'admin' ? 'Reserved' : undefined),
        }),
      ]);
      const result = validateForm(schema, { username: 'user123' });
      expect(result.ok).toBe(true);
    });

    it('custom validator receives coerced value', () => {
      const schema = formSchema([
        field.number('age', 'Age', {
          required: true,
          validate: (v) => (v < 18 ? 'Must be 18+' : undefined),
        }),
      ]);
      const result = validateForm(schema, { age: '16' });
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('CUSTOM_VALIDATION');
    });
  });

  describe('validateForm - unknown field handling', () => {
    it('ignores unknown fields in input', () => {
      const schema = formSchema([field.string('name', 'Name', { required: true })]);
      const result = validateForm(schema, { name: 'John', unknownField: 'ignored' });
      expect(result.ok).toBe(true);
      expect(result.values).not.toHaveProperty('unknownField');
    });

    it('does not error on unknown fields', () => {
      const schema = formSchema([field.string('name', 'Name', { required: true })]);
      const result = validateForm(schema, { name: 'John', extra: 'data' });
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('validateForm - multiple simultaneous errors', () => {
    it('collects all errors across fields', () => {
      const schema = formSchema([
        field.string('firstName', 'First Name', { required: true, minLength: 2 }),
        field.string('lastName', 'Last Name', { required: true, minLength: 2 }),
        field.number('age', 'Age', { required: true, min: 18 }),
        field.email('email', 'Email', { required: true }),
      ]);
      const result = validateForm(schema, {
        firstName: 'A',
        lastName: '',
        age: 15,
        email: 'invalid',
      });
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBe(4);
      const fields = result.errors.map((e) => e.field).sort();
      expect(fields).toEqual(['age', 'email', 'firstName', 'lastName']);
    });
  });

  describe('helpers - getFieldError', () => {
    it('returns error message for field', () => {
      const errors: FieldError[] = [
        { field: 'email', code: 'REQUIRED', message: 'Email is required.' },
      ];
      expect(getFieldError(errors, 'email')).toBe('Email is required.');
    });

    it('returns undefined for field without error', () => {
      const errors: FieldError[] = [
        { field: 'email', code: 'REQUIRED', message: 'Email is required.' },
      ];
      expect(getFieldError(errors, 'password')).toBeUndefined();
    });
  });

  describe('helpers - hasFieldError', () => {
    it('returns true when field has error', () => {
      const errors: FieldError[] = [
        { field: 'email', code: 'REQUIRED', message: 'Email is required.' },
      ];
      expect(hasFieldError(errors, 'email')).toBe(true);
    });

    it('returns false when field has no error', () => {
      const errors: FieldError[] = [
        { field: 'email', code: 'REQUIRED', message: 'Email is required.' },
      ];
      expect(hasFieldError(errors, 'password')).toBe(false);
    });
  });

  describe('formSchema inference', () => {
    it('preserves schema type for inference', () => {
      const schema = formSchema([
        field.string('name', 'Name', { required: true }),
        field.number('age', 'Age'),
      ]);
      // TypeScript would verify the schema type here
      expect(schema).toHaveLength(2);
      expect(schema[0].name).toBe('name');
      expect(schema[1].type).toBe('number');
    });
  });
});