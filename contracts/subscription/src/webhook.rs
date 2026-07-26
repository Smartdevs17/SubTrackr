use soroban_sdk::{Address, Env, String, Vec};
use subtrackr_types::{
    StorageKey, Subscription, SubscriptionStatus, WebhookConfig, WebhookDelivery,
    WebhookDeliveryStatus, WebhookEventType, WebhookRetryPolicy,
};

use crate::{
    events::build_payload, storage_instance_get, storage_instance_set, storage_persistent_get,
    storage_persistent_remove, storage_persistent_set,
};

fn webhook_ids_for_merchant(env: &Env, storage: &Address, merchant: &Address) -> Vec<u64> {
    storage_persistent_get(env, storage, StorageKey::MerchantWebhooks(merchant.clone()))
        .unwrap_or(Vec::new(env))
}

fn set_webhook_ids_for_merchant(env: &Env, storage: &Address, merchant: &Address, ids: Vec<u64>) {
    storage_persistent_set(env, storage, StorageKey::MerchantWebhooks(merchant.clone()), ids);
}

fn deliveries_for_webhook(env: &Env, storage: &Address, webhook_id: u64) -> Vec<u64> {
    storage_persistent_get(env, storage, StorageKey::WebhookDeliveriesByWebhook(webhook_id))
        .unwrap_or(Vec::new(env))
}

fn set_deliveries_for_webhook(env: &Env, storage: &Address, webhook_id: u64, ids: Vec<u64>) {
    storage_persistent_set(
        env,
        storage,
        StorageKey::WebhookDeliveriesByWebhook(webhook_id),
        ids,
    );
}

fn webhook_supports_event(config: &WebhookConfig, event_type: &WebhookEventType) -> bool {
    if config.is_paused {
        return false;
    }
    for configured in config.events.iter() {
        if configured == *event_type {
            return true;
        }
    }
    false
}

fn next_webhook_id(env: &Env, storage: &Address) -> u64 {
    let mut count: u64 = storage_instance_get(env, storage, StorageKey::WebhookCount).unwrap_or(0);
    count += 1;
    storage_instance_set(env, storage, StorageKey::WebhookCount, count);
    count
}

fn next_delivery_id(env: &Env, storage: &Address) -> u64 {
    let mut count: u64 =
        storage_instance_get(env, storage, StorageKey::WebhookDeliveryCount).unwrap_or(0);
    count += 1;
    storage_instance_set(env, storage, StorageKey::WebhookDeliveryCount, count);
    count
}

fn compute_delay(policy: &WebhookRetryPolicy, attempt: u32) -> u64 {
    let mut delay = policy.initial_delay_secs;
    let mut i = 1u32;
    while i < attempt {
        delay = delay.saturating_mul(policy.backoff_factor as u64);
        i += 1;
    }
    if delay > policy.max_delay_secs {
        policy.max_delay_secs
    } else {
        delay
    }
}

pub(crate) fn emit_subscription_event(
    env: &Env,
    storage: &Address,
    merchant: &Address,
    event_type: WebhookEventType,
    subscription: &Subscription,
    plan: &subtrackr_types::Plan,
    previous_status: SubscriptionStatus,
) {
    let webhook_ids = webhook_ids_for_merchant(env, storage, merchant);
    let mut i = 0u32;
    while i < webhook_ids.len() {
        let webhook_id = webhook_ids.get_unchecked(i);
        if let Some(config) = storage_persistent_get::<WebhookConfig>(
            env,
            storage,
            StorageKey::Webhook(webhook_id),
        ) {
            if !webhook_supports_event(&config, &event_type) {
                i += 1;
                continue;
            }

            let delivery_id = next_delivery_id(env, storage);
            let payload = build_payload(
                env,
                webhook_id,
                event_type.clone(),
                merchant,
                subscription,
                plan,
                previous_status.clone(),
            );
            let delivery = WebhookDelivery {
                id: delivery_id,
                webhook_id,
                event_id: payload.id,
                event_type,
                payload,
                status: if config.is_paused {
                    WebhookDeliveryStatus::Paused
                } else {
                    WebhookDeliveryStatus::Pending
                },
                attempts: 0,
                max_attempts: config.retry_policy.max_retries,
                next_retry_at: 0,
                last_attempt_at: 0,
                delivered_at: 0,
                response_code: 0,
                error_message: String::from_str(env, ""),
                signature: String::from_str(env, ""),
                created_at: env.ledger().timestamp(),
                updated_at: env.ledger().timestamp(),
            };
            storage_persistent_set(env, storage, StorageKey::WebhookDelivery(delivery_id), delivery);

            let mut deliveries = deliveries_for_webhook(env, storage, webhook_id);
            deliveries.push_back(delivery_id);
            set_deliveries_for_webhook(env, storage, webhook_id, deliveries);
        }
        i += 1;
    }
}

