import { options as defaultOptions } from './config/options.js';
import subscriptionFlow from './scenarios/subscriptionFlow.js';
import billingCycle from './scenarios/billingCycle.js';
import userLoad from './scenarios/userLoad.js';
import contractLoad from './contracts/contractLoad.test.js';
import { handleSummary } from './utils/summary.js';

const scenarios = {
  subscription: subscriptionFlow,
  billing: billingCycle,
  user: userLoad,
  contract: contractLoad,
};

export const options = defaultOptions;

// Generates load-tests/reports/{summary.json,summary.md,summary.html} and a
// stdout summary with baseline comparison at the end of every run.
export { handleSummary };

export default function () {
  const scenarioName = __ENV.SCENARIO || 'subscription';
  const scenario = scenarios[scenarioName] || scenarios.subscription;

  scenario();
}
