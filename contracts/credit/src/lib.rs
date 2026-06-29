#![no_std]
//! SubTrackr account credit contract.
//!
//! Subscribers accrue credit from refunds, promotions or overpayments. Credit
//! is held in lots (each optionally expiring) so it can be applied to future
//! charges, transferred between accounts, and expired deterministically.
//!
//! Credit notes are formal documents stored off-chain; this contract manages
//! the on-chain prepayment wallet and credit-lot mechanics, and provides an
//! expiry checker suitable for cron-driven keeper jobs.
//!
//! Required behaviour (issue: credit system):
//! * `AccountCredit { balance, transactions[], expiration_policy }`
//! * manual and automatic issuance
//! * automatic application on charging via [`SubTrackrCredit::apply_credit`]
//! * transfer between accounts
//! * expiration handling and a full transaction history
//! * prepayment wallet with deposit/withdraw/drawdown
//!
//! Balances can never go negative: application/transfer only ever move credit
//! that is actually available and unexpired.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String, Vec,
};
use subtrackr_types::SubscriptionId;

/// Maximum retained transaction-history and lot entries per account.
const MAX_HISTORY: u32 = 128;

#[contracterror]
#[derive(Clone, Debug, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum CreditError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    InsufficientCredit = 5,
    SelfTransfer = 6,
    WalletNotFound = 7,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CreditTxKind {
    Issue,
    Apply,
    TransferIn,
    TransferOut,
    Expire,
    Deposit,
    Withdraw,
}

/// Default expiration applied to newly issued credit when no explicit expiry
/// is supplied.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExpirationPolicy {
    Never,
    AfterSecs(u64),
}

/// A single issuance "lot" of credit with its own optional expiry. Application
/// and transfer consume lots oldest-first.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CreditLot {
    pub id: u64,
    pub remaining: i128,
    pub issued_at: u64,
    pub expires_at: Option<u64>,
}

/// An immutable ledger entry recording a change to an account's credit.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CreditTransaction {
    pub id: u64,
    pub kind: CreditTxKind,
    /// Signed: positive for inflow (issue/transfer-in), negative for outflow.
    pub amount: i128,
    pub timestamp: u64,
    pub reason: String,
    pub counterparty: Option<Address>,
}

/// A subscriber's complete credit account.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AccountCredit {
    pub subscriber: Address,
    pub balance: i128,
    pub lots: Vec<CreditLot>,
    pub transactions: Vec<CreditTransaction>,
    pub expiration_policy: ExpirationPolicy,
}

/// Result of applying credit to a charge.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CreditApplied {
    pub subscription_id: SubscriptionId,
    pub applied: i128,
    pub remaining_due: i128,
    pub balance_after: i128,
}

/// A prepayment wallet tied to a subscription for pre-funded draws.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PrepaymentWallet {
    pub id: u64,
    pub subscriber: Address,
    pub subscription_id: SubscriptionId,
    pub currency: String,
    pub balance: i128,
    pub total_deposited: i128,
    pub total_withdrawn: i128,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Prepayment summary returned after a deposit or withdrawal.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PrepaymentSnapshot {
    pub wallet_id: u64,
    pub balance: i128,
    pub transaction_id: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    NextId,
    Account(Address),
    Wallet(u64),
    Counter(u64),
}

#[contract]
pub struct SubTrackrCredit;

