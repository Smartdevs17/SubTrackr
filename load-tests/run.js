import { options as defaultOptions } from './config/options.js';
import subscriptionFlow from './scenarios/subscriptionFlow.js';
import billingCycle from './scenarios/billingCycle.js';
import userLoad from './scenarios/userLoad.js';

const scenarios = {
  subscription: subscriptionFlow,
  billing: billingCycle,
  user: userLoad,
};

export const options = defaultOptions;

export default function () {
  const scenarioName = __ENV.SCENARIO || 'subscription';
  const scenario = scenarios[scenarioName] || scenarios.subscription;

  scenario();
}
