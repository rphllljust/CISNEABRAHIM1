import { useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { getPhysicalAsset, listPhysicalAssets } from '../../assets/api/physical-assets-api';
import type { PhysicalAsset } from '../../assets/types/physical-asset.types';
import { listPeople } from '../../people/api/people-api';
import type { Person } from '../../people/types/person.types';
import { ConfirmDialog } from '../../clients/components/ConfirmDialog';
import {
  buildAuthorizedRelations,
  EnterpriseObjectHeader,
  EnterpriseObjectPage,
  NextActionPanel,
  ObjectContextBlock,
  ObjectPanel,
  ObjectStateFlow,
  SmartRelationBar,
  type ObjectAction,
} from '../../enterprise-object';
import { ActivityTimeline } from '../../operator';
import { BusinessChain, useBusinessChain } from '../../business-chain';
import { ModulePage, ModulePageHeader } from '../../ui';
import type { BreadcrumbItem } from '../../ui/Breadcrumb';
import { getServiceOrder } from '../api/service-orders-api';
import { ServiceOrdersApiError } from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import {
  allocateResource,
  listAllocations,
  listPlannedResources,
  planResource,
  removeAllocation,
} from '../api/service-order-planning-api';
import { RequirementCoverageTable } from '../components/RequirementCoverageTable';
import { OperationsControlCenter } from '../components/OperationsControlCenter';
import { SERVICE_ORDER_STATUS_TONES } from '../components/ServiceOrderStatusBadge';
import { useServiceOrderPlanningCapabilities } from '../hooks/useServiceOrderPlanningCapabilities';
import { PLANNED_RESOURCE_KINDS, type PlannedResource, type ResourceAllocation } from '../types/resource-planning.types';
import { SERVICE_ORDER_STATUSES, type ServiceOrderDetail, type ServiceOrderStatus } from '../types/service-order.types';
import { buildRequirementCoverage } from '../utils/planning-aggregates';
import { buildServiceOrdersListHref } from '../utils/service-order-list-params';
import { useAvailableActions } from '../hooks/useAvailableActions';
import { formatServiceOrderStatus, toHumanStatusLabel } from '../utils/service-order-labels';
import {
  buildServiceOrderContextFields,
  buildServiceOrderHistoryFacts,
  buildServiceOrderMetadata,
  buildServiceOrderNextAction,
  buildServiceOrderRelationSpecs,
  buildServiceOrderStateFlow,
  serviceOrderClientName,
} from '../utils/service-order-object-view';

type PageState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      order: ServiceOrderDetail;
      planned: PlannedResource[];
      allocations: ResourceAllocation[];
    };

/**
 * EXCECAO DA ORDEM, no topo e SO quando existe FATO.
 *
 * Nenhum score, nenhuma prioridade artificial. Cada linha e um estado verificavel do
 * payload autorizado:
 *  - requisito planejado sem alocacao ativa (o trabalho nao tem recurso);
 *  - execucao iniciada sem alocacao registrada;
 *  - medicao pendente com execucao em curso;
 *  - medicao registrada e faturamento ainda nao preparado.
 *
 * Sem excecao real o componente NAO RENDERIZA: nao se reserva area para dizer
 * "esta tudo bem".
 */
export function ServiceOrderAttentionStrip({
  status,
  awaitingAllocation,
  plannedCount,
  activeAllocationCount,
  measurementCount,
  billingCount,
}: {
  status: ServiceOrderStatus;
  awaitingAllocation: PlannedResource | null;
  plannedCount: number;
  activeAllocationCount: number;
  measurementCount: number | null;
  billingCount: number | null;
}) {
  const exceptions: string[] = [];

  if (status === SERVICE_ORDER_STATUSES.InExecution && activeAllocationCount === 0) {
    exceptions.push('Execução iniciada sem nenhuma alocação ativa registrada.');
  } else if (awaitingAllocation && activeAllocationCount < plannedCount) {
    exceptions.push(
      `${plannedCount - activeAllocationCount} requisito(s) planejado(s) ainda sem alocação ativa.`,
    );
  }

  if (status === SERVICE_ORDER_STATUSES.InExecution && measurementCount === 0) {
    exceptions.push('Em execução sem nenhuma medição registrada.');
  }

  if (measurementCount !== null && measurementCount > 0 && billingCount === 0) {
    exceptions.push('Há medição registrada e nenhum faturamento preparado.');
  }

  if (exceptions.length === 0) {
    return null;
  }

  return (
    <div className="so-attention" role="alert" aria-label="Exceções da ordem de serviço">
      <span className="so-attention__title">Atenção</span>
      <ul className="so-attention__list">
        {exceptions.map((exception) => (
          <li key={exception}>{exception}</li>
        ))}
      </ul>
    </div>
  );
}

