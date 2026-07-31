export { PromotionEngine, promotionEngine } from './domain/PromotionEngine';
export { BudgetChecker, checkCampaignBudget } from './jobs/budgetChecker';
export type { BudgetCheckResult } from './jobs/budgetChecker';
export { ExpirationCleanupCron, cleanupExpiredCoupons } from './jobs/expirationCleanup';
export type { ExpirationCleanupResult } from './jobs/expirationCleanup';
export { handleApplyDiscount } from './controller/promotionController';
export type { ApplyDiscountRequestBody } from './controller/promotionController';
