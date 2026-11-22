import {
  FamilyError,
  MAX_FAMILY_SEATS,
  createFamilyService,
  createInMemoryFamilyStore,
  type FamilyEvent,
  type FamilyStore,
} from '../family';

const SUB = 'sub-1';
const PAYER = 'GPAYER';

function setup(opts: { store?: FamilyStore } = {}) {
  let clock = 1_000_000;
  const events: FamilyEvent[] = [];
  const service = createFamilyService({
    store: opts.store,
    now: () => clock,
    inviteTtlMs: 1000,
    onEvent: (e) => events.push(e),
  });
  return { service, events, advance: (ms: number) => (clock += ms) };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toEqual(expect.objectContaining({ name: 'FamilyError', code }));
}

describe('createGroup', () => {
  it('creates a group with the payer holding a seat', async () => {
    const { service } = setup();
    const g = await service.createGroup({ subscriptionId: SUB, payer: PAYER, maxSeats: 4 });
    expect(g).toMatchObject({ payer: PAYER, maxSeats: 4, members: [], invites: [] });
    expect(await service.hasAccess(SUB, PAYER)).toBe(true);
  });

  it.each([1, 0, -1, 2.5, MAX_FAMILY_SEATS + 1, NaN])('rejects maxSeats %p', async (maxSeats) => {
    const { service } = setup();
    await expectCode(service.createGroup({ subscriptionId: SUB, payer: PAYER, maxSeats }), 'INVALID_SEATS');
  });

  it('rejects an empty payer and a duplicate group', async () => {
    const { service } = setup();
    await expectCode(service.createGroup({ subscriptionId: SUB, payer: ' ', maxSeats: 3 }), 'INVALID_WALLET');
    await service.createGroup({ subscriptionId: SUB, payer: PAYER, maxSeats: 3 });
    await expectCode(service.createGroup({ subscriptionId: SUB, payer: PAYER, maxSeats: 3 }), 'GROUP_EXISTS');
  });
});

describe('invite and accept', () => {
  it('adds a member only after they accept', async () => {
    const { service, events } = setup();
    await service.createGroup({ subscriptionId: SUB, payer: PAYER, maxSeats: 3 });
    const invite = await service.invite({ subscriptionId: SUB, payer: PAYER, wallet: 'GKID' });
    expect(await service.hasAccess(SUB, 'GKID')).toBe(false);

    const g = await service.acceptInvite({ subscriptionId: SUB, inviteId: invite.id, wallet: 'GKID' });
    expect(g.members).toEqual(['GKID']);
    expect(g.invites).toEqual([]);
    expect(await service.hasAccess(SUB, 'GKID')).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['created', 'invited', 'joined']);
  });

  it('only the payer can invite', async () => {
    const { service } = setup();
    await service.createGroup({ subscriptionId: SUB, payer: PAYER, maxSeats: 3 });
    await expectCode(service.invite({ subscriptionId: SUB, payer: 'GOTHER', wallet: 'GKID' }), 'NOT_PAYER');
  });

  it('fails for a missing group', async () => {
    const { service } = setup();
    await expectCode(service.invite({ subscriptionId: 'nope', payer: PAYER, wallet: 'GKID' }), 'GROUP_NOT_FOUND');
  });

  it('rejects inviting the payer, a member or an already-invited wallet', async () => {
    const { service } = setup();
    await service.createGroup({ subscriptionId: SUB, payer: PAYER, maxSeats: 5 });
    await expectCode(service.invite({ subscriptionId: SUB, payer: PAYER, wallet: PAYER }), 'ALREADY_MEMBER');
    const inv = await service.invite({ subscriptionId: SUB, payer: PAYER, wallet: 'GKID' });
    await expectCode(service.invite({ subscriptionId: SUB, payer: PAYER, wallet: 'GKID' }), 'ALREADY_INVITED');
    await service.acceptInvite({ subscriptionId: SUB, inviteId: inv.id, wallet: 'GKID' });
    await expectCode(service.invite({ subscriptionId: SUB, payer: PAYER, wallet: 'GKID' }), 'ALREADY_MEMBER');
  });

  it('counts pending invitations against the seat limit', async () => {
    const { service } = setup();
    await service.createGroup({ subscriptionId: SUB, payer: PAYER, maxSeats: 2 });
    await service.invite({ subscriptionId: SUB, payer: PAYER, wallet: 'GA' });
    await expectCode(service.invite({ subscriptionId: SUB, payer: PAYER, wallet: 'GB' }), 'NO_FREE_SEATS');
  });

  it('frees the seat when an invitation expires', async () => {
    const { service, advance } = setup();
    await service.createGroup({ subscriptionId: SUB, payer: PAYER, maxSeats: 2 });
    const inv = await service.invite({ subscriptionId: SUB, payer: PAYER, wallet: 'GA' });
    advance(1000);
    await expectCode(service.acceptInvite({ subscriptionId: SUB, inviteId: inv.id, wallet: 'GA' }), 'INVITE_EXPIRED');
    await expect(service.invite({ subscriptionId: SUB, payer: PAYER, wallet: 'GB' })).resolves.toBeDefined();
  });

  it('rejects accepting with the wrong wallet or an unknown invite', async () => {
    const { service } = setup();
    await service.createGroup({ subscriptionId: SUB, payer: PAYER, maxSeats: 3 });
    const inv = await service.invite({ subscriptionId: SUB, payer: PAYER, wallet: 'GA' });
    await expectCode(service.acceptInvite({ subscriptionId: SUB, inviteId: inv.id, wallet: 'GB' }), 'INVITE_NOT_FOR_YOU');
    await expectCode(service.acceptInvite({ subscriptionId: SUB, inviteId: 'bogus', wallet: 'GA' }), 'INVITE_NOT_FOUND');
  });

  it('an invitation cannot be used twice', async () => {
    const { service } = setup();
    await service.createGroup({ subscriptionId: SUB, payer: PAYER, maxSeats: 3 });
    const inv = await service.invite({ subscriptionId: SUB, payer: PAYER, wallet: 'GA' });
    await service.acceptInvite({ subscriptionId: SUB, inviteId: inv.id, wallet: 'GA' });
    await expectCode(service.acceptInvite({ subscriptionId: SUB, inviteId: inv.id, wallet: 'GA' }), 'INVITE_NOT_FOUND');
  });
});

