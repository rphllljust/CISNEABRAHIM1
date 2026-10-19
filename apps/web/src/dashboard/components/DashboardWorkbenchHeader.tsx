import {
  WORK_DOMAIN_LABELS,
  type WorkDomain,
} from '../../work-inbox/api/work-inbox-api';
import { cn } from '../../ui/utils/cn';
import { DASHBOARD_DOMAIN_ORDER } from '../utils/dashboard-semantics';
import { situationBadgeLabel, type OperationalSituation } from '../utils/dashboard-situation';

export type DashboardWorkbenchHeaderProps = {
  title: string;
  /** Descricao contextual curta — o que ESTA superficie responde. */
  description: string;
  unitLabel: string | null;
  periodLabel: string | null;
  period: string;
  periodOptions: ReadonlyArray<{ value: string; label: string }>;
  onPeriodChange: (period: string) => void;
  activeFilters: string[];
  onClearFilters?: () => void;
  generatedAt: string | null;
  generatedAtFormatted: string | null;
  /** UNICO filtro de dominio da tela: alimenta fila, cadeia e faixa de indicadores. */
  domain: WorkDomain | null;
  onDomainChange: (domain: WorkDomain | null) => void;
  /** Situacao do recorte — avaliada pelo painel, exibida aqui como fato de contexto. */
  situation: OperationalSituation | null;
  /** Quantos itens a fila de trabalho publicou para o recorte ativo. */
  queueTotal: number | null;
};

const SITUATION_TONE_CLASS = {
  critical: 'dashboard-workspace-head__situation--critical',
  warning: 'dashboard-workspace-head__situation--warning',
  unknown: 'dashboard-workspace-head__situation--unknown',
  normal: 'dashboard-workspace-head__situation--normal',
} as const;

/**
 * CABECALHO DO WORKSPACE OPERACIONAL — contexto em DUAS faixas densas, alinhadas por divisor.
 *
 * O que existia aqui era um bloco escuro de ~200px (`linear-gradient` teal->slate + sombra de 42px)
 * que dominava a primeira dobra: o cabecalho pesava mais que o trabalho. A tela e ERP desktop de
 * tema CLARO — o cabecalho dela e uma faixa de contexto, nao um banner.
 *
 * A composicao nova e a mesma informacao, com massa visual menor:
 *
 *   linha 1  identidade (titulo + descricao) | escopo e periodo | atualizado, periodo, atualizar
 *   linha 2  recorte de dominio (unico lugar da tela onde o recorte vive) | situacao e refinamento
 *
 * A SITUACAO DO RECORTE subiu para ca de proposito. Antes eram dois lugares concorrentes dizendo se
 * havia problema: um banner no meio do conteudo e a contagem NAO publicada em outro. Agora existe
 * UMA regua de situacao, no mesmo plano do recorte que a produziu — o operador le "recorte" e
 * "estado do recorte" na mesma linha, sem procurar.
 */
export function DashboardWorkbenchHeader({
  title,
  description,
  unitLabel,
  periodLabel,
  period,
  periodOptions,
  onPeriodChange,
  activeFilters,
  onClearFilters,
  generatedAt,
  generatedAtFormatted,
  domain,
  onDomainChange,
  situation,
  queueTotal,
}: DashboardWorkbenchHeaderProps) {
  const hasExtraFilters = activeFilters.length > 0;
  const badge = situation ? situationBadgeLabel(situation) : null;
  const situationTone = situation?.level ?? 'unknown';
  const periodOptionLabel = periodOptions.find((option) => option.value === period)?.label ?? period;

  return (
    /*
      `role="group"`, NAO `<header>`.

      O shell JA tem o banner da aplicacao (`ShellTopBar`, `role="banner"`). Um `<header>` aqui e
      mapeado como um SEGUNDO landmark `banner` — o leitor de tela passa a ter dois "cabecalhos" e
      nao sabe qual e o da pagina. O cabecalho do workspace e o topo da AREA DE TRABALHO.
    */
    <div className="dashboard-workspace-head" role="group" aria-label="Contexto do workspace">
      <div className="dashboard-workspace-head__row">
        <div className="dashboard-workspace-head__identity">
          <p className="dashboard-workspace-head__eyebrow">
            Painel operacional · {periodOptionLabel}
          </p>
          <h1 className="dashboard-workspace-head__title">{title}</h1>
          <p className="dashboard-workspace-head__description">{description}</p>
        </div>

        <div className="dashboard-workspace-head__controls" aria-label="Controles do workspace">
          <p className="dashboard-workspace-head__scope">
            <span>{unitLabel ?? 'Todas as unidades autorizadas'}</span>
            <span aria-hidden className="dashboard-workspace-head__sep">
              ·
            </span>
            <span className="tabular-nums">{periodLabel ?? 'período carregando'}</span>
          </p>

          {generatedAt && generatedAtFormatted ? (
            <p className="dashboard-workspace-head__updated">
              <span className="dashboard-workspace-head__updated-label">Atualizado</span>
              <time dateTime={generatedAt}>{generatedAtFormatted}</time>
            </p>
          ) : null}

          <label className="dashboard-workspace-head__period">
            <span className="cisne-sr-only">Período</span>
            <select
              id="dashboard-period"
              aria-label="Período"
              className="dashboard-workspace-head__select"
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

        </div>
      </div>

      <div className="dashboard-workspace-head__row dashboard-workspace-head__row--recorte">
        <div className="dashboard-workspace-head__chips" role="group" aria-label="Recorte por domínio">
          <button
            type="button"
            aria-pressed={domain === null}
            className={cn(
              'dashboard-workspace-head__chip',
              domain === null && 'dashboard-workspace-head__chip--on',
            )}
            onClick={() => onDomainChange(null)}
          >
            Tudo
          </button>
          {DASHBOARD_DOMAIN_ORDER.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={domain === candidate}
              className={cn(
                'dashboard-workspace-head__chip',
                domain === candidate && 'dashboard-workspace-head__chip--on',
              )}
              onClick={() => onDomainChange(domain === candidate ? null : candidate)}
            >
              {WORK_DOMAIN_LABELS[candidate]}
            </button>
          ))}
        </div>

        <div className="dashboard-workspace-head__state">
          {badge ? (
            <span
              className={cn(
                'dashboard-workspace-head__situation',
                SITUATION_TONE_CLASS[situationTone],
              )}
            >
              {badge}
              {typeof queueTotal === 'number' ? (
                <span className="dashboard-workspace-head__queue-count tabular-nums">
                  {queueTotal} na fila
                </span>
              ) : null}
            </span>
          ) : null}

          {hasExtraFilters ? (
            <>
              <ul className="dashboard-workspace-head__filter-list" aria-label="Filtros ativos">
                {activeFilters.map((filter) => (
                  <li key={filter} className="dashboard-workspace-head__filter">
                    {filter}
                  </li>
                ))}
              </ul>
              {onClearFilters ? (
                <button type="button" className="dashboard-workspace-head__clear" onClick={onClearFilters}>
                  Limpar
                </button>
              ) : null}
            </>
          ) : null}

        </div>
      </div>
    </div>
  );
}
