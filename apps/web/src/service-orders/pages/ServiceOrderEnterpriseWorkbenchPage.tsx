import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getEnterpriseServiceOrderWorkbench,
  prepareServiceOrder,
  releaseServiceOrder,
  ServiceOrdersApiError,
} from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import type { ServiceOrderEnterpriseWorkbench } from '../types/service-order-enterprise-workbench.types';
import type { ServiceOrderDetail } from '../types/service-order.types';
import { ModulePage } from '../../ui/module-layout';

type WorkbenchTab = 'process' | 'resources' | 'financial' | 'evidence';
type LoadPhase = 'loading' | 'ready' | 'denied' | 'missing' | 'error';

const PHASES: Array<{ code: string; label: string; suffix: string; description: string }> = [
  { code: 'DEMAND', label: 'Demanda', suffix: '', description: 'Origem, cliente, contrato e serviço' },
  { code: 'PLANNING', label: 'Planejamento', suffix: '/planning', description: 'Pessoas, frota, materiais, capacidade e custo previsto' },
  { code: 'RELEASE', label: 'Liberação', suffix: '', description: 'Pré-condições e transição autorizada' },
  { code: 'EXECUTION', label: 'Execução', suffix: '/execution', description: 'Atividades, apontamentos, ocorrências e evidências' },
  { code: 'COMPLETION', label: 'Conclusão', suffix: '/execution', description: 'Resultado e confirmação do serviço executado' },
  { code: 'MEASUREMENT', label: 'Medição', suffix: '/measurement', description: 'Quantidades, aceite, glosas e evidências' },
  { code: 'BILLING', label: 'Faturamento', suffix: '/billing', description: 'Itens faturáveis, documentos e consequências financeiras' },
];

const TABS: Array<{ id: WorkbenchTab; label: string }> = [
  { id: 'process', label: 'Fluxo operacional' },
  { id: 'resources', label: 'Recursos e requisitos' },
  { id: 'financial', label: 'Custos e faturamento' },
  { id: 'evidence', label: 'Documentos e auditoria' },
];

const STATE_LABELS: Record<string, string> = {
  DONE: 'Concluída',
  CURRENT: 'Em andamento',
  PENDING: 'Pendente',
  ATTENTION: 'Requer atenção',
};

function safeDateTime(value: string | null | undefined): string {
  if (!value) return 'Não publicado';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Não publicado'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function workbenchMoney(value: string | null | undefined, currency: string | null | undefined): string {
  if (value == null || !currency || !Number.isFinite(Number(value))) return 'Não publicado';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value));
  } catch {
    return value + ' ' + currency;
  }
}

function snapshotName(snapshot: Record<string, unknown> | null): string {
  if (!snapshot) return 'Nome não publicado';
  for (const key of ['name', 'legalName', 'tradeName', 'displayName', 'clientName']) {
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'Nome não publicado';
}

function stateCopy(phase: 'denied' | 'unavailable' | 'stale'): string {
  if (phase === 'denied') return 'O domínio não autorizou esta leitura. Nenhum dado foi presumido.';
  if (phase === 'stale') return 'Os dados foram lidos em versões diferentes. Atualize antes de tomar uma decisão econômica.';
  return 'O domínio não respondeu. Valores e contagens não foram substituídos por zero.';
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3 border-b border-gray-200 pb-2">
      <h2 className="m-0 text-base font-semibold text-gray-900">{title}</h2>
      {subtitle ? <p className="m-0 mt-1 text-xs text-gray-500">{subtitle}</p> : null}
    </div>
  );
}

function LinkedAction({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-9 items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-brand-700 no-underline hover:border-brand-400 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600"
    >
      {label}
    </Link>
  );
}

