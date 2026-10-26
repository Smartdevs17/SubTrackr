## Fraud Detection API Documentation

## Overview

The Fraud Detection API provides real-time fraud monitoring, risk scoring, alerting, investigation tools, and comprehensive analytics for subscription payment fraud prevention.

## Real-time Fraud Detection

### Perform Fraud Check

```typescript
performFraudCheck(request: FraudCheckRequest): Promise<FraudCheckResponse>
```

Performs real-time fraud analysis on a transaction and returns risk assessment.

**Parameters:**
- `request.transactionId` (string, required): Unique transaction identifier
- `request.subscriptionId` (string, required): Associated subscription ID
- `request.userId` (string, required): User performing the transaction
- `request.amount` (number, required): Transaction amount
- `request.currency` (string, required): Currency code
- `request.paymentMethod` (string, required): Payment method used
- `request.metadata` (object, required): Additional context data
  - `ipAddress` (string, optional): IP address of the user
  - `deviceId` (string, optional): Device fingerprint
  - `userAgent` (string, optional): Browser/app user agent
  - `location` (object, optional): Geographic location data
  - `transactionAmount` (number, optional): Amount for analytics

**Returns:** `FraudCheckResponse` with:
- `allowed` (boolean): Whether transaction should be allowed
- `riskScore` (number): Risk score 0-100
- `riskLevel` (FraudRiskLevel): 'low', 'medium', 'high', or 'critical'
- `indicators` (FraudIndicator[]): Array of detected fraud indicators
- `recommendation` (string): Action recommendation
- `detectionId` (string, optional): ID if detection was created

**Example:**
```typescript
const response = await performFraudCheck({
  transactionId: 'txn-123',
  subscriptionId: 'sub-456',
  userId: 'user-789',
  amount: 99.99,
  currency: 'USD',
  paymentMethod: 'credit_card',
  metadata: {
    ipAddress: '203.0.113.0',
    deviceId: 'device-abc',
    location: {
      country: 'US',
      city: 'New York',
    },
  },
});

if (!response.allowed) {
  // Block transaction
  console.log('Transaction blocked:', response.recommendation);
} else if (response.riskLevel === 'high') {
  // Require additional verification
  console.log('High risk - verify user');
}
```

## Fraud Detection Methods

The system uses multiple detection methods:

1. **Velocity Check**: Detects rapid succession of transactions
2. **Pattern Analysis**: Identifies suspicious behavioral patterns
3. **Geolocation**: Flags location anomalies and impossible travel
4. **Device Fingerprint**: Detects new or suspicious devices
5. **Amount Anomaly**: Identifies unusual transaction amounts
6. **Behavioral Analysis**: Analyzes user behavior patterns
7. **Network Analysis**: Examines network-level indicators
8. **ML Model**: Machine learning-based predictions

## Fraud Indicators

### Common Indicators

- **RAPID_TRANSACTIONS**: Multiple transactions in short time
- **UNUSUAL_AMOUNT**: Amount significantly different from historical
- **LOCATION_MISMATCH**: Geographic location inconsistency
- **NEW_DEVICE**: Transaction from unrecognized device
- **SUSPICIOUS_PATTERN**: Anomalous behavior pattern
- **MULTIPLE_FAILED_ATTEMPTS**: Repeated failed transaction attempts
- **VELOCITY_EXCEEDED**: Transaction rate exceeds threshold
- **BLACKLISTED**: User/IP on blacklist
- **UNUSUAL_TIME**: Transaction at atypical time
- **IP_REPUTATION**: Suspicious IP address

## Detection Management

### Get All Detections

```typescript
getAllDetections(filters?: FraudFilters): Promise<FraudDetection[]>
```

Retrieves fraud detections with optional filtering.

**Filter Parameters:**
- `riskLevel` (FraudRiskLevel[], optional): Filter by risk levels
- `status` (FraudStatus[], optional): Filter by status
- `dateFrom` (Date, optional): Start date
- `dateTo` (Date, optional): End date
- `subscriptionId` (string, optional): Filter by subscription
- `userId` (string, optional): Filter by user
- `minRiskScore` (number, optional): Minimum risk score
- `maxRiskScore` (number, optional): Maximum risk score

**Example:**
```typescript
const highRiskDetections = await getAllDetections({
  riskLevel: ['high', 'critical'],
  status: ['pending', 'investigating'],
});
```

### Update Detection Status

