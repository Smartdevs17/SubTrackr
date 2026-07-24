const { disasterRecoveryService } = require('../backend/dr/DisasterRecoveryService');
const { drMonitor } = require('../backend/dr/drMonitoring');

async function runTest() {
  console.log('--- Starting Disaster Recovery Automated Drill ---');
  
  // 1. Run the DR Drill
  console.log('\nRunning core DR drill (Backup -> Verify -> Restore)...');
  const drillResult = await disasterRecoveryService.runDrDrill();
  
  console.log('Drill passed:', drillResult.passed);
  console.log('Backup ID:', drillResult.backupId);
  console.log('RTO Compliant:', drillResult.rtoCompliant, `(${drillResult.recovery.durationMs}ms)`);
  
  if (!drillResult.passed) {
    console.error('DR Drill failed details:', JSON.stringify(drillResult, null, 2));
    process.exit(1);
  }

  // 2. Test Monitoring logic
  console.log('\nRunning DR Health Monitor Check...');
  const isHealthy = await drMonitor.checkHealth();
  console.log('DR Health check passed:', isHealthy);

  if (!isHealthy) {
    console.error('DR Monitor health check failed. Review logs for RPO or integrity breaches.');
    process.exit(1);
  }

  console.log('\n✅ Disaster Recovery Automation Test Complete.');
  process.exit(0);
}

runTest().catch((e) => {
  console.error('Fatal error during DR testing:', e);
  process.exit(1);
});
