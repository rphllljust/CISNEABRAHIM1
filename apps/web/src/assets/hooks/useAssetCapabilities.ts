import { useEffect, useMemo, useState } from 'react';
import { listPhysicalResourceTypes, type AssetCapabilities } from '../api/physical-assets-api';
import { useAuth } from '../../auth/context/AuthProvider';
import { useSessionMeta } from '../../service-orders/context/SessionMetaProvider';

/**
 * CAPABILITIES DE UI — projeção dos grants efetivos já publicados por GET /me.
 *
 * O hook antigo descobria permissão disparando POST/PATCH/activate/deactivate contra um UUID
 * sintético a cada montagem da tela. Isso gerava ASSET_VALIDATION_FAILED e ASSET_NOT_FOUND reais
 * em produção sem representar tentativa do operador, e tratava 400/404 como "tem permissão".
 * `/me` já publica os grants efetivos da sessão; a UI apenas projeta esse contrato. O backend
 * continua sendo a barreira autoritativa e revalida cada comando com escopo.
 */
const EMPTY_CAPABILITIES: AssetCapabilities = {
  canList: false,
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canDeactivate: false,
  canActivate: false,
};

export function useAssetCapabilities() {
  const { status: authStatus } = useAuth();
  const session = useSessionMeta();

  const capabilities = useMemo<AssetCapabilities>(() => {
    if (authStatus !== 'authenticated' || session.status !== 'ready') {
      return EMPTY_CAPABILITIES;
    }
    return {
      canList: session.can('resources:asset:list'),
      canCreate: session.can('resources:asset:create'),
      canRead: session.can('resources:asset:read'),
      canUpdate: session.can('resources:asset:update'),
      canDeactivate: session.can('resources:asset:deactivate'),
      canActivate: session.can('resources:asset:activate'),
    };
  }, [authStatus, session]);

  return {
    loading:
      authStatus === 'loading' ||
      (authStatus === 'authenticated' &&
        (session.status === 'idle' || session.status === 'loading')),
    capabilities,
    error: authStatus === 'authenticated' && session.status === 'error',
  };
}

export function useAssetResourceTypes() {
  const [loading, setLoading] = useState(true);
  const [resourceTypes, setResourceTypes] = useState<
    Awaited<ReturnType<typeof listPhysicalResourceTypes>>
  >([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void listPhysicalResourceTypes(controller.signal)
      .then((items) => {
        if (!cancelled) {
          setResourceTypes(items);
          setError(false);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return { loading, resourceTypes, error };
}
