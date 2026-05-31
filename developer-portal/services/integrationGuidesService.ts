import { IntegrationGuide, IntegrationStep } from '../types/portal';

export class IntegrationGuidesService {
  private guides: IntegrationGuide[] = [];

  constructor() {
    this.initializeGuides();
  }

  private initializeGuides(): void {
    this.guides = [
      {
        id: 'react-integration',
        title: 'React Integration',
        description: 'Integrate SubTrackr into your React application',
        difficulty: 'beginner',
        estimatedTime: 30,
        prerequisites: ['Node.js 16+', 'npm or yarn', 'React 18+'],
        steps: [
          {
            id: 'install',
            title: 'Install the SDK',
            description: 'Install the SubTrackr SDK using npm or yarn',
            code: 'npm install @subtrackr/sdk',
            language: 'bash',
          },
          {
            id: 'configure',
            title: 'Configure the Client',
            description: 'Initialize the SubTrackr client with your API key',
            code: `import { SubTrackr } from '@subtrackr/sdk';

const subtrackr = new SubTrackr({
  apiKey: process.env.REACT_APP_SUBTRACKR_KEY,
  environment: 'sandbox'
});

export default subtrackr;`,
            language: 'typescript',
          },
          {
            id: 'create-hook',
            title: 'Create a Custom Hook',
            description: 'Create a reusable hook for subscription data',
            code: `import { useState, useEffect } from 'react';
import subtrackr from './subtrackr';

export function useSubscriptions(userId: string) {
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchSubscriptions() {
      try {
        const data = await subtrackr.subscriptions.list({
          userId,
          status: 'active'
        });
        setSubscriptions(data);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    }

    fetchSubscriptions();
  }, [userId]);

  return { subscriptions, loading, error };
}`,
            language: 'typescript',
          },
          {
            id: 'use-component',
            title: 'Use in Component',
            description: 'Use the hook in your React component',
            code: `import React from 'react';
import { useSubscriptions } from './useSubscriptions';

function SubscriptionList({ userId }) {
  const { subscriptions, loading, error } = useSubscriptions(userId);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <ul>
      {subscriptions.map(sub => (
        <li key={sub.id}>
          {sub.plan} - {sub.status}
        </li>
      ))}
    </ul>
  );
}`,
            language: 'tsx',
            notes: [
              'Make sure to handle loading and error states',
              'Consider implementing pagination for large lists',
            ],
          },
        ],
      },
      {
        id: 'node-integration',
        title: 'Node.js Integration',
        description: 'Server-side integration with Node.js',
        difficulty: 'intermediate',
        estimatedTime: 45,
        prerequisites: ['Node.js 16+', 'Express or similar framework'],
        steps: [
          {
            id: 'install',
            title: 'Install Dependencies',
            description: 'Install required packages',
            code: 'npm install @subtrackr/sdk express',
            language: 'bash',
          },
          {
            id: 'setup-middleware',
            title: 'Setup Express Middleware',
            description: 'Create middleware for API key validation',
            code: `import express from 'express';
import { SubTrackr } from '@subtrackr/sdk';

const app = express();
const subtrackr = new SubTrackr({
  apiKey: process.env.SUBTRACKR_API_KEY,
  environment: 'sandbox'
});

// Middleware to attach SubTrackr client
app.use((req, res, next) => {
  req.subtrackr = subtrackr;
  next();
});`,
            language: 'typescript',
          },
          {
            id: 'create-routes',
            title: 'Create API Routes',
            description: 'Build REST endpoints for subscription management',
            code: `// Get user subscriptions
app.get('/api/subscriptions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const subscriptions = await req.subtrackr.subscriptions.list({
      userId,
      status: req.query.status
    });
    res.json(subscriptions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new subscription
app.post('/api/subscriptions', async (req, res) => {
  try {
    const { userId, planId } = req.body;
    const subscription = await req.subtrackr.subscriptions.create({
      userId,
      planId,
      paymentMethod: req.body.paymentMethod
    });
    res.status(201).json(subscription);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});`,
            language: 'typescript',
          },
          {
            id: 'webhook-handler',
            title: 'Setup Webhook Handler',
            description: 'Handle incoming webhook events',
            code: `import { verifyWebhookSignature } from '@subtrackr/sdk';

app.post('/webhooks/subtrackr', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-subtrackr-signature'];
  
  if (!verifyWebhookSignature(req.body, signature, process.env.WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(req.body);
  
  switch (event.type) {
    case 'subscription.created':
      handleSubscriptionCreated(event.data);
      break;
    case 'payment.completed':
      handlePaymentCompleted(event.data);
      break;
    default:
      console.log('Unhandled event:', event.type);
  }

  res.status(200).send('OK');
});`,
            language: 'typescript',
            notes: [
              'Always verify webhook signatures in production',
              'Use raw body parser for signature verification',
              'Handle events asynchronously for better performance',
            ],
          },
        ],
      },
      {
        id: 'web3-integration',
        title: 'Web3 Wallet Integration',
        description: 'Connect blockchain wallets for payments',
        difficulty: 'advanced',
        estimatedTime: 60,
        prerequisites: ['Web3 provider (MetaMask, WalletConnect)', 'Ethers.js or similar'],
        steps: [
          {
            id: 'install-web3',
            title: 'Install Web3 Dependencies',
            description: 'Install required Web3 packages',
            code: 'npm install @subtrackr/sdk ethers @walletconnect/react-native-compat',
            language: 'bash',
          },
          {
            id: 'connect-wallet',
            title: 'Connect Wallet',
            description: 'Implement wallet connection flow',
            code: `import { ethers } from 'ethers';
import { SubTrackr } from '@subtrackr/sdk';

async function connectWallet() {
  if (typeof window.ethereum === 'undefined') {
    throw new Error('Please install MetaMask');
  }

  const provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  const signer = provider.getSigner();
  const address = await signer.getAddress();

  return { provider, signer, address };
}

const subtrackr = new SubTrackr({
  apiKey: process.env.SUBTRACKR_KEY,
  environment: 'sandbox',
  walletProvider: window.ethereum
});`,
            language: 'typescript',
          },
          {
            id: 'create-subscription',
            title: 'Create On-Chain Subscription',
            description: 'Create a subscription using blockchain payment',
            code: `async function createSubscription(planId: string) {
  const { signer, address } = await connectWallet();
  
  // Get plan details
  const plan = await subtrackr.plans.get(planId);
  
  // Create subscription with wallet
  const subscription = await subtrackr.subscriptions.create({
    planId,
    walletAddress: address,
    paymentMethod: 'blockchain',
    network: 'ethereum'
  });

  // Sign the transaction
  const tx = await signer.sendTransaction({
    to: subscription.paymentAddress,
    value: ethers.utils.parseEther(subscription.amount.toString()),
    data: subscription.paymentData
  });

  // Confirm payment
  await subtrackr.payments.confirm(subscription.id, tx.hash);
  
  return subscription;
}`,
            language: 'typescript',
            notes: [
              'Always check wallet balance before creating subscriptions',
              'Handle transaction failures gracefully',
              'Consider implementing retry logic for failed transactions',
            ],
          },
        ],
      },
    ];
  }

  async getGuides(): Promise<IntegrationGuide[]> {
    return this.guides;
  }

  async getGuide(guideId: string): Promise<IntegrationGuide | null> {
    return this.guides.find((g) => g.id === guideId) || null;
  }

  async getGuidesByDifficulty(
    difficulty: IntegrationGuide['difficulty']
  ): Promise<IntegrationGuide[]> {
    return this.guides.filter((g) => g.difficulty === difficulty);
  }

  async searchGuides(query: string): Promise<IntegrationGuide[]> {
    const lowerQuery = query.toLowerCase();
    return this.guides.filter(
      (guide) =>
        guide.title.toLowerCase().includes(lowerQuery) ||
        guide.description.toLowerCase().includes(lowerQuery)
    );
  }
}
