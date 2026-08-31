# SubTrackr Subscription Analytics Guide

The SubTrackr advanced analytics suite delivers enterprise-grade SaaS telemetry, providing deep visibility into Monthly Recurring Revenue (MRR), Annual Recurring Revenue (ARR), subscriber cohort retention curves, algorithmic revenue forecasting, and channel-based LTV attribution.

---

## 1. Key Metrics & Financial Formulas

### Monthly Recurring Revenue (MRR)
MRR represents the normalized monthly revenue contribution from all currently active subscriptions:
- **Monthly Billing**: Contribution = `price`
- **Yearly Billing**: Contribution = `price / 12`
- **Weekly Billing**: Contribution = `price * 4.345` (average weeks per month)

### Annual Recurring Revenue (ARR)
ARR projects the annualized run-rate of current active subscriptions:
$$\text{ARR} = \text{MRR} \times 12$$

### Growth Rates (MoM / YoY)
Period-over-period growth rates evaluate momentum across historical billing cycles:
$$\text{MRR Growth Rate} = \left( \frac{\text{MRR}_{\text{current}} - \text{MRR}_{\text{previous}}}{\text{MRR}_{\text{previous}}} \right) \times 100$$

### Customer Lifetime Value (LTV) & ARPU
- **Average Revenue Per User (ARPU)**: $\text{MRR} / \text{Active Subscribers}$
- **Customer Lifetime Value (LTV)**:
  - If Gross Churn Rate $> 0$: $\text{ARPU} / \text{Gross Churn Rate}$
  - If Churn Rate $= 0$: $\text{ARPU} \times 24 \text{ months}$ (default lifetime assumption)

---

## 2. Cohort Retention Curves & Heatmaps

Subscribers are bucketed into signup cohorts based on their initial subscription timestamp (monthly or weekly granularity).
- **Retention Curve**: Evaluates active status at Day 1, Day 7, Day 30, Day 60, and Day 90 relative to cohort signup date.
- **Logo Churn vs. Revenue Churn**: Highlights divergence between subscriber count churn and monetary MRR churn (critical for identifying churn among high-value enterprise tiers).

---

## 3. Revenue Forecasting Models

SubTrackr supports dual algorithmic models for predicting revenue trajectories over the next 3 to 12 months:

### Exponential Decay Model (Default)
Assumes future revenue compounds based on historical retention and natural net expansion:
$$\text{Expected Revenue}_{M+k} = \text{MRR} \times (\text{Average Cohort Retention})^{k}$$

### Linear Regression Model
Fits a linear trend line across the last 6 months of observed MRR using ordinary least squares (OLS):
$$\text{Slope } (m) = \frac{n \sum (xy) - \sum x \sum y}{n \sum (x^2) - (\sum x)^2}$$
$$\text{Expected Revenue}_{M+k} = \max(0, \text{MRR} + m \times k)$$

---

## 4. Dashboard Customization & Widgets

The **Analytics Dashboard** is fully modular. Via the `WidgetCustomizationModal` (powered by Zustand `analyticsStore`), administrators can:
- **Toggle Visibility**: Enable/disable individual cards (`MRR & ARR Overview`, `Revenue Trend`, `Cohort Heatmap`, `Churn Breakdown`, `Revenue Forecast`, `Plan Migrations`).
- **Reorder Layout**: Move widgets up or down to customize hierarchy.
- **Switch Forecast Model**: Dynamically switch between Linear Regression and Exponential Decay across all forecasting views.

---

## 5. Multi-Format Report Exports

Users can export telemetry in multiple standard formats directly from the dashboard or via API:
1. **MRR/ARR Summary (CSV)**: Tabular KPI report with growth rates and forecast data.
2. **MRR/ARR Summary (Text/PDF)**: Formatted executive briefing text suitable for PDF rendering or sharing.
3. **Cohort Retention Report (CSV / PDF)**: Detailed breakdown of cohort sizes, starting MRR, and retention percentages.
4. **Raw Subscriptions (CSV)**: Full export of underlying subscriber records.

---

## 6. REST API Reference (`AnalyticsDashboardApi`)

The backend service exposes standard `ApiResponse<T>` endpoints for programmatic access:

| Method | Endpoint / Method Name | Description |
| :--- | :--- | :--- |
| `GET` | `getCohortTable(merchantId, granularity)` | Serves nightly cohort table (cached or live compute). |
| `GET` | `getRetentionCurve(merchantId)` | Returns Day 1/7/30/60/90 retention milestones. |
| `GET` | `getMrrArrReport(merchantId)` | Returns active MRR, ARR, ARPU, LTV, and subscriber counts. |
| `GET` | `getRevenueForecast(merchantId, model, monthsAhead)` | Calculates linear or exponential predictive trajectories. |
| `GET` | `getChurnBreakdown(merchantId, start, end)` | Computes logo churn rate vs. revenue churn rate. |
| `GET` | `exportCohortReport(merchantId, granularity, format)` | Returns CSV or PDF report buffer and headers. |