```typescript
updateDetectionStatus(
  id: string,
  status: FraudStatus,
  reviewedBy?: string,
  notes?: string
): Promise<FraudDetection>
```

Updates the status of a fraud detection after review.

**Status Values:**
- `pending`: Awaiting review
- `investigating`: Under investigation
- `confirmed`: Confirmed as fraud
- `false_positive`: Determined to be legitimate
- `resolved`: Case resolved

**Example:**
```typescript
await updateDetectionStatus(
  'detection-123',
  'confirmed',
  'admin@example.com',
  'Verified fraudulent activity'
);
```

## Fraud Alerts

### Get All Alerts

```typescript
getAllAlerts(): Promise<FraudAlert[]>
```

Retrieves all fraud alerts.

### Mark Alert as Read

```typescript
markAlertAsRead(id: string): Promise<void>
```

Marks an alert as read.

### Resolve Alert

```typescript
resolveAlert(id: string, actionTaken: string): Promise<void>
```

Resolves an alert with the action taken.

**Example:**
```typescript
await resolveAlert(
  'alert-123',
  'Blocked transaction and contacted user for verification'
);
```

## Fraud Analytics

### Get Fraud Analytics

```typescript
getFraudAnalytics(): Promise<FraudAnalytics>
```

Retrieves comprehensive fraud analytics.

**Returns:**
- `totalDetections` (number): Total fraud detections
- `blockedTransactions` (number): Number of blocked transactions
- `confirmedFraud` (number): Confirmed fraud cases
- `falsePositives` (number): False positive detections
- `averageRiskScore` (number): Average risk score
- `detectionsByLevel` (object): Count by risk level
- `detectionsByMethod` (object): Count by detection method
- `indicatorBreakdown` (object): Count by indicator type
- `preventedLoss` (number): Estimated prevented financial loss
- `detectionRate` (number): Percentage of confirmed fraud
- `falsePositiveRate` (number): Percentage of false positives
- `timeSeriesData` (array): Historical trend data
- `topRiskUsers` (array): Users with highest risk scores

**Example:**
```typescript
const analytics = await getFraudAnalytics();
console.log(`Prevented $${analytics.preventedLoss} in fraud`);
console.log(`Detection rate: ${analytics.detectionRate}%`);
console.log(`False positive rate: ${analytics.falsePositiveRate}%`);
```

## Fraud Investigation

### Create Investigation

```typescript
createInvestigation(
  detectionId: string,
  investigator: string,
  priority: 'low' | 'medium' | 'high' | 'urgent'
): Promise<FraudInvestigation>
```

Creates a new fraud investigation case.

**Example:**
```typescript
const investigation = await createInvestigation(
  'detection-456',
  'fraud-team@example.com',
  'high'
);
```

### Update Investigation

```typescript
updateInvestigation(
  id: string,
  updates: Partial<FraudInvestigation>
): Promise<FraudInvestigation>
```

Updates an existing investigation.

**Example:**
```typescript
await updateInvestigation('inv-123', {
  status: 'in_progress',
  findings: 'User account compromised. Payment method stolen.',
  recommendation: 'Block user account and refund transactions',
});
```

## Fraud Reporting

### Generate Fraud Report

```typescript
generateFraudReport(
  reportType: 'daily' | 'weekly' | 'monthly' | 'custom',
  period: { start: Date; end: Date }
): Promise<FraudReport>
```

Generates a comprehensive fraud report for a time period.

**Returns:**
- `summary`: High-level metrics
- `details`: Full analytics
- `trends`: Detection and risk trends
- `recommendations`: Actionable recommendations

**Example:**
```typescript
const report = await generateFraudReport('monthly', {
  start: new Date('2026-07-01'),
  end: new Date('2026-07-31'),
});

console.log(report.summary);
console.log('Trend:', report.trends.detectionTrend);
console.log('Recommendations:', report.recommendations);
```

## Real-time Monitoring

### Get Monitoring Status

```typescript
getMonitoringStatus(): Promise<RealTimeMonitoring>
```

Gets the current status of real-time fraud monitoring.

**Returns:**
- `isActive` (boolean): Whether monitoring is active
- `transactionsMonitored` (number): Total transactions monitored
- `activeDetections` (number): Currently pending detections
- `lastCheckTimestamp` (Date): Last check time
- `systemHealth` ('healthy' | 'degraded' | 'offline'): System status
- `averageResponseTime` (number): Average response time in ms

