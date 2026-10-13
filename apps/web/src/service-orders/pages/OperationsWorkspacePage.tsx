import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ModulePage } from '../../ui/module-layout';
import { DateTime, Button } from '../../ui';
import { WorklistHeader, WorklistStatePanel } from '../../ui/enterprise-list';
import {
  WorkbenchQueue,
  WorkbenchQueueItem,
  workbenchPrimaryActionClass,
  workbenchSecondaryActionClass,
} from '../../ui/workbench';
import { ContextDrawer, type ContextField } from '../../operator';
import { isTechnicalIdentity } from '../../shell/format-identity';
import { ServiceOrderStatusBadge, SERVICE_ORDER_STATUS_TONES } from '../components/ServiceOrderStatusBadge';
import { listServiceOrders, ServiceOrdersApiError } from '../api/service-orders-api';
import type { ServiceOrderSummary } from '../api/service-orders-api';
import { formatServiceOrderStatus } from '../utils/service-order-labels';
import { SERVICE_ORDER_STATUSES } from '../types/service-order.types';
import { DomainWorkZones } from '../../workspaces/components/DomainWorkZones';
import { WorkspaceQueueSurface } from '../../workspaces/components/WorkspaceQueueSurface';
import {
  ALL_WORKSPACE_QUEUE_SCOPE,
} from '../../workspaces/api/workspace-queue-model';
import { OperationsObjectContext } from '../components/OperationsObjectContext';

/**
 * WORKSPACE DE OPERAÇÕES — `/app/workspaces/operacoes`.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE A TELA NAO E MAIS UMA LISTA DE OS
 *
 * A operacao tinha uma lista e uma object page. O operador via OS em tabela, abria uma, voltava,
 * abria outra — o modo "menu -> tabela -> formulario -> voltar" que nao e trabalho. Aqui a operacao
 * e uma AREA DE TRABALHO com quatro camadas, na ordem em que a decisao acontece:
 *
 *   1. EXECUCAO AGORA      — o que esta em execucao e o que esta pausado. Sao os unicos estados em
 *                            que existe trabalho fisico em curso e o operador pode agir.
 *   2. AGUARDANDO MEDICAO  — OS liberadas/encerradas sem medicao registrada. E a pendencia real que
 *                            trava faturamento, e ela nao aparecia em lugar nenhum.
 *   3. FILA DE OPERACOES   — o read model unificado (`GET /work-inbox`, `domain=OPERACOES`), com
 *                            contexto, proxima acao e visoes salvas — a MESMA superficie dos demais
 *                            dominios.
 *   4. CARTEIRA            — todas as OS liberadas, com o estado real e o caminho para a object page.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA TELA NAO FAZ
 *
 * - Nao inventa contagem: `listServiceOrders` NAO publica `total` (o contrato devolve
 *   `{ items, limit, offset }`). Por isso a carteira diz "as primeiras N OS lidas", nunca "N OS no
 *   total" — apresentar a pagina como conjunto seria exatamente o defeito que se quer eliminar.
 * - Nao inventa prioridade nem SLA. O prazo exibido e `deadlineAt`, derivado pelo backend; sem ele,
 *   nao ha atraso a declarar.
 * - Nao inventa permissao: a leitura negada e declarada, e a zona nao aparece vazia por causa dela.
 * - Nao cria comando novo. As acoes da linha sao rotas que JA existem (execucao e object page).
 */

/**
 * Estados em que existe execucao fisica em curso e estados em que a OS ja passou do ponto de
 * execucao — os recortes que a tela executa no servidor.
 *
 * Eles NAO sao listas decorativas: cada valor e usado como `status` em `listServiceOrders`, ou seja,
 * cada um gera UMA leitura recortada pelo servidor. Estao declarados aqui para que a tela diga o
 * recorte em um lugar so.
 */
const CARD_LIMIT = 12;

type Slice<T> = { data: T | null; error: string | null; denied: boolean };

function failureCopy(reason: unknown, subject: string): { error: string; denied: boolean } {
  if (reason instanceof ServiceOrdersApiError) {
    if (reason.kind === 'denied') {
      return { error: `Você não tem permissão para ler ${subject}.`, denied: true };
    }
    if (reason.kind === 'network') {
      return {
        error: `Não foi possível falar com o servidor: ${subject} é desconhecido nesta leitura — não é zero.`,
        denied: false,
      };
    }
  }
  return { error: `Não foi possível ler ${subject}.`, denied: false };
}

type OperationsData = {
  inExecution: Slice<ServiceOrderSummary[]>;
  paused: Slice<ServiceOrderSummary[]>;
  withoutMeasurement: Slice<ServiceOrderSummary[]>;
  portfolio: Slice<ServiceOrderSummary[]>;
};

