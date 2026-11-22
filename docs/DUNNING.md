# Dunning Email Sequences & A/B Testing

## Overview

The dunning system manages failed payment recovery through automated email sequences, A/B testing for email optimization, deliverability monitoring, and analytics.

## Architecture

```
DunningEmailSequenceService
├── Email Sequence Management
│   ├── createSequence()      - Create dunning email sequences
│   ├── updateSequence()      - Modify sequence configuration
│   ├── getActiveSequenceForStage() - Get active sequence for a stage
│   └── listSequences()       - List all sequences
│
├── Email Variant Management
│   ├── createVariant()       - Create email content variants
│   ├── updateVariant()       - Modify variant content
│   ├── listVariants()        - List variants by stage
│   └── getActiveVariantsForStage() - Get active variants
│
├── A/B Testing
│   ├── createABTest()        - Create A/B test with variants
│   ├── startABTest()         - Start a test
│   ├── pauseABTest()         - Pause a running test
│   ├── completeABTest()      - Complete and declare winner
│   ├── assignVariant()       - Assign subscriber to variant
│   └── getABTestResults()    - Get test performance results
│
├── Delivery Tracking
│   ├── logDelivery()         - Log email delivery events
│   ├── updateDeliveryStatus() - Update delivery status
│   └── getDeliveryLogs()     - Query delivery history
│
└── Analytics & Optimization
    ├── getDeliverabilityMetrics() - Full deliverability report
    ├── getOptimalSendTime() - Data-driven send time optimization
    └── getSequenceRecommendations() - Actionable recommendations
```

## Dunning Email Stages

1. **Retry** - Automatic payment retry with gentle notification
2. **Warning** - Urgent warning about service interruption
3. **Suspension** - Service suspension notice
4. **Cancellation** - Final cancellation notice

## A/B Testing Workflow

1. Create email variants for different stages
2. Create an A/B test linking variants
3. Start the test to begin variant assignment
4. Monitor results via `getABTestResults()`
5. Complete the test with the winning variant

```typescript
import { dunningEmailSequenceService } from './notification/dunningEmailSequences';

// Create variants
const variantA = dunningEmailSequenceService.createVariant({
  name: 'Friendly Retry',
  subject: 'Payment retry for {subscription_name}',
  body: 'We noticed a payment issue...',
  stage: 'retry',
  weight: 50,
});

const variantB = dunningEmailSequenceService.createVariant({
  name: 'Urgent Retry',
  subject: 'Action needed: {subscription_name} payment',
  body: 'Your payment failed...',
  stage: 'retry',
  weight: 50,
});

// Create and run A/B test
const test = dunningEmailSequenceService.createABTest({
  name: 'Retry Email Test',
  stage: 'retry',
  variantIds: [variantA.id, variantB.id],
});
dunningEmailSequenceService.startABTest(test.id);

// Get results after collecting data
const results = dunningEmailSequenceService.getABTestResults(test.id);
```

## Deliverability Monitoring

- **Delivery Rate**: Percentage of emails successfully delivered
- **Bounce Rate**: Percentage of bounced emails (threshold: 5%)
- **Open Rate**: Percentage of opened emails
- **Click Rate**: Percentage of clicked emails
- **Per-stage and per-variant breakdowns**

## Email Scheduling Optimization

The system analyzes historical open-time data to recommend optimal send times per stage, improving engagement rates.

## API Endpoints

| Method | Description |
|--------|-------------|
| `createSequence()` | Create a new dunning email sequence |
| `updateSequence()` | Modify an existing sequence |
| `getSequence()` | Get sequence by ID |
| `listSequences()` | List all sequences |
| `deleteSequence()` | Delete a sequence |
| `createVariant()` | Create an email variant |
| `updateVariant()` | Modify variant content |
| `createABTest()` | Create A/B test |
| `startABTest()` | Start a test |
| `pauseABTest()` | Pause a running test |
| `completeABTest()` | Complete test |
| `getABTestResults()` | Get test results |
| `assignVariant()` | Assign variant to subscriber |
| `logDelivery()` | Log delivery event |
| `updateDeliveryStatus()` | Update delivery status |
| `getDeliveryLogs()` | Query delivery logs |
| `getDeliverabilityMetrics()` | Get full metrics |
| `getOptimalSendTime()` | Get optimal send time |
| `getSequenceRecommendations()` | Get recommendations |
