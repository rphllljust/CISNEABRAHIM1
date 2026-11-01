import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deletePersonalSavedView,
  PersonalSavedViewsApiError,
  listPersonalSavedViews,
  savePersonalSavedView,
} from './personal-saved-views-api';

/**
 * View configuration only: never records or cached business information.
 * WorkspaceQueue uses the authenticated server as authority. The old storage
 * reader remains ONLY to migrate pre-existing personal views after server
 * persistence is acknowledged, preserving users' pre-release preferences.
 */
export type SavedView = {
  id: string;
  name: string;
  filters: Record<string, string>;
  viewType: string;
  createdAt: string;
};

const STORAGE_PREFIX = 'cisne.saved-views';

function storageKey(identityId: string, entity: string): string {
  return `${STORAGE_PREFIX}.${identityId}.${entity}`;
}

function isSavedView(value: unknown): value is SavedView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['name'] === 'string' &&
    typeof candidate['viewType'] === 'string' &&
    typeof candidate['createdAt'] === 'string' &&
    typeof candidate['filters'] === 'object' &&
    candidate['filters'] !== null &&
    !Array.isArray(candidate['filters']) &&
    Object.entries(candidate['filters']).every(([, value]) => typeof value === 'string')
  );
}

/** Legacy import reader; NOT a fallback when the server is unavailable. */
export function readSavedViews(owner: string | null, entity: string): SavedView[] {
  if (!owner) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(owner, entity));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSavedView) : [];
  } catch {
    return [];
  }
}

function writeLocalViews(owner: string | null, entity: string, views: SavedView[]): void {
  if (!owner) return;
  try {
    window.localStorage.setItem(storageKey(owner, entity), JSON.stringify(views));
  } catch {
    // The legacy local-only screens cannot promise persistence on quota failure.
  }
}

export type UseSavedViewsResult = {
  views: SavedView[];
  save: (name: string, filters: Record<string, string>, viewType: string) => Promise<boolean>;
  remove: (id: string) => void;
  persistedLocally: boolean;
  persistable: boolean;
  loading: boolean;
  notice: string | null;
  canRetry: boolean;
  retry: () => void;
};

export function useSavedViews(owner: string | null, entity: string): UseSavedViewsResult {
  // P2-01 only migrates operational workspaces. Other view families retain
  // their explicitly-local status until their own typed server contracts ship.
  const remote = entity.startsWith('workspace.');
  const [views, setViews] = useState<SavedView[]>(() => remote ? [] : readSavedViews(owner, entity));
  const [loading, setLoading] = useState(remote && owner !== null);
  const [ready, setReady] = useState(!remote || owner === null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [readDenied, setReadDenied] = useState(false);
  const currentScope = useRef(`${owner ?? ''}:${entity}`);
  currentScope.current = `${owner ?? ''}:${entity}`;

  useEffect(() => {
    setNotice(null);
    setReadDenied(false);
    if (!remote) {
      setViews(readSavedViews(owner, entity));
      setLoading(false);
      setReady(true);
      return;
    }
    if (!owner) {
      setViews([]);
      setLoading(false);
      setReady(true);
      return;
    }

    const controller = new AbortController();
    let active = true;
    const key = `${owner}:${entity}`;
    setViews([]);
    setReady(false);
    setLoading(true);

    void (async () => {
      const persisted = await listPersonalSavedViews(entity, controller.signal);
      const imported = [...persisted];
      const legacy = readSavedViews(owner, entity);
      // Only the old 'list' surface is supported in this P2 slice. Never
      // delete incompatible local views or overwrite server-owned names.
      const migratable = legacy.filter((view) => view.viewType === 'list');
      for (const view of migratable) {
        if (controller.signal.aborted) return;
        if (!imported.some((stored) => stored.name.toLowerCase() === view.name.toLowerCase())) {
          imported.push(await savePersonalSavedView(entity, {
            name: view.name, filters: view.filters, viewType: 'list',
          }));
        }
      }
      if (legacy.length === migratable.length && !controller.signal.aborted) {
        try { window.localStorage.removeItem(storageKey(owner, entity)); } catch { /* ignored */ }
      }
      if (!active || currentScope.current !== key) return;
      setViews(imported);
      setReady(true);
      setLoading(false);
    })().catch((error: unknown) => {
      if (!active || currentScope.current !== key || controller.signal.aborted) return;
      const denied = error instanceof PersonalSavedViewsApiError && (error.status === 401 || error.status === 403);
      setViews([]);
      setReady(false);
      setLoading(false);
      setReadDenied(denied);
      setNotice(denied
        ? 'Sem permissão para consultar as visões salvas desta sessão.'
        : 'Visões salvas indisponíveis no servidor. Nada foi salvo localmente.');
    });

    return () => { active = false; controller.abort(); };
  }, [owner, entity, remote, retryCount]);

  const retry = useCallback(() => {
    if (remote && owner) setRetryCount((count) => count + 1);
  }, [remote, owner]);

  /**
   * The Save form must not close before the backend acknowledges persistence.
   * Returning false also covers identity changes during a request: a response
   * for the previous account is never presented as this account's success.
   */
  const save = useCallback(
    async (name: string, filters: Record<string, string>, viewType: string): Promise<boolean> => {
      const trimmed = name.trim();
      if (!owner || !ready || trimmed.length < 1 || trimmed.length > 60) return false;

      if (!remote) {
        const next: SavedView = {
          id: `view-${crypto.randomUUID()}`,
          name: trimmed, filters, viewType, createdAt: new Date().toISOString(),
        };
        setViews((current) => {
          const updated = [...current.filter((view) => view.name !== trimmed), next];
          writeLocalViews(owner, entity, updated);
          return updated;
        });
        return true;
      }

      const key = `${owner}:${entity}`;
      try {
        const saved = await savePersonalSavedView(entity, { name: trimmed, filters, viewType });
        if (currentScope.current !== key) return false;
        setViews((current) => [
          ...current.filter((view) => view.id !== saved.id &&
            view.name.toLowerCase() !== saved.name.toLowerCase()),
          saved,
        ]);
        setNotice(null);
        return true;
      } catch {
        if (currentScope.current === key) {
          setNotice('A visão não foi salva. Verifique a conexão e tente novamente.');
        }
        return false;
      }
    },
    [owner, entity, remote, ready],
  );

  const remove = useCallback(
    (id: string) => {
      if (!owner || !ready) return;
      if (!remote) {
        setViews((current) => {
          const updated = current.filter((view) => view.id !== id);
          writeLocalViews(owner, entity, updated);
          return updated;
        });
        return;
      }
      const key = `${owner}:${entity}`;
      void deletePersonalSavedView(entity, id)
        .then(() => {
          if (currentScope.current !== key) return;
          setViews((current) => current.filter((view) => view.id !== id));
          setNotice(null);
        })
        .catch(() => {
          if (currentScope.current === key) {
            setNotice('Não foi possível excluir a visão no servidor.');
          }
        });
    },
    [owner, entity, remote, ready],
  );

  return useMemo(() => ({
    views,
    save,
    remove,
    persistedLocally: !remote,
    persistable: owner !== null && ready,
    loading,
    notice,
    canRetry: remote && owner !== null && !loading && !ready && !readDenied,
    retry,
  }), [views, save, remove, remote, owner, ready, loading, notice, readDenied, retry]);
}
