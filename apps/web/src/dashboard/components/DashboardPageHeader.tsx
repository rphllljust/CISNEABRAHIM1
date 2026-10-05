import { RefreshCw } from 'lucide-react';
import { WORK_DOMAIN_LABELS, WORK_DOMAINS } from '../../work-inbox/api/work-inbox-api';
import { cn } from '../../ui/utils/cn';

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
  /** Escopo de unidade — mantido no value do seletor, nunca exibido como nome. */
  unitId?: string | null;
  /** UNICO filtro de dominio da tela: alimenta fila, cadeia e faixa de indicadores. */
  domain: string | null;
  onDomainChange: (domain: string | null) => void;
  /** UNICO refinamento temporal da tela. */
  overdueOnly: boolean;
  onOverdueChange: (value: boolean) => void;
};

/**
 * COMMAND HEADER — DUAS linhas de contexto, sem hero.
 *
 * A tela tinha DUAS camadas de recorte concorrentes: uma barra de "Visoes" (Tudo / salvar visao)
 * dentro da fila e uma fileira de chips de dominio ao lado dela — a mesma pergunta feita duas
 * vezes, com dois estados que podiam discordar. Aqui existe UMA faixa: escopo e periodo a esquerda
 * (perspectiva), recorte de dominio e refinamento a direita. Nenhuma secao da tela tem filtro
 * proprio.
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
  domain,
  onDomainChange,
  overdueOnly,
  onOverdueChange,
}: DashboardPageHeaderProps) {
  const hasExtraFilters = activeFilters.length > 0;

  return (
    <header className="dashboard-command">
      <div className="dashboard-command__row">
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
      </div>

      <div className="dashboard-command__row dashboard-command__row--recorte">
        <div className="dashboard-command__chips" role="group" aria-label="Recorte por domínio">
          <button
            type="button"
            aria-pressed={domain === null}
            className={cn('dashboard-command__chip', domain === null && 'dashboard-command__chip--on')}
            onClick={() => onDomainChange(null)}
          >
            Tudo
          </button>
          {WORK_DOMAINS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={domain === candidate}
              className={cn(
                'dashboard-command__chip',
                domain === candidate && 'dashboard-command__chip--on',
              )}
              onClick={() => onDomainChange(domain === candidate ? null : candidate)}
            >
              {WORK_DOMAIN_LABELS[candidate]}
            </button>
          ))}
        </div>

        <div className="dashboard-command__refine">
          {hasExtraFilters ? (
            <ul className="dashboard-command__filter-list" aria-label="Filtros ativos">
              {activeFilters.map((filter) => (
                <li key={filter} className="dashboard-command__filter">
                  {filter}
                </li>
              ))}
            </ul>
          ) : null}
          {hasExtraFilters && onClearFilters ? (
            <button type="button" className="dashboard-command__clear" onClick={onClearFilters}>
              Limpar
            </button>
          ) : null}
          <label className="dashboard-command__overdue">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(event) => onOverdueChange(event.target.checked)}
            />
            Somente vencidos
          </label>
        </div>
      </div>
    </header>
  );
}