describe('remove, leave and dissolve', () => {
  async function withMember() {
    const ctx = setup();
    await ctx.service.createGroup({ subscriptionId: SUB, payer: PAYER, maxSeats: 3 });
    const inv = await ctx.service.invite({ subscriptionId: SUB, payer: PAYER, wallet: 'GA' });
    await ctx.service.acceptInvite({ subscriptionId: SUB, inviteId: inv.id, wallet: 'GA' });
    return ctx;
  }

  it('payer removes a member and the seat is reusable', async () => {
    const { service } = await withMember();
    const g = await service.removeMember({ subscriptionId: SUB, payer: PAYER, wallet: 'GA' });
    expect(g.members).toEqual([]);
    expect(await service.hasAccess(SUB, 'GA')).toBe(false);
    await expect(service.invite({ subscriptionId: SUB, payer: PAYER, wallet: 'GB' })).resolves.toBeDefined();
  });

  it('a non-payer cannot remove, and removing a stranger fails', async () => {
    const { service } = await withMember();
    await expectCode(service.removeMember({ subscriptionId: SUB, payer: 'GA', wallet: 'GA' }), 'NOT_PAYER');
    await expectCode(service.removeMember({ subscriptionId: SUB, payer: PAYER, wallet: 'GZ' }), 'NOT_A_MEMBER');
  });

  it('a member can leave; the payer cannot', async () => {
    const { service } = await withMember();
    await service.leave({ subscriptionId: SUB, wallet: 'GA' });
    expect(await service.hasAccess(SUB, 'GA')).toBe(false);
    await expectCode(service.leave({ subscriptionId: SUB, wallet: 'GA' }), 'NOT_A_MEMBER');
    await expectCode(service.leave({ subscriptionId: SUB, wallet: PAYER }), 'PAYER_CANNOT_LEAVE');
  });

  it('dissolve removes all access and is idempotent', async () => {
    const { service, events } = await withMember();
    await service.dissolve(SUB);
    await service.dissolve(SUB);
    expect(await service.hasAccess(SUB, 'GA')).toBe(false);
    expect(await service.hasAccess(SUB, PAYER)).toBe(false);
    expect(await service.getGroup(SUB)).toBeUndefined();
    expect(events.filter((e) => e.type === 'dissolved')).toHaveLength(1);
  });
});

describe('concurrency and hooks', () => {
  it('retries a conflicting write and then succeeds', async () => {
    const inner = createInMemoryFamilyStore();
    let rejectNext = 0;
    const store: FamilyStore = {
      ...inner,
      async save(g, v) {
        if (g.version > 1 && rejectNext > 0) {
          rejectNext--;
          return false;
        }
        return inner.save(g, v);
      },
    };
    const { service } = setup({ store });
    await service.createGroup({ subscriptionId: SUB, payer: PAYER, maxSeats: 3 });
    rejectNext = 2;
    await expect(service.invite({ subscriptionId: SUB, payer: PAYER, wallet: 'GA' })).resolves.toBeDefined();
  });

  it('gives up with CONFLICT after repeated conflicts', async () => {
    const inner = createInMemoryFamilyStore();
    const store: FamilyStore = { ...inner, save: async (g, v) => (g.version > 1 ? false : inner.save(g, v)) };
    const { service } = setup({ store });
    await service.createGroup({ subscriptionId: SUB, payer: PAYER, maxSeats: 3 });
    await expectCode(service.invite({ subscriptionId: SUB, payer: PAYER, wallet: 'GA' }), 'CONFLICT');
  });

  it('a throwing event hook does not break the flow', async () => {
    const service = createFamilyService({
      onEvent: () => {
        throw new Error('boom');
      },
    });
    await expect(service.createGroup({ subscriptionId: SUB, payer: PAYER, maxSeats: 3 })).resolves.toBeDefined();
    expect(new FamilyError('CONFLICT', 'x').name).toBe('FamilyError');
  });
});
