import { LogEntry, LogStorage } from '../elasticsearch/logStorage';

// Threshold: 10 errors within 5 minutes triggers an alert
const ERROR_THRESHOLD = 10;
const TIME_WINDOW_MS = 5 * 60 * 1000;

let lastAlertTime = 0;
const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 mins cooldown

export async function checkLogAlerts(newLog: LogEntry, storage: LogStorage) {
  if (newLog.level !== 'error') return;

  const now = Date.now();
  if (now - lastAlertTime < ALERT_COOLDOWN_MS) {
    return; // Cooldown active
  }

  const windowStart = new Date(now - TIME_WINDOW_MS);
  
  // Search recent errors
  const recentErrors = await storage.searchLogs({
    level: 'error',
    startDate: windowStart,
    limit: 100,
  });

  if (recentErrors.total >= ERROR_THRESHOLD) {
    triggerAlert(`High Error Rate Detected: ${recentErrors.total} errors in the last 5 minutes.`);
    lastAlertTime = now;
  }
  
  // Pattern matching for critical errors
  const criticalPatterns = ['payment failed', 'database connection lost', 'out of memory'];
  if (criticalPatterns.some(pattern => newLog.message.toLowerCase().includes(pattern))) {
    triggerAlert(`CRITICAL ERROR DETECTED: ${newLog.message}`);
    // Update cooldown to prevent spam if critical error repeats rapidly
    lastAlertTime = now;
  }
}

function triggerAlert(message: string) {
  // In a real system, this would integrate with PagerDuty, Slack, Email, etc.
  console.warn(`\n[ALERT] 🚨🚨🚨 ${message} 🚨🚨🚨\n`);
}
