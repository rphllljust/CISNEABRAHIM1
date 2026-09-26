import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { listServiceRequests } from '../../requests/api/service-requests-api';
import { ServiceRequestStatusBadge } from '../../requests/components/ServiceRequestStatusBadge';
import { listProposals } from '../../proposals/api/proposals-api';
import { listPurchaseOrders } from '../../purchase-orders/api/purchase-orders-api';
import { PurchaseOrderStatusBadge } from '../../purchase-orders/components/PurchaseOrderStatusBadge';
import { listServiceOrders, type ServiceOrderSummary } from '../../service-orders/api/service-orders-api';
import { ServiceOrderStatusBadge } from '../../service-orders/components/ServiceOrderStatusBadge';

/**
 * Faixa "Relacionados" do Cliente.
 *
 * O Cliente e a contraparte de toda a cadeia comercial, mas a pagina de detalhe nao dizia
 * nada sobre ela. Aqui cada modulo que JA aceita `clientId` na sua listagem entrega os
 * ultimos registros reais daquele Cliente — sem contagem inventada, sem agregacao no
 * frontend e sem endpoint novo.
 *
 * Regras de honestidade:
 * - o que o usuario nao pode ler aparece como "sem acesso", nunca como zero;
 * - modulo vazio aparece como "nenhum registro", nunca com linha fantasma;
 * - a lista mostra no maximo RECENT_LIMIT registros por modulo (nao e um dashboard).
 */
const RECENT_LIMIT = 4;

type RelatedRow = {
  id: string;
  href: string;
  label: string;
  meta: string | null;
  badge: ReactNode;
};

type RelatedModuleState = {
  phase: 'loading' | 'ready' | 'denied' | 'error';
  rows: RelatedRow[];
};

const EMPTY_MODULE: RelatedModuleState = { phase: 'loading', rows: [] };

const MODULE_LABELS = {
  requests: 'Solicitações',
  proposals: 'Propostas',
  purchaseOrders: 'Pedidos de compra',
  serviceOrders: 'Ordens de serviço',
} as const;

type RelatedModules = Record<keyof typeof MODULE_LABELS, RelatedModuleState>;

const INITIAL_MODULES: RelatedModules = {
  requests: EMPTY_MODULE,
  proposals: EMPTY_MODULE,
  purchaseOrders: EMPTY_MODULE,
  serviceOrders: EMPTY_MODULE,
};

function isDenied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    (error as { kind?: unknown }).kind === 'denied'
  );
}

/** Somente apresentacao do instante: nenhum calculo de negocio. */
function formatShortDateTime(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(parsed);
}

