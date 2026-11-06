import { useEffect, useRef, useState } from 'react';
import { embedDashboard, type EmbeddedDashboard } from '@superset-ui/embedded-sdk';
import { useAuth } from '../../auth/context/AuthProvider';
import { useOperationalUnits, OperationalUnitOptions } from '../../shell/hooks/useOperationalUnits';
import { ModulePage, ModulePageHeader } from '../../ui/module-layout';
import {
  EmbeddedBiError,
  getEmbeddedBiCatalog,
  issueEmbeddedBiTicket,
  type EmbeddedBiCatalog,
  type SupersetDashboardKey,
} from '../api/embedded-bi-api';

type Phase = 'loading' | 'ready' | 'denied' | 'unavailable' | 'session_expired';
type CatalogState = { phase: Phase; catalog: EmbeddedBiCatalog | null };

export function EmbeddedBiPage() {
  const { status: authStatus, identityId, sessionId, expireSession } = useAuth();
  const { unitId, setUnitId, options, status: unitStatus, reload } = useOperationalUnits();
  const [catalogState, setCatalogState] = useState<CatalogState>({ phase: 'loading', catalog: null });
  const [selectedKey, setSelectedKey] = useState<SupersetDashboardKey | ''>('');
  const [embedState, setEmbedState] = useState<Phase>('loading');
  const [revision, setRevision] = useState(0);
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (unitStatus !== 'ready' || !unitId || authStatus !== 'authenticated') {
      setCatalogState({ phase: 'loading', catalog: null });
      return;
    }
    const controller = new AbortController();
    setCatalogState({ phase: 'loading', catalog: null });
    void getEmbeddedBiCatalog(unitId, controller.signal)
      .then((catalog) => {
        if (controller.signal.aborted) return;
        // A fresh catalog is required after unit changes; never reuse a prior unit's result.
        setSelectedKey((previous) =>
          catalog.items.some((item) => item.key === previous)
            ? previous
            : catalog.items[0]?.key ?? '',
        );
        setCatalogState({ phase: 'ready', catalog });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const phase: Phase = error instanceof EmbeddedBiError
          ? error.status === 403 ? 'denied' : error.status === 401 ? 'session_expired' : 'unavailable'
          : 'unavailable';
        setCatalogState({ phase, catalog: null });
      });
    return () => controller.abort();
  }, [unitId, unitStatus, authStatus, identityId, sessionId, revision]);

  useEffect(() => {
    if (catalogState.phase !== 'ready' || !selectedKey ||
        !catalogState.catalog?.items.some((item) => item.key === selectedKey) ||
        !unitId || authStatus !== 'authenticated') {
      return;
    }
    const point = mountRef.current;
    if (!point) return;
    const controller = new AbortController();
    let active = true;
    let instance: EmbeddedDashboard | null = null;
    setEmbedState('loading');
    point.replaceChildren();

    void (async () => {
      const ticket = await issueEmbeddedBiTicket(unitId, selectedKey, controller.signal);
      if (!active) return;

      // The SDK needs the guest token in memory. Never save it in browser storage.
      let initialToken: string | null = ticket.token;
      const embedded = await embedDashboard({
        id: ticket.dashboardId,
        supersetDomain: ticket.supersetDomain,
        mountPoint: point,
        iframeTitle: 'CISNE BI — painel analítico',
        dashboardUiConfig: { hideTitle: true },
        fetchGuestToken: async () => {
          if (!active) throw new Error('Embedded dashboard unmounted.');
          if (initialToken !== null) {
            const value = initialToken;
            initialToken = null;
            return value;
          }
          const refreshed = await issueEmbeddedBiTicket(unitId, selectedKey, controller.signal);
          // Refresh is re-authorized by CISNE PDP. Dashboard ID and origin must be stable.
          if (refreshed.dashboardId !== ticket.dashboardId ||
              refreshed.supersetDomain !== ticket.supersetDomain) {
            throw new Error('Embedded dashboard configuration changed.');
          }
          return refreshed.token;
        },
      });
      if (!active) {
        embedded.unmount();
        return;
      }
      instance = embedded;
      setEmbedState('ready');
    })().catch((error: unknown) => {
      if (!active || controller.signal.aborted) return;
      const phase: Phase = error instanceof EmbeddedBiError
        ? error.status === 403 ? 'denied' : error.status === 401 ? 'session_expired' : 'unavailable'
        : 'unavailable';
      setEmbedState(phase);
    });

    return () => {
      active = false;
      controller.abort();
      instance?.unmount();
      point.replaceChildren();
    };
  }, [unitId, selectedKey, catalogState, authStatus, identityId, sessionId]);

  useEffect(() => {
    if (catalogState.phase === 'session_expired' || embedState === 'session_expired') {
      expireSession();
    }
  }, [catalogState.phase, embedState, expireSession]);

  const phase = unitStatus === 'error' || (!unitId && unitStatus === 'ready')
    ? 'unavailable'
    : catalogState.phase !== 'ready'
      ? catalogState.phase
      : embedState;

  return (
    <ModulePage layout="wide">
      <ModulePageHeader
        title="BI e indicadores"
        description="Painéis analíticos autorizados por unidade operacional. Os relatórios existentes permanecem disponíveis."
      />
      <div className="flex flex-wrap items-end gap-4 py-4">
        <label className="flex min-w-56 flex-col gap-2 text-sm font-medium text-gray-800">
          Unidade operacional
          <select
            className="min-h-10 rounded-md border border-gray-300 bg-white px-3 py-2"
            value={unitId}
            onChange={(event) => setUnitId(event.currentTarget.value)}
            disabled={unitStatus !== 'ready'}
          >
            <OperationalUnitOptions options={options} />
          </select>
        </label>
        {catalogState.phase === 'ready' && catalogState.catalog?.items.length ? (
          <label className="flex min-w-56 flex-col gap-2 text-sm font-medium text-gray-800">
            Painel
            <select
              className="min-h-10 rounded-md border border-gray-300 bg-white px-3 py-2"
              value={selectedKey}
              onChange={(event) => setSelectedKey(event.currentTarget.value as SupersetDashboardKey)}
            >
              {catalogState.catalog.items.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="min-h-10 rounded-md border border-gray-300 px-4 text-sm"
          onClick={() => { reload(); setRevision((value) => value + 1); }}
        >
          Atualizar
        </button>
      </div>
      {phase === 'denied' ? (
        <p role="alert">Sem autorização para consultar os painéis desta unidade.</p>
      ) : null}
      {phase === 'unavailable' ? (
        <p role="alert">O serviço analítico está indisponível ou ainda não foi habilitado. Isso não significa ausência de dados.</p>
      ) : null}
      {phase === 'session_expired' ? (
        <p role="alert">Sua sessão expirou. Entre novamente para consultar os indicadores.</p>
      ) : null}
      {phase === 'loading' ? (
        <p aria-live="polite" role="status">Verificando permissões e carregando o painel…</p>
      ) : null}
      {/* Keep the mount node while switching loading states; iframe teardown is explicit. */}
      <div
        ref={mountRef}
        className={phase === 'ready' ? 'min-h-[65dvh] w-full overflow-hidden rounded-md border border-gray-200' : 'hidden'}
        aria-label="Painel analítico incorporado"
      />
    </ModulePage>
  );
}