function formatPersonLabel(person: Person): string {
  const name = person.preferredName || person.legalName;
  return `${name} (${person.memberCode})`;
}

function formatAllocatedResource(
  allocation: ResourceAllocation,
  peopleById: Record<string, Person>,
  assetsById: Record<string, PhysicalAsset>,
): string {
  if (allocation.workforceMemberId) {
    const person = peopleById[allocation.workforceMemberId];
    return person ? formatPersonLabel(person) : `Empregado ${allocation.workforceMemberId.slice(0, 8)}...`;
  }
  if (allocation.physicalAssetId) {
    const asset = assetsById[allocation.physicalAssetId];
    return asset ? `${asset.name} (${asset.assetCode})` : `Ativo ${allocation.physicalAssetId.slice(0, 8)}...`;
  }
  return '-';
}

export function ServiceOrderPlanningPage() {
  const { serviceOrderId = '' } = useParams();
  const navigate = useNavigate();
  const { capabilities } = useServiceOrderPlanningCapabilities();
  /**
   * AÇÃO PRIMÁRIA — comandos válidos vindos do BACKEND.
   *
   * Chamado AQUI, no topo, e não junto do uso: os estados de página (loading/denied/
   * not_found/error) fazem `return` antecipado antes de `order` existir, e um hook depois
   * desses returns viola as Rules of Hooks ("Rendered more hooks than during the previous
   * render"). O id vem da rota, então está disponível desde o primeiro render.
   *
   * Antes de B5 esta página derivava o próximo passo de um mapa local de status
   * (`resolveServiceOrderNextAction`) e só depois conferia `availableTransitions`.
   */
  const commands = useAvailableActions(serviceOrderId, serviceOrderId.length > 0);
  // Cadeia empresarial desta OS: origem comercial (solicitação, proposta, pedido) e resultado
  // operacional (medição, faturamento) em UMA requisição, já autorizados pelo servidor.
  const businessChain = useBusinessChain('SERVICE_ORDER', serviceOrderId);
  const feedbackId = useId();
  const [state, setState] = useState<PageState>({ phase: 'loading' });
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success' | 'info'; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [selectedPlannedId, setSelectedPlannedId] = useState('');
  const [operationalStart, setOperationalStart] = useState('');
  const [operationalEnd, setOperationalEnd] = useState('');
  const [allocateKind, setAllocateKind] = useState<'PHYSICAL_RESOURCE' | 'LABOR'>('PHYSICAL_RESOURCE');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [assets, setAssets] = useState<PhysicalAsset[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [knownPeople, setKnownPeople] = useState<Record<string, Person>>({});
  const [knownAssets, setKnownAssets] = useState<Record<string, PhysicalAsset>>({});
  const attemptedAssetLabels = useRef<Set<string>>(new Set());
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [allocationConflictAssetId, setAllocationConflictAssetId] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++requestSeq.current;
    setState({ phase: 'loading' });
    try {
      const [order, planned, allocations] = await Promise.all([
        getServiceOrder(serviceOrderId),
        listPlannedResources(serviceOrderId),
        listAllocations(serviceOrderId),
      ]);
      if (seq !== requestSeq.current) {
        return;
      }
      setState({ phase: 'ready', order, planned, allocations });
    } catch (error) {
      if (seq !== requestSeq.current) {
        return;
      }
      if (error instanceof ServiceOrdersApiError) {
        if (error.kind === 'denied') {
          setState({ phase: 'denied' });
          return;
        }
        if (error.kind === 'not_found') {
          setState({ phase: 'not_found' });
          return;
        }
      }
      setState({
        phase: 'error',
        message:
          error instanceof ServiceOrdersApiError
            ? mapServiceOrdersErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar o planejamento.',
      });
    }
  }, [serviceOrderId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadAssets = useCallback(
    async (resourceTypeCode: string, signal: AbortSignal) => {
      setAssetsLoading(true);
      try {
        const response = await listPhysicalAssets({ limit: 100, offset: 0 }, signal);
        const filtered = response.items.filter((asset) => asset.resourceTypeCode === resourceTypeCode);
        if (!signal.aborted) {
          setAssets(filtered);
        }
      } catch {
        if (!signal.aborted) {
          setAssets([]);
        }
      } finally {
        if (!signal.aborted) {
          setAssetsLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (state.phase !== 'ready') {
      return;
    }
    const codes = [
      ...new Set(
        state.planned
          .map((item) => item.laborTypeCode)
          .filter((code): code is string => Boolean(code)),
      ),
    ];
    if (codes.length === 0) {
      return;
    }
    const controller = new AbortController();
    void Promise.all(
      codes.map((code) =>
        listPeople(
          { limit: 100, offset: 0, status: 'ACTIVE', defaultLaborTypeCode: code },
          controller.signal,
        ),
      ),
    )
      .then((pages) => {
        if (controller.signal.aborted) {
          return;
        }
        const items = pages.flatMap((page) => page.items);
        setKnownPeople((current) => ({
          ...current,
          ...Object.fromEntries(items.map((person) => [person.id, person])),
        }));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [state]);

  /**
   * Rotulos legiveis das alocacoes confirmadas: a alocacao referencia o ativo por id,
   * portanto o nome/codigo precisa ser resolvido no cadastro. Nunca exibir UUID como
   * identificacao principal; se a leitura do ativo for negada, mantem-se o fallback.
   */
  useEffect(() => {
    if (state.phase !== 'ready') {
      return;
    }
    const missing = [
      ...new Set(
        state.allocations
          .map((item) => item.physicalAssetId)
          .filter((id): id is string => Boolean(id)),
      ),
    ].filter((id) => !attemptedAssetLabels.current.has(id));
    if (missing.length === 0) {
      return;
    }
    for (const id of missing) {
      attemptedAssetLabels.current.add(id);
    }
    const controller = new AbortController();
    void Promise.all(
      missing.map((id) =>
        getPhysicalAsset(id, controller.signal)
          .then((asset) => [id, asset] as const)
          .catch(() => null),
      ),
    ).then((results) => {
      if (controller.signal.aborted) {
        return;
      }
      const entries = results.filter(
        (entry): entry is readonly [string, PhysicalAsset] => entry !== null,
      );
      if (entries.length === 0) {
        return;
      }
      setKnownAssets((current) => ({ ...current, ...Object.fromEntries(entries) }));
    });
    return () => controller.abort();
  }, [state]);

  useEffect(() => {
    if (!allocateOpen || state.phase !== 'ready' || !selectedPlannedId) {
      return;
    }
    const planned = state.planned.find((item) => item.id === selectedPlannedId);
    if (!planned) {
      return;
    }
    const controller = new AbortController();
    if (planned.requirementKind === PLANNED_RESOURCE_KINDS.Labor && planned.laborTypeCode) {
      setAssetsLoading(true);
      void listPeople(
        { limit: 100, offset: 0, status: 'ACTIVE', defaultLaborTypeCode: planned.laborTypeCode },
        controller.signal,
      )
        .then((response) => {
          if (!controller.signal.aborted) {
            setPeople(response.items);
            setKnownPeople((current) => ({
              ...current,
              ...Object.fromEntries(response.items.map((person) => [person.id, person])),
            }));
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setPeople([]);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setAssetsLoading(false);
          }
        });
      return () => controller.abort();
    }
    if (!planned.resourceTypeCode) {
      return;
    }
    void loadAssets(planned.resourceTypeCode, controller.signal);
    return () => controller.abort();
  }, [allocateOpen, loadAssets, selectedPlannedId, state]);

  /**
   * Abre a alocacao do item planejado no MESMO fluxo existente (mesmo dialogo, mesma
   * confirmacao pelo servidor). Extraido para que a acao primaria do cabecalho e o botao do
   * corpo usem exatamente a mesma transicao, sem duplicar regra.
   */
  function openAllocationFor(item: PlannedResource) {
    setSelectedPlannedId(item.id);
    setOperationalStart('');
    setOperationalEnd('');
    if (item.requirementKind === PLANNED_RESOURCE_KINDS.Labor) {
      setAllocateKind('LABOR');
      setSelectedPersonId('');
      setSelectedAssetId('');
      setPeople([]);
    } else {
      setAllocateKind('PHYSICAL_RESOURCE');
      setSelectedAssetId('');
      setAllocationConflictAssetId(null);
    }
    setAllocateOpen(true);
  }

  async function handlePlanPhysical(resourceTypeCode: string, quantity: string) {
    if (state.phase !== 'ready' || submitting) {
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      await planResource(serviceOrderId, {
        requirementKind: PLANNED_RESOURCE_KINDS.PhysicalResource,
        resourceTypeCode,
        plannedQuantity: quantity,
      });
      setFeedback({ tone: 'success', message: 'Recurso planejado com sucesso.' });
      await reload();
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof ServiceOrdersApiError
            ? mapServiceOrdersErrorToMessage(error.code, error.status)
            : 'Não foi possível planejar o recurso.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePlanLabor(laborTypeCode: string, quantity: string) {
    if (state.phase !== 'ready' || submitting) {
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      await planResource(serviceOrderId, {
        requirementKind: PLANNED_RESOURCE_KINDS.Labor,
        laborTypeCode,
        plannedQuantity: quantity,
      });
      setFeedback({ tone: 'success', message: 'Mão de obra planejada com sucesso.' });
      await reload();
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof ServiceOrdersApiError
            ? mapServiceOrdersErrorToMessage(error.code, error.status)
            : 'Não foi possível planejar a mão de obra.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAllocate() {
    const targetId = allocateKind === 'LABOR' ? selectedPersonId : selectedAssetId;
    if (state.phase !== 'ready' || submitting || !selectedPlannedId || !targetId) {
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    setAllocationConflictAssetId(null);
    try {
      await allocateResource(serviceOrderId, {
        plannedResourceId: selectedPlannedId,
        ...(allocateKind === 'LABOR'
          ? { workforceMemberId: selectedPersonId }
          : { physicalAssetId: selectedAssetId }),
        operationalStart: new Date(operationalStart).toISOString(),
        operationalEnd: new Date(operationalEnd).toISOString(),
      });
      setAllocateOpen(false);
      setFeedback({ tone: 'success', message: 'Alocação confirmada pelo servidor.' });
      await reload();
    } catch (error) {
      if (error instanceof ServiceOrdersApiError && error.kind === 'allocation_conflict') {
        setAllocationConflictAssetId(selectedAssetId);
        setFeedback({
          tone: 'error',
          message: mapServiceOrdersErrorToMessage(error.code, error.status),
        });
        await reload();
      } else {
        setFeedback({
          tone: 'error',
          message:
            error instanceof ServiceOrdersApiError
              ? mapServiceOrdersErrorToMessage(error.code, error.status)
              : 'Não foi possível alocar o recurso.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * ESTADOS DE PAGINA — resolvidos pelo primitivo da object page, nao por markup proprio:
   * negacao nao e ausencia de dado e erro oferece nova tentativa real.
   */
  if (state.phase === 'loading') {
    return (
      <ModulePage className="planning-page">
        <ModulePageHeader title="Ordem de serviço" />
        <EnterpriseObjectPage
          header={null}
          phase="loading"
          phaseTitle="Ordem de serviço"
          phaseMessage="Carregando o registro da ordem de serviço…"
        />
      </ModulePage>
    );
  }

  if (state.phase === 'denied') {
    return (
      <ModulePage className="planning-page">
        <ModulePageHeader title="Ordem de serviço" />
        <EnterpriseObjectPage
          header={null}
          phase="denied"
          phaseTitle="Ordem de serviço"
          phaseMessage="Você não tem permissão para acessar esta ordem de serviço."
        />
      </ModulePage>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <ModulePage className="planning-page">
        <ModulePageHeader title="Ordem de serviço" />
        <EnterpriseObjectPage
          header={null}
          phase="empty"
          phaseTitle="Ordem de serviço"
          phaseMessage="Ordem de serviço não encontrada."
        />
      </ModulePage>
    );
  }

  if (state.phase === 'error') {
    return (
      <ModulePage className="planning-page">
        <ModulePageHeader title="Ordem de serviço" />
        <EnterpriseObjectPage
          header={null}
          phase="error"
          phaseTitle="Ordem de serviço"
          phaseMessage={state.message}
          onRetry={() => void reload()}
        />
      </ModulePage>
    );
  }

  const { order, planned, allocations } = state;
  const coverage = buildRequirementCoverage(order.serviceSnapshot, planned, allocations);
  const physicalPlanned = planned.filter((item) => item.requirementKind === PLANNED_RESOURCE_KINDS.PhysicalResource);
  const laborPlanned = planned.filter((item) => item.requirementKind === PLANNED_RESOURCE_KINDS.Labor);
  const activeAllocations = allocations.filter((item) => item.status === 'ACTIVE');
  const planningAllowed =
    order.status === SERVICE_ORDER_STATUSES.Released || order.status === SERVICE_ORDER_STATUSES.InExecution;

  const controlCenter = order.controlCenter;
  const availableTransitions = controlCenter?.nextAction.availableTransitions ?? [];
  const clientName = serviceOrderClientName(order);
  const stateFlow = buildServiceOrderStateFlow(order);

  const nextAction = buildServiceOrderNextAction({
    serviceOrderId: order.id,
    orderNumber: order.orderNumber,
    availableActions: commands.data?.comandos_validos ?? [],
    canReadServiceOrder: capabilities.canRead,
  });

  const relations = buildAuthorizedRelations(
    buildServiceOrderRelationSpecs({
      serviceOrderId: order.id,
      canReadServiceOrder: capabilities.canRead,
      controlCenter,
    }),
  );

  const historyFacts = buildServiceOrderHistoryFacts(order);

  /**
   * ACAO PRIMARIA — a mais provavel AGORA, derivada do status real (`resolveServiceOrderNextAction`)
   * somada a autorizacao real e ao dado real:
   * 1. proxima etapa aponta para OUTRA superficie (execucao/medicao) ou para a transicao de ciclo
   *    de vida ja autorizada pelo backend (`availableTransitions`);
   * 2. na etapa de planejamento (que e ESTA pagina) a acao real daqui e alocar um recurso
   *    planejado que ainda nao tem alocacao ativa, e so com `canAllocate` real.
   */
  const awaitingAllocation = planned.find(
    (item) => !activeAllocations.some((allocation) => allocation.plannedResourceId === item.id),
  );
  const primaryAction: ObjectAction | null = (() => {
    if (nextAction?.to) {
      const destination = nextAction.to;
      return {
        id: 'next-action',
        label: nextAction.label,
        onSelect: () => {
          void navigate(destination);
        },
      };
    }
    if (
      capabilities.canAllocate &&
      planningAllowed &&
      awaitingAllocation &&
      nextAction !== null &&
      nextAction.kind === 'act' &&
      nextAction.to === undefined
    ) {
      return {
        id: 'allocate',
        label: nextAction.label,
        onSelect: () => openAllocationFor(awaitingAllocation),
      };
    }
    return null;
  })();

  /**
   * ACAO DESTRUTIVA — cancelar existe como comando e o backend avaliza, por OS, quais transicoes
   * este ator pode executar (`availableTransitions`). Ate o cancelamento o comando e sua
   * justificativa vivem na lista de ordens de servico, entao o destino e a lista filtrada pelo
   * numero real da OS.
   */
  const destructiveActions: ObjectAction[] = availableTransitions.includes('cancel')
    ? [
        {
          id: 'cancel',
          label: 'Cancelar OS',
          onSelect: () => {
            void navigate(buildServiceOrdersListHref({ q: order.orderNumber }));
          },
        },
      ]
    : [];

  const breadcrumb: BreadcrumbItem[] = [
    { label: 'Ordens de serviço', href: '/app/service-orders' },
    // Cliente entra pelo NOME do snapshot; sem leitura do cadastro de clientes nao ha vinculo.
    ...(clientName ? [{ label: clientName }] : []),
    { label: order.orderNumber },
  ];

  /*
   * FAIXA OPERACIONAL DA PRIMEIRA DOBRA.
   *
   * O gestor precisa responder OS/cliente/servico/status/responsavel/agenda/proxima
   * acao/processo/planejado x realizado/medicao/faturamento SEM ROLAR. Antes, o
   * Planejado x Realizado e o Medicao/Faturamento viviam ~2.5 mil pixels abaixo do
   * topo: a informacao existia e nao chegava a primeira leitura.
   *
   * Tudo aqui vem do MESMO payload ja autorizado (Operations Control Center). Nada e
   * recalculado no front e nada e inventado: quando o bloco nao autorizado chega
   * zerado, o fato e OMITIDO em vez de exibir 0, exatamente como o dominio faz.
   */
  const downstream = controlCenter?.downstream;
  const plannedVsActual = controlCenter?.plannedVsActual;
  const executionLabel = nextAction?.label ?? 'Sem próximo passo declarado';

  return (
    <ModulePage className="planning-page">
      <EnterpriseObjectPage
        breadcrumb={breadcrumb}
        header={
          <EnterpriseObjectHeader
            reference={order.orderNumber}
            title={order.serviceSnapshot.serviceName}
            subtitle={clientName}
            status={{
              label: formatServiceOrderStatus(order.status),
              tone: SERVICE_ORDER_STATUS_TONES[order.status],
            }}
            metadata={buildServiceOrderMetadata(order)}
            primaryAction={primaryAction}
            destructiveActions={destructiveActions}
          />
        }
        stateFlow={<ObjectStateFlow steps={stateFlow.steps} currentId={stateFlow.currentId} />}
        nextAction={<NextActionPanel action={nextAction} />}
        relations={<SmartRelationBar relations={relations} />}
        context={
          /*
           * A MOLDURA renderiza `context` ANTES do corpo. Entao e AQUI que a leitura
           * operacional precisa viver: excecao, planejado x realizado e os estagios a
           * jusante entram na PRIMEIRA DOBRA, com o contexto cadastral logo abaixo em
           * uma linha compacta — em vez de campos de baixo valor ocupando o topo.
           */
          <div className="flex flex-col gap-2">
            <ServiceOrderAttentionStrip
              status={order.status}
              awaitingAllocation={awaitingAllocation ?? null}
              plannedCount={planned.length}
              activeAllocationCount={activeAllocations.length}
              measurementCount={downstream?.measurement.count ?? null}
              billingCount={downstream?.billing.count ?? null}
            />

            <section className="so-strip" aria-label="Situação operacional da ordem">
              <div className="so-strip__metrics">
                <div className="so-strip__metric">
                  <span className="so-strip__label">Planejado</span>
                  <span className="so-strip__value">{planned.length}</span>
                  <span className="so-strip__hint">itens planejados</span>
                </div>
                <div className="so-strip__metric">
                  <span className="so-strip__label">Alocado</span>
                  <span className="so-strip__value">{activeAllocations.length}</span>
                  <span className="so-strip__hint">alocações ativas</span>
                </div>
                <div className="so-strip__metric">
                  <span className="so-strip__label">Execuções</span>
                  <span className="so-strip__value">{plannedVsActual?.executionEntries ?? 0}</span>
                  <span className="so-strip__hint">apontamentos</span>
                </div>
                {downstream && downstream.measurement.count !== null ? (
                  <div className="so-strip__metric">
                    <span className="so-strip__label">Medições</span>
                    <span className="so-strip__value">{downstream.measurement.count}</span>
                    <span className="so-strip__hint">
                      {downstream.measurement.status
                        ? toHumanStatusLabel(downstream.measurement.status)
                        : 'sem status'}
                    </span>
                  </div>
                ) : null}
                {downstream && downstream.billing.count !== null ? (
                  <div className="so-strip__metric">
                    <span className="so-strip__label">Faturamento</span>
                    <span className="so-strip__value">{downstream.billing.count}</span>
                    <span className="so-strip__hint">
                      {downstream.billing.status
                        ? toHumanStatusLabel(downstream.billing.status)
                        : 'sem status'}
                    </span>
                  </div>
                ) : null}
              </div>
              <p className="so-strip__next">
                <span className="so-strip__next-label">Próxima ação</span>
                <strong>{executionLabel}</strong>
              </p>
            </section>

            <ObjectContextBlock
              title="Contexto da ordem"
              fields={buildServiceOrderContextFields({
                ...order,
                serviceName: order.serviceSnapshot.serviceName,
                serviceCode: order.serviceSnapshot.serviceCode,
              })}
            />
          </div>
        }
        aside={
          <ObjectPanel title="Operação">
            {order.controlCenter ? (
              <OperationsControlCenter
                controlCenter={order.controlCenter}
                measurementHref={'/app/service-orders/' + order.id + '/measurement'}
              />
            ) : (
              <p className="m-0 text-sm text-gray-500">
                Sem controle operacional disponível para esta ordem.
              </p>
            )}
            <ActivityTimeline
              facts={historyFacts}
              title="Histórico"
              emptyMessage="Nenhum evento registrado para esta ordem."
            />
          </ObjectPanel>
        }
      >
        {/* De onde veio / o que foi gerado: a linhagem comercial e operacional desta OS. */}
        <section className="planning-section" aria-label="Cadeia de negócio">
          <BusinessChain
            chain={businessChain.chain}
            phase={businessChain.phase}
            message={businessChain.message}
            onRetry={businessChain.retry}
            title="Cadeia de negócio da ordem"
          />
        </section>

        <section className="planning-section" aria-labelledby="planning-summary-heading">
          <h2 id="planning-summary-heading">Resumo operacional</h2>
          <dl className="planning-summary">
            <div>
              <dt>Requisitos</dt>
              <dd>{coverage.length}</dd>
            </div>
            <div>
              <dt>Itens planejados</dt>
              <dd>{planned.length}</dd>
            </div>
            <div>
              <dt>Alocações ativas</dt>
              <dd>{activeAllocations.length}</dd>
            </div>
          </dl>
        </section>

        <section className="planning-section" aria-labelledby="requirements-heading">
          <h2 id="requirements-heading">Requisitos do serviço</h2>
          <p className="planning-hint">
            <span className="planning-legend planning-legend--requirement">Requirement</span> — exigência do snapshot do serviço (somente leitura).
          </p>
          <RequirementCoverageTable rows={coverage} />
        </section>

        <section className="planning-section" aria-labelledby="planned-heading">
          <h2 id="planned-heading">Planejamento</h2>
          <p className="planning-hint">
            <span className="planning-legend planning-legend--planned">Planned</span> — tipos e quantidades planejadas, sem recurso concreto obrigatório.
          </p>
          {!planningAllowed && (
            <p role="status" className="planning-notice">
              Planejamento disponível apenas para ordens liberadas ou em execução.
            </p>
          )}
          {physicalPlanned.length === 0 && laborPlanned.length === 0 ? (
            <p className="planning-empty" role="status">
              Nenhum item planejado ainda.
            </p>
          ) : (
            <div className="planning-kind-grid">
              {physicalPlanned.length > 0 ? (
                <div className="planning-kind">
                  <h3 className="planning-kind__title">Recursos físicos</h3>
                  <ul className="planning-list">
                    {physicalPlanned.map((item) => (
                      <li key={item.id}>
                        <strong>{item.resourceTypeCode}</strong> — qtd. {item.plannedQuantity}
                        {capabilities.canAllocate && planningAllowed ? (
                          <button
                            type="button"
                            className="button-link"
                            onClick={() => openAllocationFor(item)}
                          >
                            Alocar ativo
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {laborPlanned.length > 0 ? (
                <div className="planning-kind">
                  <h3 className="planning-kind__title">Mão de obra</h3>
                  <ul className="planning-list">
                    {laborPlanned.map((item) => (
                      <li key={item.id}>
                        <strong>{item.laborTypeCode}</strong> — qtd. {item.plannedQuantity}
                        {capabilities.canAllocate && planningAllowed ? (
                          <button
                            type="button"
                            className="button-link"
                            onClick={() => openAllocationFor(item)}
                          >
                            Atribuir empregado
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
          {capabilities.canPlan && planningAllowed
            ? coverage
                .filter((row) => row.kind === 'PHYSICAL_RESOURCE' && row.planned < row.required)
                .map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    className="button-secondary planning-plan-action"
                    disabled={submitting}
                    onClick={() => void handlePlanPhysical(row.label, '1')}
                  >
                    Planejar 1× {row.label}
                  </button>
                ))
            : null}
          {capabilities.canPlan && planningAllowed
            ? coverage
                .filter((row) => row.kind === 'LABOR' && row.planned < row.required)
                .map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    className="button-secondary planning-plan-action"
                    disabled={submitting}
                    onClick={() => void handlePlanLabor(row.label, '1')}
                  >
                    Planejar 1× {row.label}
                  </button>
                ))
            : null}
        </section>

        <section className="planning-section" aria-labelledby="availability-heading">
          <h2 id="availability-heading">Disponibilidade de ativos físicos</h2>
          <p className="planning-hint">
            <span className="planning-legend planning-legend--available">Available</span> /{' '}
            <span className="planning-legend planning-legend--unavailable">Unavailable</span> — elegibilidade informada pelo cadastro; conflito de intervalo é confirmado pelo servidor ao alocar.
          </p>
          {assetsLoading ? (
            <p aria-busy="true">Consultando ativos…</p>
          ) : assets.length === 0 ? (
            <p className="planning-empty" role="status">
              Selecione um recurso físico planejado para consultar ativos compatíveis.
            </p>
          ) : (
            <ul className="planning-asset-list">
              {assets.map((asset) => {
                const unavailable = asset.lifecycleStatus !== 'ACTIVE';
                const conflicted = allocationConflictAssetId === asset.id;
                return (
                  <li
                    key={asset.id}
                    className={
                      unavailable || conflicted
                        ? 'planning-asset planning-asset--unavailable'
                        : 'planning-asset planning-asset--available'
                    }
                  >
                    <span className="planning-asset__name">{asset.name}</span>
                    <span className="planning-asset__code">{asset.assetCode}</span>
                    <span className="planning-asset__status">
                      {unavailable ? 'Indisponível (inativo)' : conflicted ? 'Indisponível (conflito)' : 'Elegível para alocação'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="planning-section" aria-labelledby="allocations-heading">
          <h2 id="allocations-heading">Alocações confirmadas</h2>
          <p className="planning-hint">
            <span className="planning-legend planning-legend--allocated">Allocated</span> — vínculo confirmado pelo backend com intervalo operacional.
          </p>
          {activeAllocations.length === 0 ? (
            <p className="planning-empty" role="status">
              Nenhuma alocação ativa.
            </p>
          ) : (
            <div className="planning-table-wrap">
              <table className="planning-table">
                <thead>
                  <tr>
                    <th scope="col">Tipo</th>
                    <th scope="col">Recurso alocado</th>
                    <th scope="col">Início</th>
                    <th scope="col">Fim</th>
                    <th scope="col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {activeAllocations.map((allocation) => (
                    <tr key={allocation.id}>
                      <td>{allocation.resourceTypeCode}</td>
                      <td>
                        {formatAllocatedResource(allocation, knownPeople, knownAssets)}
                      </td>
                      <td>{new Date(allocation.operationalStart).toLocaleString()}</td>
                      <td>{new Date(allocation.operationalEnd).toLocaleString()}</td>
                      <td>
                        {capabilities.canRemoveAllocation ? (
                          <button
                            type="button"
                            className="button-link"
                            disabled={submitting}
                            onClick={() =>
                              void (async () => {
                                setSubmitting(true);
                                try {
                                  await removeAllocation(serviceOrderId, allocation.id, allocation.rowVersion);
                                  setFeedback({ tone: 'success', message: 'Alocação removida.' });
                                  await reload();
                                } catch (error) {
                                  setFeedback({
                                    tone: 'error',
                                    message:
                                      error instanceof ServiceOrdersApiError
                                        ? mapServiceOrdersErrorToMessage(error.code, error.status)
                                        : 'Falha ao remover alocação.',
                                  });
                                } finally {
                                  setSubmitting(false);
                                }
                              })()
                            }
                          >
                            Remover
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {feedback ? (
          <div
            id={feedbackId}
            role={feedback.tone === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`planning-feedback planning-feedback--${feedback.tone}`}
          >
            {feedback.message}
          </div>
        ) : null}
      </EnterpriseObjectPage>

      <ConfirmDialog
        open={allocateOpen}
        title={allocateKind === 'LABOR' ? 'Atribuir empregado' : 'Alocar recurso físico'}
        description={
          allocateKind === 'LABOR'
            ? 'Selecione o intervalo e o empregado ativo com a função planejada. A atribuição será confirmada pelo servidor.'
            : 'Selecione o intervalo e o ativo. A disponibilidade no período será confirmada pelo servidor.'
        }
        confirmLabel={submitting ? 'Alocando…' : 'Confirmar alocação'}
        cancelLabel="Cancelar"
        confirmDisabled={
          submitting ||
          !operationalStart ||
          !operationalEnd ||
          (allocateKind === 'LABOR' ? !selectedPersonId : !selectedAssetId)
        }
        onCancel={() => setAllocateOpen(false)}
        onConfirm={() => void handleAllocate()}
      >
        <div className="planning-form">
          <label className="form-field">
            Início operacional
            <input
              type="datetime-local"
              value={operationalStart}
              onChange={(event) => setOperationalStart(event.target.value)}
              required
            />
          </label>
          <label className="form-field">
            Fim operacional
            <input
              type="datetime-local"
              value={operationalEnd}
              onChange={(event) => setOperationalEnd(event.target.value)}
              required
            />
          </label>
          {allocateKind === 'LABOR' ? (
            <fieldset>
              <legend>Empregado compatível</legend>
              {people.length === 0 ? (
                <p>Nenhum empregado ativo com esta função.</p>
              ) : (
                people.map((person) => (
                  <label key={person.id} className="planning-asset-option">
                    <input
                      type="radio"
                      name="workforceMember"
                      value={person.id}
                      checked={selectedPersonId === person.id}
                      onChange={() => setSelectedPersonId(person.id)}
                    />
                    {formatPersonLabel(person)}
                  </label>
                ))
              )}
            </fieldset>
          ) : (
          <fieldset>
            <legend>Ativo compatível</legend>
            {assets.map((asset) => (
              <label key={asset.id} className="planning-asset-option">
                <input
                  type="radio"
                  name="physicalAsset"
                  value={asset.id}
                  checked={selectedAssetId === asset.id}
                  disabled={asset.lifecycleStatus !== 'ACTIVE'}
                  onChange={() => setSelectedAssetId(asset.id)}
                />
                {asset.name} ({asset.assetCode}) —{' '}
                {asset.lifecycleStatus === 'ACTIVE' ? 'Ativo' : 'Inativo'}
              </label>
            ))}
          </fieldset>
          )}
        </div>
      </ConfirmDialog>
    </ModulePage>
  );
}
