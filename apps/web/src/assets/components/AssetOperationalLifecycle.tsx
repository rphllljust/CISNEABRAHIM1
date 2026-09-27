import { Link } from 'react-router-dom';
import type {
  AssetOperationalLifecycle,
  AssetOperationalUsage,
} from '../types/asset-operational-lifecycle.types';

type AssetOperationalLifecyclePanelProps = {
  lifecycle: AssetOperationalLifecycle;
};

const ALLOCATION_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Alocação ativa',
  REALLOCATED: 'Realocada',
  REMOVED: 'Removida',
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  PREPARED: 'Preparada',
  RELEASED: 'Liberada',
  IN_EXECUTION: 'Em execução',
  PAUSED: 'Pausada',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
};

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? '—'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(parsed);
}

function formatWindow(start: string, end: string): string {
  return `${formatDateTime(start)} — ${formatDateTime(end)}`;
}

function orderLabel(usage: AssetOperationalUsage): string {
  return usage.orderNumber;
}

/**
 * Painel da vida operacional do recurso.
 *
 * Renderiza SOMENTE o payload autorizado: se o elo (OS) não veio, não há número, status nem link —
 * e o frontend não tenta buscar em outro endpoint. Sem leitura de km/horímetro (sem elo persistido
 * entre execução e ativo) e sem transformar ocorrência em falha/avaria/manutenção.
 */
export function AssetOperationalLifecyclePanel({
  lifecycle,
}: AssetOperationalLifecyclePanelProps) {
  const { currentUse, nextUse, history, occurrences } = lifecycle;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <section
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
          aria-labelledby="asset-current-use-heading"
        >
          <h2 id="asset-current-use-heading" className="cisne-type-section-title">
            Uso atual
          </h2>
          {currentUse ? (
            <div className="mt-2 text-sm">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  to={`/app/service-orders/${currentUse.serviceOrderId}/planning`}
                  className="cisne-type-code font-semibold text-brand-700 no-underline hover:text-brand-800"
                >
                  {orderLabel(currentUse)}
                </Link>
                <span className="text-xs text-gray-500">
                  {ORDER_STATUS_LABELS[currentUse.orderStatus] ?? currentUse.orderStatus}
                </span>
              </p>
              <dl className="mt-2 space-y-1 text-xs text-gray-600">
                <div>
                  <dt className="font-medium text-gray-500">Período da alocação</dt>
                  <dd className="tabular-nums">
                    {formatWindow(currentUse.operationalStart, currentUse.operationalEnd)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-gray-500">Situação</dt>
                  <dd>
                    {ALLOCATION_STATUS_LABELS[currentUse.allocationStatus] ??
                      currentUse.allocationStatus}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500">Sem uso atual registrado.</p>
          )}
        </section>

        <section
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
          aria-labelledby="asset-next-use-heading"
        >
          <h2 id="asset-next-use-heading" className="cisne-type-section-title">
            Próxima utilização
          </h2>
          {nextUse ? (
            <div className="mt-2 text-sm">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  to={`/app/service-orders/${nextUse.serviceOrderId}/planning`}
                  className="cisne-type-code font-semibold text-brand-700 no-underline hover:text-brand-800"
                >
                  {orderLabel(nextUse)}
                </Link>
                <span className="text-xs text-gray-500">
                  {ORDER_STATUS_LABELS[nextUse.orderStatus] ?? nextUse.orderStatus}
                </span>
              </p>
              <p className="mt-2 text-xs text-gray-600 tabular-nums">
                {formatWindow(nextUse.operationalStart, nextUse.operationalEnd)}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500">Sem próxima utilização registrada.</p>
          )}
        </section>
      </div>

      <section
        className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
        aria-labelledby="asset-usage-history-heading"
      >
        <h2 id="asset-usage-history-heading" className="cisne-type-section-title">
          Histórico operacional
        </h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            Nenhuma utilização registrada para este recurso.
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {history.map((usage) => (
              <li
                key={usage.allocationId}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-100 pb-2 last:border-b-0 last:pb-0"
              >
                <Link
                  to={`/app/service-orders/${usage.serviceOrderId}/planning`}
                  className="cisne-type-code text-sm font-semibold text-brand-700 no-underline hover:text-brand-800"
                >
                  {orderLabel(usage)}
                </Link>
                <span className="text-xs text-gray-500 tabular-nums">
                  {formatWindow(usage.operationalStart, usage.operationalEnd)}
                </span>
                <span className="text-xs text-gray-500">
                  {ORDER_STATUS_LABELS[usage.orderStatus] ?? usage.orderStatus} ·{' '}
                  {ALLOCATION_STATUS_LABELS[usage.allocationStatus] ?? usage.allocationStatus}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section
        className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
        aria-labelledby="asset-occurrences-heading"
      >
        <h2 id="asset-occurrences-heading" className="cisne-type-section-title">
          Ocorrências recentes
        </h2>
        {occurrences.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            Nenhuma ocorrência registrada nas ordens em que este recurso foi alocado.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {occurrences.map((occurrence) => (
              <li key={occurrence.id} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="cisne-type-code text-xs font-semibold text-gray-700">
                    {occurrence.occurrenceCode}
                  </span>
                  <Link
                    to={`/app/service-orders/${occurrence.serviceOrderId}/planning`}
                    className="cisne-type-code text-sm font-semibold text-brand-700 no-underline hover:text-brand-800"
                  >
                    {occurrence.orderNumber}
                  </Link>
                  <span className="text-xs text-gray-500 tabular-nums">
                    {formatDateTime(occurrence.recordedAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-600">{occurrence.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
