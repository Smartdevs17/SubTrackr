# Group Subscriptions & Member Management

## Overview

Group subscriptions enable shared subscription plans with member management, billing aggregation, admin controls, and plan customization for families, teams, and organizations.

## Architecture

```
GroupBillingService
├── Billing Aggregation
│   ├── generateBillingSummary()    - Generate billing summary
│   ├── aggregateCharges()          - Aggregate charges over period
│   └── calculateGroupAnalytics()   - Calculate full analytics
│
├── Invoice Generation
│   ├── generateInvoice()           - Generate group invoice
│   ├── issueInvoice()              - Issue invoice
│   ├── markInvoicePaid()           - Mark invoice paid
│   └── getGroupInvoices()          - Get group invoices
│
├── Admin Controls
│   ├── recordAdminAction()         - Record admin action
│   ├── getAdminActions()           - Get admin action history
│   ├── canPerformAction()          - Check permission
│   └── overrideMemberBalance()     - Override member balance
│
└── Plan Customization
    ├── customizeGroupPlan()        - Customize group plan
    └── getGroupPlanCustomization() - Get customization

Member billing allocation (src/services/groupBillingAllocation.ts)
├── allocateMemberBilling()       - Split a charge by strategy
└── applyAllocationToMembers()    - Apply shares to outstanding balances
```

## Group Structure

```typescript
interface SubscriptionGroup {
  groupId: string;
  name: string;
  owner: string;
  members: GroupMember[];
  invites: GroupInvite[];
  planSharingRules: GroupPlanSharingRules;
  charges: GroupChargeResult[];
  createdAt: Date;
  updatedAt: Date;
}
```

## Member Roles & Permissions

| Role | Invite | Remove | Role Change | Billing Override | Plan Change | Pause Member |
|------|--------|--------|-------------|-----------------|-------------|--------------|
| Owner | Yes | Yes | Yes | Yes | Yes | Yes |
| Admin | Yes | Yes | No | No | No | Yes |
| Member | No | No | No | No | No | No |

## Billing Allocation Strategies

| Strategy | Behavior |
|----------|----------|
| `equal` | Split the charge evenly across all members |
| `usage_weighted` | Split by each member's `usageUnits` (falls back to equal when usage is zero) |
| `custom_weights` | Split by an explicit per-member weight map |
| `owner_pays` | Assign the full amount to the group owner |

Use `allocateMemberBilling(group, totalAmount, strategy, customWeights?)` for a breakdown, then `applyAllocationToMembers(group, allocation)` to update outstanding balances. `chargeGroupWithAllocation` combines allocation, charge persistence, and balance updates.

## Billing Aggregation

- **Consolidated Billing**: Owner pays for all members or individual billing
- **Charge Breakdown**: Per-member charge allocation
- **Outstanding Balance Tracking**: Track per-member balances
- **Invoice Generation**: Period-based group invoices with line items
- **Discount Application**: Owner discounts on group plans

## Group Analytics

- **Seat Utilization**: Active seats vs seat limit
- **Usage Tracking**: Per-member usage units
- **Cost Distribution**: Per-member cost share
- **Outstanding Balances**: Total and per-member outstanding amounts
- **Total Spend**: Cumulative group spending

## Plan Customization

- **Custom Group Names**: Override default plan name
- **Custom Pricing**: Set custom group price
- **Shared Features**: Define features available to all members
- **Member Limits**: Per-member feature limits
- **Owner Discount**: Percentage discount for group owner

## HTTP API Endpoints

Mount via `createGroupBillingRouter()` from `backend/groups`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/groups` | Create group |
| `GET` | `/groups/:groupId` | Get group |
| `POST` | `/groups/:groupId/invites` | Invite member |
| `POST` | `/groups/:groupId/invites/:inviteId/accept` | Accept invite |
| `DELETE` | `/groups/:groupId/members/:address` | Remove member |
| `POST` | `/groups/:groupId/charges` | Charge with allocation strategy |
| `GET` | `/groups/:groupId/analytics` | Group analytics |
| `GET` | `/groups/:groupId/admin/actions` | Admin action history |
| `POST` | `/groups/:groupId/admin/override-balance` | Override member balance |
| `POST` | `/groups/:groupId/admin/change-role` | Change member role |

Charge body: `{ amount, strategy?, customWeights? }` where `strategy` is one of the allocation strategies above.

## Service Helpers

| Method | Description |
|--------|-------------|
| `generateBillingSummary()` | Generate billing summary |
| `aggregateCharges()` | Aggregate charges over period |
| `generateInvoice()` | Generate group invoice |
| `issueInvoice()` | Issue invoice |
| `markInvoicePaid()` | Mark invoice paid |
| `getGroupInvoices()` | Get group invoices |
| `calculateGroupAnalytics()` | Calculate analytics |
| `recordAdminAction()` | Record admin action |
| `getAdminActions()` | Get admin action history |
| `canPerformAction()` | Check action permission |
| `overrideMemberBalance()` | Override member balance |
| `customizeGroupPlan()` | Customize group plan |
| `getGroupPlanCustomization()` | Get plan customization |
| `allocateMemberBilling()` | Allocate charge by strategy |
| `applyAllocationToMembers()` | Apply allocation to balances |
| `chargeGroupWithAllocation()` | Charge + allocate + persist |
| `changeMemberRole()` | Admin role change helper |

## Integration with Frontend

The `GroupManagementScreen` provides:
- Group creation with custom plan sharing rules
- Member invitation and management
- Billing overview and charge history
- Analytics dashboard
- Admin controls for owners and admins
