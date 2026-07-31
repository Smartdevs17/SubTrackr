# SLA Monitoring & Breach Detection

## Overview

The SLA monitoring system provides subscription-tier-based SLA definitions, real-time availability tracking, automated breach detection, credit calculation, and comprehensive analytics.

## Architecture

```
SlaMonitoringService
├── Tier Management
│   ├── setTierDefinition()    - Define SLA tiers
│   ├── getTierDefinition()    - Get tier config
│   ├── assignMerchantToTier() - Assign merchant to tier
│   └── getSlaConfigForTier()  - Get SLA config for tier
│
├── Credit Rules
│   ├── addCreditRule()        - Add credit calculation rule
│   ├── removeCreditRule()     - Remove credit rule
│   ├── listCreditRules()      - List all rules
│   └── calculateCreditAmount() - Calculate breach credit
│
├── Response Time Tracking
│   ├── recordResponseTime()   - Record response time
│   ├── getAverageResponseTime() - Get avg response time
│   └── isResponseTimeBreached() - Check response time SLA
│
├── Real-time Tracking
│   └── trackAvailability()    - Record availability event
│
├── Breach Detection
│   └── detectBreaches()       - Detect and create breaches
│
├── Analytics
│   └── getAnalytics()         - Get SLA analytics
│
└── Reporting
    └── generateSlaReport()    - Generate dashboard report
```

## SLA Tier Definitions

### Basic Tier
- **Uptime Target**: 99.0%
- **Measurement Interval**: 7 days
- **Response Time Target**: 5000ms
- **Max Breaches**: 3
- **Credit Percentage**: 5%
- **Auto Credit**: Disabled

### Premium Tier
- **Uptime Target**: 99.5%
- **Measurement Interval**: 7 days
- **Response Time Target**: 2000ms
- **Max Breaches**: 2
- **Credit Percentage**: 10%
- **Auto Credit**: Enabled

### Enterprise Tier
- **Uptime Target**: 99.9%
- **Measurement Interval**: 30 days
- **Response Time Target**: 1000ms
- **Max Breaches**: 1
- **Credit Percentage**: 20%
- **Auto Credit**: Enabled

## Credit Rules

| Rule | Uptime Threshold | Credit % | Max Credit | Auto Apply |
|------|-----------------|----------|------------|------------|
| Minor Breach | < 99.0% | 5% | $50 | Yes |
| Major Breach | < 95.0% | 15% | $200 | Yes |
| Critical Breach | < 90.0% | 30% | $500 | Yes |

## Breach Detection Algorithm

1. Calculate observed seconds within the measurement window
2. Sum downtime (weighted: full_outage=100%, partial_outage=50%, maintenance=0%)
3. Compute uptime percentage
4. Compare against tier-specific uptime target
5. If non-compliant and no active breach: create new breach with auto-calculated credit
6. If compliant and active breach exists: resolve the breach

## Analytics

- **Total/Compliant Merchants**: Overall compliance status
- **Average Uptime**: System-wide uptime
- **Total Breaches/Credits**: Breach history
- **Uptime by Tier**: Performance per SLA tier
- **Breach/Credit Trends**: 7-day trend analysis
- **Response Time Tracking**: Real-time response time monitoring

## API Endpoints

| Method | Description |
|--------|-------------|
| `setTierDefinition()` | Define or update SLA tier |
| `getTierDefinition()` | Get tier configuration |
| `listTierDefinitions()` | List all tiers |
| `assignMerchantToTier()` | Assign merchant to tier |
| `getSlaConfigForTier()` | Get SLA config for tier |
| `addCreditRule()` | Add credit rule |
| `removeCreditRule()` | Remove credit rule |
| `listCreditRules()` | List all credit rules |
| `calculateCreditAmount()` | Calculate breach credit |
| `recordResponseTime()` | Record response time |
| `getAverageResponseTime()` | Get average response time |
| `isResponseTimeBreached()` | Check response time breach |
| `trackAvailability()` | Record availability event |
| `detectBreaches()` | Detect breaches |
| `getAnalytics()` | Get SLA analytics |
| `generateSlaReport()` | Generate dashboard report |
| `getMonitoringEvents()` | Get monitoring events |
