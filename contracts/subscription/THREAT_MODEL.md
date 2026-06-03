# SubTrackr Subscription Threat Model & Reentrancy Mitigation

## 1. Attack Surface
* **Cross-Contract Reentrancy:** A malicious ERC20/Soroban token contract could hijack the `transfer_from` call within `charge()` to recursively call `charge()`, draining the subscriber's balance.
* **Read-Only Reentrancy:** An external contract queries `get_subscription()` during a `transfer_from` hook before the state is updated, utilizing stale billing data for parallel logic manipulation.
* **Flash Loan Attacks:** Flash loans could be utilized to manipulate liquidity pools if dynamic subscription pricing was based on real-time AMM quotes. 

## 2. Mitigation Strategies Implemented
1. **RAII Reentrancy Guard:** A dedicated `ReentrancyGuard` locks the instance storage upon entering the `charge()` function and explicitly drops it upon exit.
2. **Checks-Effects-Interactions (CEI):** Refactored the `charge` lifecycle to completely update the `next_billing_date` and commit the subscription state *before* interacting with the external Token client. 
3. **Revert Propagation:** If an interaction fails or a malicious token attempts to pause the transaction, Soroban's native environment reverts all state, un-doing the effect phase securely.