function readSnapshotLabel(snapshot: Record<string, unknown> | null): string | null {
  if (!snapshot) {
    return null;
  }
  for (const key of ['tradeName', 'legalName', 'serviceName', 'name']) {
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

function serviceOrderMeta(order: ServiceOrderSummary): string | null {
  const parts: string[] = [];
  const serviceName = readSnapshotLabel(order.clientSnapshot);
  if (serviceName) {
    parts.push(serviceName);
  }
  const deadline = formatShortDateTime(order.deadlineAt);
  parts.push(deadline ? `Prazo ${deadline}` : 'Sem prazo');
  return parts.join(' · ');
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

async function loadRelated(
  clientId: string,
  signal: AbortSignal,
): Promise<RelatedModules> {
  const [requests, proposals, purchaseOrders, serviceOrders] = await Promise.all([
    settle(listServiceRequests({ limit: RECENT_LIMIT, offset: 0, clientId }, signal)),
    settle(listProposals({ limit: RECENT_LIMIT, offset: 0, clientId }, signal)),
    settle(listPurchaseOrders({ limit: RECENT_LIMIT, offset: 0, clientId }, signal)),
    settle(listServiceOrders({ limit: RECENT_LIMIT, offset: 0, clientId }, signal)),
  ]);

  return {
    requests: toModuleState(requests, (response) =>
      response.items.map((item) => ({
        id: item.id,
        href: `/app/requests/${item.id}`,
        label: item.requestCode,
        meta: item.description ?? formatShortDateTime(item.desiredStartAt),
        badge: <ServiceRequestStatusBadge status={item.status} />,
      })),
    ),
    proposals: toModuleState(proposals, (response) =>
      response.items.map((item) => ({
        id: item.id,
        href: `/app/proposals/${item.id}`,
        label: item.proposalCode,
        meta: item.title,
        badge:
          item.currentVersionNumber === null ? (
            <span className="text-xs text-gray-500">Sem versão emitida</span>
          ) : (
            <span className="text-xs text-gray-600">Revisão {item.currentVersionNumber}</span>
          ),
      })),
    ),
    purchaseOrders: toModuleState(purchaseOrders, (response) =>
      response.items.map((item) => ({
        id: item.id,
        href: `/app/purchase-orders/${item.id}`,
        label: item.poNumber,
        meta: item.issueDate ? `Emissão ${formatShortDateTime(item.issueDate)}` : item.internalCode,
        badge: <PurchaseOrderStatusBadge status={item.status} />,
      })),
    ),
    serviceOrders: toModuleState(serviceOrders, (response) =>
      response.items.map((item) => ({
        id: item.id,
        href: `/app/service-orders/${item.id}/planning`,
        label: item.orderNumber,
        meta: serviceOrderMeta(item),
        badge: <ServiceOrderStatusBadge status={item.status} />,
      })),
    ),
  };
}

function toModuleState<T>(settled: Settled<T>, map: (value: T) => RelatedRow[]): RelatedModuleState {
  if (!settled.ok) {
    return { phase: isDenied(settled.error) ? 'denied' : 'error', rows: [] };
  }
  return { phase: 'ready', rows: map(settled.value) };
}

function moduleSummary(state: RelatedModuleState): string {
  if (state.phase === 'loading') {
    return 'Carregando…';
  }
  if (state.phase === 'denied') {
    return 'Sem acesso neste perfil';
  }
  if (state.phase === 'error') {
    return 'Não foi possível carregar';
  }
  if (state.rows.length === 0) {
    return 'Nenhum registro';
  }
  return `${state.rows.length} mais recente${state.rows.length === 1 ? '' : 's'}`;
}

export function ClientRelatedRecords({ clientId }: { clientId: string }) {
  const [modules, setModules] = useState<RelatedModules>(INITIAL_MODULES);

  useEffect(() => {
    const controller = new AbortController();
    setModules(INITIAL_MODULES);
    void loadRelated(clientId, controller.signal).then((next) => {
      if (!controller.signal.aborted) {
        setModules(next);
      }
    });
    return () => controller.abort();
  }, [clientId]);

  const entries = useMemo(
    () => (Object.keys(MODULE_LABELS) as Array<keyof typeof MODULE_LABELS>),
    [],
  );

  return (
    <section className="client-section" aria-labelledby="client-related-heading">
      <h2 id="client-related-heading">Relacionados</h2>
      <p className="text-sm text-gray-500">
        Últimos registros deste Cliente na cadeia comercial. Cada item abre o documento de
        origem.
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-4">
        {entries.map((key) => {
          const state = modules[key];
          return (
            <div key={key} className="rounded-lg ring-1 ring-gray-900/5">
              <div className="flex items-baseline justify-between gap-2 border-b border-gray-100 px-3 py-2">
                <h3 className="text-xs font-semibold tracking-wide text-gray-700 uppercase">
                  {MODULE_LABELS[key]}
                </h3>
                <span className="text-xs text-gray-500">{moduleSummary(state)}</span>
              </div>
              {state.phase === 'ready' && state.rows.length > 0 ? (
                <ul className="divide-y divide-gray-100">
                  {state.rows.map((row) => (
                    <li key={row.id} className="px-3 py-2">
                      <Link
                        to={row.href}
                        className="text-sm font-semibold text-brand-700 no-underline hover:text-brand-800"
                      >
                        {row.label}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {row.badge}
                      </div>
                      {row.meta ? (
                        <p className="mt-1 truncate text-xs text-gray-500" title={row.meta}>
                          {row.meta}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