#[contractimpl]
impl SubTrackrCredit {
    /// One-time initialization recording the admin allowed to issue credit.
    pub fn initialize(env: Env, admin: Address) -> Result<(), CreditError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(CreditError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextId, &0u64);
        Ok(())
    }

    /// Sets the default expiration policy applied to future issuance for an
    /// account. Admin only.
    pub fn set_expiration_policy(
        env: Env,
        subscriber: Address,
        policy: ExpirationPolicy,
    ) -> Result<(), CreditError> {
        Self::require_admin(&env)?.require_auth();
        let mut account = Self::account(&env, &subscriber);
        account.expiration_policy = policy;
        Self::save(&env, &account);
        Ok(())
    }

    /// Issues credit to a subscriber. Used for both manual grants and automatic
    /// refunds/promotions (the admin/system account authorizes). When
    /// `expires_at` is `None` the account's expiration policy decides the expiry.
    pub fn issue_credit(
        env: Env,
        subscriber: Address,
        amount: i128,
        reason: String,
        expires_at: Option<u64>,
    ) -> Result<i128, CreditError> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        if amount <= 0 {
            return Err(CreditError::InvalidAmount);
        }
        let now = env.ledger().timestamp();
        let mut account = Self::account(&env, &subscriber);
        Self::realize_expiry(&env, now, &mut account);

        let expiry = expires_at.or_else(|| match account.expiration_policy {
            ExpirationPolicy::Never => None,
            ExpirationPolicy::AfterSecs(s) => Some(now + s),
        });
        let lot = CreditLot {
            id: Self::next_id(&env),
            remaining: amount,
            issued_at: now,
            expires_at: expiry,
        };
        account.lots.push_back(lot);
        account.balance += amount;
        Self::record(
            &env,
            &mut account,
            CreditTxKind::Issue,
            amount,
            reason,
            None,
        );
        Self::save(&env, &account);
        env.events()
            .publish((symbol_short!("issue"), subscriber), amount);
        Ok(account.balance)
    }

    /// Applies available credit toward a charge, consuming oldest lots first.
    /// Never applies more than the amount due or the available balance.
    pub fn apply_credit(
        env: Env,
        subscriber: Address,
        subscription_id: SubscriptionId,
        amount_due: i128,
    ) -> Result<CreditApplied, CreditError> {
        if amount_due < 0 {
            return Err(CreditError::InvalidAmount);
        }
        let now = env.ledger().timestamp();
        let mut account = Self::account(&env, &subscriber);
        Self::realize_expiry(&env, now, &mut account);

        let applied = Self::consume(now, &mut account, amount_due);
        if applied > 0 {
            account.balance -= applied;
            let reason = String::from_str(&env, "charge_application");
            Self::record(
                &env,
                &mut account,
                CreditTxKind::Apply,
                -applied,
                reason,
                None,
            );
        }
        Self::save(&env, &account);

        Ok(CreditApplied {
            subscription_id,
            applied,
            remaining_due: amount_due - applied,
            balance_after: account.balance,
        })
    }

    /// Transfers available credit from one account to another. The sender must
    /// authorize and have sufficient unexpired balance.
    pub fn transfer_credit(
        env: Env,
        from: Address,
        to: Address,
        amount: i128,
        reason: String,
    ) -> Result<(), CreditError> {
        from.require_auth();
        if amount <= 0 {
            return Err(CreditError::InvalidAmount);
        }
        if from == to {
            return Err(CreditError::SelfTransfer);
        }
        let now = env.ledger().timestamp();
        let mut sender = Self::account(&env, &from);
        Self::realize_expiry(&env, now, &mut sender);
        if Self::available(now, &sender) < amount {
            return Err(CreditError::InsufficientCredit);
        }
        let moved = Self::consume(now, &mut sender, amount);
        sender.balance -= moved;
        Self::record(
            &env,
            &mut sender,
            CreditTxKind::TransferOut,
            -moved,
            reason.clone(),
            Some(to.clone()),
        );
        Self::save(&env, &sender);

        let mut recipient = Self::account(&env, &to);
        Self::realize_expiry(&env, now, &mut recipient);
        recipient.lots.push_back(CreditLot {
            id: Self::next_id(&env),
            remaining: moved,
            issued_at: now,
            expires_at: match recipient.expiration_policy {
                ExpirationPolicy::Never => None,
                ExpirationPolicy::AfterSecs(s) => Some(now + s),
            },
        });
        recipient.balance += moved;
        Self::record(
            &env,
            &mut recipient,
            CreditTxKind::TransferIn,
            moved,
            reason,
            Some(from),
        );
        Self::save(&env, &recipient);
        Ok(())
    }

    /// Returns the available (unexpired) credit balance. Read-only: expired lots
    /// are excluded from the figure but not yet written back.
    pub fn get_credit_balance(env: Env, subscriber: Address) -> i128 {
        let now = env.ledger().timestamp();
        let account = Self::account(&env, &subscriber);
        Self::available(now, &account)
    }

    /// Realizes expiry for an account, writing back zeroed lots and recording an
    /// `Expire` transaction. Anyone may trigger it (e.g. a keeper job).
    pub fn expire_credits(env: Env, subscriber: Address) -> i128 {
        let now = env.ledger().timestamp();
        let mut account = Self::account(&env, &subscriber);
        let before = account.balance;
        Self::realize_expiry(&env, now, &mut account);
        Self::save(&env, &account);
        before - account.balance
    }

    /// Returns the full account record.
    pub fn get_credit_account(env: Env, subscriber: Address) -> AccountCredit {
        Self::account(&env, &subscriber)
    }

    /// Returns the account's transaction history.
    pub fn get_transactions(env: Env, subscriber: Address) -> Vec<CreditTransaction> {
        Self::account(&env, &subscriber).transactions
    }

    /// Creates a new prepayment wallet for the given subscription.
    pub fn create_wallet(
        env: Env,
        subscriber: Address,
        subscription_id: SubscriptionId,
        currency: String,
    ) -> u64 {
        let admin = Self::require_admin(&env).expect("admin required");
        admin.require_auth();
        let wallet_id = Self::next_wallet_id(&env);
        let now = env.ledger().timestamp();
        let wallet = PrepaymentWallet {
            id: wallet_id,
            subscriber: subscriber.clone(),
            subscription_id,
            currency,
            balance: 0,
            total_deposited: 0,
            total_withdrawn: 0,
            created_at: now,
            updated_at: now,
        };
        env.storage().persistent().set(&DataKey::Wallet(wallet_id), &wallet);
        env.events()
            .publish((symbol_short!("wallet"), subscriber), wallet_id);
        wallet_id
    }

    /// Deposits funds into a prepayment wallet by ID.
    pub fn deposit(
        env: Env,
        caller: Address,
        wallet_id: u64,
        amount: i128,
    ) -> Result<PrepaymentSnapshot, CreditError> {
        caller.require_auth();
        if amount <= 0 {
            return Err(CreditError::InvalidAmount);
        }
        let mut wallet: PrepaymentWallet = env
            .storage()
            .persistent()
            .get(&DataKey::Wallet(wallet_id))
            .ok_or(CreditError::WalletNotFound)?;
        if wallet.subscriber != caller {
            return Err(CreditError::Unauthorized);
        }
        let now = env.ledger().timestamp();
        wallet.balance += amount;
        wallet.total_deposited += amount;
        wallet.updated_at = now;
        env.storage().persistent().set(&DataKey::Wallet(wallet_id), &wallet);
        Ok(PrepaymentSnapshot {
            wallet_id,
            balance: wallet.balance,
            transaction_id: Self::next_tx_id(&env, wallet_id),
        })
    }

    /// Withdraws funds from a prepayment wallet by ID.
    pub fn withdraw(
        env: Env,
        caller: Address,
        wallet_id: u64,
        amount: i128,
    ) -> Result<PrepaymentSnapshot, CreditError> {
        caller.require_auth();
        if amount <= 0 {
            return Err(CreditError::InvalidAmount);
        }
        let mut wallet: PrepaymentWallet = env
            .storage()
            .persistent()
            .get(&DataKey::Wallet(wallet_id))
            .ok_or(CreditError::WalletNotFound)?;
        if wallet.subscriber != caller {
            return Err(CreditError::Unauthorized);
        }
        if wallet.balance < amount {
            return Err(CreditError::InsufficientCredit);
        }
        let now = env.ledger().timestamp();
        wallet.balance -= amount;
        wallet.total_withdrawn += amount;
        wallet.updated_at = now;
        env.storage().persistent().set(&DataKey::Wallet(wallet_id), &wallet);
        Ok(PrepaymentSnapshot {
            wallet_id,
            balance: wallet.balance,
            transaction_id: Self::next_tx_id(&env, wallet_id),
        })
    }

    /// Returns the current balance of a prepayment wallet.
    pub fn get_wallet_balance(env: Env, _caller: Address, wallet_id: u64) -> i128 {
        env.storage()
            .persistent()
            .get::<_, PrepaymentWallet>(&DataKey::Wallet(wallet_id))
            .map(|w| w.balance)
            .unwrap_or(0)
    }

    /// Batch expiry processor for cron keepers. Iterates all stored wallets,
    /// applies credit lot expiry, and returns total expired amounts. Caller
    /// must be admin.
    pub fn expire_credits_with_cron(env: Env, admin: Address) -> Vec<(Address, i128)> {
        admin.require_auth();
        let now = env.ledger().timestamp();
        let mut results: Vec<(Address, i128)> = Vec::new(&env);
        let mut i: u32 = 0;
        while i < MAX_HISTORY {
            let key = DataKey::Counter(i);
            if !env.storage().persistent().has(&key) {
                break;
            }
            let subscriber: Address = env.storage().persistent().get(&key).unwrap();
            let mut account = Self::account(&env, &subscriber);
            let before = account.balance;
            Self::realize_expiry(&env, now, &mut account);
            let expired = before - account.balance;
            if expired > 0 {
                Self::save(&env, &account);
                results.push_back((subscriber, expired));
            }
            i += 1;
        }
        results
    }

    // ---- internals --------------------------------------------------------

    fn require_admin(env: &Env) -> Result<Address, CreditError> {
        env.storage()
            .instance()
            .get::<_, Address>(&DataKey::Admin)
            .ok_or(CreditError::NotInitialized)
    }

    fn account(env: &Env, subscriber: &Address) -> AccountCredit {
        env.storage()
            .persistent()
            .get(&DataKey::Account(subscriber.clone()))
            .unwrap_or_else(|| AccountCredit {
                subscriber: subscriber.clone(),
                balance: 0,
                lots: Vec::new(env),
                transactions: Vec::new(env),
                expiration_policy: ExpirationPolicy::Never,
            })
    }

    fn save(env: &Env, account: &AccountCredit) {
        env.storage()
            .persistent()
            .set(&DataKey::Account(account.subscriber.clone()), account);
    }

    fn next_id(env: &Env) -> u64 {
        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));
        id
    }

    fn next_wallet_id(env: &Env) -> u64 {
        let id: u64 = env.storage().instance().get(&DataKey::Admin).map(|_| id).unwrap_or(0);
        let base: u64 = env.storage().instance().get(&symbol_short!("NWID")).unwrap_or(0);
        env.storage()
            .instance()
            .set(&symbol_short!("NWID"), &(base + 1));
        base
    }

    fn next_tx_id(env: &Env, _wallet_id: u64) -> u64 {
        let base: u64 = env
            .storage()
            .instance()
            .get(&symbol_short!("NWID"))
            .unwrap_or(0);
        base
    }

    /// Sum of unexpired lot balances.
    fn available(now: u64, account: &AccountCredit) -> i128 {
        let mut total: i128 = 0;
        let mut i = 0u32;
        while i < account.lots.len() {
            let lot = account.lots.get(i).unwrap();
            if lot.remaining > 0 && !Self::is_expired(now, &lot) {
                total += lot.remaining;
            }
            i += 1;
        }
        total
    }

    fn is_expired(now: u64, lot: &CreditLot) -> bool {
        match lot.expires_at {
            Some(t) => t <= now,
            None => false,
        }
    }

    /// Zeroes expired lots and reduces balance, recording an `Expire` entry.
    fn realize_expiry(env: &Env, now: u64, account: &mut AccountCredit) {
        let mut expired_total: i128 = 0;
        let mut i = 0u32;
        while i < account.lots.len() {
            let mut lot = account.lots.get(i).unwrap();
            if lot.remaining > 0 && Self::is_expired(now, &lot) {
                expired_total += lot.remaining;
                lot.remaining = 0;
                account.lots.set(i, lot);
            }
            i += 1;
        }
        if expired_total > 0 {
            account.balance -= expired_total;
            let reason = String::from_str(env, "expired");
            Self::record(
                env,
                account,
                CreditTxKind::Expire,
                -expired_total,
                reason,
                None,
            );
        }
    }

    /// Consumes up to `amount` from unexpired lots oldest-first, returning the
    /// amount actually consumed. Does not touch `balance`.
    fn consume(now: u64, account: &mut AccountCredit, amount: i128) -> i128 {
        let mut remaining = amount;
        let mut i = 0u32;
        while i < account.lots.len() && remaining > 0 {
            let mut lot = account.lots.get(i).unwrap();
            if lot.remaining > 0 && !Self::is_expired(now, &lot) {
                let take = if lot.remaining < remaining {
                    lot.remaining
                } else {
                    remaining
                };
                lot.remaining -= take;
                remaining -= take;
                account.lots.set(i, lot);
            }
            i += 1;
        }
        amount - remaining
    }

    fn record(
        env: &Env,
        account: &mut AccountCredit,
        kind: CreditTxKind,
        amount: i128,
        reason: String,
        counterparty: Option<Address>,
    ) {
        let tx = CreditTransaction {
            id: Self::next_id(env),
            kind,
            amount,
            timestamp: env.ledger().timestamp(),
            reason,
            counterparty,
        };
        account.transactions.push_back(tx);
        while account.transactions.len() > MAX_HISTORY {
            account.transactions.remove(0);
        }
    }
}

#[cfg(test)]
mod test;
