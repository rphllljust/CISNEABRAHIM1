import type { ActivityFact } from '../../operator';
import {
  toHumanText,
  type NextAction,
  type ObjectContextField,
  type ObjectMetadataField,
  type ObjectStateStep,
  type SmartRelationSpec,
} from '../../enterprise-object';
import {
  SERVICE_ORDER_STATUSES,
  type ServiceOrderControlCenter,
  type ServiceOrderDetail,
  type ServiceOrderStatus,
} from '../types/service-order.types';
import { buildServiceOrdersListHref } from './service-order-list-params';
import { resolveServiceOrderNextAction, serviceOrderStagePath } from './service-order-next-action';
import {
  formatClientLabel,
  formatDateTime,
  formatServiceOrderHistoryEventDetail,
  formatServiceOrderHistoryEventLabel,
  formatServiceOrderOrigin,
  formatServiceOrderStatus,
} from './service-order-labels';

/**
 * CISNE — ORDEM DE SERVICO COMO OBJECT PAGE
 *
 * Adaptador entre os DADOS REAIS da OS e os primitivos do contrato enterprise
 * (`src/enterprise-object`). Aqui nao existe estado novo, contagem nova, ator novo nem
 * etapa nova: cada funcao abaixo LE o que o backend ja devolveu e nomeia em linguagem
 * operacional. O que nao existe simplesmente nao entra na lista.
 */

/**
 * Ciclo de vida real da OS, na ordem em que o backend permite as transicoes
 * (`apps/api/src/service-orders/domain/service-order.state-machine.ts`):
 * DRAFT -> PREPARED -> RELEASED -> IN_EXECUTION -> PAUSED -> COMPLETED, mais CANCELLED.
 */
const STATE_FLOW: readonly ServiceOrderStatus[] = [
  SERVICE_ORDER_STATUSES.Draft,
  SERVICE_ORDER_STATUSES.Prepared,
  SERVICE_ORDER_STATUSES.Released,
  SERVICE_ORDER_STATUSES.InExecution,
  SERVICE_ORDER_STATUSES.Paused,
  SERVICE_ORDER_STATUSES.Completed,
  SERVICE_ORDER_STATUSES.Cancelled,
];

/** Estados terminais segundo o proprio backend (`TERMINAL_SERVICE_ORDER_STATUSES`). */
const TERMINAL_STATUSES: readonly ServiceOrderStatus[] = [
  SERVICE_ORDER_STATUSES.Completed,
  SERVICE_ORDER_STATUSES.Cancelled,
];

const KNOWN_STATUSES: readonly string[] = Object.values(SERVICE_ORDER_STATUSES);

export type ServiceOrderStateFlow = {
  steps: ObjectStateStep[];
  /** Estado corrente REAL da OS; e ele que marca o passo atual do fluxo. */
  currentId: ServiceOrderStatus;
};

/**
 * Fluxo de processo da OS. Os passos sao os estados reais e o unico comentario de passo e o
 * instante PERSISTIDO daquele passo (criada/preparada/liberada/iniciada/pausada/concluida/
 * cancelada). Nao ha etapa derivada nem previsao.
 */
export function buildServiceOrderStateFlow(
  order: Pick<
    ServiceOrderDetail,
    | 'status'
    | 'createdAt'
    | 'preparedAt'
    | 'releasedAt'
    | 'startedAt'
    | 'pausedAt'
    | 'completedAt'
    | 'cancelledAt'
  >,
): ServiceOrderStateFlow {
  const persistedAt: Partial<Record<ServiceOrderStatus, string | null | undefined>> = {
    [SERVICE_ORDER_STATUSES.Draft]: order.createdAt,
    [SERVICE_ORDER_STATUSES.Prepared]: order.preparedAt,
    [SERVICE_ORDER_STATUSES.Released]: order.releasedAt,
    [SERVICE_ORDER_STATUSES.InExecution]: order.startedAt,
    [SERVICE_ORDER_STATUSES.Paused]: order.pausedAt,
    [SERVICE_ORDER_STATUSES.Completed]: order.completedAt,
    [SERVICE_ORDER_STATUSES.Cancelled]: order.cancelledAt,
  };

  const steps: ObjectStateStep[] = STATE_FLOW.map((status) => {
    const at = persistedAt[status] ?? null;
    return {
      id: status,
      label: formatServiceOrderStatus(status),
      hint: at ? `Registrado em ${formatDateTime(at)}` : undefined,
      terminal: TERMINAL_STATUSES.includes(status),
    };
  });

  return { steps, currentId: order.status };
}

