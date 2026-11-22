import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAtomicState } from './useAtomicState';
import { useAppStore } from '../store/slices';
import {
  allConsent,
  consentService as defaultConsentService,
  ConsentCategory,
  ConsentPreferences,
  ConsentService,
  ConsentSource,
  DEFAULT_CONSENT_PREFERENCES,
  SaveConsentResult,
  StoredConsent,
} from '../services/consentService';

export type ConsentLoadStatus = 'loading' | 'ready' | 'error';

interface ConsentState {
  status: ConsentLoadStatus;
  stored: StoredConsent | null;
  draft: ConsentPreferences;
  saving: boolean;
  error: string | null;
}

const ANONYMOUS_USER_ID = 'anonymous';

const INITIAL_CONSENT_STATE: ConsentState = {
  status: 'loading',
  stored: null,
  draft: DEFAULT_CONSENT_PREFERENCES,
  saving: false,
  error: null,
};

function samePreferences(a: ConsentPreferences, b: ConsentPreferences) {
  return (
    a.analytics === b.analytics &&
    a.marketing === b.marketing &&
    a.notifications === b.notifications
  );
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useConsentManager(service: ConsentService = defaultConsentService) {
  const userId = useAppStore((s) => s.userId) ?? ANONYMOUS_USER_ID;
  const setStoreConsent = useAppStore((s) => s.setConsent);

  const [{ status, stored, draft, saving, error }, patchState] =
    useAtomicState<ConsentState>(INITIAL_CONSENT_STATE);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applyConsent = useCallback(
    (consent: StoredConsent | null) => {
      const preferences = consent?.preferences ?? DEFAULT_CONSENT_PREFERENCES;
      setStoreConsent({ ...preferences, hasAcceptedPolicy: !service.requiresConsent(consent) });
      return { stored: consent, draft: preferences };
    },
    [service, setStoreConsent]
  );

  const reload = useCallback(async () => {
    patchState({ status: 'loading', error: null });
    try {
      const consent = await service.load();
      if (!mounted.current) return;
      patchState({ ...applyConsent(consent), status: 'ready' });
    } catch (e) {
      if (!mounted.current) return;
      patchState({
        error: errorMessage(e, 'Could not load your privacy preferences.'),
        status: 'error',
      });
    }
  }, [applyConsent, patchState, service]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (
      task: () => Promise<SaveConsentResult | null>,
      fallback: string
    ): Promise<SaveConsentResult | null> => {
      patchState({ saving: true, error: null });
      let result: SaveConsentResult | null = null;
      let failure: string | null = null;
      try {
        result = await task();
      } catch (e) {
        failure = errorMessage(e, fallback);
      }
      if (!mounted.current) return result;

      const applied = result ? applyConsent(result.consent) : {};
      patchState({
        ...applied,
        saving: false,
        error: failure,
      });
      return failure ? null : result;
    },
    [applyConsent, patchState]
  );

  const save = useCallback(
    (preferences: ConsentPreferences, source: ConsentSource) =>
      run(
        () => service.save(userId, preferences, source),
        'Could not save your privacy preferences.'
      ),
    [run, service, userId]
  );

  const setCategory = useCallback(
    (category: ConsentCategory, granted: boolean) => {
      patchState((previous) => ({ draft: { ...previous.draft, [category]: granted } }));
    },
    [patchState]
  );

  const saved = stored?.preferences ?? DEFAULT_CONSENT_PREFERENCES;

  return useMemo(
    () => ({
      status,
      error,
      saving,
      draft,
      saved,
      history: stored?.history ?? [],
      updatedAt: stored?.updatedAt ?? null,
      policyVersion: service.policyVersion,
      requiresConsent: service.requiresConsent(stored),
      isPolicyUpdate: stored !== null && service.requiresConsent(stored),
      isDirty: stored === null || !samePreferences(draft, saved),
      pendingSync: (stored?.pendingRecords.length ?? 0) > 0,
      setCategory,
      reload,
      saveDraft: (source: ConsentSource) => save(draft, source),
      acceptAll: (source: ConsentSource) => save(allConsent(true), source),
      rejectAll: (source: ConsentSource) => save(allConsent(false), source),
      retrySync: () =>
        run(() => service.retrySync(userId), 'Could not sync your privacy preferences.'),
    }),
    [status, error, saving, draft, saved, stored, service, setCategory, reload, save, run, userId]
  );
}

export type ConsentManager = ReturnType<typeof useConsentManager>;
