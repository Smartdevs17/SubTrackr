/// ContractHandler — ghost-state wrapper around SubTrackrContractClient.
///
/// Every mutating helper mirrors the on-chain operation and keeps a parallel
/// "ghost" model that the invariant checker can compare against the real
/// contract state without re-reading every storage slot.
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};
use subtrackr::{Interval, SubTrackrContract, SubTrackrContractClient, SubscriptionStatus};

// ── Minimal mock token ────────────────────────────────────────────────────────
// We use the real Stellar asset contract so token::Client::transfer works.
// Each plan gets its own token; each subscriber is minted enough to cover
// many charges.

const MINT_AMOUNT: i128 = 1_000_000_000; // 1 billion stroops — plenty for tests

// ── Ghost model ──────────────────────────────────────────────────────────────

/// Lightweight shadow of on-chain state used for invariant assertions.
#[derive(Debug, Default)]
pub struct GhostState {
    /// Number of plans ever created (monotonically increasing).
    pub plan_count: u64,
    /// Number of subscriptions ever created (monotonically increasing).
    pub subscription_count: u64,
    /// Sum of all successful charges minus approved refunds.
    pub total_collected: i128,
    /// Per-subscription total_paid mirror: sub_id → amount paid.
    pub sub_total_paid: std::collections::HashMap<u64, i128>,
    /// Per-plan subscriber_count mirror: plan_id → active subscriber count.
    pub plan_subscriber_count: std::collections::HashMap<u64, u32>,
    /// Per-plan price mirror: plan_id → price.
    pub plan_price: std::collections::HashMap<u64, i128>,
    /// Per-subscription status mirror.
    pub sub_status: std::collections::HashMap<u64, SubscriptionStatus>,
    /// Per-subscription plan_id mirror.
    pub sub_plan_id: std::collections::HashMap<u64, u64>,
}

// ── ContractHandler ───────────────────────────────────────────────────────────

pub struct ContractHandler<'a> {
    pub env: Env,
    pub client: SubTrackrContractClient<'a>,
    pub admin: Address,
    pub merchant: Address,
    /// Pool of subscriber addresses created during the test run.
    pub subscribers: Vec<Address>,
    pub ghost: GhostState,
}

impl<'a> ContractHandler<'a> {
    /// Bootstrap a fresh contract with admin + one default merchant.
    /// The ledger timestamp is set to a non-zero base so time arithmetic works.
    pub fn new(env: &Env) -> Self {
        env.ledger().set_timestamp(1_700_000_000);

        let contract_id = env.register_contract(None, SubTrackrContract);
        let client = SubTrackrContractClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let merchant = Address::generate(env);

        env.mock_all_auths();
        client.initialize(&admin);

        ContractHandler {
            env: env.clone(),
            client,
            admin,
            merchant,
            subscribers: Vec::new(),
            ghost: GhostState::default(),
        }
    }

    // ── Internal: create a real Stellar asset token and mint to an address ────

    fn make_token(&self, mint_to: &Address) -> Address {
        let token_admin = Address::generate(&self.env);
        let token_id = self
            .env
            .register_stellar_asset_contract_v2(token_admin.clone());
        let asset_client = token::StellarAssetClient::new(&self.env, &token_id.address());
        asset_client.mint(mint_to, &MINT_AMOUNT);
        token_id.address()
    }

    // ── Plan helpers ──────────────────────────────────────────────────────────

    /// Create a plan with the given price (monthly interval, real token).
    pub fn create_plan(&mut self, price: i128) -> u64 {
        self.create_plan_with_interval(price, Interval::Monthly)
    }

    /// Create a plan with a specific interval.
    pub fn create_plan_with_interval(&mut self, price: i128, interval: Interval) -> u64 {
        // Mint to merchant so they can receive payments (token transfer goes
        // subscriber → merchant; merchant doesn't need a balance to receive,
        // but we mint anyway to keep the token account alive).
        let token = self.make_token(&self.merchant.clone());
        let name = String::from_str(&self.env, "Plan");
        let plan_id =
            self.client
                .create_plan(&self.merchant, &name, &price, &token, &interval);
        self.ghost.plan_count += 1;
        self.ghost.plan_price.insert(plan_id, price);
        self.ghost.plan_subscriber_count.insert(plan_id, 0);
        plan_id
    }

    /// Deactivate a plan (merchant only).
    pub fn deactivate_plan(&mut self, plan_id: u64) {
        self.client.deactivate_plan(&self.merchant, &plan_id);
    }

    // ── Subscription helpers ──────────────────────────────────────────────────