/**
 * Nome humano do cliente a partir do snapshot PERSISTIDO na OS.
 *
 * `formatClientLabel` cai no identificador tecnico quando nao ha snapshot e usa "—" quando
 * nao ha nem identificador; nenhum dos dois e nome de cliente, entao os dois casos viram
 * `null` (omitir), nunca um placeholder na tela.
 */
export function serviceOrderClientName(
  order: Pick<ServiceOrderDetail, 'clientSnapshot' | 'clientId'>,
): string | null {
  const label = formatClientLabel(order.clientSnapshot, order.clientId);
  if (label === '—') {
    return null;
  }
  return toHumanText(label);
}

/**
 * Valor faturado SOMENTE quando o modulo de faturamento autorizou o bloco: o backend zera
 * total e moeda quando o ator nao pode ler faturamento (`maskedFacts`), e ausencia de bloco
 * nao e "valor zero".
 */
function billedAmount(controlCenter: ServiceOrderControlCenter | undefined): string | null {
  const total = toHumanText(controlCenter?.downstream.billing.totalAmount);
  if (!total) {
    return null;
  }
  const currency = toHumanText(controlCenter?.downstream.billing.currencyCode);
  return currency ? `${total} ${currency}` : total;
}

/**
 * Fatos curtos do cabecalho: apenas o que a OS realmente carrega.
 *
 * Quantidade executada NAO entra aqui: planejado x realizado ja tem superficie propria no
 * Operations Control Center, e duplicar a mesma leitura nao acrescenta informacao.
 */
export function buildServiceOrderMetadata(
  order: Pick<
    ServiceOrderDetail,
    'origin' | 'preparedAt' | 'releasedAt' | 'startedAt' | 'controlCenter'
  >,
): ObjectMetadataField[] {
  return [
    { label: 'Origem', value: formatServiceOrderOrigin(order.origin) },
    {
      label: 'Preparada em',
      value: order.preparedAt ? formatDateTime(order.preparedAt) : null,
    },
    {
      label: 'Liberada em',
      value: order.releasedAt ? formatDateTime(order.releasedAt) : null,
    },
    // Inicio operacional REAL: so existe quando a execucao foi efetivamente iniciada.
    {
      label: 'Início',
      value: order.startedAt ? formatDateTime(order.startedAt) : null,
      emphasis: true,
    },
    { label: 'Valor faturado', value: billedAmount(order.controlCenter), emphasis: true },
  ];
}

/**
 * Contexto empresarial do objeto. Campo sem dado real e omitido pelo primitivo.
 *
 * Sem unidade e sem responsavel: o detalhe da OS entrega apenas `unitId`
 * (identificador tecnico) e nao entrega o membro alocado — inventar esses dois fatos seria
 * mentir sobre o cadastro. Sem quantidade executada: e leitura de planejado x realizado, que
 * ja vive no Operations Control Center.
 */
export function buildServiceOrderContextFields(
  order: Pick<
    ServiceOrderDetail,
    'clientSnapshot' | 'clientId' | 'internalCode' | 'status' | 'description' | 'controlCenter'
  > & { serviceName?: string; serviceCode?: string },
): ObjectContextField[] {
  const service = toHumanText(order.serviceName);
  const serviceCode = toHumanText(order.serviceCode);
  const serviceLabel = service ? (serviceCode ? `${service} · ${serviceCode}` : service) : null;

  return [
    { label: 'Cliente', value: serviceOrderClientName(order), hint: 'Cliente registrado na OS' },
    { label: 'Serviço', value: serviceLabel },
    { label: 'Código interno', value: toHumanText(order.internalCode) },
    { label: 'Situação operacional', value: formatServiceOrderStatus(order.status) },
    { label: 'Descrição', value: toHumanText(order.description) },
  ];
}

/**
 * Relacoes reais do objeto, cada uma com CONTAGEM que existe e DESTINO realmente filtrado.
 *
 * AUTORIZACAO (`read A != read B`):
 * - execucoes pertencem ao agregado da OS e sao lidas com a leitura da OS (`canRead`);
 * - medicao e faturamento vem do Operations Control Center, que ZERA o bloco quando o ator
 *   nao tem autorizacao no modulo dono. Bloco zerado por autorizacao e indistinguivel de
 *   bloco autorizado e vazio, portanto a relacao e OMITIDA por inteiro em vez de exibir "0".
 *
 * Relacoes deliberadamente AUSENTES por falta de contagem real: Recursos/Alocacoes (nao ha
 * pagina de recursos filtrada por OS — o destino seria esta propria pagina) e Documentos
 * (nao existe contagem de documentos por OS no payload autorizado).
 */
