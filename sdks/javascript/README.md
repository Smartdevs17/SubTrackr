# SubTrackr JavaScript SDK

The official JavaScript/Node.js SDK for the SubTrackr API.

## Installation

```bash
npm install @subtrackr/sdk
# or
yarn add @subtrackr/sdk
```

## Quick Start

### 1. Initialize the Client

```javascript
import SubTrackr from '@subtrackr/sdk';

const client = new SubTrackr({
  apiKey: process.env.SUBTRACKR_API_KEY, // e.g., 'sk_test_your_key'
});
```

### 2. List Subscriptions

```javascript
async function fetchSubscriptions() {
  try {
    const subscriptions = await client.subscriptions.list({
      status: 'active',
      limit: 10
    });
    console.log(subscriptions.data);
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
  }
}

fetchSubscriptions();
```

### 3. Create a Subscription

```javascript
async function createSubscription() {
  const newSub = await client.subscriptions.create({
    name: 'Netflix',
    category: 'streaming',
    price: 15.99,
    currency: 'USD',
    billingCycle: 'monthly',
    startDate: new Date().toISOString()
  });
  console.log('Created subscription:', newSub.id);
}
```

## TypeScript Support
This SDK is written in TypeScript and provides complete type definitions out of the box.