    /// Subscribe a fresh address to `plan_id`. Returns the new subscription id.
    /// The subscriber is minted enough tokens to cover many charges.
    pub fn subscribe(&mut self, plan_id: u64) -> u64 {
        let subscriber = Address::generate(&self.env);
        // Mint tokens for this subscriber on the plan's token contract
        let plan = self.client.get_plan(&plan_id);
        let asset_client = token::StellarAssetClient::new(&self.env, &plan.token);
        asset_client.mint(&subscriber, &MINT_AMOUNT);

        self.subscribers.push(subscriber.clone());
        let sub_id = self.client.subscribe(&subscriber, &plan_id);
        self.ghost.subscription_count += 1;
        self.ghost.sub_total_paid.insert(sub_id, 0);
        self.ghost
            .sub_status
            .insert(sub_id, SubscriptionStatus::Active);
        self.ghost.sub_plan_id.insert(sub_id, plan_id);
        *self
            .ghost
            .plan_subscriber_count
            .entry(plan_id)
            .or_insert(0) += 1;
        sub_id
    }

    /// Cancel a subscription by its subscriber (index into `self.subscribers`).
    pub fn cancel(&mut self, sub_id: u64, subscriber_idx: usize) {
        let subscriber = self.subscribers[subscriber_idx].clone();
        self.client.cancel_subscription(&subscriber, &sub_id);
        let plan_id = *self.ghost.sub_plan_id.get(&sub_id).unwrap();
        self.ghost
            .sub_status
            .insert(sub_id, SubscriptionStatus::Cancelled);
        let cnt = self
            .ghost
            .plan_subscriber_count
            .entry(plan_id)
            .or_insert(0);
        if *cnt > 0 {
            *cnt -= 1;
        }
    }

    /// Pause a subscription.
    pub fn pause(&mut self, sub_id: u64, subscriber_idx: usize) {
        let subscriber = self.subscribers[subscriber_idx].clone();
        self.client.pause_subscription(&subscriber, &sub_id);
        self.ghost
            .sub_status
            .insert(sub_id, SubscriptionStatus::Paused);
    }

    /// Resume a paused subscription.
    pub fn resume(&mut self, sub_id: u64, subscriber_idx: usize) {
        let subscriber = self.subscribers[subscriber_idx].clone();
        self.client.resume_subscription(&subscriber, &sub_id);
        self.ghost
            .sub_status
            .insert(sub_id, SubscriptionStatus::Active);
    }

    /// Advance ledger time by `seconds` and charge a subscription.
    /// Returns `true` if the charge succeeded, `false` if skipped
    /// (not yet due, not active).
    pub fn advance_and_charge(&mut self, sub_id: u64, advance_secs: u64) -> bool {
        self.env.ledger().with_mut(|li| {
            li.timestamp += advance_secs;
        });
        let sub_before = self.client.get_subscription(&sub_id);
        if sub_before.status != SubscriptionStatus::Active {
            return false;
        }
        let now = self.env.ledger().timestamp();
        if now < sub_before.next_charge_at {
            return false;
        }
        self.client.charge_subscription(&sub_id);
        let plan_price = *self
            .ghost
            .plan_price
            .get(&sub_before.plan_id)
            .unwrap_or(&0);
        *self.ghost.sub_total_paid.entry(sub_id).or_insert(0) += plan_price;
        self.ghost.total_collected += plan_price;
        true
    }

    /// Convenience: advance one full monthly interval and charge.
    pub fn charge(&mut self, sub_id: u64) -> bool {
        self.advance_and_charge(sub_id, Interval::Monthly.seconds() + 1)
    }

    // ── Refund helpers ────────────────────────────────────────────────────────

    pub fn request_refund(&mut self, sub_id: u64, amount: i128) {
        self.client.request_refund(&sub_id, &amount);
    }

    pub fn approve_refund(&mut self, sub_id: u64) {
        let sub = self.client.get_subscription(&sub_id);
        let amount = sub.refund_requested_amount;
        self.client.approve_refund(&sub_id);
        *self.ghost.sub_total_paid.entry(sub_id).or_insert(0) -= amount;
        self.ghost.total_collected -= amount;
    }

    pub fn reject_refund(&mut self, sub_id: u64) {
        self.client.reject_refund(&sub_id);
    }

    // ── Transfer helpers ──────────────────────────────────────────────────────

    pub fn request_transfer(&mut self, sub_id: u64, _subscriber_idx: usize, recipient: Address) {
        self.client.request_transfer(&sub_id, &recipient);
    }

    pub fn accept_transfer(&mut self, sub_id: u64, recipient: Address) {
        self.client.accept_transfer(&sub_id, &recipient);
    }

    // ── Time helpers ──────────────────────────────────────────────────────────

    pub fn advance_time(&mut self, secs: u64) {
        self.env.ledger().with_mut(|li| {
            li.timestamp += secs;
        });
    }

    pub fn current_timestamp(&self) -> u64 {
        self.env.ledger().timestamp()
    }
}
