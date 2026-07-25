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

## API Endpoints

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

## Integration with Frontend

The `GroupManagementScreen` provides:
- Group creation with custom plan sharing rules
- Member invitation and management
- Billing overview and charge history
- Analytics dashboard
- Admin controls for owners and admins
