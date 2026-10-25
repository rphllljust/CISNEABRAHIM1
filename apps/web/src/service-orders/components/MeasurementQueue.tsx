import type { WorkQueueItem } from '../types/measurement-workbench.types';
import {
  formatDuration,
  formatMoney,
  severityTone,
  stateLabel,
} from '../utils/measurement-workbench-format';
import { cn } from '../../ui/utils/cn';

/**
 * FILA DE TRABALHO DA MEDIÇÃO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * A COLUNA ESQUERDA NÃO É MENU: É TRABALHO
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Cada linha responde, sem abrir nada: quem, qual documento, quanto, há quanto
 * tempo, qual a severidade, quem é o dono, por que está parado e qual é a
 * próxima ação. Um número sem drill-down não tem valor; um item de fila sem
 * DONO e sem PRÓXIMA AÇÃO é uma notificação, não trabalho.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE COMPONENTE NÃO FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não ordena, não filtra, não calcula severidade e não decide prioridade. A
 * ordem vem do backend — `projectRevenueLeakage` ordena por estágio mais
 * adiantado, idade e valor. O componente apresenta a ordem recebida.
 */
export function MeasurementQueue({
  items,
  selectedServiceOrderId,
  onSelect,
  refreshing,
}: {
  items: WorkQueueItem[];
  selectedServiceOrderId: string | null;
  onSelect: (item: WorkQueueItem) => void;
  refreshing?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-[10px] border border-[color:var(--color-border-default)] bg-white p-4">
        <p className="m-0 text-sm font-medium text-gray-700">Nenhum trabalho pendente</p>
        <p className="m-0 mt-1 text-xs text-gray-500">
          Nesta unidade, nenhuma medição exige decisão neste momento.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[10px] border border-[color:var(--color-border-default)] bg-white',
        refreshing && 'opacity-70 transition-opacity',
      )}
    >
      <h2 className="cisne-type-workspace m-0 border-b border-[color:var(--color-divider)] bg-[color:var(--color-surface-header)] px-3 py-1.5">
        Fila de trabalho
      </h2>
      <ul className="m-0 list-none p-0" aria-label="Itens de trabalho da medição">
        {items.map((item) => {
          const selected = item.serviceOrderId === selectedServiceOrderId;
          const age = formatDuration(item.ageSeconds);
          const amount = formatMoney(item.amount, item.currencyCode);
          return (
            <li key={item.serviceOrderId}>
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(item)}
                className={cn(
                  'block w-full border-b border-[color:var(--color-divider)] px-3 py-2 text-left last:border-b-0',
                  'hover:bg-[color:var(--color-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-600',
                  selected && 'bg-brand-50',
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-gray-900">
                    {item.customerLabel ?? 'Cliente não informado'}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      severityClass(item.severity),
                    )}
                  >
                    {stateLabel(item.severity) ?? item.severity}
                  </span>
                </div>

                <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[11px] text-gray-600">
                  <span className="truncate">
                    {item.orderNumber}
                    {item.measurementId ? ` · M-${item.measurementId.slice(0, 8)}` : ''}
                  </span>
                  <span className="shrink-0 tabular-nums">{amount ?? 'Não apurado'}</span>
                </div>

                {/* O ESTÁGIO é o motivo de o item estar nesta fila — não um rótulo de status. */}
                <p className="m-0 mt-1 truncate text-[11px] font-medium text-gray-800">
                  {item.stageLabel}
                </p>

                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-500">
                  <span>Dono: {item.ownerRole}</span>
                  {age ? <span>· {age}</span> : null}
                  <span className="truncate">· {item.nextAction.label}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function severityClass(severity: string): string {
  switch (severityTone(severity)) {
    case 'critical':
      return 'bg-red-100 text-red-800';
    case 'warning':
      return 'bg-amber-100 text-amber-800';
    case 'info':
      return 'bg-blue-100 text-blue-800';
    case 'success':
      return 'bg-emerald-100 text-emerald-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}
