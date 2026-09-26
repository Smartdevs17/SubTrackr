# Loyalty Program

## Overview

The loyalty program provides subscriber retention through points earning, tiered benefits, reward redemption, streak bonuses, and comprehensive analytics.

## Architecture

```
LoyaltyService
├── Points Rules Management
│   ├── addPointsRule()       - Add earning rule
│   ├── updatePointsRule()    - Update rule
│   ├── removePointsRule()    - Remove rule
│   └── getPointsRules()      - List rules by trigger
│
├── Points Calculation
│   └── calculatePoints()     - Calculate points for event
│
├── Points History
│   ├── recordPointsEvent()   - Record points transaction
│   └── getPointsHistory()    - Get subscriber history
│
├── Loyalty Analytics
│   └── getLoyaltyAnalytics() - Full analytics report
│
├── Loyalty Notifications
│   ├── createNotification()  - Create notification
│   ├── getNotifications()    - Get notifications
│   ├── markNotificationRead() - Mark as read
│   ├── markAllNotificationsRead() - Mark all read
│   └── getUnreadCount()      - Get unread count
│
└── API Helpers
    ├── createApiResponse()   - Create success response
    └── createErrorResponse() - Create error response
```

## Points Earning Rules

| Rule | Trigger | Multiplier | Base Points | Conditions |
|------|---------|------------|-------------|------------|
| Standard Charge | subscription_charge | 10x | 0 | None |
| High-Value Charge | subscription_charge | 20x | 0 | Min $100 charge |
| Referral Bonus | referral | 1x | 500 | None |
| 30-Day Member | tenure_milestone | 1x | 200 | 30 days tenure |
| 1-Year Member | tenure_milestone | 1x | 2,000 | 365 days tenure |
| High Usage | usage_threshold | 1x | 100 | 1000 usage units |

## Loyalty Tiers

| Tier | Points Required | Discount | Priority Support | Reduced Fees |
|------|----------------|----------|-----------------|--------------|
| Bronze | 0 | 0% | No | 0% |
| Silver | 1,000 | 5% | No | 2% |
| Gold | 5,000 | 10% | Yes | 5% |
| Platinum | 15,000 | 15% | Yes | 10% |

## Reward Catalog

| Reward | Points Cost | Value | Description |
|--------|------------|-------|-------------|
| $5 Discount | 500 | $5 | $5 off next billing cycle |
| $10 Discount | 900 | $10 | $10 off next billing cycle |
| Free Month | 2,000 | - | Get one month free |
| T-Shirt | 5,000 | $25 | Exclusive SubTrackr merchandise |

## Points Lifecycle

1. **Earn**: Points earned on subscription charges, referrals, tenure milestones
2. **Redeem**: Points exchanged for rewards (discounts, free months, merchandise)
3. **Expire**: Points expire after configured expiration period
4. **Streak Bonus**: Bonus points at streak milestones (every 10 consecutive charges)

## Loyalty Notifications

- **Points Earned**: Notify when points are earned
- **Tier Upgraded**: Celebrate tier advancement
- **Reward Available**: Notify about available rewards
- **Points Expiring**: Warn about expiring points
- **Streak Bonus**: Celebrate streak milestones

## Analytics

- **Total Points Earned/Redeemed/Expired**: Lifetime point flow
- **Active Points Balance**: Current points across all members
- **Tier Breakdown**: Member distribution across tiers
- **Points Trend**: 7-day earn/redeem trend
- **Average Points Per Member**: Per-member average
- **Redemption Rate**: Points redeemed / points earned

## On-Chain Integration

The loyalty program integrates with Soroban smart contracts (`contracts/subscription/src/loyalty.rs`) for:
- On-chain points tracking
- Tier determination based on lifetime points
- Referral bonus distribution
- Points redemption for on-chain discounts
- Streak management

## API Endpoints

| Method | Description |
|--------|-------------|
| `addPointsRule()` | Add points earning rule |
| `updatePointsRule()` | Update rule configuration |
| `removePointsRule()` | Remove points rule |
| `getPointsRules()` | List rules by trigger type |
| `calculatePoints()` | Calculate points for event |
| `recordPointsEvent()` | Record points transaction |
| `getPointsHistory()` | Get subscriber points history |
| `getLoyaltyAnalytics()` | Get full analytics report |
| `createNotification()` | Create loyalty notification |
| `getNotifications()` | Get subscriber notifications |
| `markNotificationRead()` | Mark notification as read |
| `markAllNotificationsRead()` | Mark all as read |
| `getUnreadCount()` | Get unread notification count |
| `createApiResponse()` | Create API success response |
| `createErrorResponse()` | Create API error response |

## Integration with Frontend

### LoyaltyDashboardScreen
- Tier display with progress bar
- Points balance and lifetime stats
- Reward catalog with redemption
- Points transaction history
- Tier benefits overview

### GamificationStore
- Points tracking integration
- Achievement system integration
- Streak management
- Level progression