**Example:**
```typescript
const monitoring = await getMonitoringStatus();
if (monitoring.systemHealth !== 'healthy') {
  console.warn('Fraud detection system health:', monitoring.systemHealth);
}
```

## Risk Scoring

### Risk Score Ranges

- **0-29**: Low Risk - Normal transaction
- **30-49**: Medium Risk - Monitor closely
- **50-69**: High Risk - Require verification
- **70-100**: Critical Risk - Block transaction

### Risk Level Actions

- **Low**: Allow transaction, continue monitoring
- **Medium**: Allow with additional monitoring
- **High**: Request additional verification
- **Critical**: Block transaction, manual review required

## Best Practices

### 1. Always Perform Fraud Checks

```typescript
// Before processing payment
const fraudCheck = await performFraudCheck(transactionData);

if (!fraudCheck.allowed) {
  throw new Error('Transaction blocked for fraud prevention');
}

if (fraudCheck.riskLevel === 'high') {
  await requestAdditionalVerification(userId);
}

// Process payment
await processPayment(transactionData);
```

### 2. Review High-Risk Detections

Set up a workflow to review high-risk detections:

```typescript
const pendingDetections = await getAllDetections({
  status: ['pending'],
  riskLevel: ['high', 'critical'],
});

for (const detection of pendingDetections) {
  await investigateDetection(detection);
}
```

### 3. Monitor False Positive Rate

```typescript
const analytics = await getFraudAnalytics();

if (analytics.falsePositiveRate > 20) {
  console.warn('High false positive rate - review rules');
  // Adjust detection thresholds
}
```

### 4. Regular Reporting

```typescript
// Generate weekly reports
const report = await generateFraudReport('weekly', {
  start: getStartOfWeek(),
  end: getEndOfWeek(),
});

await sendReportToTeam(report);
```

### 5. Alert Response

```typescript
const unreadAlerts = await getAllAlerts().then(alerts =>
  alerts.filter(a => !a.isRead && a.severity === 'critical')
);

for (const alert of unreadAlerts) {
  await notifySecurityTeam(alert);
  await markAlertAsRead(alert.id);
}
```

## Integration Example

Complete workflow for fraud-protected payment:

```typescript
async function processSecurePayment(
  userId: string,
  subscriptionId: string,
  amount: number
) {
  // 1. Perform fraud check
  const fraudCheck = await performFraudCheck({
    transactionId: generateTransactionId(),
    subscriptionId,
    userId,
    amount,
    currency: 'USD',
    paymentMethod: 'credit_card',
    metadata: {
      ipAddress: getUserIP(),
      deviceId: getDeviceFingerprint(),
      location: getUserLocation(),
    },
  });

  // 2. Handle based on risk level
  if (!fraudCheck.allowed) {
    throw new FraudError('Transaction blocked', fraudCheck);
  }

  if (fraudCheck.riskLevel === 'high') {
    await sendVerificationEmail(userId);
    throw new VerificationRequiredError('Additional verification needed');
  }

  // 3. Process payment
  const payment = await processPayment({ userId, subscriptionId, amount });

  // 4. Log successful transaction
  await logTransaction(payment, fraudCheck.riskScore);

  return payment;
}
```

## Storage

All fraud data is stored locally using AsyncStorage:
- `@SubTrackr:fraudDetections`: Detection records
- `@SubTrackr:fraudAlerts`: Alert records
- `@SubTrackr:fraudInvestigations`: Investigation records
- `@SubTrackr:fraudRules`: Custom fraud rules
- `@SubTrackr:fraudMonitoring`: Monitoring stats

## Error Handling

```typescript
try {
  const response = await performFraudCheck(request);
  // Handle response
} catch (error) {
  console.error('Fraud check failed:', error.message);
  // Fail-safe: allow transaction if fraud check fails
  // Or reject to be safe: throw error;
}
```

## Performance Considerations

1. **Caching**: Detection results are cached for performance
2. **Async Processing**: Fraud checks run asynchronously
3. **Batch Operations**: Use batch APIs for multiple checks
4. **Rate Limiting**: Built-in protection against abuse

## Security Notes

1. Never expose fraud detection logic to clients
2. Use secure channels for fraud data transmission
3. Regularly update detection rules
4. Monitor for bypass attempts
5. Log all fraud-related actions for audit

## Support

For fraud detection issues:
- Check system health: `getMonitoringStatus()`
- Review recent detections: `getAllDetections()`
- Analyze trends: `getFraudAnalytics()`
- Generate reports: `generateFraudReport()`
