import { useEffect, useState } from 'react';
import { ClientsApiError, probeClientCapabilities, type ClientCapabilities } from '../api/clients-api';
import { useAuth } from '../../auth/context/AuthProvider';

/**
 * ESTADO INICIAL E DE NEGAÇÃO — NEGAÇÃO EM TODAS, INCLUSIVE NAS DO CUSTOMER 360.
 *
 * Exaustividade aqui é requisito, não estilo: uma capacidade acrescentada ao tipo e esquecida
 * neste objeto fica `undefined`, e os painéis que a consomem passam a oferecer (ou a esconder)
 * comandos com base em ausência de valor em vez de uma decisão. As quatro capacidades novas estão
 * declaradas explicitamente por isso.
 */
const EMPTY_CAPABILITIES: ClientCapabilities = {
  canList: false,
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canDeactivate: false,
  canActivate: false,
  canManageContacts: false,
  canManageUnits: false,
  canManageHierarchy: false,
  canReadAudit: false,
};

export function useClientCapabilities() {
  const { status } = useAuth();
  const [loading, setLoading] = useState(true);
  const [capabilities, setCapabilities] = useState<ClientCapabilities>(EMPTY_CAPABILITIES);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (status === 'loading') {
      setLoading(true);
      return;
    }

    if (status !== 'authenticated') {
      setLoading(false);
      setCapabilities(EMPTY_CAPABILITIES);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    void probeClientCapabilities(controller.signal)
      .then((result) => {
        if (!cancelled) {
          setCapabilities(result);
          setError(false);
          setLoading(false);
        }
      })
      .catch((probeError: unknown) => {
        if (cancelled) {
          return;
        }
        if (probeError instanceof ClientsApiError && probeError.kind === 'denied') {
          setCapabilities(EMPTY_CAPABILITIES);
          setError(false);
        } else {
          setError(true);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [status]);

  return { loading, capabilities, error };
}
