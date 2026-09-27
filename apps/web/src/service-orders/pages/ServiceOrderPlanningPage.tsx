import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { getPhysicalAsset, listPhysicalAssets } from '../../assets/api/physical-assets-api';
import type { PhysicalAsset } from '../../assets/types/physical-asset.types';
import { listPeople } from '../../people/api/people-api';
import type { Person } from '../../people/types/person.types';
import { ConfirmDialog } from '../../clients/components/ConfirmDialog';
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
import { ServiceOrderTimeline } from '../components/ServiceOrderTimeline';
import { useServiceOrderPlanningCapabilities } from '../hooks/useServiceOrderPlanningCapabilities';
import { PLANNED_RESOURCE_KINDS, type PlannedResource, type ResourceAllocation } from '../types/resource-planning.types';
import { SERVICE_ORDER_STATUSES, type ServiceOrderDetail } from '../types/service-order.types';
import { buildRequirementCoverage } from '../utils/planning-aggregates';

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
  const { capabilities } = useServiceOrderPlanningCapabilities();
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

  if (state.phase === 'loading') {
    return (
      <main id="main-content" className="shell-page">
        <p aria-busy="true" aria-live="polite">
          Carregando planejamento…
        </p>
      </main>
    );
  }

  if (state.phase === 'denied') {
    return (
      <main id="main-content" className="shell-page">
        <p role="alert">Você não tem permissão para acessar esta ordem de serviço.</p>
      </main>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <main id="main-content" className="shell-page">
        <p role="alert">Ordem de serviço não encontrada.</p>
      </main>
    );
  }

  if (state.phase === 'error') {
    return (
      <main id="main-content" className="shell-page">
        <p role="alert">{state.message}</p>
        <button type="button" onClick={() => void reload()}>
          Tentar novamente
        </button>
      </main>
    );
  }

  const { order, planned, allocations } = state;
  const coverage = buildRequirementCoverage(order.serviceSnapshot, planned, allocations);
  const physicalPlanned = planned.filter((item) => item.requirementKind === PLANNED_RESOURCE_KINDS.PhysicalResource);
  const laborPlanned = planned.filter((item) => item.requirementKind === PLANNED_RESOURCE_KINDS.Labor);
  const activeAllocations = allocations.filter((item) => item.status === 'ACTIVE');
  const planningAllowed =
    order.status === SERVICE_ORDER_STATUSES.Released || order.status === SERVICE_ORDER_STATUSES.InExecution;

  return (
    <main id="main-content" className="shell-page planning-page">
      <header className="planning-page__header">
        <div>
          <p className="planning-page__eyebrow">Ordem de serviço</p>
          <h1>{order.orderNumber}</h1>
          <p className="planning-page__meta">
            {order.serviceSnapshot.serviceName} · Status: {order.status}
          </p>
        </div>
        <Link to="/app/requests" className="button-secondary">
          Voltar
        </Link>
      </header>

      {order.controlCenter ? (
        <section className="planning-section" aria-label="Centro de controle operacional">
          <OperationsControlCenter
            controlCenter={order.controlCenter}
            measurementHref={'/app/service-orders/' + order.id + '/measurement'}
          />
        </section>
      ) : null}

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
          <ul className="planning-list">
            {physicalPlanned.map((item) => (
              <li key={item.id}>
                <strong>{item.resourceTypeCode}</strong> — qtd. {item.plannedQuantity}
                {capabilities.canAllocate && planningAllowed ? (
                  <button
                    type="button"
                    className="button-link"
                    onClick={() => {
                      setAllocateKind('PHYSICAL_RESOURCE');
                      setSelectedPlannedId(item.id);
                      setSelectedAssetId('');
                      setOperationalStart('');
                      setOperationalEnd('');
                      setAllocationConflictAssetId(null);
                      setAllocateOpen(true);
                    }}
                  >
                    Alocar ativo
                  </button>
                ) : null}
              </li>
            ))}
            {laborPlanned.map((item) => (
              <li key={item.id}>
                <strong>{item.laborTypeCode}</strong> — qtd. {item.plannedQuantity}
                {capabilities.canAllocate && planningAllowed ? (
                  <button
                    type="button"
                    className="button-link"
                    onClick={() => {
                      setAllocateKind('LABOR');
                      setSelectedPlannedId(item.id);
                      setSelectedPersonId('');
                      setSelectedAssetId('');
                      setOperationalStart('');
                      setOperationalEnd('');
                      setPeople([]);
                      setAllocateOpen(true);
                    }}
                  >
                    Atribuir empregado
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
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

      <section className="planning-section" aria-labelledby="planning-timeline-heading">
        <h2 id="planning-timeline-heading">Linha do tempo</h2>
        <p className="planning-hint">
          Histórico do ciclo de vida da OS, incluindo planejamento, despacho e execução. Somente
          leitura.
        </p>
        <ServiceOrderTimeline events={order.historyEvents} />
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
    </main>
  );
}
