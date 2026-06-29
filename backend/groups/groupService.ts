export interface GroupMember {
  userId: string;
  role: 'owner' | 'member';
  joinedAt: number;
}

export interface Group {
  id: string;
  ownerId: string;
  name: string;
  maxSeats: number;
  members: GroupMember[];
  billingCycleId: string;
}

export class GroupService {
  private groups: Map<string, Group> = new Map();

  createGroup(ownerId: string, name: string, maxSeats: number): Group {
    const group: Group = {
      id: `group_${Date.now()}`,
      ownerId,
      name,
      maxSeats,
      members: [{ userId: ownerId, role: 'owner', joinedAt: Date.now() }],
      billingCycleId: `cycle_${Date.now()}`,
    };
    this.groups.set(group.id, group);
    return group;
  }

  inviteMember(groupId: string, ownerId: string, email: string): string {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('Group not found');
    if (group.ownerId !== ownerId) throw new Error('Only owner can invite');
    if (group.members.length >= group.maxSeats) throw new Error('No seats available');
    
    // In a real implementation we would send the email here
    return `invite_${Date.now()}`;
  }

  joinGroup(groupId: string, userId: string, inviteCode: string): Group {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('Group not found');
    if (group.members.length >= group.maxSeats) throw new Error('Group is full');
    
    group.members.push({
      userId,
      role: 'member',
      joinedAt: Date.now(),
    });
    
    return group;
  }

  removeMember(groupId: string, ownerId: string, memberId: string): void {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('Group not found');
    if (group.ownerId !== ownerId) throw new Error('Only owner can remove');
    if (ownerId === memberId) throw new Error('Owner cannot remove themselves');
    
    group.members = group.members.filter(m => m.userId !== memberId);
  }
}
