/**
 * Tests for the repository factory (Issue #2215).
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  createRepositorySet,
  getRepositorySet,
  initRepositoryFactory,
  resetRepositoryFactory,
} from '../repositoryFactory';

describe('RepositoryFactory', () => {
  beforeEach(() => {
    resetRepositoryFactory();
  });

  it('creates an in-memory repository set by default', () => {
    const set = createRepositorySet();
    expect(set.backend).toBe('in-memory');
    expect(set.subscriptions).toBeDefined();
    expect(set.transactions).toBeDefined();
    expect(set.users).toBeDefined();
    expect(set.merchants).toBeDefined();
    expect(set.loyalty).toBeDefined();
    expect(set.unitOfWork).toBeDefined();
  });

  it('creates an in-memory set when backend is specified', () => {
    const set = createRepositorySet({ backend: 'in-memory' });
    expect(set.backend).toBe('in-memory');
  });

  it('throws for postgres backend without a pool', () => {
    expect(() => createRepositorySet({ backend: 'postgres' })).toThrow(
      /Pool instance is required/,
    );
  });

  it('throws for unknown backend', () => {
    expect(() => createRepositorySet({ backend: 'redis' as unknown as 'in-memory' })).toThrow(
      /Unknown storage backend/,
    );
  });

  it('getRepositorySet returns the initialized set', () => {
    const set = initRepositoryFactory({ backend: 'in-memory' });
    expect(getRepositorySet()).toBe(set);
  });

  it('getRepositorySet defaults to in-memory when not initialized', () => {
    const set = getRepositorySet();
    expect(set.backend).toBe('in-memory');
  });

  it('resetRepositoryFactory clears the singleton', () => {
    initRepositoryFactory({ backend: 'in-memory' });
    resetRepositoryFactory();
    // After reset, getRepositorySet creates a new default
    const set = getRepositorySet();
    expect(set.backend).toBe('in-memory');
  });
});
