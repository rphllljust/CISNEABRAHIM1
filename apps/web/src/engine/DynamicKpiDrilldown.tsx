import { t } from '../i18n';

/**
 * KPI DRILL-DOWN — cards de indicador que aplicam filtro na lista.
 *
 * A engine NÃO calcula o indicador: ela recebe `value` pronto e apenas o apresenta. Quem deriva
 * a contagem é a tela, a partir do payload que já carregou — inventar métrica na engine seria
 * criar um segundo lugar onde o número nasce.
 *
 * O CLIQUE é o ponto: cada card declara QUAL filtro ele aplica (`filterField` + `filterValue`),
 * e a lista pai recebe esse filtro pelo mesmo caminho de qualquer outro. Assim o número e a
 * lista filtrada vêm do MESMO recorte, e o operador nunca vê um total que a lista não reproduz.
 *
 * Sem hardcode de negócio: nenhum rótulo, campo ou valor é conhecido aqui.
 */
export type KpiMetric = {
  /** Identificador estável do card, para `key` e para o `data-` de prova. */
  id: string;
  label: string;
  value: number | string;
  /** Campo do metadado que o clique filtra. Ausente = card não clicável. */
  filterField?: string;
  /** Valor aplicado ao campo. Ausente com `filterField` presente = limpa o filtro. */
  filterValue?: string;
  /** Texto secundário já formatado pela tela (ex.: valor somado). */
  hint?: string;
  tone?: 'neutral' | 'info' | 'warning' | 'critical' | 'success';
};

export type DynamicKpiDrilldownProps = {
  metrics: KpiMetric[];
  /** Aplica o filtro do card. Chamado só quando o card declara `filterField`. */
  onDrilldown?: (field: string, value: string) => void;
  /** Filtros ativos, para marcar o card como selecionado. */
  activeFilters?: Record<string, string>;
};

export function DynamicKpiDrilldown({
  metrics,
  onDrilldown,
  activeFilters = {},
}: DynamicKpiDrilldownProps): React.ReactElement | null {
  if (metrics.length === 0) {
    return null;
  }

  return (
    <div data-testid="dynamic-kpi-drilldown" className="mb-3 flex flex-wrap gap-2" role="group">
      {metrics.map((metric) => {
        const drillable = metric.filterField !== undefined && onDrilldown !== undefined;
        const active =
          metric.filterField !== undefined &&
          (activeFilters[metric.filterField] ?? '') === (metric.filterValue ?? '');

        return (
          <button
            key={metric.id}
            type="button"
            data-testid="dynamic-kpi-card"
            data-kpi-id={metric.id}
            data-kpi-value={String(metric.value)}
            data-kpi-field={metric.filterField ?? null}
            data-kpi-filter={metric.filterValue ?? null}
            data-kpi-active={active ? 'true' : 'false'}
            /* Card sem `filterField` não é botão de ação: fica inerte, não finge clicabilidade. */
            disabled={!drillable}
            aria-pressed={drillable ? active : undefined}
            className={`rounded-lg border px-3 py-2 text-left ${
              active ? 'border-slate-800 bg-slate-100' : 'border-gray-200 bg-white'
            } ${drillable ? 'cursor-pointer hover:border-slate-400' : 'cursor-default'}`}
            onClick={() => {
              if (metric.filterField !== undefined && onDrilldown) {
                onDrilldown(metric.filterField, metric.filterValue ?? '');
              }
            }}
          >
            <span className="block text-lg font-semibold tabular-nums" data-kpi-number>
              {metric.value}
            </span>
            <span className="block text-xs text-gray-600">{metric.label}</span>
            {metric.hint ? (
              <span className="mt-0.5 block text-[11px] text-gray-500">{metric.hint}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Extrai os indicadores de um conjunto de linhas, por agrupamento declarado.
 *
 * Existe para que a TELA não reimplemente contagem: ela descreve os recortes e a engine conta.
 * Continua sem conhecer domínio — os recortes chegam como `equals`.
 */
export type KpiSpec = {
  id: string;
  label: string;
  field: string;
  equals: string;
  tone?: KpiMetric['tone'];
};

export function buildKpiMetrics(
  rows: ReadonlyArray<Record<string, unknown>>,
  specs: readonly KpiSpec[],
): KpiMetric[] {
  return specs.map((spec) => ({
    id: spec.id,
    label: spec.label,
    value: rows.filter((row) => matches(row[spec.field], spec.equals)).length,
    filterField: spec.field,
    filterValue: spec.equals,
    ...(spec.tone ? { tone: spec.tone } : {}),
  }));
}

function matches(value: unknown, equals: string): boolean {
  if (typeof value === 'string') {
    return value === equals;
  }
  return false;
}

/** Rótulo padrão do bloco, para telas que não passam título próprio. */
export function kpiSectionLabel(): string {
  return t('filters.title');
}