export function buildServiceOrderRelationSpecs(input: {
  serviceOrderId: string;
  canReadServiceOrder: boolean;
  controlCenter?: ServiceOrderControlCenter | undefined;
}): SmartRelationSpec[] {
  const controlCenter = input.controlCenter;
  if (!controlCenter) {
    return [];
  }

  const measurement = controlCenter.downstream.measurement;
  const billing = controlCenter.downstream.billing;

  return [
    {
      id: 'executions',
      label: 'Execuções',
      count: controlCenter.plannedVsActual.executionEntries,
      to: serviceOrderStagePath(input.serviceOrderId, 'execution'),
      hint: 'Apontamentos de execução registrados na ordem de serviço',
      allowed: input.canReadServiceOrder,
    },
    {
      id: 'measurements',
      label: 'Medições',
      count: measurement.count,
      to: serviceOrderStagePath(input.serviceOrderId, 'measurement'),
      hint: 'Medições da ordem de serviço',
      allowed: measurement.status !== null,
    },
    {
      id: 'billing',
      label: 'Faturamento',
      count: billing.count,
      to: `/app/service-orders/${input.serviceOrderId}/billing`,
      hint: 'Registros de faturamento da ordem de serviço',
      allowed: billing.status !== null,
    },
  ];
}

/**
 * Proxima acao operacional, derivada de `resolveServiceOrderNextAction` (status real) somada
 * a autorizacao real e dado real.
 *
 * - etapa (execucao/medicao): destino real, liberado pela leitura da OS;
 * - etapa de planejamento: acontece NESTA pagina — o painel nomeia o passo sem oferecer um
 *   link que voltaria para o mesmo lugar;
 * - transicao de ciclo de vida (preparar/liberar/reabrir): o comando existe na lista de OS
 *   filtrada pelo numero real. O controle so aparece quando `availableTransitions` (avaliado
 *   pelo backend com a acao exata de cada comando) confirma a transicao para este ator;
 * - sem derivacao honesta: `null`, e a secao desaparece.
 */
export function buildServiceOrderNextAction(input: {
  serviceOrderId: string;
  orderNumber: string;
  status: ServiceOrderStatus;
  availableTransitions: readonly string[];
  canReadServiceOrder: boolean;
}): NextAction | null {
  const derived = resolveServiceOrderNextAction(input.status);

  if (derived.kind === 'stage') {
    if (derived.stage === 'planning') {
      return {
        kind: 'act',
        label: derived.label,
        description: 'Planejamento e alocação são feitos nesta página.',
      };
    }
    if (!input.canReadServiceOrder) {
      return null;
    }
    return {
      kind: 'act',
      label: derived.label,
      to: serviceOrderStagePath(input.serviceOrderId, derived.stage),
    };
  }

  if (derived.kind === 'lifecycle') {
    const confirmed = input.availableTransitions.includes(derived.intent);
    return {
      kind: 'act',
      label: derived.label,
      description: confirmed
        ? 'Transição de ciclo de vida executada na lista de ordens de serviço.'
        : undefined,
      to: confirmed ? buildServiceOrdersListHref({ q: input.orderNumber }) : undefined,
    };
  }

  return null;
}

function persistedStatusLabel(value: unknown): string | null {
  if (typeof value !== 'string' || !KNOWN_STATUSES.includes(value)) {
    return null;
  }
  return formatServiceOrderStatus(value as ServiceOrderStatus);
}

/**
 * Historico da OS a partir da trilha PERSISTIDA (`historyEvents`).
 *
 * `actorIdentityId` e identificador tecnico da identidade: nunca vira ator na interface e
 * nunca e substituido por "Sistema". O detalhe do evento vem do payload persistido e passa
 * pela guarda de texto humano, que descarta qualquer identificador tecnico.
 */
export function buildServiceOrderHistoryFacts(
  order: Pick<ServiceOrderDetail, 'historyEvents'>,
): ActivityFact[] {
  return order.historyEvents.flatMap((event) => {
    const at = toHumanText(event.occurredAt);
    const label = toHumanText(formatServiceOrderHistoryEventLabel(event.eventType));
    if (!at || !label) {
      return [];
    }
    const payload = event.payload ?? {};
    const detail = toHumanText(formatServiceOrderHistoryEventDetail(event));
    const fact: ActivityFact = {
      at,
      event: label,
      fromState: persistedStatusLabel(payload['fromStatus']),
      toState: persistedStatusLabel(payload['toStatus']),
      reference: detail,
    };
    return [fact];
  });
}
