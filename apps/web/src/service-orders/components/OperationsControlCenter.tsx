import type {
  ControlCenterStepCode,
  ServiceOrderControlCenter,
} from '../types/service-order.types';
import { cn } from '../../ui/utils/cn';

type OperationsControlCenterProps = {
  controlCenter: ServiceOrderControlCenter;
  /** Rota de medição da OS (link só quando o bloco veio autorizado). */
  measurementHref: string;
};

const STEP_LABELS: Record<ControlCenterStepCode, string> = {
  DEMAND: 'Demanda',
  PLANNING: 'Planejamento',
  RELEASE: 'Liberação',
  EXECUTION: 'Execução',
  COMPLETION: 'Conclusão',
  MEASUREMENT: 'Medição',
  BILLING: 'Faturamento',
};

const ORPHAN_OWNER_STATUS: Record<string, string> = {
  DRAFT: 'Rascunho',
  PREPARED: 'Preparada',
  RELEASED: 'Liberada',
  IN_EXECUTION: 'Em execução',
  PAUSED: 'Pausada',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
  SUBMITTED: 'Enviada',
  UNDER_REVIEW: 'Em análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  VOIDED: 'Cancelado',
};

const STEP_TONE: Record<string, string> = {
  DONE: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  CURRENT: 'bg-brand-50 text-brand-700 ring-brand-600/30',
  PENDING: 'bg-gray-50 text-gray-500 ring-gray-300/40',
  ATTENTION: 'bg-amber-50 text-amber-800 ring-amber-600/25',
};

const NEXT_STEP_LABELS: Record<string, string> = {
  PREPARE: 'Preparar a ordem',
  RELEASE: 'Liberar para execução',
  START_EXECUTION: 'Iniciar execução',
  COMPLETE: 'Concluir execução',
  RESUME: 'Retomar execução',
  MEASURE: 'Gerar medição',
  CLOSED: 'Ciclo encerrado',
};

const BLOCKER_LABELS: Record<string, string> = {
  NO_ACTIVE_ALLOCATION: 'Nenhum recurso ativo alocado para a execução.',
  EXECUTION_OCCURRENCES_REGISTERED: 'Há ocorrências registradas na execução.',
};

const DIVERGENCE_LABELS: Record<string, string> = {
  PLANNED_WITHOUT_ACTIVE_ALLOCATION: 'Planejado com recursos, mas sem alocação ativa.',
  EXECUTED_WITHOUT_PLAN: 'Execução registrada sem planejamento de recursos.',
  EXECUTION_OCCURRENCES_REGISTERED: 'Execução com ocorrências registradas.',
};

