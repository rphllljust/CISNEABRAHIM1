import { useEffect, useState, type ReactNode } from 'react';
import { getServiceRequestSummary, listServiceRequests } from '../../requests/api/service-requests-api';
import { ServiceRequestStatusBadge } from '../../requests/components/ServiceRequestStatusBadge';
import { listProposals } from '../../proposals/api/proposals-api';
import { listPurchaseOrders } from '../../purchase-orders/api/purchase-orders-api';
import { PurchaseOrderStatusBadge } from '../../purchase-orders/components/PurchaseOrderStatusBadge';
import {
  listServiceOrders,
  type ServiceOrderSummary,
} from '../../service-orders/api/service-orders-api';
import { ServiceOrderStatusBadge } from '../../service-orders/components/ServiceOrderStatusBadge';

/**
 * Dados reais da cadeia comercial de um Cliente — uma única leitura para a página inteira.
 *
 * A leitura é compartilhada entre a coluna de relacionamentos (`SmartRelationBar`) e os painéis
 * "Relacionados": uma requisição por módulo, sem agregação no frontend e sem endpoint novo.
 *
 * REGRAS DE HONESTIDADE (vinculantes):
 * - `allowed` é a decisão REAL do servidor: leitura negada (403) devolve `allowed: false`, e o que
 *   não é autorizado não vira rótulo, contagem nem a palavra "oculto".
 * - `count` só existe quando o backend COMPROVOU o conjunto: o total publicado pelo resumo de
 *   Solicitações, ou uma página devolvida SEM enchimento (o servidor entregou todos os registros
 *   do recorte). Página cheia significa "existe mais registro" — total desconhecido, logo `null`.
 *   Nunca se estima, nunca se soma no navegador.
 */
export const CLIENT_RECENT_LIMIT = 4;

/** Mesmo tamanho de página que as listagens dos módulos publicam (`limit` padrão = 20). */
export const CLIENT_RELATION_PAGE_SIZE = 20;

export type RelatedRow = {
  id: string;
  href: string;
  label: string;
  meta: string | null;
  badge: ReactNode;
};

export type RelatedModulePhase = 'loading' | 'ready' | 'denied' | 'error';

export type RelatedModule = {
  phase: RelatedModulePhase;
  /** Leitura AUTORIZADA pelo backend e concluída para este módulo. */
  allowed: boolean;
  /** Linhas reais do módulo, limitadas à faixa de exibição (`CLIENT_RECENT_LIMIT`). */
  rows: RelatedRow[];
  /** Contagem persistida EXATA do recorte. `null` = o backend não publicou o total. */
  count: number | null;
};

export type ClientRelatedModuleKey =
  | 'requests'
  | 'proposals'
  | 'purchaseOrders'
  | 'serviceOrders';

export type ClientRelatedModules = Record<ClientRelatedModuleKey, RelatedModule>;

const LOADING_MODULE: RelatedModule = {
  phase: 'loading',
  allowed: false,
  rows: [],
  count: null,
};

const INITIAL_MODULES: ClientRelatedModules = {
  requests: LOADING_MODULE,
  proposals: LOADING_MODULE,
  purchaseOrders: LOADING_MODULE,
  serviceOrders: LOADING_MODULE,
};

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

function isDenied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    (error as { kind?: unknown }).kind === 'denied'
  );
}

/**
 * Contagem comprovada pelo conjunto devolvido.
 *
 * O servidor só prova que entregou tudo quando devolve a MESMA página pedida e ela não vem cheia.
 * Página cheia (`items.length === limit`) pode esconder registros: o total é desconhecido.
 */
function completeCount(response: { items: unknown[]; limit: number }): number | null {
  if (response.limit !== CLIENT_RELATION_PAGE_SIZE) {
    return null;
  }
  if (response.items.length >= CLIENT_RELATION_PAGE_SIZE) {
    return null;
  }
  return response.items.length;
}

function toModule<T>(
  settled: Settled<T>,
  map: (value: T) => RelatedRow[],
  count: (value: T) => number | null,
): RelatedModule {
  if (!settled.ok) {
    const denied = isDenied(settled.error);
    return { phase: denied ? 'denied' : 'error', allowed: false, rows: [], count: null };
  }
  return {
    phase: 'ready',
    allowed: true,
    rows: map(settled.value).slice(0, CLIENT_RECENT_LIMIT),
    count: count(settled.value),
  };
}

/** Somente apresentação do instante: nenhum cálculo de negócio. */
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

async function loadModules(
  clientId: string,
  signal: AbortSignal,
): Promise<ClientRelatedModules> {
  const [requests, proposals, purchaseOrders, serviceOrders, requestsSummary] = await Promise.all([
    settle(listServiceRequests({ limit: CLIENT_RELATION_PAGE_SIZE, offset: 0, clientId }, signal)),
    settle(listProposals({ limit: CLIENT_RELATION_PAGE_SIZE, offset: 0, clientId }, signal)),
    settle(listPurchaseOrders({ limit: CLIENT_RELATION_PAGE_SIZE, offset: 0, clientId }, signal)),
    settle(listServiceOrders({ limit: CLIENT_RELATION_PAGE_SIZE, offset: 0, clientId }, signal)),
    settle(getServiceRequestSummary({ clientId }, signal)),
  ]);

  return {
    requests: toModule(
      requests,
      (response) =>
        response.items.map((item) => ({
          id: item.id,
          href: `/app/requests/${item.id}`,
          label: item.requestCode,
          meta: item.description ?? formatShortDateTime(item.desiredStartAt),
          badge: <ServiceRequestStatusBadge status={item.status} />,
        })),
      // O resumo publica o total do recorte, exato em qualquer volume; sem ele vale a página completa.
      (response) =>
        requestsSummary.ok ? requestsSummary.value.total : completeCount(response),
    ),
    proposals: toModule(
      proposals,
      (response) =>
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
      completeCount,
    ),
    purchaseOrders: toModule(
      purchaseOrders,
      (response) =>
        response.items.map((item) => ({
          id: item.id,
          href: `/app/purchase-orders/${item.id}`,
          label: item.poNumber,
          meta: item.issueDate ? `Emissão ${formatShortDateTime(item.issueDate)}` : item.internalCode,
          badge: <PurchaseOrderStatusBadge status={item.status} />,
        })),
      completeCount,
    ),
    serviceOrders: toModule(
      serviceOrders,
      (response) =>
        response.items.map((item) => ({
          id: item.id,
          href: `/app/service-orders/${item.id}/planning`,
          label: item.orderNumber,
          meta: serviceOrderMeta(item),
          badge: <ServiceOrderStatusBadge status={item.status} />,
        })),
      completeCount,
    ),
  };
}

export function useClientRelatedRecords(clientId: string | null): ClientRelatedModules {
  const [modules, setModules] = useState<ClientRelatedModules>(INITIAL_MODULES);

  useEffect(() => {
    if (!clientId) {
      setModules(INITIAL_MODULES);
      return;
    }

    const controller = new AbortController();
    setModules(INITIAL_MODULES);
    void loadModules(clientId, controller.signal).then((next) => {
      if (!controller.signal.aborted) {
        setModules(next);
      }
    });
    return () => controller.abort();
  }, [clientId]);

  return modules;
}
