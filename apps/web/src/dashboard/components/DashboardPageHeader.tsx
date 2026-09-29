import { RefreshCw } from 'lucide-react';

type DashboardPageHeaderProps = {
  title: string;
  unitLabel?: string | null;
  periodLabel: string | null;
  period: string;
  periodOptions: ReadonlyArray<{ value: string; label: string }>;
  onPeriodChange: (period: string) => void;
  activeFilters: string[];
  onClearFilters?: () => void;
  generatedAt: string | null;
  generatedAtFormatted: string | null;
  isRefreshing: boolean;
  onRefresh: () => void;
};

/**
 * COMMAND HEADER — uma linha de contexto, sem hero.
 *
 * O painel executivo nao precisa de banner: precisa dizer ESCOPO, PERIODO e
 * ATUALIZACAO no menor numero de pixels possivel, para que a primeira dobra
 * pertença aos numeros e nao ao titulo.
 */
export function DashboardPageHeader({
  title,
  unitLabel,
  periodLabel,
  period,
  periodOptions,
  onPeriodChange,
  activeFilters,
  onClearFilters,
  generatedAt,
  generatedAtFormatted,
  isRefreshing,
  onRefresh,
}: DashboardPageHeaderProps) {
  const hasExtraFilters = activeFilters.length > 0;

  return (
    <header className="dashboard-command">
      <div className="dashboard-command__identity">
        <h1 className="dashboard-command__title">{title}</h1>
        <p className="dashboard-command__scope">
          <span>{unitLabel ?? 'Todas as unidades autorizadas'}</span>
          <span aria-hidden className="dashboard-command__sep">
            ·
          </span>
          <span>{periodLabel ?? 'período carregando'}</span>
        </p>
      </div>

      <div className="dashboard-command__controls" aria-label="Controles do painel">
        {generatedAt && generatedAtFormatted ? (
          <p className="dashboard-command__updated">
            <span className="dashboard-command__updated-label">Atualizado</span>
            <time dateTime={generatedAt}>{generatedAtFormatted}</time>
          </p>
        ) : null}

        <label className="dashboard-command__period">
          <span className="cisne-sr-only">Período</span>
          <select
            id="dashboard-period"
            aria-label="Período"
            className="dashboard-command__select"
            value={period}
            onChange={(event) => onPeriodChange(event.target.value)}
          >
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="dashboard-command__refresh"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-busy={isRefreshing}
        >
          <RefreshCw className="dashboard-command__refresh-icon" strokeWidth={2.2} aria-hidden />
          <span>{isRefreshing ? 'Atualizando…' : 'Atualizar'}</span>
        </button>
      </div>

      {hasExtraFilters ? (
        <div className="dashboard-command__filters">
          <ul className="dashboard-command__filter-list" aria-label="Filtros ativos">
            {activeFilters.map((filter) => (
              <li key={filter} className="dashboard-command__filter">
                {filter}
              </li>
            ))}
          </ul>
          {onClearFilters ? (
            <button type="button" className="dashboard-command__clear" onClick={onClearFilters}>
              Limpar filtros
            </button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
