import type { EconomicAccountingState } from '../api/economic-trace-api';

/**
 * FAIXA DE STATUS DA CENTRAL CONTÁBIL (ACCOUNTING OPERATIONS).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ELA EXISTE
 *
 * O plano diretor exige que a Central de Contabilidade abra com o TAMANHO DO PROBLEMA
 * antes da fila: `FAILED · PENDING · REVERSED`. Sem isso o operador entra numa lista e
 * precisa contar à mão para saber se o dia está crítico.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * A REGRA QUE MANDA AQUI
 *
 * NENHUM NÚMERO É CALCULADO LOCALMENTE. Todos vêm de `worklist.counts`, agregado no
 * servidor sobre o recorte da unidade. Somar `items` da página e chamar de total seria
 * inventar posição — a página é uma amostra.
 *
 * E TODO NÚMERO É UM FILTRO: clicar aplica o recorte exato que o valor conta. Um KPI
 * sem drill-through é decoração, e decoração não é Tier 1.
 */

export type EconomicStatusCounts = {
  pending: number;
  failed: number;
  reversed: number;
};

const STATUS_CELLS: Array<{
  key: keyof EconomicStatusCounts;
  label: string;
  hint: string;
  tone: 'critical' | 'warning' | 'neutral';
  filter: EconomicAccountingState | null;
}> = [
  {
    key: 'failed',
    label: 'Falharam',
    hint: 'Contabilização falhou e exige ação',
    tone: 'critical',
    filter: 'FAILED',
  },
  {
    key: 'pending',
    label: 'Pendentes',
    hint: 'Publicados sem decisão contábil',
    tone: 'warning',
    filter: 'PENDING',
  },
  {
    key: 'reversed',
    label: 'Estornadas',
    hint: 'Compensação emitida',
    tone: 'neutral',
    filter: 'REVERSED',
  },
];

const TONE_CLASS = {
  critical: 'text-[color:var(--color-red-700)]',
  warning: 'text-[color:var(--color-amber-700)]',
  neutral: 'text-[color:var(--color-text-primary)]',
} as const;

export function EconomicStatusStrip({
  counts,
  activeFilter,
  onFilterChange,
  unitLabel,
}: {
  counts: EconomicStatusCounts | null;
  activeFilter: EconomicAccountingState | null;
  onFilterChange: (next: EconomicAccountingState | null) => void;
  unitLabel: string;
}) {
  return (
    <section
      aria-label="Resumo da contabilização"
      className="mx-2 mb-2 flex flex-wrap items-stretch overflow-hidden rounded-[10px] border border-[color:var(--color-border-default)] bg-white"
    >
      <div className="flex min-w-32 flex-col justify-center gap-0.5 border-r border-[color:var(--color-divider)] px-4 py-2">
        <span className="cisne-meta-label">Unidade</span>
        <span className="text-xs font-semibold">{unitLabel || '—'}</span>
      </div>

      {STATUS_CELLS.map((cell) => {
        const value = counts ? counts[cell.key] : null;
        const isActive = activeFilter === cell.filter;
        return (
          <button
            key={cell.key}
            type="button"
            onClick={() => onFilterChange(isActive ? null : cell.filter)}
            aria-pressed={isActive}
            title={cell.hint}
            className={`flex min-w-32 flex-1 flex-col items-start gap-0.5 border-r border-[color:var(--color-divider)] px-4 py-2 text-left transition-colors last:border-r-0 hover:bg-brand-50/40 ${
              isActive ? 'bg-brand-50' : ''
            }`}
          >
            <strong
              className={`text-xl leading-none font-semibold tracking-tight tabular-nums ${TONE_CLASS[cell.tone]}`}
            >
              {value === null ? '—' : value}
            </strong>
            <span className="cisne-meta-label">
              {cell.label}
              {isActive ? ' · filtrando' : ''}
            </span>
          </button>
        );
      })}
    </section>
  );
}
