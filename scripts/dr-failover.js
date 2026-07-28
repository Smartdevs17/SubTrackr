const { disasterRecoveryService } = require('../backend/dr/DisasterRecoveryService');

async function triggerFailover() {
  console.log('🚨 EMERGENCY: Triggering Automated Disaster Recovery Failover 🚨');
  
  console.log('\nInitiating failover sequence...');
  const start = Date.now();
  
  const result = await disasterRecoveryService.failover();
  
  const elapsed = Date.now() - start;

  if (result.success) {
    console.log(`\n✅ Failover successful in ${elapsed}ms.`);
    console.log(`Restored ${result.restoredKeys.length} storage keys:`, result.restoredKeys);
    process.exit(0);
  } else {
    console.error(`\n❌ Failover failed after ${elapsed}ms.`);
    console.error('Errors encountered:', result.errors);
    console.error('\nPlease escalate to the incident response team immediately and consult docs/runbooks/02-incident-response.md');
    process.exit(1);
  }
}

triggerFailover().catch((e) => {
  console.error('Fatal error during failover execution:', e);
  process.exit(1);
});