function ProcessView({ order, base }: { order: ServiceOrderDetail; base: string }) {
  const control = order.controlCenter;
  return (
    <div className="space-y-5">
      <section aria-label="Etapas do ciclo de serviço">
        <SectionTitle
          title="Service-to-Cash: etapas transacionais"
          subtitle="Cada status é publicado pelo domínio. As transições não são inferidas a partir da cor."
        />
        {control ? (
          <ol className="grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {PHASES.map((phase) => {
              const fact = control.progression.find((entry) => entry.code === phase.code);
              const downstreamNotPublished =
                (phase.code === 'MEASUREMENT' && control.downstream.measurement.status === null && control.downstream.measurement.count === 0) ||
                (phase.code === 'BILLING' && control.downstream.billing.status === null && control.downstream.billing.count === 0);
              return (
                <li key={phase.code} className="min-w-0 rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="m-0 text-sm font-semibold text-gray-900">{phase.label}</h3>
                    <span className="rounded-sm bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      {downstreamNotPublished ? 'Sem leitura publicada' : fact ? STATE_LABELS[fact.state] ?? fact.state : 'Sem leitura'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-600">{phase.description}</p>
                  {fact?.ownerStatus ? <p className="mt-1 text-xs">Estado de origem: {fact.ownerStatus}</p> : null}
                  {fact?.at ? <p className="mt-1 text-xs text-gray-500">{safeDateTime(fact.at)}</p> : null}
                  {fact?.detail ? <p className="mt-1 text-xs text-gray-600">{fact.detail}</p> : null}
                  <Link className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline"
                    to={base + phase.suffix}>Abrir etapa</Link>
                </li>
              );
            })}
          </ol>
        ) : (
          <p role="status" className="text-sm text-gray-600">Progressão não publicada para esta ordem.</p>
        )}
      </section>
      <section className="rounded-md border-l-4 border-brand-500 bg-gray-50 p-4" aria-label="Próxima decisão">
        <SectionTitle title="Próxima decisão operacional" />
        {control ? (
          <>
            <p className="m-0 text-sm font-semibold text-gray-900">{control.nextAction.step}</p>
            {control.nextAction.blockers.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-sm text-amber-900">
                {control.nextAction.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            ) : <p className="mt-1 text-sm text-gray-600">Nenhum bloqueio publicado nesta leitura.</p>}
          </>
        ) : <p className="text-sm text-gray-600">Próxima ação indisponível.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <LinkedAction to={base + '/planning'} label="Planejar recursos" />
            <LinkedAction to={base + '/execution'} label="Abrir execução" />
            <LinkedAction to={base + '/measurement'} label="Medição e aceite" />
          </div>
      </section>
    </div>
  );
}

