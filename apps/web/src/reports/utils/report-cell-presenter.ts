import { AGING_BUCKET_LABELS } from '../../financial-ui/labels';
import { formatServiceOrderStatus } from '../../service-orders/utils/service-order-labels';
import { MEASUREMENT_STATUSES } from '../../service-orders/types/measurement.types';
import { BILLING_RECORD_STATUSES } from '../../billing/types/billing.types';
import { SERVICE_ORDER_STATUSES } from '../../service-orders/types/service-order.types';

/**
 * APRESENTACAO SEMANTICA DAS CELULAS DE RELATORIO.
 *
 * O ReportsPage usava `formatCell()` generico: data, numero e string. Isso colocava na cara do
 * operador `unit-synthetic-homolog` (identificador interno de ambiente somado a codigo tecnico) e
 * `COMPLETED` / `CANCELLED` / `RELEASED` / `PREPARED` (enums crus de dominio) lado a lado com
 * numeros de OS ja legiveis. Relatorio e superficie de LEITURA: se o sistema ja sabe traduzir o
 * valor, a tela nao pode devolver o enum.
 *
 * REGRA DURA — nenhum rotulo e inventado aqui. Cada dicionario abaixo aponta para o mapa REAL do
 * dominio dono (`service-order-labels`, `labels.ts`, enums de medicao e faturamento). Quando o
 * valor nao tem traducao conhecida, o valor volta COMO VEIO e o gap fica registrado em
 * `PARK_LABEL_GAP` — nunca um rotulo adivinhado, nunca um placeholder que esconde o dado.
 *
 * Identificadores internos (unitId) nao recebem nome falso: o contrato de unidades operacionais
 * nao publica nome humano (PARK_API_GAP ja registrado em `useOperationalUnits`), entao a coluna
 * declara o ESCOPO em vez de repetir o slug como se fosse nome.
 */

/* ------------------------------------------------------------------ unidade */

/**
 * Colunas que carregam IDENTIFICADOR INTERNO de unidade operacional.
 *
 * `unitId` e o nome publicado pelo contrato de relatorios (`REPORT_DEFINITIONS`).
 */
const UNIT_COLUMN_KEYS = new Set(['unitId', 'unit', 'unitCode']);

/**
 * Unidade: o contrato publica `unitId` — slug interno em HML (`unit-synthetic-homolog`) e codigo
 * tecnico em outros ambientes. O sistema NAO conhece o nome humano, entao prometer um nome seria
 * pior que declarar o escopo. Mesma decisao ja tomada em `UnitScopeLabel`.
 */
export function presentUnitCell(value: unknown): string {
  const hasScope = typeof value === 'string' && value.trim().length > 0;
  return hasScope ? 'No seu escopo' : 'Sem unidade';
}

/* ------------------------------------------------------------------- status */

/**
 * Status por TIPO DE RELATORIO — o dicionario do dominio dono.
 *
 * A chave de coluna `status` e ambigua sozinha: em `SERVICE_ORDERS_BY_PERIOD` ela e o ciclo da OS,
 * em `MEASUREMENTS` e o ciclo da medicao e em `BILLING` o do registro de faturamento. Traduzir
 * `status` por um mapa unico misturaria vocabularios — por isso o mapa e escolhido pelo
 * `reportType`, que e o dominio real da linha.
 */
const REPORT_STATUS_PRESENTERS: Record<string, (value: string) => string | null> = {
  SERVICE_ORDERS_BY_PERIOD: presentServiceOrderStatus,
  SERVICE_ORDERS_BY_CLIENT: presentServiceOrderStatus,
  SERVICE_ORDERS_BY_SERVICE: presentServiceOrderStatus,
  SERVICE_ORDERS_OVERDUE: presentServiceOrderStatus,
  MEASUREMENTS: presentMeasurementStatus,
  BILLING: presentBillingStatus,
};

/** Ciclo da OS — dicionario REAL de `service-order-labels`. */
function presentServiceOrderStatus(value: string): string | null {
  const known = Object.values(SERVICE_ORDER_STATUSES) as string[];
  if (!known.includes(value)) {
    return null;
  }
  return formatServiceOrderStatus(value as (typeof SERVICE_ORDER_STATUSES)[keyof typeof SERVICE_ORDER_STATUSES]);
}

/** Ciclo da medicao — mesmos rotulos de `MeasurementStatusBadge`. */
const MEASUREMENT_STATUS_LABELS: Record<string, string> = {
  [MEASUREMENT_STATUSES.Draft]: 'Rascunho',
  [MEASUREMENT_STATUSES.Submitted]: 'Submetida',
  [MEASUREMENT_STATUSES.UnderReview]: 'Em análise',
  [MEASUREMENT_STATUSES.Approved]: 'Aprovada',
  [MEASUREMENT_STATUSES.Rejected]: 'Rejeitada',
};

function presentMeasurementStatus(value: string): string | null {
  return MEASUREMENT_STATUS_LABELS[value] ?? null;
}

/** Ciclo do registro de faturamento — mesmos rotulos de `BillingStatusBadge`. */
const BILLING_STATUS_LABELS: Record<string, string> = {
  [BILLING_RECORD_STATUSES.Prepared]: 'Em preparação',
  [BILLING_RECORD_STATUSES.Voided]: 'Anulado',
};