/**
 * Dias desde o prazo operacional DERIVADO PELO BACKEND. `null` sem prazo ou com prazo futuro.
 * Nao ha SLA calculado na tela: o unico fato afirmado e que o prazo publicado ja passou.
 */
function daysLate(deadlineAt: string | null, now: Date = new Date()): number | null {
  if (!deadlineAt) {
    return null;
  }
  const deadline = new Date(deadlineAt);
  if (Number.isNaN(deadline.getTime())) {
    return null;
  }
  const startOfDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const elapsed = Math.floor((startOfDay(now) - startOfDay(deadline)) / 86_400_000);
  return elapsed > 0 ? elapsed : null;
}

/** Rotulo humano do cliente a partir do snapshot real publicado pelo servidor. */
function clientLabel(order: ServiceOrderSummary): string | null {
  const snapshot = order.clientSnapshot;
  if (!snapshot) {
    return null;
  }
  for (const key of ['name', 'legalName', 'tradeName', 'displayName']) {
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

export function OperationsWorkspacePage() {
  const [state, setState] = useState<
    { phase: 'loading' } | { phase: 'ready'; data: OperationsData }
  >({ phase: 'loading' });
  const [selected, setSelected] = useState<ServiceOrderSummary | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async (signal: AbortSignal): Promise<OperationsData> => {
    const [inExecution, paused, released, completed] = await Promise.allSettled([
      listServiceOrders({ limit: CARD_LIMIT, status: SERVICE_ORDER_STATUSES.InExecution }, signal),
      listServiceOrders({ limit: CARD_LIMIT, status: SERVICE_ORDER_STATUSES.Paused }, signal),
      listServiceOrders({ limit: CARD_LIMIT, status: SERVICE_ORDER_STATUSES.Released }, signal),
      listServiceOrders({ limit: CARD_LIMIT, status: SERVICE_ORDER_STATUSES.Completed }, signal),
    ]);

    const slice = (
      result: PromiseSettledResult<{ items: ServiceOrderSummary[] }>,
      subject: string,
    ): Slice<ServiceOrderSummary[]> =>
      result.status === 'fulfilled'
        ? { data: result.value.items, error: null, denied: false }
        : { data: null, ...failureCopy(result.reason, subject) };

    /*
     * AGUARDANDO MEDICAO — as OS encerradas e as liberadas compõem a mesma pergunta: quais ja
     * passaram do ponto de execucao e ainda nao tem medicao. A tela NAO afirma que todas estao sem
     * medicao: `listServiceOrders` nao publica esse campo. O que ela faz e entregar o recorte exato
     * ("liberadas e encerradas") com a acao de registrar medicao — a leitura de medicao continua
     * sendo a da propria OS, no dominio que a possui.
     */
    const completedItems = completed.status === 'fulfilled' ? completed.value.items : [];
    const releasedItems = released.status === 'fulfilled' ? released.value.items : [];
    const measurementFailure =
      completed.status === 'rejected'
        ? failureCopy(completed.reason, 'as ordens encerradas')
        : released.status === 'rejected'
          ? failureCopy(released.reason, 'as ordens liberadas')
          : null;

    return {
      inExecution: slice(inExecution, 'as ordens em execução'),
      paused: slice(paused, 'as ordens pausadas'),
      withoutMeasurement: measurementFailure
        ? { data: null, ...measurementFailure }
        : { data: [...releasedItems, ...completedItems], error: null, denied: false },
      portfolio: slice(released, 'a carteira de ordens liberadas'),
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function run() {
      setState({ phase: 'loading' });
      const data = await load(controller.signal);
      if (active && !controller.signal.aborted) {
        setState({ phase: 'ready', data });
      }
    }

    void run();
    return () => {
      active = false;
      controller.abort();
    };
  }, [load, reloadToken]);

  const data = state.phase === 'ready' ? state.data : null;
  const reload = () => setReloadToken((token) => token + 1);

  return (
    <ModulePage layout="workspace">
      <WorklistHeader
        title="Operações"
        count={data ? (data.inExecution.data?.length ?? 0) + (data.paused.data?.length ?? 0) : null}
        context="Execução em curso, ordens sem medição, fila de trabalho do domínio e a carteira liberada. Exceção primeiro; cada item abre a ordem que o forma."
        action={
          <Button type="button" variant="secondary" onClick={reload}>
            Atualizar
          </Button>
        }
      />

      {state.phase === 'loading' ? (
        <WorklistStatePanel
          title="Lendo a operação"
          description="Execução, medição e carteira estão sendo lidas do servidor."
        />
      ) : null}

      {data ? (
        <>
          {/* 1. EXECUCAO AGORA — o unico estado em que existe trabalho fisico em curso. */}
          <WorkbenchQueue
            title="Execução agora"
            regionLabel="Execução em curso"
            count={
              data.inExecution.data && data.paused.data
                ? data.inExecution.data.length + data.paused.data.length
                : null
            }
            description="Ordens em execução e pausadas — as primeiras linhas lidas do servidor. A ordem completa abre na execução."
            emptyTitle="Nenhuma ordem em execução ou pausada"
            emptyDescription="O servidor não devolveu ordens neste estado para o seu escopo."
            action={
              <Link className={workbenchSecondaryActionClass} to="/app/service-orders?status=active">
                Abrir todas as ordens ativas
              </Link>
            }
          >
            {(
              [
                ...(data.inExecution.data ?? []),
                ...(data.paused.data ?? []),
              ] as ServiceOrderSummary[]
            ).map((order) => (
              <ServiceOrderQueueRow key={order.id} order={order} onSelect={setSelected} />
            ))}

            {data.inExecution.error ? (
              <p role="alert" className="m-0 px-2.5 py-2 text-xs text-red-700">
                {data.inExecution.error}
              </p>
            ) : null}
            {data.paused.error ? (
              <p role="alert" className="m-0 px-2.5 py-2 text-xs text-red-700">
                {data.paused.error}
              </p>
            ) : null}
          </WorkbenchQueue>

          {/* 2. AGUARDANDO MEDICAO — o que trava faturamento e nao aparecia em lugar nenhum. */}
          <WorkbenchQueue
            title="Aguardando medição"
            regionLabel="Ordens aguardando medição"
            count={data.withoutMeasurement.data?.length ?? null}
            description="Ordens liberadas e encerradas — o recorte que antecede a medição e o faturamento."
            emptyTitle="Nenhuma ordem aguardando medição"
            emptyDescription="Nenhuma ordem liberada ou encerrada foi devolvida pelo servidor neste escopo."
            action={
              <Link className={workbenchSecondaryActionClass} to="/app/service-orders?status=COMPLETED">
                Abrir ordens encerradas
              </Link>
            }
          >
            {(data.withoutMeasurement.data ?? []).map((order) => (
              <ServiceOrderQueueRow
                key={order.id}
                order={order}
                onSelect={setSelected}
                actionLabel="Registrar medição"
                actionRoute={`/app/service-orders/${order.id}/execution`}
              />
            ))}

            {data.withoutMeasurement.error ? (
              <p role="alert" className="m-0 px-2.5 py-2 text-xs text-red-700">
                {data.withoutMeasurement.error}
              </p>
            ) : null}
          </WorkbenchQueue>

          {/* 3. FILA DE OPERACOES — o read model unificado, com contexto e visoes salvas. */}
          <WorkspaceQueueSurface
            title="Fila de operações"
            ariaLabel="Fila de trabalho de operações"
            description="Exceções e decisões reais da operação"
            lockDomain="OPERACOES"
            savedViewsScope="workspace.OPERACOES"
            scopeSource="local"
            initialScope={ALL_WORKSPACE_QUEUE_SCOPE}
          />

          {/* 4. CARTEIRA — todas as OS liberadas, com o caminho para a object page. */}
          <WorkbenchQueue
            title="Carteira liberada"
            regionLabel="Carteira de ordens liberadas"
            count={data.portfolio.data?.length ?? null}
            description="As primeiras ordens liberadas lidas do servidor. O contrato da lista não publica totalizador — por isso a tela diz quantas foram lidas, nunca quantas existem."
            emptyTitle="Nenhuma ordem liberada"
            emptyDescription="O servidor não devolveu ordens liberadas para o seu escopo."
            action={
              <Link className={workbenchSecondaryActionClass} to="/app/service-orders?status=RELEASED">
                Abrir lista completa de ordens
              </Link>
            }
          >
            {(data.portfolio.data ?? []).map((order) => (
              <ServiceOrderQueueRow key={order.id} order={order} onSelect={setSelected} />
            ))}

            {data.portfolio.error ? (
              <p role="alert" className="m-0 px-2.5 py-2 text-xs text-red-700">
                {data.portfolio.error}
              </p>
            ) : null}
          </WorkbenchQueue>

          {/* 5. AGORA / ATENCAO / CONTINUAR — as zonas de dominio, com o contexto do ciclo. */}
          <DomainWorkZones domain="OPERACOES" />
        </>
      ) : null}

      {/*
        CONTEXTO DA ORDEM — o mesmo primitivo lateral das demais filas, com a CADEIA DE NEGOCIO e o
        contexto de cliente/contrato DENTRO do drawer. Ele NAO substitui a object page: entrega o
        suficiente para decidir e a proxima acao real, que e a execucao — mas agora o operador
        descobre de onde a ordem veio sem sair da fila.
      */}
      <ContextDrawer
        open={selected !== null}
        title="Contexto da ordem de serviço"
        onClose={() => setSelected(null)}
        preview={
          selected
            ? {
                identifier: selected.orderNumber,
                subtitle: selected.description ?? 'Ordem de serviço',
                status: <ServiceOrderStatusBadge status={selected.status} />,
                facts: orderFacts(selected),
                nextAction: {
                  label: 'Abrir execução',
                  href: `/app/service-orders/${selected.id}/execution`,
                  kind: 'primary',
                },
                detailHref: `/app/service-orders/${selected.id}`,
                detailLabel: 'Abrir ordem completa',
                /* Cliente, contrato e CADEIA DE NEGOCIO — dentro do MESMO drawer. */
                body: <OperationsObjectContext order={selected} />,
              }
            : null
        }
      />
    </ModulePage>
  );
}

/** Fatos da ordem — so o que o servidor publicou, sem rotulo derivado de identificador tecnico. */
function orderFacts(order: ServiceOrderSummary): ContextField[] {
  const facts: ContextField[] = [
    { label: 'Ordem', value: order.orderNumber },
    { label: 'Situação', value: formatServiceOrderStatus(order.status) },
  ];

  const client = clientLabel(order);
  if (client) {
    facts.push({ label: 'Cliente', value: client });
  } else if (order.clientId) {
    facts.push({ label: 'Cliente', value: 'Cliente identificado no cadastro' });
  }

  if (order.unitId && !isTechnicalIdentity(order.unitId)) {
    facts.push({ label: 'Unidade', value: order.unitId });
  }

  if (order.assignedWorkforceMember) {
    facts.push({ label: 'Responsável', value: order.assignedWorkforceMember.displayName });
  }

  if (order.description) {
    facts.push({ label: 'Descrição', value: order.description });
  }

  if (order.deadlineAt) {
    const late = daysLate(order.deadlineAt);
    facts.push({
      label: 'Prazo operacional',
      value: late !== null ? `${late} dia${late === 1 ? '' : 's'} em atraso` : 'dentro do prazo',
    });
  }

  return facts;
}

/**
 * LINHA DE ORDEM NA FILA.
 *
 * Mesma ordem de leitura de toda fila do produto: SEVERIDADE -> MOTIVO -> OBJETO -> PRAZO -> ACAO.
 * A severidade vem do estado real da OS; o atraso vem do prazo DERIVADO pelo backend. Nada aqui e
 * score nem prioridade calculada.
 */
function ServiceOrderQueueRow({
  order,
  onSelect,
  actionLabel,
  actionRoute,
}: {
  order: ServiceOrderSummary;
  onSelect: (order: ServiceOrderSummary) => void;
  actionLabel?: string;
  actionRoute?: string;
}) {
  const late = daysLate(order.deadlineAt);
  const client = clientLabel(order);
  const tone = SERVICE_ORDER_STATUS_TONES[order.status];

  return (
    <WorkbenchQueueItem
      severity={<ServiceOrderStatusBadge status={order.status} />}
      severityTone={late !== null ? 'critical' : tone === 'warning' ? 'warning' : 'info'}
      title={order.description ?? `Ordem ${order.orderNumber}`}
      reason={
        late !== null
          ? `${late} dia${late === 1 ? '' : 's'} além do prazo operacional publicado`
          : undefined
      }
      context={
        <>
          <button
            type="button"
            onClick={() => onSelect(order)}
            title="Ver o contexto desta ordem"
            className="text-xs font-semibold text-brand-700 hover:text-brand-800"
          >
            {order.orderNumber}
          </button>
          {client ? <span className="ml-3">{client}</span> : null}
          {order.assignedWorkforceMember ? (
            <span className="ml-3">{order.assignedWorkforceMember.displayName}</span>
          ) : (
            <span className="ml-3 text-gray-500">Sem responsável atribuído</span>
          )}
        </>
      }
      age={
        order.deadlineAt ? (
          <>
            Prazo <DateTime value={order.deadlineAt} mode="date" />
          </>
        ) : (
          'sem prazo publicado'
        )
      }
      action={
        <Link
          className={workbenchPrimaryActionClass}
          to={actionRoute ?? `/app/service-orders/${order.id}/execution`}
        >
          {actionLabel ?? 'Abrir execução'}
        </Link>
      }
      drilldown={
        <Link className={workbenchSecondaryActionClass} to={`/app/service-orders/${order.id}`}>
          Ver ordem
        </Link>
      }
    />
  );
}