function ResourcesView({ snapshot, base }: { snapshot: ServiceOrderEnterpriseWorkbench; base: string }) {
  const order = snapshot.serviceOrder;
  const requirements = order.serviceSnapshot?.requirements;
  const center = order.controlCenter;
  const groups = [
    { label: 'Recursos físicos', rows: requirements?.resources ?? [], kind: 'resource' },
    { label: 'Pessoas e qualificações', rows: requirements?.labor ?? [], kind: 'labor' },
    { label: 'Evidências de execução', rows: requirements?.execution ?? [], kind: 'execution' },
  ] as const;
  return (
    <div className="space-y-4">
      <SectionTitle title="Planejamento e elegibilidade" subtitle="O requisito vem da versão do catálogo vinculada à OS; alocações e consumos são validados nas telas de domínio." />
      {center ? (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-gray-50 p-3"><dt className="text-xs text-gray-600">Recursos planejados</dt><dd className="text-xl font-semibold">{center.plannedVsActual.plannedResources}</dd></div>
          <div className="rounded-md bg-gray-50 p-3"><dt className="text-xs text-gray-600">Alocações ativas</dt><dd className="text-xl font-semibold">{center.plannedVsActual.activeAllocations}</dd></div>
          <div className="rounded-md bg-gray-50 p-3"><dt className="text-xs text-gray-600">Apontamentos de execução</dt><dd className="text-xl font-semibold">{center.plannedVsActual.executionEntries}</dd></div>
        </dl>
      ) : <p className="text-sm">Não há posição de recursos publicada.</p>}
      {center?.plannedVsActual.divergences.length ? (
        <section className="border-l-4 border-amber-500 bg-amber-50 p-3" aria-label="Divergências de recurso">
          <h3 className="font-semibold">Divergências identificadas</h3>
          {center.plannedVsActual.divergences.map((item) => <p key={item} className="text-sm">{item}</p>)}
        </section>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="min-w-0 rounded-md border border-gray-200 bg-white p-3" aria-label="Plano operacional persistido">
          <h3 className="m-0 mb-1 text-sm font-semibold">Recursos planejados persistidos</h3>
          <p className="mb-3 text-xs text-gray-500">Leitura do módulo de planejamento com autorização própria.</p>
          {snapshot.plannedResources.state === 'ready' || snapshot.plannedResources.state === 'stale' ? (
            snapshot.plannedResources.data.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead><tr className="border-b text-xs text-gray-500"><th className="p-2">Tipo</th><th className="p-2">Quantidade</th><th className="p-2">Janela</th><th className="p-2">Estado</th></tr></thead>
                  <tbody>{snapshot.plannedResources.data.map((resource) => (
                    <tr key={resource.id} className="border-b border-gray-100">
                      <td className="p-2">{resource.resourceTypeCode || resource.laborTypeCode || resource.requirementKind}</td>
                      <td className="p-2 tabular-nums">{resource.plannedQuantity}</td>
                      <td className="p-2">{safeDateTime(resource.operationalStart)} — {safeDateTime(resource.operationalEnd)}</td>
                      <td className="p-2">{resource.status}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="text-sm text-gray-500">Nenhum recurso foi planejado para esta ordem.</p>
          ) : <p role="status" className="text-sm text-gray-600">{stateCopy(snapshot.plannedResources.state)}</p>}
        </section>
        <section className="min-w-0 rounded-md border border-gray-200 bg-white p-3" aria-label="Alocações operacionais persistidas">
          <h3 className="m-0 mb-1 text-sm font-semibold">Alocações operacionais persistidas</h3>
          <p className="mb-3 text-xs text-gray-500">Recursos registrados pelo módulo de alocações; situação conforme estado publicado.</p>
          {snapshot.allocations.state === 'ready' || snapshot.allocations.state === 'stale' ? (
            snapshot.allocations.data.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead><tr className="border-b text-xs text-gray-500"><th className="p-2">Tipo de recurso</th><th className="p-2">Janela</th><th className="p-2">Estado</th></tr></thead>
                  <tbody>{snapshot.allocations.data.map((allocation) => (
                    <tr key={allocation.id} className="border-b border-gray-100">
                      <td className="p-2">{allocation.resourceTypeCode}</td>
                      <td className="p-2">{safeDateTime(allocation.operationalStart)} — {safeDateTime(allocation.operationalEnd)}</td>
                      <td className="p-2">{allocation.status}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="text-sm text-gray-500">Nenhuma alocação foi registrada para esta ordem.</p>
          ) : <p role="status" className="text-sm text-gray-600">{stateCopy(snapshot.allocations.state)}</p>}
        </section>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {groups.map(({ label, rows, kind }) => (
          <section key={label} className="min-w-0 border border-gray-200 bg-white p-3">
            <h3 className="m-0 mb-3 font-semibold">{label}</h3>
            {rows.length === 0 ? (
              <p className="text-sm text-gray-500">Sem requisito publicado nesta categoria.</p>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0 text-sm">
                {rows.map((requirement, index) => (
                  <li key={index} className="border-b border-gray-100 pb-2">
                    <span className="font-medium">
                      {kind === 'resource' ? 'physicalResourceTypeCode' in requirement && requirement.physicalResourceTypeCode
                        : kind === 'labor' ? 'laborTypeCode' in requirement && requirement.laborTypeCode
                        : 'evidenceKind' in requirement && requirement.evidenceKind}
                    </span>
                    <span className="block text-xs text-gray-600">{requirement.requirementLevel}</span>
                    {'minQuantity' in requirement && requirement.minQuantity ? (
                      <span className="block text-xs text-gray-600">Quantidade mínima: {requirement.minQuantity}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <LinkedAction to={base + '/planning'} label="Abrir alocação e reservas" />
        <LinkedAction to="/app/people" label="Pessoas" />
        <LinkedAction to="/app/fleet" label="Frota" />
        <LinkedAction to="/app/inventory" label="Estoque" />
        <LinkedAction to="/app/procurement" label="Suprimentos" />
      </div>
    </div>
  );
}

function FinancialView({ snapshot, base }: { snapshot: ServiceOrderEnterpriseWorkbench; base: string }) {
  const { costs, serviceOrder } = snapshot;
  const control = serviceOrder.controlCenter;
  const costsReady = costs.state === 'ready' || costs.state === 'stale';
  const summary = costsReady ? costs.data.summary : null;
  return (
    <div className="space-y-5">
      <SectionTitle title="Evidências de custo e consequência econômica"
        subtitle="Receita somente com base em evidência aprovada; custos estimados e reais são grandezas monetárias, não quantidades físicas." />
      {costs.state !== 'ready' ? (
        <p role="status" className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm">
          {costs.state === 'stale' ? stateCopy('stale') : stateCopy(costs.state)}
        </p>
      ) : null}
      {summary ? (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Receita evidenciada', summary.revenue],
              ['Custo previsto', summary.totalEstimatedCost],
              ['Custo real', summary.totalActualCost],
              ['Margem real', summary.actualMargin],
            ].map(([label, amount]) => (
              <div key={label} className="rounded-md border border-gray-200 bg-white px-3 py-3">
                <dt className="text-xs text-gray-500">{label}</dt>
                <dd className="mt-1 text-base font-semibold tabular-nums">{workbenchMoney(amount, summary.currencyCode)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-gray-500">
            Fonte: resumo de custo operacional autorizado · apurado em {safeDateTime(summary.capturedAt)}.
            {summary.disclaimer ? ' ' + summary.disclaimer : ''}
          </p>
          {summary.blockingReasons.length ? (
            <div className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm">
              <h3 className="font-semibold">Pendências de reconciliação</h3>
              <ul className="mt-1 list-disc pl-5">{summary.blockingReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            </div>
          ) : null}
          <section>
            <SectionTitle title="Lançamentos de custo e suas origens" subtitle="Evidência original do domínio de custos operacionais." />
            {costsReady && costs.data.entries.length ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead><tr className="border-b text-xs text-gray-600"><th className="p-2">Categoria</th><th className="p-2">Natureza</th><th className="p-2">Origem</th><th className="p-2">Quando</th><th className="p-2 text-right">Valor</th></tr></thead>
                  <tbody>{costs.data.entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-gray-100">
                      <td className="p-2">{entry.category}</td><td className="p-2">{entry.costKind}</td>
                      <td className="p-2">{entry.description || entry.origin}</td>
                      <td className="p-2">{safeDateTime(entry.recordedAt)}</td>
                      <td className="p-2 text-right tabular-nums">{workbenchMoney(entry.amount, entry.currencyCode)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="text-sm text-gray-600">Nenhum lançamento de custo retornado na leitura autorizada.</p>}
          </section>
        </>
      ) : null}
      <section className="border-t border-gray-200 pt-4">
        <SectionTitle title="Medição e faturamento" />
        {control ? (
          <div className="grid gap-3 md:grid-cols-2">
            <p className="text-sm">Medição — {control.downstream.measurement.status || control.downstream.measurement.count > 0
              ? (control.downstream.measurement.status || 'Situação não publicada') + '; documentos retornados: ' + control.downstream.measurement.count
              : 'Posição não publicada ou leitura não autorizada.'}</p>
            <p className="text-sm">Faturamento — {control.downstream.billing.status || control.downstream.billing.count > 0
              ? (control.downstream.billing.status || 'Situação não publicada') + '; documentos retornados: ' + control.downstream.billing.count
              : 'Posição não publicada ou leitura não autorizada.'}</p>
          </div>
        ) : <p className="text-sm">Não há dados downstream publicados para esta leitura.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkedAction to={base + '/measurement'} label="Medição e aceite" />
          <LinkedAction to={base + '/billing'} label="Abrir faturamento" />
          <LinkedAction to="/app/finance" label="Contas a receber e conciliação" />
        </div>
      </section>
    </div>
  );
}

function EvidenceView({ snapshot, base }: { snapshot: ServiceOrderEnterpriseWorkbench; base: string }) {
  const { serviceOrder: order, chain } = snapshot;
  const authorizedChain = chain.state === 'ready' || chain.state === 'stale';
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section>
        <SectionTitle title="Fluxo de documentos transacionais" subtitle="Cada nó é retornado pelo backend já filtrado por autorização. Nenhum documento é presumido." />
        {authorizedChain ? (
          chain.data.nodes.length ? (
            <ol className="list-none space-y-2 p-0">
              {chain.data.nodes.map((node) => (
                <li key={node.kind + ':' + node.id} className="border-l-2 border-brand-400 bg-gray-50 p-3">
                  <p className="m-0 text-xs text-gray-500">{node.kind} · {node.relation}</p>
                  <Link to={node.route} className="text-sm font-semibold text-brand-700 hover:underline">{node.businessReference}</Link>
                  <p className="m-0 mt-1 text-xs text-gray-600">{node.status} · {safeDateTime(node.occurredAt)}</p>
                  <p className="m-0 mt-1 text-xs text-gray-600">{node.summary}</p>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-gray-600">Nenhum vínculo transacional foi retornado.</p>
        ) : <p role="status" className="text-sm text-gray-600">{stateCopy(chain.state)}</p>}
      </section>
      <section>
        <SectionTitle title="Histórico persistido da OS" subtitle="Eventos reais de domínio: não é uma timeline demonstrativa." />
        {order.historyEvents.length ? (
          <ol className="list-none space-y-2 p-0">
            {order.historyEvents.map((event) => (
              <li key={event.id} className="border-b border-gray-100 pb-3 text-sm">
                <span className="font-semibold">{event.eventType}</span>
                <p className="m-0 text-xs text-gray-500">{safeDateTime(event.occurredAt)}</p>
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-gray-600">Nenhum evento retornado na OS.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <LinkedAction to="/app/documents" label="Acervo GED" />
          <LinkedAction to={base + '/execution'} label="Evidências da execução" />
          <LinkedAction to={base} label="Registro 360" />
        </div>
      </section>
    </div>
  );
}

/**
 * One screen for the authoritative lifecycle, not another CRUD or independent read model.
 * Commands reuse the existing versioned OS endpoints; the read is server-composed.
 */
export function ServiceOrderEnterpriseWorkbenchPage() {
  const { serviceOrderId = '' } = useParams<{ serviceOrderId: string }>();
  const base = '/app/service-orders/' + serviceOrderId;
  const [snapshot, setSnapshot] = useState<ServiceOrderEnterpriseWorkbench | null>(null);
  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [tab, setTab] = useState<WorkbenchTab>('process');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reload = useCallback(async (signal?: AbortSignal) => {
    if (!serviceOrderId) { setPhase('error'); return; }
    setPhase('loading');
    try {
      const data = await getEnterpriseServiceOrderWorkbench(serviceOrderId, signal);
      if (signal?.aborted) return;
      setSnapshot(data);
      setPhase('ready');
    } catch (reason) {
      if (signal?.aborted) return;
      setSnapshot(null);
      setPhase(reason instanceof ServiceOrdersApiError && reason.kind === 'denied'
        ? 'denied'
        : reason instanceof ServiceOrdersApiError && reason.kind === 'not_found' ? 'missing' : 'error');
    }
  }, [serviceOrderId]);

  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null);
    setError(null);
    setSuccess(null);
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const perform = async (command: 'prepare' | 'release') => {
    const order = snapshot?.serviceOrder;
    if (!order || busy || !order.controlCenter?.nextAction.availableTransitions.includes(command)) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      if (command === 'prepare') await prepareServiceOrder(order.id, order.rowVersion);
      else await releaseServiceOrder(order.id, order.rowVersion);
      await reload();
      setSuccess('Comando registrado. Os dados e a versão foram atualizados a partir do servidor.');
    } catch (reason) {
      // A 409 may change the next legal action: always refresh the real state before retry.
      if (reason instanceof ServiceOrdersApiError && (reason.status === 409 || reason.kind === 'version_conflict')) {
        await reload();
        setError('A ordem mudou ou não atende às pré-condições da transição. Revise o estado e os bloqueios atualizados antes de agir.');
      } else {
        setError(reason instanceof ServiceOrdersApiError
          ? mapServiceOrdersErrorToMessage(reason.code, reason.status)
          : 'Não foi possível executar a transição.');
      }
    } finally { setBusy(false); }
  };

  if (phase !== 'ready' || !snapshot) {
    return (
      <ModulePage layout="workspace" className="space-y-4 py-5">
        <Link to="/app/service-orders" className="text-sm text-brand-700">Ordens de serviço</Link>
        <h1 className="text-xl font-semibold">Bancada empresarial da ordem de serviço</h1>
        {phase === 'loading' ? <p role="status">Consultando contratos e evidências no servidor…</p>
          : phase === 'denied' ? <p role="alert">Seu perfil não tem permissão para ler esta ordem.</p>
          : phase === 'missing' ? <p role="status">Esta ordem não foi encontrada no seu escopo autorizado.</p>
          : <div role="alert"><p>Não foi possível consultar a ordem.</p><button type="button" onClick={() => void reload()} className="text-brand-700 underline">Tentar novamente</button></div>}
      </ModulePage>
    );
  }

  const order = snapshot.serviceOrder;
  const available = order.controlCenter?.nextAction.availableTransitions ?? [];
  const now = snapshot.asOf;
  return (
    <ModulePage layout="workspace" className="space-y-4 py-4">
      <nav aria-label="Caminho" className="flex flex-wrap gap-2 text-xs text-gray-600">
        <Link to="/app/service-orders" className="text-brand-700">Operações / Ordens de serviço</Link>
        <span>/</span><Link to={base} className="text-brand-700">{order.orderNumber}</Link>
        <span>/</span><span>Bancada integrada</span>
      </nav>
      <header className="border-b border-gray-200 pb-4">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
          <div>
            <p className="m-0 text-xs font-semibold tracking-wide text-brand-700 uppercase">Service-to-Cash · Objeto operacional 360</p>
            <h1 className="m-0 mt-1 text-2xl font-semibold text-gray-900">Bancada empresarial · {order.orderNumber}</h1>
            <p className="m-0 mt-1 text-sm text-gray-600">{snapshotName(order.clientSnapshot)} · {order.contractReference || 'Sem contrato referenciado'} · Unidade operacional vinculada</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600">
              <span className="rounded bg-gray-100 px-2 py-1 font-semibold text-gray-800">{order.status}</span>
              <span>Versão {order.rowVersion}</span><span>Leitura {safeDateTime(now)}</span>
              <span>Código {order.internalCode}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkedAction to={base} label="OS 360" />
            {available.includes('prepare') ? (
              <button type="button" disabled={busy} onClick={() => void perform('prepare')}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Preparar OS</button>
            ) : null}
            {available.includes('release') ? (
              <button type="button" disabled={busy} onClick={() => void perform('release')}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Liberar OS</button>
            ) : null}
            <button type="button" disabled={busy} onClick={() => void reload()}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 disabled:opacity-50">Atualizar</button>
          </div>
        </div>
        {error ? <p role="alert" className="mt-3 border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
        {success ? <p role="status" className="mt-3 border-l-4 border-green-500 bg-green-50 p-3 text-sm text-green-800">{success}</p> : null}
        {order.controlCenter?.nextAction.blockers.length ? (
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Bloqueios do backend">
            {order.controlCenter.nextAction.blockers.map((reason) => (
              <span key={reason} className="rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">{reason}</span>
            ))}
          </div>
        ) : null}
      </header>
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">
          <div role="tablist" aria-label="Áreas da bancada" className="mb-4 flex flex-wrap gap-1 border-b border-gray-200 pb-2">
            {TABS.map(({ id, label }) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id}
                onClick={() => setTab(id)} className={tab === id
                  ? 'rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white'
                  : 'rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100'}>{label}</button>
            ))}
          </div>
          <div role="tabpanel">
            {tab === 'process' ? <ProcessView order={order} base={base} /> : null}
            {tab === 'resources' ? <ResourcesView snapshot={snapshot} base={base} /> : null}
            {tab === 'financial' ? <FinancialView snapshot={snapshot} base={base} /> : null}
            {tab === 'evidence' ? <EvidenceView snapshot={snapshot} base={base} /> : null}
          </div>
        </div>
        <aside aria-label="Contexto econômico e empresarial" className="min-w-0 space-y-4 border-t border-gray-200 pt-4 xl:border-t-0 xl:border-l xl:pl-4 xl:pt-0">
          <section>
            <SectionTitle title="Posição da OS" subtitle="Somente indicadores do backend" />
            {order.controlCenter ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2"><dt>Recursos planejados</dt><dd className="font-semibold">{order.controlCenter.plannedVsActual.plannedResources}</dd></div>
                <div className="flex justify-between gap-2"><dt>Alocações ativas</dt><dd className="font-semibold">{order.controlCenter.plannedVsActual.activeAllocations}</dd></div>
                <div className="flex justify-between gap-2"><dt>Apontamentos</dt><dd className="font-semibold">{order.controlCenter.plannedVsActual.executionEntries}</dd></div>
              </dl>
            ) : <p className="text-sm text-gray-500">Não publicado.</p>}
          </section>
          <section className="border-t border-gray-200 pt-3">
            <SectionTitle title="Situação econômica" subtitle="Dados monetários vindos de leitura autorizada" />
            {snapshot.costs.state === 'ready' || snapshot.costs.state === 'stale' ? (
              <dl className="space-y-2 text-sm">
                <div><dt className="text-xs text-gray-500">Custo real</dt><dd className="font-semibold">{workbenchMoney(snapshot.costs.data.summary.totalActualCost, snapshot.costs.data.summary.currencyCode)}</dd></div>
                <div><dt className="text-xs text-gray-500">Receita evidenciada</dt><dd className="font-semibold">{workbenchMoney(snapshot.costs.data.summary.revenue, snapshot.costs.data.summary.currencyCode)}</dd></div>
                {snapshot.costs.state === 'stale' ? <p role="status" className="text-xs text-amber-700">{stateCopy('stale')}</p> : null}
              </dl>
            ) : <p role="status" className="text-sm text-gray-600">{stateCopy(snapshot.costs.state)}</p>}
            <button type="button" onClick={() => setTab('financial')} className="mt-2 text-sm font-semibold text-brand-700 underline">Detalhar valores e origens</button>
          </section>
          <section className="border-t border-gray-200 pt-3">
            <SectionTitle title="Rastreabilidade" subtitle="Documentos filtrados por autorização no servidor" />
            {snapshot.chain.state === 'ready' || snapshot.chain.state === 'stale' ? (
              <p className="text-sm text-gray-700">{snapshot.chain.data.nodes.length} nós retornados pela cadeia autorizada</p>
            ) : <p role="status" className="text-xs text-gray-600">{stateCopy(snapshot.chain.state)}</p>}
            <button type="button" onClick={() => setTab('evidence')} className="mt-2 text-sm font-semibold text-brand-700 underline">Abrir documentos e eventos</button>
          </section>
          <section className="border-t border-gray-200 pt-3">
            <SectionTitle title="Outros postos de trabalho" />
            <div className="flex flex-col items-start gap-2">
              <LinkedAction to="/app/work-inbox" label="Minha fila de pendências" />
              <LinkedAction to="/app/procurement" label="Compras e recebimentos" />
              <LinkedAction to="/app/finance" label="Financeiro" />
              <LinkedAction to="/app/accounting/closing" label="Fechamento contábil" />
            </div>
          </section>
        </aside>
      </div>
    </ModulePage>
  );
}