function presentBillingStatus(value: string): string | null {
  return BILLING_STATUS_LABELS[value] ?? null;
}

/**
 * Alocacao de ativo — `AssetAllocationStatusBadge` declara exatamente `available` / `allocated`
 * (minusculos). O relatorio de utilizacao publica a mesma dimensao.
 */
const ALLOCATION_STATUS_LABELS: Record<string, string> = {
  available: 'Disponível',
  allocated: 'Alocado',
  AVAILABLE: 'Disponível',
  ALLOCATED: 'Alocado',
};

/**
 * Faixa de aging — `AGING_BUCKET_LABELS` do modulo financeiro. As chaves de bucket
 * (`1_30`, `90_PLUS`, `CURRENT`) nao significam nada fora do dicionario.
 */
export const presentAgingBucket = (value: string): string | null => AGING_BUCKET_LABELS[value] ?? null;

/* --------------------------------------------------------------- disciplina */

/** Coluna de status com vocabulario conhecido pelo dominio dono do relatorio. */
function relatorDeStatus(reportType: string, columnKey: string): ((value: string) => string | null) | null {
  if (columnKey === 'status') {
    return REPORT_STATUS_PRESENTERS[reportType] ?? null;
  }
  if (columnKey === 'allocationStatus') {
    return (value: string) => ALLOCATION_STATUS_LABELS[value] ?? null;
  }
  if (columnKey === 'bucket') {
    return presentAgingBucket;
  }
  return null;
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function presentDate(value: string, withTime: boolean): string {
  return new Intl.DateTimeFormat('pt-BR', withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }).format(
    new Date(value),
  );
}

/**
 * Valor de celula ja apresentado para leitura humana.
 *
 * Ordem de decisao — a mais especifica vence:
 * 1. nulo/vazio -> travessao (nunca "null" na tela);
 * 2. coluna de status com dicionario real do relatorio -> rotulo do dominio;
 * 3. coluna de unidade -> escopo declarado, nunca o slug interno;
 * 4. data ISO -> data local pt-BR;
 * 5. objeto/array -> resumo estrutural, nunca `[object Object]`.
 *
 * O valor cru NAO e descartado: ele continua no `title` da celula, para auditoria.
 */
export function presentReportCell(
  reportType: string,
  columnKey: string,
  value: unknown,
): { text: string; raw: string | null; humanized: boolean } {
  if (value === null || value === undefined || value === '') {
    return { text: '—', raw: null, humanized: false };
  }

  if (typeof value === 'string') {
    const traduzir = relatorDeStatus(reportType, columnKey);
    if (traduzir) {
      const label = traduzir(value);
      if (label !== null) {
        return { text: label, raw: value, humanized: true };
      }
      // PARK_LABEL_GAP: valor de dominio sem traducao conhecida — exibido como veio.
      return { text: value, raw: value, humanized: false };
    }

    if (UNIT_COLUMN_KEYS.has(columnKey)) {
      return { text: presentUnitCell(value), raw: value, humanized: true };
    }

    if (ISO_DATE_TIME.test(value)) {
      return { text: presentDate(value, true), raw: value, humanized: true };
    }
    if (ISO_DATE.test(value)) {
      return { text: presentDate(value, false), raw: value, humanized: true };
    }
    return { text: value, raw: value, humanized: false };
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return { text: String(value), raw: String(value), humanized: false };
  }

  if (Array.isArray(value)) {
    return { text: `${value.length} item(ns)`, raw: JSON.stringify(value), humanized: true };
  }

  if (isPlainObject(value)) {
    return { text: `${Object.keys(value).length} campo(s)`, raw: JSON.stringify(value), humanized: true };
  }

  return { text: '—', raw: null, humanized: false };
}

/* ------------------------------------------------- busca global (mesmo problema) */

/**
 * STATUS NA BUSCA GLOBAL — a Busca agrupa resultados por TIPO DE ENTIDADE
 * (`CLIENT`, `SERVICE_ORDER`, `MEASUREMENT`, `BILLING_RECORD`, ...) e publica `status` cru em cada
 * item. E o mesmo defeito dos relatorios: `COMPLETED` na cara do operador.
 *
 * O dicionario e escolhido pelo `entityType`, que e o dominio real da linha — um mapa unico
 * misturaria o ciclo da OS com o da medicao. Valores sem traducao conhecida voltam como vieram
 * (PARK_LABEL_GAP), nunca por adivinhacao.
 */
const SEARCH_STATUS_PRESENTERS: Record<string, (value: string) => string | null> = {
  SERVICE_ORDER: presentServiceOrderStatus,
  MEASUREMENT: presentMeasurementStatus,
  BILLING_RECORD: presentBillingStatus,
};

export function presentSearchStatus(entityType: string, status: string | null): string | null {
  if (!status) {
    return null;
  }
  const traduzir = SEARCH_STATUS_PRESENTERS[entityType];
  // PARK_LABEL_GAP: os tipos restantes (CLIENT, SERVICE_REQUEST, PROPOSAL, PURCHASE_ORDER, ASSET,
  // DOCUMENT) nao publicam dicionario de status no modulo de busca; o valor segue como veio.
  return traduzir ? (traduzir(status) ?? status) : status;
}
