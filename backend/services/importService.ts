/**
 * Lightweight import helpers for server-side import from external platforms
 * Exposes functions to fetch subscriptions from Stripe and Chargebee and
 * normalize them to the internal SubscriptionInput shape.
 */
import https from 'https';

export interface SubscriptionInput {
  id?: string;
  name: string;
  description?: string;
  category: string;
  price: number;
  currency: string;
  billingCycle: string;
  nextBillingDate: string;
}

function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

export async function fetchStripeSubscriptions(stripeApiKey: string): Promise<SubscriptionInput[]> {
  if (!stripeApiKey) throw new Error('Missing Stripe API key');

  // Stripe list subscriptions endpoint (simple, may need pagination in real use)
  const url = 'https://api.stripe.com/v1/subscriptions?limit=100';
  const auth = 'Basic ' + Buffer.from(`${stripeApiKey}:`).toString('base64');

  const data = await fetchJson(url, { Authorization: auth });

  const items = data.data || [];

  return items.map((s: any) => ({
    id: s.id,
    name: s.plan?.nickname || s.plan?.product || s.id,
    description: s.description || '',
    category: 'imported',
    price: (s.plan?.amount || 0) / 100,
    currency: (s.plan?.currency || 'USD').toUpperCase(),
    billingCycle: s.plan?.interval || 'monthly',
    nextBillingDate: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : new Date().toISOString(),
  }));
}

export async function fetchChargebeeSubscriptions(site: string, apiKey: string): Promise<SubscriptionInput[]> {
  if (!site || !apiKey) throw new Error('Missing Chargebee site or API key');

  const url = `https://${site}.chargebee.com/api/v2/subscriptions`;
  const auth = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');

  const data = await fetchJson(url + '?limit=100', { Authorization: auth });

  const list = data.list || [];

  return list.map((entry: any) => {
    const s = entry.subscription || entry;
    return {
      id: s.id,
      name: s.plan_id || s.id,
      description: s.plan_description || '',
      category: 'imported',
      price: Number(s.amount || 0) / 100,
      currency: (s.currency_code || 'USD').toUpperCase(),
      billingCycle: s.billing_period_unit || 'monthly',
      nextBillingDate: s.next_billing_at ? new Date(s.next_billing_at * 1000).toISOString() : new Date().toISOString(),
    };
  });
}

export default {
  fetchStripeSubscriptions,
  fetchChargebeeSubscriptions,
};
