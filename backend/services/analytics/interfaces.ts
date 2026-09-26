import { ChurnPrediction, UserChurnData, ForecastPoint, RevenueObservation } from './predictionService';
import { Recommendation, RecommendationContext } from './recommendationService';
import { ComplianceReport } from './complianceReport';
import { Campaign, Coupon, ConversionEvent } from './campaignService';

export interface IPredictionService {
  predictChurn(subscriberAddress: string, userData: UserChurnData): Promise<ChurnPrediction>;
  getChurnRiskFactors(subscriberAddress: string): Promise<any[]>;
  forecastRevenue(observations: RevenueObservation[], horizon?: number): Promise<ForecastPoint[]>;
}

export interface IRecommendationService {
  getRecommendations(subscriberAddress: string, context?: RecommendationContext): Promise<Recommendation[]>;
  trackRecommendationClick(recId: string, subscriberAddress: string): Promise<boolean>;
}

export interface IComplianceReportService {
  generateComplianceReport(): ComplianceReport;
  formatComplianceReport(report: ComplianceReport): string;
}

export interface ICampaignService {
  createCampaign(campaign: Omit<Campaign, 'id' | 'conversions' | 'revenueGenerated'>): Campaign;
  getCampaign(id: string): Campaign | undefined;
  listCampaigns(): Campaign[];
  createCoupon(campaignId: string, coupon: Omit<Coupon, 'code' | 'usedCount'>): Coupon;
  validateCoupon(code: string): Coupon;
  recordConversion(recId: string, event: Omit<ConversionEvent, 'id' | 'timestamp'>): ConversionEvent;
}
