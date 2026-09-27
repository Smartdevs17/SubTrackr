import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const ANONYMOUS_USER_ID = 'anonymous';

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

/**
 * Loads, edits, and saves the user's GDPR consent, mirroring the saved
 * decision into the app store so the rest of the app can gate on it.
 */
export function useConsentManager(service: ConsentService = defaultConsentService) {
  const userId = useAppStore((s) => s.userId) ?? ANONYMOUS_USER_ID;
  const setStoreConsent = useAppStore((s) => s.setConsent);

  const [status, setStatus] = useState<ConsentLoadStatus>('loading');
  const [stored, setStored] = useState<StoredConsent | null>(null);
  const [draft, setDraft] = useState<ConsentPreferences>(DEFAULT_CONSENT_PREFERENCES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const apply = useCallback(
    (consent: StoredConsent | null) => {
      const preferences = consent?.preferences ?? DEFAULT_CONSENT_PREFERENCES;
      setStored(consent);
      setDraft(preferences);
      setStoreConsent({ ...preferences, hasAcceptedPolicy: !service.requiresConsent(consent) });
    },
    [service, setStoreConsent]
  );

  const reload = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const consent = await service.load();
      if (!mounted.current) return;
      apply(consent);
      setStatus('ready');
    } catch (e) {
      if (!mounted.current) return;
      setError(errorMessage(e, 'Could not load your privacy preferences.'));
      setStatus('error');
    }
  }, [apply, service]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (
      task: () => Promise<SaveConsentResult | null>,
      fallback: string
    ): Promise<SaveConsentResult | null> => {
      setSaving(true);
      setError(null);
      try {
        const result = await task();
        if (result && mounted.current) apply(result.consent);
        return result;
      } catch (e) {
        if (mounted.current) setError(errorMessage(e, fallback));
        return null;
      } finally {
        if (mounted.current) setSaving(false);
      }
    },
    [apply]
  );

  const save = useCallback(
    (preferences: ConsentPreferences, source: ConsentSource) =>
      run(
        () => service.save(userId, preferences, source),
        'Could not save your privacy preferences.'
      ),
    [run, service, userId]
  );

  const setCategory = useCallback((category: ConsentCategory, granted: boolean) => {
    setDraft((prev) => ({ ...prev, [category]: granted }));
  }, []);

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