#[soroban_sdk::contractimpl]
impl super::SubTrackrSubscription {
    pub fn register_webhook(
        env: Env,
        proxy: Address,
        storage: Address,
        mut config: WebhookConfig,
    ) -> u64 {
        proxy.require_auth();
        config.merchant.require_auth();

        let id = next_webhook_id(&env, &storage);
        config.id = id;
        config.created_at = env.ledger().timestamp();
        config.updated_at = config.created_at;
        config.health_check_at = 0;
        config.healthy = true;
        config.success_count = 0;
        config.failure_count = 0;

        storage_persistent_set(&env, &storage, StorageKey::Webhook(id), config.clone());

        let mut ids = webhook_ids_for_merchant(&env, &storage, &config.merchant);
        ids.push_back(id);
        set_webhook_ids_for_merchant(&env, &storage, &config.merchant, ids);
        id
    }

    pub fn update_webhook(
        env: Env,
        proxy: Address,
        storage: Address,
        id: u64,
        mut config: WebhookConfig,
    ) {
        proxy.require_auth();
        config.merchant.require_auth();

        let current: WebhookConfig =
            storage_persistent_get(&env, &storage, StorageKey::Webhook(id))
                .expect("Webhook not found");

        assert!(current.merchant == config.merchant, "Webhook merchant mismatch");
        config.id = id;
        config.created_at = current.created_at;
        config.updated_at = env.ledger().timestamp();
        config.success_count = current.success_count;
        config.failure_count = current.failure_count;
        config.health_check_at = current.health_check_at;
        config.healthy = current.healthy;

        storage_persistent_set(&env, &storage, StorageKey::Webhook(id), config);
    }

    pub fn delete_webhook(env: Env, proxy: Address, storage: Address, id: u64) {
        proxy.require_auth();
        let config: WebhookConfig = storage_persistent_get(&env, &storage, StorageKey::Webhook(id))
            .expect("Webhook not found");
        config.merchant.require_auth();

        let ids = webhook_ids_for_merchant(&env, &storage, &config.merchant);
        let mut next_ids = Vec::new(&env);
        for existing in ids.iter() {
            if existing != id {
                next_ids.push_back(existing);
            }
        }
        set_webhook_ids_for_merchant(&env, &storage, &config.merchant, next_ids);
        storage_persistent_remove(
            &env,
            &storage,
            StorageKey::WebhookDeliveriesByWebhook(id),
        );
        storage_persistent_remove(&env, &storage, StorageKey::Webhook(id));
    }

    pub fn pause_webhook(env: Env, proxy: Address, storage: Address, id: u64) {
        proxy.require_auth();
        let mut config: WebhookConfig =
            storage_persistent_get(&env, &storage, StorageKey::Webhook(id))
                .expect("Webhook not found");
        config.merchant.require_auth();
        config.is_paused = true;
        config.updated_at = env.ledger().timestamp();
        storage_persistent_set(&env, &storage, StorageKey::Webhook(id), config);
    }

