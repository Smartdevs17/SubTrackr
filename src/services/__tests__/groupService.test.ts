import {
  chargeGroup,
  createSubscriptionGroup,
  getGroupAnalytics,
  inviteGroupMember,
  joinGroupWithInvite,
  removeGroupMember,
} from '../groupService';

describe('groupService', () => {
  it('creates a group, accepts an invite, and reports analytics', () => {
    const group = createSubscriptionGroup('owner', {
      name: 'Family',
      planSharingRules: {
        seatLimit: 2,
        ownerPaysForMembers: true,
        allowMemberOverages: false,
      },
    });

    const invited = inviteGroupMember(group, 'member', 'owner');
    const joined = joinGroupWithInvite(invited, invited.invites[0].id, 'Member');
    const analytics = getGroupAnalytics(joined);

    expect(joined.members).toHaveLength(2);
    expect(joined.invites[0].status).toBe('accepted');
    expect(analytics.activeSeats).toBe(2);
    expect(analytics.seatLimit).toBe(2);
  });

  it('prevents over-capacity invites and owner removal', () => {
    const group = createSubscriptionGroup('owner', {
      name: 'Tiny',
      planSharingRules: {
        seatLimit: 1,
        ownerPaysForMembers: true,
        allowMemberOverages: false,
      },
    });

    expect(() => inviteGroupMember(group, 'member', 'owner')).toThrow('Member limit reached');
    expect(() => removeGroupMember(group, 'owner')).toThrow('Transfer ownership');
  });

  it('creates consolidated owner-paid charges', () => {
    const group = createSubscriptionGroup('owner', {
      name: 'Team',
      planSharingRules: {
        seatLimit: 5,
        ownerPaysForMembers: true,
        allowMemberOverages: false,
      },
    });

    const charge = chargeGroup(group, 49);

    expect(charge.payer).toBe('owner');
    expect(charge.amount).toBe(49);
    expect(charge.breakdown[0].amount).toBe(0);
  });
});
