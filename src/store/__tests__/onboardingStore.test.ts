import { useOnboardingStore, DEFAULT_ONBOARDING_STEPS } from '../onboardingStore';

describe('useOnboardingStore', () => {
  beforeEach(() => {
    useOnboardingStore.getState().resetTour();
  });

  test('initializes with default values', () => {
    const state = useOnboardingStore.getState();
    expect(state.steps).toEqual(DEFAULT_ONBOARDING_STEPS);
    expect(state.currentStepIndex).toBe(0);
    expect(state.isActive).toBe(false);
    expect(state.isCompleted).toBe(false);
    expect(state.isSkipped).toBe(false);
  });

  test('starts tour correctly', () => {
    useOnboardingStore.getState().startTour();
    const state = useOnboardingStore.getState();
    expect(state.isActive).toBe(true);
    expect(state.currentStepIndex).toBe(0);
  });

  test('navigates next and prev steps', () => {
    useOnboardingStore.getState().startTour();
    useOnboardingStore.getState().nextStep();
    expect(useOnboardingStore.getState().currentStepIndex).toBe(1);

    useOnboardingStore.getState().prevStep();
    expect(useOnboardingStore.getState().currentStepIndex).toBe(0);
  });

  test('finishes tour on last step next', () => {
    useOnboardingStore.getState().startTour();
    const totalSteps = DEFAULT_ONBOARDING_STEPS.length;
    for (let i = 0; i < totalSteps; i++) {
      useOnboardingStore.getState().nextStep();
    }

    const state = useOnboardingStore.getState();
    expect(state.isActive).toBe(false);
    expect(state.isCompleted).toBe(true);
  });

  test('skips tour correctly', () => {
    useOnboardingStore.getState().startTour();
    useOnboardingStore.getState().skipTour();

    const state = useOnboardingStore.getState();
    expect(state.isActive).toBe(false);
    expect(state.isSkipped).toBe(true);
  });
});