    pub fn resume_webhook(env: Env, proxy: Address, storage: Address, id: u64) {
        proxy.require_auth();
        let mut config: WebhookConfig =
            storage_persistent_get(&env, &storage, StorageKey::Webhook(id))
                .expect("Webhook not found");
        config.merchant.require_auth();
        config.is_paused = false;
        config.updated_at = env.ledger().timestamp();
        storage_persistent_set(&env, &storage, StorageKey::Webhook(id), config);
    }

    pub fn list_webhooks(env: Env, proxy: Address, storage: Address, merchant: Address) -> Vec<WebhookConfig> {
        proxy.require_auth();
        let ids = webhook_ids_for_merchant(&env, &storage, &merchant);
        let mut items = Vec::new(&env);
        for webhook_id in ids.iter() {
            if let Some(config) =
                storage_persistent_get::<WebhookConfig>(&env, &storage, StorageKey::Webhook(webhook_id))
            {
                items.push_back(config);
            }
        }
        items
    }

    pub fn get_webhook_deliveries(
        env: Env,
        proxy: Address,
        storage: Address,
        webhook_id: u64,
        limit: u32,
    ) -> Vec<WebhookDelivery> {
        proxy.require_auth();
        let ids = deliveries_for_webhook(&env, &storage, webhook_id);
        let mut items = Vec::new(&env);
        let mut i = 0u32;
        while i < ids.len() && i < limit {
            let delivery_id = ids.get_unchecked(i);
            if let Some(delivery) = storage_persistent_get::<WebhookDelivery>(
                &env,
                &storage,
                StorageKey::WebhookDelivery(delivery_id),
            ) {
                items.push_back(delivery);
            }
            i += 1;
        }
        items
    }

    pub fn retry_webhook_delivery(env: Env, proxy: Address, storage: Address, delivery_id: u64) {
        proxy.require_auth();
        let mut delivery: WebhookDelivery =
            storage_persistent_get(&env, &storage, StorageKey::WebhookDelivery(delivery_id))
                .expect("Webhook delivery not found");

        let config: WebhookConfig = storage_persistent_get(
            &env,
            &storage,
            StorageKey::Webhook(delivery.webhook_id),
        )
        .expect("Webhook not found");
        config.merchant.require_auth();

        if delivery.attempts > config.retry_policy.max_retries {
            delivery.status = WebhookDeliveryStatus::Failed;
        } else {
            delivery.attempts += 1;
            delivery.status = WebhookDeliveryStatus::Retrying;
            delivery.last_attempt_at = env.ledger().timestamp();
            delivery.next_retry_at = env.ledger().timestamp()
                + compute_delay(&config.retry_policy, delivery.attempts);
        }
        delivery.updated_at = env.ledger().timestamp();
        storage_persistent_set(&env, &storage, StorageKey::WebhookDelivery(delivery_id), delivery);
    }

    pub fn get_webhook_health(
        env: Env,
        proxy: Address,
        storage: Address,
        webhook_id: u64,
    ) -> WebhookConfig {
        proxy.require_auth();
        let mut config: WebhookConfig =
            storage_persistent_get(&env, &storage, StorageKey::Webhook(webhook_id))
                .expect("Webhook not found");
        config.merchant.require_auth();

        let deliveries = deliveries_for_webhook(&env, &storage, webhook_id);
        let mut failures = 0u64;
        let mut successes = 0u64;
        for delivery_id in deliveries.iter() {
            if let Some(delivery) = storage_persistent_get::<WebhookDelivery>(
                &env,
                &storage,
                StorageKey::WebhookDelivery(delivery_id),
            ) {
                match delivery.status {
                    WebhookDeliveryStatus::Delivered => successes += 1,
                    WebhookDeliveryStatus::Failed => failures += 1,
                    _ => {}
                }
            }
        }

        config.healthy = failures <= successes;
        config.health_check_at = env.ledger().timestamp();
        config.updated_at = config.health_check_at;
        storage_persistent_set(&env, &storage, StorageKey::Webhook(webhook_id), config.clone());
        config
    }
}