function formatDateTime(value: string | null): string {
  if (!value) {
    return '—';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? '—'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(parsed);
}

function resolveOwnerStatusLabel(status: string | null): string {
  if (!status) {
    return 'sem registro';
  }
  return ORPHAN_OWNER_STATUS[status] ?? status;
}

/**
 * Operations Control Center da OS.
 *
 * Composição de LEITURA: progressão derivada (cada etapa com o estado REAL do módulo dono),
 * planejado x realizado e downstream. O frontend não recalcula regra empresarial, não deriva
 * próximo passo e não busca blocos ausentes — ausência significa ausência autorizada ou ausência
 * de dado.
 */
export function OperationsControlCenter({
  controlCenter,
  measurementHref,
}: OperationsControlCenterProps) {
  const { progression, plannedVsActual, downstream, nextAction } = controlCenter;
  const measurementVisible = downstream.measurement.count > 0 || downstream.measurement.status !== null;
  const billingVisible = downstream.billing.count > 0 || downstream.billing.status !== null;

  return (
    <div className="space-y-5">
      <section
        className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
        aria-labelledby="occ-next-action-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="occ-next-action-heading" className="cisne-type-section-title">
              Próximo passo
            </h2>
            <p className="mt-1 text-sm font-semibold text-gray-900">
              {NEXT_STEP_LABELS[nextAction.step] ?? nextAction.step}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              Derivado pelo backend do estado real da OS e das suas permissões.
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {nextAction.blockers.length > 0 ? (
              nextAction.blockers.map((blocker) => (
                <span
                  key={blocker}
                  className="inline-flex items-center rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-600/25 ring-inset"
                >
                  {BLOCKER_LABELS[blocker] ?? blocker}
                </span>
              ))
            ) : (
              <span className="text-xs text-gray-500">Sem bloqueio derivável.</span>
            )}
          </div>
        </div>
      </section>

      <section
        className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
        aria-labelledby="occ-progression-heading"
      >
        <h2 id="occ-progression-heading" className="cisne-type-section-title">
          Progressão operacional
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Cada etapa mostra o estado real do seu módulo dono — não existe status único.
        </p>
        <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {progression.map((step) => (
            <li
              key={step.code}
              className={cn(
                'rounded-lg border border-gray-100 px-3 py-2 ring-1 ring-inset',
                STEP_TONE[step.state],
              )}
            >
              <p className="text-[11px] font-semibold tracking-wide uppercase">
                {STEP_LABELS[step.code]}
              </p>
              <p className="mt-0.5 text-xs font-medium">{resolveOwnerStatusLabel(step.ownerStatus)}</p>
              {step.at ? (
                <p className="mt-0.5 text-[11px] tabular-nums opacity-80">{formatDateTime(step.at)}</p>
              ) : null}
              {step.detail ? <p className="mt-0.5 text-[11px] opacity-80">{step.detail}</p> : null}
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
          aria-labelledby="occ-planned-heading"
        >
          <h2 id="occ-planned-heading" className="cisne-type-section-title">
            Planejado
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-gray-500">Recursos planejados</dt>
              <dd className="text-lg font-semibold text-gray-900 tabular-nums">
                {plannedVsActual.plannedResources}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Sem planejamento</dt>
              <dd className="text-lg font-semibold text-gray-900 tabular-nums">
                {plannedVsActual.plannedResources === 0 ? 'sim' : 'não'}
              </dd>
            </div>
          </dl>
        </section>

        <section
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
          aria-labelledby="occ-actual-heading"
        >
          <h2 id="occ-actual-heading" className="cisne-type-section-title">
            Realizado
          </h2>
          <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-gray-500">Alocações ativas</dt>
              <dd className="text-lg font-semibold text-gray-900 tabular-nums">
                {plannedVsActual.activeAllocations}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Apontamentos</dt>
              <dd className="text-lg font-semibold text-gray-900 tabular-nums">
                {plannedVsActual.executionEntries}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Quantidade executada</dt>
              <dd className="text-lg font-semibold text-gray-900 tabular-nums">
                {plannedVsActual.executedQuantityTotal ?? '—'}
              </dd>
            </div>
          </dl>
          {plannedVsActual.divergences.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1" aria-label="Divergências entre planejado e realizado">
              {plannedVsActual.divergences.map((divergence) => (
                <span
                  key={divergence}
                  className="inline-flex items-center rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-600/25 ring-inset"
                >
                  {DIVERGENCE_LABELS[divergence] ?? divergence}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-gray-500">
              Nenhuma divergência factual entre planejado e realizado.
            </p>
          )}
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
          aria-labelledby="occ-measurement-heading"
        >
          <h2 id="occ-measurement-heading" className="cisne-type-section-title">
            Medição
          </h2>
          {measurementVisible ? (
            <div className="mt-2 text-sm">
              <p className="font-semibold text-gray-900">
                {resolveOwnerStatusLabel(downstream.measurement.status)}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {downstream.measurement.count} registro(s) ·{' '}
                {formatDateTime(downstream.measurement.createdAt)}
              </p>
              <a
                href={measurementHref}
                className="mt-2 inline-block text-sm font-medium text-brand-700 no-underline hover:text-brand-800"
              >
                Abrir medição da OS
              </a>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500">
              Sem medição disponível neste contexto de autorização.
            </p>
          )}
        </section>

        <section
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
          aria-labelledby="occ-billing-heading"
        >
          <h2 id="occ-billing-heading" className="cisne-type-section-title">
            Faturamento
          </h2>
          {billingVisible ? (
            <div className="mt-2 text-sm">
              <p className="font-semibold text-gray-900">
                {resolveOwnerStatusLabel(downstream.billing.status)}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {downstream.billing.count} registro(s) ·{' '}
                {formatDateTime(downstream.billing.createdAt)}
              </p>
              {downstream.billing.totalAmount ? (
                <p className="mt-1 cisne-type-money font-semibold text-gray-900">
                  {downstream.billing.totalAmount} {downstream.billing.currencyCode ?? ''}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500">
              Sem faturamento disponível neste contexto de autorização.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
