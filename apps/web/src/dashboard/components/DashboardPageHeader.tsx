type DashboardPageHeaderProps = {
  title: string;
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

export function DashboardPageHeader({
  title,
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
    <div className="mb-6">
      <nav className="mb-3 flex text-sm text-gray-500" aria-label="Localização">
        <span className="hover:text-gray-700">Início</span>
        <span className="mx-2 text-gray-300">/</span>
        <span className="font-medium text-gray-900">Painel operacional</span>
      </nav>

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold tracking-wider text-brand-600 uppercase">
            Operação e controle
          </p>
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
          {periodLabel ? <p className="mt-1 text-sm text-gray-500">{periodLabel}</p> : null}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 md:mt-0 md:justify-end" aria-label="Controles do painel">
          {generatedAt && generatedAtFormatted ? (
            <div>
              <p className="mb-1.5 text-xs text-gray-500">Atualizado</p>
              <p className="dashboard-page__meta text-sm font-medium text-gray-900">
                <time dateTime={generatedAt}>{generatedAtFormatted}</time>
              </p>
            </div>
          ) : null}

          <div>
            <label className="mb-1.5 block text-xs text-gray-500" htmlFor="dashboard-period">
              Período
            </label>
            <select
              id="dashboard-period"
              className="h-10 rounded-md border-0 bg-white py-2 pr-8 pl-3 text-sm text-gray-900 ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500"
              value={period}
              onChange={(event) => onPeriodChange(event.target.value)}
            >
              {periodOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="dashboard-page__refresh inline-flex h-10 items-center rounded-md border-0 bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-65"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-busy={isRefreshing}
          >
            {isRefreshing ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>

      {hasExtraFilters ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Filtros ativos">
            {activeFilters.map((filter) => (
              <li key={filter}>
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
                  {filter}
                </span>
              </li>
            ))}
          </ul>
          {onClearFilters ? (
            <button
              type="button"
              className="text-xs font-medium text-brand-600 hover:text-brand-700"
              onClick={onClearFilters}
            >
              Limpar filtros
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
