/**
 * Family plan service with a shared paying wallet (#2031).
 *
 * Off-chain counterpart of the family group in
 * `contracts/subscription/src/family.rs`, with the same rules:
 *   - the subscription's subscriber is the paying wallet and the only party
 *     who can create the group, invite or remove members;
 *   - seats include the payer, with a hard cap of MAX_FAMILY_SEATS;
 *   - a member can leave at any time, and cancelling dissolves the group.
 *
 * Invitations add one step the contract does not need: nobody is added to a
 * family without accepting, so a payer cannot enrol an address that never
 * agreed. Pending invitations hold a seat so the limit cannot be exceeded by
 * racing accepts.
 *
 * The store must make `save` atomic per group (for example a conditional
 * write on `version`). The in-memory store is for tests and single-process use.
 */

import { randomUUID } from 'crypto';

export const MAX_FAMILY_SEATS = 10;
export const DEFAULT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type FamilyErrorCode =
  | 'INVALID_SEATS'
  | 'GROUP_EXISTS'
  | 'GROUP_NOT_FOUND'
  | 'NOT_PAYER'
  | 'NO_FREE_SEATS'
  | 'ALREADY_MEMBER'
  | 'ALREADY_INVITED'
  | 'INVITE_NOT_FOUND'
  | 'INVITE_EXPIRED'
  | 'INVITE_NOT_FOR_YOU'
  | 'NOT_A_MEMBER'
  | 'PAYER_CANNOT_LEAVE'
  | 'INVALID_WALLET'
  | 'CONFLICT';

export class FamilyError extends Error {
  constructor(
    public readonly code: FamilyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FamilyError';
  }
}

export interface FamilyInvite {
  id: string;
  wallet: string;
  expiresAt: number;
}

export interface FamilyGroup {
  subscriptionId: string;
  /** The shared paying wallet. */
  payer: string;
  /** Seats in total, including the payer. */
  maxSeats: number;
  members: string[];
  invites: FamilyInvite[];
  /** Incremented on every write, for optimistic concurrency. */
  version: number;
}

export interface FamilyStore {
  get(subscriptionId: string): Promise<FamilyGroup | undefined>;
  /** Writes only when the stored version equals `expectedVersion` (0 for a new group). */
  save(group: FamilyGroup, expectedVersion: number): Promise<boolean>;
  delete(subscriptionId: string): Promise<void>;
}

export function createInMemoryFamilyStore(): FamilyStore {
  const groups = new Map<string, FamilyGroup>();
  return {
    async get(id) {
      const g = groups.get(id);
      return g ? structuredClone(g) : undefined;
    },
    async save(group, expectedVersion) {
      const current = groups.get(group.subscriptionId);
      if ((current?.version ?? 0) !== expectedVersion) return false;
      groups.set(group.subscriptionId, structuredClone(group));
      return true;
    },
    async delete(id) {
      groups.delete(id);
    },
  };
}

export interface FamilyEvent {
  type: 'created' | 'invited' | 'joined' | 'removed' | 'left' | 'dissolved';
  subscriptionId: string;
  wallet?: string;
}

export interface FamilyServiceOptions {
  store?: FamilyStore;
  now?: () => number;
  inviteTtlMs?: number;
  onEvent?: (event: FamilyEvent) => void;
}

export interface FamilyService {
  createGroup(input: { subscriptionId: string; payer: string; maxSeats: number }): Promise<FamilyGroup>;
  invite(input: { subscriptionId: string; payer: string; wallet: string }): Promise<FamilyInvite>;
  acceptInvite(input: { subscriptionId: string; inviteId: string; wallet: string }): Promise<FamilyGroup>;
  removeMember(input: { subscriptionId: string; payer: string; wallet: string }): Promise<FamilyGroup>;
  leave(input: { subscriptionId: string; wallet: string }): Promise<FamilyGroup>;
  /** Called when the subscription is cancelled. Idempotent. */
  dissolve(subscriptionId: string): Promise<void>;
  hasAccess(subscriptionId: string, wallet: string): Promise<boolean>;
  getGroup(subscriptionId: string): Promise<FamilyGroup | undefined>;
}

const MAX_RETRIES = 3;

function requireWallet(wallet: string): void {
  if (typeof wallet !== 'string' || wallet.trim() === '') {
    throw new FamilyError('INVALID_WALLET', 'wallet is required');
  }
}

export function createFamilyService(options: FamilyServiceOptions = {}): FamilyService {
  const store = options.store ?? createInMemoryFamilyStore();
  const now = options.now ?? Date.now;
  const inviteTtl = options.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS;
  const emit = (event: FamilyEvent): void => {
    try {
      options.onEvent?.(event);
    } catch {
      // Observability must never break the request path.
    }
  };

  const liveInvites = (g: FamilyGroup): FamilyInvite[] => g.invites.filter((i) => i.expiresAt > now());
  const seatsUsed = (g: FamilyGroup): number => 1 + g.members.length + liveInvites(g).length;

  /** Read-modify-write with retry on a concurrent change. */
  async function mutate<T>(
    subscriptionId: string,
    fn: (group: FamilyGroup) => T,
  ): Promise<{ group: FamilyGroup; result: T }> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const current = await store.get(subscriptionId);
      if (!current) throw new FamilyError('GROUP_NOT_FOUND', 'Family group not found');
      const draft = structuredClone(current);
      const result = fn(draft);
      draft.invites = liveInvites(draft);
      draft.version = current.version + 1;
      if (await store.save(draft, current.version)) return { group: draft, result };
    }
    throw new FamilyError('CONFLICT', 'Family group changed concurrently, retry');
  }

  const assertPayer = (g: FamilyGroup, payer: string): void => {
    if (g.payer !== payer) {
      throw new FamilyError('NOT_PAYER', 'Only the paying wallet can manage the family');
    }
  };

  return {
    async createGroup({ subscriptionId, payer, maxSeats }) {
      requireWallet(payer);
      if (!Number.isInteger(maxSeats) || maxSeats < 2 || maxSeats > MAX_FAMILY_SEATS) {
        throw new FamilyError(
          'INVALID_SEATS',
          `maxSeats must be an integer between 2 and ${MAX_FAMILY_SEATS}`,
        );
      }
      const group: FamilyGroup = {
        subscriptionId,
        payer,
        maxSeats,
        members: [],
        invites: [],
        version: 1,
      };
      if (!(await store.save(group, 0))) {
        throw new FamilyError('GROUP_EXISTS', 'Family group already exists');
      }
      emit({ type: 'created', subscriptionId, wallet: payer });
      return group;
    },

    async invite({ subscriptionId, payer, wallet }) {
      requireWallet(wallet);
      const { result } = await mutate(subscriptionId, (g) => {
        assertPayer(g, payer);
        if (wallet === g.payer || g.members.includes(wallet)) {
          throw new FamilyError('ALREADY_MEMBER', 'Wallet already holds a seat');
        }
        if (liveInvites(g).some((i) => i.wallet === wallet)) {
          throw new FamilyError('ALREADY_INVITED', 'Wallet already has a pending invitation');
        }
        if (seatsUsed(g) >= g.maxSeats) {
          throw new FamilyError('NO_FREE_SEATS', 'No free family seats');
        }
        const invite: FamilyInvite = { id: randomUUID(), wallet, expiresAt: now() + inviteTtl };
        g.invites.push(invite);
        return invite;
      });
      emit({ type: 'invited', subscriptionId, wallet });
      return result;
    },

    async acceptInvite({ subscriptionId, inviteId, wallet }) {
      const { group } = await mutate(subscriptionId, (g) => {
        const invite = g.invites.find((i) => i.id === inviteId);
        if (!invite) throw new FamilyError('INVITE_NOT_FOUND', 'Invitation not found');
        if (invite.expiresAt <= now()) throw new FamilyError('INVITE_EXPIRED', 'Invitation expired');
        if (invite.wallet !== wallet) {
          throw new FamilyError('INVITE_NOT_FOR_YOU', 'Invitation belongs to another wallet');
        }
        g.invites = g.invites.filter((i) => i.id !== inviteId);
        g.members.push(wallet);
      });
      emit({ type: 'joined', subscriptionId, wallet });
      return group;
    },

    async removeMember({ subscriptionId, payer, wallet }) {
      const { group } = await mutate(subscriptionId, (g) => {
        assertPayer(g, payer);
        if (!g.members.includes(wallet)) {
          throw new FamilyError('NOT_A_MEMBER', 'Wallet is not a family member');
        }
        g.members = g.members.filter((m) => m !== wallet);
      });
      emit({ type: 'removed', subscriptionId, wallet });
      return group;
    },

    async leave({ subscriptionId, wallet }) {
      const { group } = await mutate(subscriptionId, (g) => {
        if (g.payer === wallet) {
          throw new FamilyError('PAYER_CANNOT_LEAVE', 'The paying wallet cannot leave its own family');
        }
        if (!g.members.includes(wallet)) {
          throw new FamilyError('NOT_A_MEMBER', 'Wallet is not a family member');
        }
        g.members = g.members.filter((m) => m !== wallet);
      });
      emit({ type: 'left', subscriptionId, wallet });
      return group;
    },

    async dissolve(subscriptionId) {
      if (await store.get(subscriptionId)) {
        await store.delete(subscriptionId);
        emit({ type: 'dissolved', subscriptionId });
      }
    },

    async hasAccess(subscriptionId, wallet) {
      const g = await store.get(subscriptionId);
      return !!g && (g.payer === wallet || g.members.includes(wallet));
    },

    getGroup: (subscriptionId) => store.get(subscriptionId),
  };
}
