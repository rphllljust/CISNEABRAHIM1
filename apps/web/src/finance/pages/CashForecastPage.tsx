import { useCallback, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DateTime, EmptyState, Field, Input, Money } from '../../ui';
import {
  enterpriseHeadCellClass,
  enterpriseNumericCellClass,
  enterpriseNumericHeadCellClass,
  enterpriseRowClass,
  enterpriseTableCardClass,
  enterpriseTableClass,
  enterpriseCellClass,
  enterpriseCellMutedClass,
  worklistControlClass,
} from '../../ui/enterprise-list';
import { ModulePage } from '../../ui/module-layout';
import { Button } from '../../ui/Button';
import { WorkbenchQueue } from '../../ui/workbench';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { getCashForecast } from '../api/finance-api';
import { formatDatePtBr } from '../../billing/utils/billing-format';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import type { CashForecast, CashForecastLine } from '../types/finance.types';
import {
  EnterpriseObjectHeader,
  EnterpriseObjectPage,
  ObjectContextBlock,
  type ObjectContextField,
  type ObjectPagePhase,
} from '../../enterprise-object';
/** `ObjectPanel` vem do modulo-fonte: o barril o reexporta, e o ciclo quebra a inferencia. */
import { ObjectPanel } from '../../enterprise-object/EnterpriseObjectPage';

/**
 * PREVISAO DE CAIXA — workspace financeira TEMPORAL, nao dashboard.
 *
 * A tela responde, com o que o SERVIDOR devolve e nada mais:
 *   quanto tenho? quanto entra? quanto sai? quanto terei? quando falta caixa? por que?
 *
 * TRES CATEGORIAS QUE NAO SE MISTURAM (ACTUAL != COMMITTED != FORECAST):
 *   REALIZADO    — fato ocorrido: saldo de caixa e liquidacoes/pagamentos ja efetivados.
 *   COMPROMETIDO — parcela de titulo ATIVO com vencimento ANTERIOR a posicao: divida real em
 *                  atraso, excecao operacional antes de decoracao.
 *   PREVISTO     — parcela de titulo ativo vencendo DENTRO do horizonte, hoje e adiante.
 *
 * Essas categorias NAO sao inferidas: os totais de vencido vem publicados pelo servidor
 * (`forecast.overdueInflows/overdueOutflows`) e as linhas trazem `kind` + `bucket`. O navegador
 * NAO soma titulo, NAO estima, NAO projeta e NAO inventa limite de caixa.
 */

/** Rotulo humano do tipo de linha. Tipo desconhecido e mostrado como veio, nunca oculto. */
const LINE_KIND_LABELS: Record<string, string> = {
  REALIZED: 'Realizado',
  FORECAST: 'Previsto',
  RECEIVABLE: 'Recebível',
  PAYABLE: 'Pagável',
};

/** Rotulo humano da origem do movimento — a resposta ao "por que". */
const SOURCE_LABELS: Record<string, string> = {
  TREASURY_BALANCE: 'Saldo de caixa e bancos',
  RECEIVABLE_SETTLEMENT: 'Recebimento liquidado',
  PAYABLE_PAYMENT: 'Pagamento efetuado',
  RECEIVABLE_INSTALLMENT: 'Parcela a receber',
  PAYABLE_INSTALLMENT: 'Parcela a pagar',
};

/** Rotulo humano da janela de vencimento publicada pelo servidor. */
const BUCKET_LABELS: Record<string, string> = {
  OVERDUE: 'Vencido',
  DUE: 'Vence hoje',
  SCHEDULED: 'Programado',
};

const DIRECTION_LABELS: Record<string, string> = {
  INFLOW: 'Entrada',
  OUTFLOW: 'Saída',
  BALANCE: 'Saldo',
};

/**
 * Horizonte de projecao. `days` e um deslocamento de CALENDARIO aplicado a posicao — o navegador
 * nao projeta nada: ele escolhe QUAL data enviar. Sem posicao informada nao existe horizonte
 * possivel, porque nao existe de onde contar.
 */
const HORIZON_PRESETS: Array<{ id: string; label: string; days: number }> = [
  { id: 'today', label: 'Hoje', days: 0 },
  { id: '7', label: '7 dias', days: 7 },
  { id: '30', label: '30 dias', days: 30 },
  { id: '60', label: '60 dias', days: 60 },
  { id: '90', label: '90 dias', days: 90 },
];

const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * O QUE A PROJEÇÃO RESPONDE — declarado ANTES de existir projeção carregada.
 *
 * Não é texto de sistema: é o mapa das QUATRO leituras que a tela publica quando o servidor
 * devolve a série (saldo realizado, entradas, saídas e posição projetada) e a origem de cada uma
 * nos dois razões. Sem isto o estado inicial era um aviso vazio, e o operador só descobria o
 * alcance da tela depois de projetar.
 */
const FORECAST_CAPABILITIES: Array<{ title: string; description: string }> = [
  {
    title: 'Saldo realizado',
    description: 'Caixa e bancos na posição informada, reconstruído por conta.',
  },
  {
    title: 'Entradas previstas',
    description: 'Parcelas a receber com vencimento dentro do horizonte.',
  },
  {
    title: 'Saídas previstas',
    description: 'Parcelas a pagar com vencimento dentro do horizonte.',
  },
  {
    title: 'Posição projetada',
    description: 'Saldo atual somado ao efeito líquido do horizonte, calculado pelo servidor.',
  },
];

/** Ultimo dia do horizonte como dia de CALENDARIO — nunca instante UTC. */
export function addDaysToIsoDate(value: string, days: number): string {
  const match = ISO_DATE_ONLY.exec(value.slice(0, 10));
  if (!match) {
    return value;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Preset que casa EXATAMENTE com o recorte consultado. Sem casar, nenhum preset fica aceso. */
export function activeHorizonPreset(asOf: string, horizonEndsOn: string): string | null {
  const preset = HORIZON_PRESETS.find(
    (item) => addDaysToIsoDate(asOf, item.days) === horizonEndsOn.slice(0, 10),
  );
  return preset ? preset.id : null;
}

export function cashForecastLineLabel(kind: string): string {
  return LINE_KIND_LABELS[kind] ?? kind;
}

export function cashForecastSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export function cashForecastBucketLabel(bucket: string): string {
  return BUCKET_LABELS[bucket] ?? bucket;
}

export function cashForecastDirectionLabel(direction: string): string {
  return DIRECTION_LABELS[direction] ?? direction;
}

const toNumber = (value: string | null | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Vencido a receber publicado pelo servidor. Zero e ausencia de fato, nao um risco zerado. */
export function hasCommittedOverdueInflows(forecast: CashForecast): boolean {
  return toNumber(forecast.forecast.overdueInflows) > 0;
}

/** Vencido a pagar publicado pelo servidor. */
export function hasCommittedOverdueOutflows(forecast: CashForecast): boolean {
  return toNumber(forecast.forecast.overdueOutflows) > 0;
}

/** Ha excecao a declarar SOMENTE quando o servidor informou valor vencido maior que zero. */
export function hasOverdueRisk(forecast: CashForecast): boolean {
  return hasCommittedOverdueInflows(forecast) || hasCommittedOverdueOutflows(forecast);
}

/**
 * Risco de caixa: saldo projetado negativo PUBLICADO pelo servidor.
 *
 * Sem limite/floor oficial no contrato, o unico limiar honesto e a propria cobertura do saldo:
 * o navegador nao inventa threshold de tesouraria.
 */
export function hasNegativeProjectedCash(forecast: CashForecast): boolean {
  return toNumber(forecast.projectedCash.amount) < 0;
}

/** Fatos de contexto: o recorte exato da projecao e a natureza de cada bloco. */
export function buildForecastContextFields(forecast: CashForecast): ObjectContextField[] {
  return [
    { label: 'Unidade', value: forecast.unitId },
    { label: 'Moeda', value: forecast.currencyCode },
    { label: 'Posição (as of)', value: formatDatePtBr(forecast.asOf) },
    { label: 'Horizonte até', value: formatDatePtBr(forecast.horizonEndsOn) },
    {
      label: 'Situação',
      value: forecast.status === 'NO_DATA' ? 'Sem dados projetados' : 'Projetado',
    },
    {
      label: 'Linhas devolvidas',
      value: String(forecast.lines.length),
      hint: 'Movimentos que o servidor devolveu para o horizonte',
    },
  ];
}

/** Colecao de linhas do forecast, na leitura tipada usada pelos blocos da tela. */
type ForecastLines = CashForecastLine[];

/**
 * As linhas do contrato numa colecao TIPADA.
 *
 * O contrato publica `lines` como uniao larga (o mesmo campo carrega saldo, liquidacao e
 * parcela), e inferir o tipo do elemento direto do campo devolve `any` para os helpers de
 * rotulo. A anotacao local fixa a leitura sem tocar no contrato nem no dominio: os rotulos
 * continuam recebendo string, e o valor segue vindo do servidor sem reinterpretacao.
 */
function forecastLines(forecast: CashForecast): ForecastLines {
  const lines: ForecastLines = forecast.lines;
  return lines;
}

/** Linhas RECEBIDAS do servidor para uma categoria. Nada e somado nem estimado aqui. */
function linesOf(forecast: CashForecast, kind: string): ForecastLines {
  const lines: ForecastLines = forecastLines(forecast).filter((line) => line.kind === kind);
  return lines;
}

function lineDirections(lines: ForecastLines): string[] {
  const directions: string[] = [];
  for (const line of lines) {
    if (!directions.includes(line.direction)) {
      directions.push(line.direction);
    }
  }
  return directions;
}

/**
 * Drilldown REAL: o titulo que origina o movimento abriu a tela de detalhe do modulo.
 * Sem `originId` publicado, o texto continua sendo o valor — o front nao inventa link.
 */
function originCell(line: CashForecastLine): ReactNode {
  const label = cashForecastSourceLabel(line.source);
  if (!line.originId) {
    return label;
  }
  const linkTarget = line.source === 'PAYABLE_INSTALLMENT' || line.source === 'PAYABLE_PAYMENT';
  return (
    <Link
      to={`/app/finance/${linkTarget ? 'payables' : 'receivables'}/${line.originId}`}
      className="text-brand-700 no-underline hover:text-brand-800 hover:underline"
    >
      {label}
    </Link>
  );
}

/**
 * Grade de movimentos de UMA categoria, na mesma coluna semantica de toda worklist:
 * tipo, vencimento, origem navegavel e valor. Total NUNCA e recalculado: a fonte do total
 * e o bloco de totais do servidor, declarada no rodape.
 */
function MovementTable({
  caption,
  total,
  totalSource,
  currencyCode,
  lines,
}: {
  caption: string;
  total: ReactNode;
  totalSource: string;
  currencyCode: string;
  lines: ForecastLines;
}) {
  if (lines.length === 0) {
    return (
      <p className="m-0 text-xs text-gray-500">
        O servidor não devolveu movimentos nesta categoria para o recorte consultado.
      </p>
    );
  }
  const directions = lineDirections(lines);
  return (
    <div className={enterpriseTableCardClass}>
      <table className={enterpriseTableClass} aria-label={caption}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={enterpriseHeadCellClass}>
              Movimento
            </th>
            {directions.length > 1 ? (
              <th scope="col" className={enterpriseHeadCellClass}>
                Direção
              </th>
            ) : null}
            <th scope="col" className={enterpriseHeadCellClass}>
              Vencimento
            </th>
            <th scope="col" className={enterpriseHeadCellClass}>
              Origem
            </th>
            <th scope="col" className={enterpriseHeadCellClass}>
              Janela
            </th>
            <th scope="col" className={enterpriseNumericHeadCellClass}>
              Valor
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.kind}-${line.source}-${line.originId}-${index}`} className={enterpriseRowClass}>
              {/*
                MOVIMENTO — o rótulo humano da ORIGEM, nunca o token do domínio. A primeira coluna
                exibia `TREASURY_BALANCE` cru; o mapa `cashForecastSourceLabel` já existe nesta tela
                e é o mesmo usado pela coluna de origem ao lado.
              */}
              <td className={enterpriseCellClass}>{cashForecastSourceLabel(line.source)}</td>
              {directions.length > 1 ? (
                <td className={enterpriseCellClass}>{cashForecastDirectionLabel(line.direction)}</td>
              ) : null}
              <td className={enterpriseCellMutedClass}>
                {line.dueOn ? <DateTime value={line.dueOn} mode="date" /> : '—'}
              </td>
              <td className={enterpriseCellClass}>{originCell(line)}</td>
              <td className={enterpriseCellMutedClass}>
                {line.bucket ? cashForecastBucketLabel(line.bucket) : '—'}
              </td>
              <td className={enterpriseNumericCellClass}>
                <Money value={line.amount} currencyCode={currencyCode} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={directions.length > 1 ? 5 : 4} className={enterpriseCellClass}>
              <span className="font-semibold text-gray-700">{caption}</span>
              <span className="ml-2 text-[11px] text-gray-500">{totalSource}</span>
            </th>
            <td className={`${enterpriseNumericCellClass} font-semibold text-gray-900`}>{total}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function CashForecastPage() {
  const [unitId, setUnitId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('BRL');
  const [asOf, setAsOf] = useState('');
  const [horizonEndsOn, setHorizonEndsOn] = useState('');
  const [submitted, setSubmitted] = useState<{
    unitId: string;
    currencyCode: string;
    asOf?: string;
    horizonEndsOn?: string;
  } | null>(null);

  const project = useCallback(
    (override?: { horizonEndsOn?: string }) => {
      const requestedAsOf = asOf.trim() || undefined;
      const requestedHorizon = override?.horizonEndsOn ?? (horizonEndsOn.trim() || undefined);
      if (override?.horizonEndsOn) {
        setHorizonEndsOn(override.horizonEndsOn);
      }
      setSubmitted({
        unitId: unitId.trim(),
        currencyCode: currencyCode.trim() || 'BRL',
        asOf: requestedAsOf,
        horizonEndsOn: requestedHorizon,
      });
    },
    [asOf, horizonEndsOn, unitId, currencyCode],
  );

  const loader = useCallback(
    (signal?: AbortSignal) =>
      getCashForecast(
        {
          unitId: submitted?.unitId ?? '',
          currencyCode: submitted?.currencyCode ?? 'BRL',
          asOf: submitted?.asOf,
          horizonEndsOn: submitted?.horizonEndsOn,
        },
        signal,
      ),
    [submitted],
  );
  const { state, reload } = useBackofficeQuery<CashForecast>({
    loader,
    mapError: mapFinanceErrorToMessage,
    enabled: Boolean(submitted && submitted.unitId),
    autoLoad: Boolean(submitted && submitted.unitId),
  });

  const forecast = state.phase === 'ready' ? state.data : null;
  const activePreset = forecast ? activeHorizonPreset(forecast.asOf, forecast.horizonEndsOn) : null;

  /*
   * RECORTE EM LEITURA — os fatos do recorte que o servidor devolveu, numa linha, sempre
   * presentes. O cabecalho do objeto repete os mesmos fatos no campo "Posição (as of)" e na
   * coluna de contexto; esta linha e a leitura rapida de unidade/moeda/posicao/horizonte.
   */
  const scopeFacts = forecast ? (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
      <span>
        <span className="text-gray-500">Unidade: </span>
        <strong className="font-semibold text-gray-800">{forecast.unitId}</strong>
      </span>
      <span>
        <span className="text-gray-500">Moeda: </span>
        <strong className="font-semibold text-gray-800">{forecast.currencyCode}</strong>
      </span>
      <span>
        <span className="text-gray-500">Posição: </span>
        <DateTime value={forecast.asOf} mode="date" />
      </span>
      <span>
        <span className="text-gray-500">Horizonte até: </span>
        <DateTime value={forecast.horizonEndsOn} mode="date" />
      </span>
    </div>
  ) : null;

  return (
    <ModulePage layout="workspace">
      {/*
        PARAMETROS — a unica acao real da tela. Fica ANTES do cabecalho do objeto porque e ela
        que define o recorte; o cabecalho passa a descrever a projecao que ja existe.
      */}
      <form
        className="mb-3 rounded-lg border border-gray-200 bg-white"
        aria-label="Parâmetros da projeção de caixa"
        onSubmit={(event) => {
          event.preventDefault();
          project();
        }}
      >
        <div className="flex flex-wrap items-end gap-2 border-b border-gray-100 px-3 py-2">
          <div className="w-36">
            <Field label="Unidade" htmlFor="forecast-unit">
              <Input
                id="forecast-unit"
                className={worklistControlClass}
                value={unitId}
                onChange={(event) => setUnitId(event.target.value)}
                required
              />
            </Field>
          </div>
          <div className="w-24">
            <Field label="Moeda" htmlFor="forecast-currency">
              <Input
                id="forecast-currency"
                className={worklistControlClass}
                value={currencyCode}
                onChange={(event) => setCurrencyCode(event.target.value)}
                required
              />
            </Field>
          </div>
          <div className="w-40">
            <Field label="Posição em" htmlFor="forecast-as-of">
              <Input
                id="forecast-as-of"
                className={worklistControlClass}
                type="date"
                value={asOf}
                onChange={(event) => setAsOf(event.target.value)}
              />
            </Field>
          </div>
          <div className="w-40">
            <Field label="Horizonte até" htmlFor="forecast-horizon">
              <Input
                id="forecast-horizon"
                className={worklistControlClass}
                type="date"
                value={horizonEndsOn}
                onChange={(event) => setHorizonEndsOn(event.target.value)}
              />
            </Field>
          </div>
          <Button type="submit" className="mb-0.5">
            Projetar
          </Button>
        </div>
        {/*
          HORIZONTE — so existe quando existe POSICAO, porque o horizonte e contado a partir
          dela. As opcoes apenas escolhem QUAIS datas enviar; a projecao continua sendo do
          servidor. Sem posicao informada o grupo fica indisponivel em vez de mentir um recorte.
        */}
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
          <span className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
            Horizonte
          </span>
          {HORIZON_PRESETS.map((preset) => {
            const disabled = asOf.trim().length === 0;
            const selected = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => project({ horizonEndsOn: addDaysToIsoDate(asOf.trim(), preset.days) })}
                className={
                  selected
                    ? 'rounded border border-brand-600 bg-brand-50 px-2 py-1 text-[12px] font-semibold text-brand-800 disabled:cursor-not-allowed disabled:opacity-60'
                    : 'rounded border border-gray-300 bg-white px-2 py-1 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60'
                }
              >
                {preset.label}
              </button>
            );
          })}
          <span className="text-[11px] text-gray-500">
            {asOf.trim().length === 0
              ? 'Informe a posição para projetar por período.'
              : 'Contado a partir da posição; a projeção é calculada pelo servidor.'}
          </span>
        </div>
      </form>

      {/*
        ESTADOS DE PAGINA resolvidos pela MESMA moldura das object pages: negacao nao e
        ausencia de dado, e falha de autorizacao nao se disfarca de lista vazia.

        O estado inicial NAO e uma tela morta: enquanto ninguem projetou, a tela declara o que
        este workspace responde e quais filas do dominio alimentam a projecao — o operador sabe o
        que vai encontrar antes de informar a unidade, em vez de olhar um aviso vazio.
      */}
      {state.phase === 'idle' ? (
        <section aria-label="Como a previsão é composta" className="mb-2">
          <WorkbenchQueue
            title="O que a projeção responde"
            description="A projeção é calculada pelo servidor para a unidade, a moeda e o horizonte informados. Escolha a posição e o horizonte acima para carregá-la."
          >
            <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
              {FORECAST_CAPABILITIES.map((item) => (
                <div key={item.title} className="min-w-0">
                  <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    {item.title}
                  </dt>
                  <dd className="m-0 mt-0.5 text-[13px] text-gray-700">{item.description}</dd>
                </div>
              ))}
            </dl>
          </WorkbenchQueue>
        </section>
      ) : null}

      <EnterpriseObjectPage
        breadcrumb={[{ label: 'Financeiro', href: '/app/finance' }, { label: 'Previsão de caixa' }]}
        phase={
          (
            {
              idle: 'empty',
              loading: 'loading',
              denied: 'denied',
              error: 'error',
              ready: 'ready',
            } as const satisfies Record<string, ObjectPagePhase>
          )[state.phase]
        }
        phaseTitle={state.phase === 'idle' ? 'Nenhuma projeção carregada' : 'Previsão de caixa'}
        phaseMessage={
          state.phase === 'idle'
            ? 'Informe a unidade e projete para consultar o servidor.'
            : state.phase === 'loading'
              ? 'Projetando caixa…'
              : state.phase === 'denied'
                ? 'Você não tem permissão para consultar a previsão de caixa.'
                : state.phase === 'error'
                  ? state.message
                  : undefined
        }
        onRetry={
          state.phase === 'error' && state.retryable ? () => void reload() : undefined
        }
        header={
          forecast ? (
            <>
              {scopeFacts}
              <EnterpriseObjectHeader
                reference={`${forecast.unitId} · ${forecast.currencyCode}`}
                title="Previsão de caixa"
                /*
                 * Datas em formato HUMANO — o subtítulo exibia `2026-10-06` cru. As mesmas datas
                 * já aparecem formatadas na linha de recorte acima e no contexto do objeto; aqui
                 * elas apenas repetem o recorte, na gramática de data do produto.
                 */
                subtitle={`Posição em ${formatDatePtBr(forecast.asOf)} · horizonte até ${formatDatePtBr(forecast.horizonEndsOn)}`}
                status={
                  forecast.status === 'NO_DATA'
                    ? {
                        label: 'Sem dados projetados',
                        tone: 'warning',
                        description: 'O servidor não devolveu movimentos para o recorte informado.',
                      }
                    : hasNegativeProjectedCash(forecast)
                      ? {
                          label: 'Caixa descoberto no horizonte',
                          /*
                           * `tone` do selo é `error`, não `critical`: o contrato de `StatusBadge`
                           * aceita neutral/success/warning/error/info. O valor anterior não existia
                           * na união e a tela nunca compilou — o defeito estava registrado como
                           * pré-existente e é o mesmo fato semântico (falta de caixa projetada).
                           */
                          tone: 'error',
                          description:
                            'O saldo projetado publicado pelo servidor é negativo no horizonte consultado.',
                        }
                      : hasOverdueRisk(forecast)
                        ? {
                            label: 'Exceção no horizonte',
                            tone: 'warning',
                            description:
                              'Existem parcelas de títulos ativos vencidas antes da posição.',
                          }
                        : { label: 'Projetado', tone: 'info' }
                }
              />
            </>
          ) : null
        }
        context={forecast ? <ObjectContextBlock title="Contexto do recorte" fields={buildForecastContextFields(forecast)} /> : null}
      >
        {forecast ? (
          <>
            {/*
              RISCO — o fato que exige atencao vem ANTES da decoracao.
              Saldo projetado negativo e publicado pelo servidor; vencido e fato real de titulo
              ativo. Nenhum limiar e inventado no front.
            */}
            {hasNegativeProjectedCash(forecast) || hasOverdueRisk(forecast) ? (
              <section
                role="alert"
                aria-label="Risco de caixa no horizonte"
                className={[
                  'rounded-lg border px-4 py-3',
                  hasNegativeProjectedCash(forecast)
                    ? 'border-red-200 bg-red-50'
                    : 'border-amber-200 bg-amber-50',
                ].join(' ')}
              >
                <h2
                  className={[
                    'm-0 text-sm font-semibold',
                    hasNegativeProjectedCash(forecast) ? 'text-red-800' : 'text-amber-900',
                  ].join(' ')}
                >
                  {hasNegativeProjectedCash(forecast)
                    ? 'Falta de caixa projetada'
                    : 'Exceção no horizonte: títulos já vencidos'}
                </h2>
                <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0 text-xs">
                  {hasNegativeProjectedCash(forecast) ? (
                    <li
                      className={
                        hasNegativeProjectedCash(forecast) ? 'text-red-800' : 'text-amber-900'
                      }
                    >
                      Saldo projetado ao fim do horizonte:{' '}
                      <strong className="font-semibold">
                        <Money value={forecast.projectedCash.amount} currencyCode={forecast.currencyCode} />
                      </strong>{' '}
                      — valor publicado pelo servidor para o recorte informado.
                    </li>
                  ) : null}
                  {hasCommittedOverdueInflows(forecast) ? (
                    <li className="text-amber-900">
                      Em atraso a receber:{' '}
                      <Money value={forecast.forecast.overdueInflows} currencyCode={forecast.currencyCode} /> —
                      entrada comprometida que depende de cobrança.
                    </li>
                  ) : null}
                  {hasCommittedOverdueOutflows(forecast) ? (
                    <li className="text-amber-900">
                      Em atraso a pagar:{' '}
                      <Money value={forecast.forecast.overdueOutflows} currencyCode={forecast.currencyCode} /> —
                      saída comprometida já em atraso.
                    </li>
                  ) : null}
                </ul>
              </section>
            ) : null}

            {/* SALDO — a resposta de "quanto tenho e quanto terei", publicada pelo servidor. */}
            <ObjectPanel title="Posição de caixa">
              <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <div className="min-w-0">
                  <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    Saldo atual (realizado)
                  </dt>
                  <dd className="m-0 mt-0.5 text-lg font-semibold text-gray-900 tabular-nums">
                    <Money
                      value={forecast.realized.cashBalance}
                      currencyCode={forecast.currencyCode}
                      emphasis
                    />
                  </dd>
                  <p className="m-0 text-[11px] text-gray-500">Caixa e bancos na posição informada.</p>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    Entradas previstas
                  </dt>
                  <dd className="m-0 mt-0.5 text-lg font-semibold text-emerald-700 tabular-nums">
                    <Money value={forecast.forecast.inflows} currencyCode={forecast.currencyCode} />
                  </dd>
                  <p className="m-0 text-[11px] text-gray-500">Parcelas a receber dentro do horizonte.</p>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    Saídas previstas
                  </dt>
                  <dd className="m-0 mt-0.5 text-lg font-semibold text-red-700 tabular-nums">
                    <Money value={forecast.forecast.outflows} currencyCode={forecast.currencyCode} />
                  </dd>
                  <p className="m-0 text-[11px] text-gray-500">Parcelas a pagar dentro do horizonte.</p>
                </div>
                <div className="min-w-0 border-l border-gray-100 pl-4">
                  <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    Saldo projetado
                  </dt>
                  <dd
                    className={[
                      'm-0 mt-0.5 text-lg font-semibold tabular-nums',
                      hasNegativeProjectedCash(forecast) ? 'text-red-700' : 'text-gray-900',
                    ].join(' ')}
                  >
                    <Money value={forecast.projectedCash.amount} currencyCode={forecast.currencyCode} emphasis />
                  </dd>
                  <p className="m-0 text-[11px] text-gray-500">
                    Saldo atual + efeito líquido previsto (
                    <Money value={forecast.forecast.net} currencyCode={forecast.currencyCode} />
                    ), calculado pelo servidor.
                  </p>
                </div>
              </dl>
            </ObjectPanel>

            {/*
              AS TRES CATEGORIAS, EM ORDEM DE TEMPO: o que aconteceu, o que esta em atraso e o
              que ainda vai acontecer. Os numeros de cada bloco sao os DO SERVIDOR.
            */}
            <ObjectPanel title="Realizado (fato)">
              <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                <div className="min-w-0">
                  <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    Saldo de caixa
                  </dt>
                  <dd className="m-0 text-sm font-semibold text-gray-900 tabular-nums">
                    <Money value={forecast.realized.cashBalance} currencyCode={forecast.currencyCode} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    Entradas realizadas
                  </dt>
                  <dd className="m-0 text-sm text-gray-800 tabular-nums">
                    <Money value={forecast.realized.inflows} currencyCode={forecast.currencyCode} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    Saídas realizadas
                  </dt>
                  <dd className="m-0 text-sm text-gray-800 tabular-nums">
                    <Money value={forecast.realized.outflows} currencyCode={forecast.currencyCode} />
                  </dd>
                </div>
              </dl>
              <MovementTable
                caption="Movimentos realizados"
                totalSource="saldo de caixa e liquidações publicados pelo servidor"
                total={<Money value={forecast.realized.cashBalance} currencyCode={forecast.currencyCode} />}
                currencyCode={forecast.currencyCode}
                lines={linesOf(forecast, 'REALIZED')}
              />
            </ObjectPanel>

            <ObjectPanel title="Comprometido (vencido antes da posição)">
              {hasOverdueRisk(forecast) ? (
                <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                  <div className="min-w-0">
                    <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                      A receber vencido
                    </dt>
                    <dd className="m-0 text-sm font-semibold text-amber-800 tabular-nums">
                      <Money value={forecast.forecast.overdueInflows} currencyCode={forecast.currencyCode} />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                      A pagar vencido
                    </dt>
                    <dd className="m-0 text-sm font-semibold text-amber-800 tabular-nums">
                      <Money value={forecast.forecast.overdueOutflows} currencyCode={forecast.currencyCode} />
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="m-0 text-xs text-gray-500">
                  O servidor não publicou parcelas vencidas antes da posição neste recorte.
                </p>
              )}
              <MovementTable
                caption="Parcelas vencidas em títulos ativos"
                totalSource="total de vencidos publicado pelo servidor"
                total={
                  <>
                    <Money value={forecast.forecast.overdueInflows} currencyCode={forecast.currencyCode} />
                    {' · '}
                    <Money value={forecast.forecast.overdueOutflows} currencyCode={forecast.currencyCode} />
                  </>
                }
                currencyCode={forecast.currencyCode}
                lines={forecast.lines.filter((line) => line.bucket === 'OVERDUE')}
              />
            </ObjectPanel>

            <ObjectPanel title="Previsto no horizonte">
              <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                <div className="min-w-0">
                  <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    Entradas previstas
                  </dt>
                  <dd className="m-0 text-sm font-semibold text-emerald-700 tabular-nums">
                    <Money value={forecast.forecast.inflows} currencyCode={forecast.currencyCode} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    Saídas previstas
                  </dt>
                  <dd className="m-0 text-sm font-semibold text-red-700 tabular-nums">
                    <Money value={forecast.forecast.outflows} currencyCode={forecast.currencyCode} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    Efeito líquido
                  </dt>
                  <dd className="m-0 text-sm font-semibold text-gray-900 tabular-nums">
                    <Money value={forecast.forecast.net} currencyCode={forecast.currencyCode} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    Saldo projetado
                  </dt>
                  <dd className="m-0 text-sm font-semibold text-gray-900 tabular-nums">
                    <Money value={forecast.projectedCash.amount} currencyCode={forecast.currencyCode} />
                  </dd>
                </div>
              </dl>
              <MovementTable
                caption="Parcelas previstas no horizonte"
                totalSource={`líquido previsto ${forecast.currencyCode} publicado pelo servidor`}
                total={<Money value={forecast.forecast.net} currencyCode={forecast.currencyCode} />}
                currencyCode={forecast.currencyCode}
                lines={forecast.lines.filter((line) => line.kind === 'FORECAST')}
              />
            </ObjectPanel>

            {/*
              DRILLDOWN — o numero nao pode parecer magico. Cada titulo que compoe a projecao
              abre a tela do modulo; cada numero agregado e rastreavel ate os movimentos.
            */}
            <ObjectPanel title="Origem dos valores">
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                <li>
                  <Link
                    to="/app/finance/receivables"
                    className="font-medium text-brand-700 no-underline hover:text-brand-800 hover:underline"
                  >
                    Contas a receber
                  </Link>
                  <span className="text-gray-500">
                    {' '}
                    — as parcelas a receber originam as entradas previstas e o realizado de
                    recebimento.
                  </span>
                </li>
                <li>
                  <Link
                    to="/app/finance/payables"
                    className="font-medium text-brand-700 no-underline hover:text-brand-800 hover:underline"
                  >
                    Contas a pagar
                  </Link>
                  <span className="text-gray-500">
                    {' '}
                    — as parcelas a pagar originam as saídas previstas e o realizado de pagamento.
                  </span>
                </li>
                <li>
                  <Link
                    to="/app/finance/treasury"
                    className="font-medium text-brand-700 no-underline hover:text-brand-800 hover:underline"
                  >
                    Caixa e bancos
                  </Link>
                  <span className="text-gray-500">
                    {' '}
                    — os movimentos de tesouraria compõem o saldo atual.
                  </span>
                </li>
              </ul>
            </ObjectPanel>

            {forecast.lines.length === 0 ? (
              <EmptyState
                title="Sem linhas de forecast"
                description="O servidor não devolveu movimentos para o horizonte informado."
              />
            ) : null}
          </>
        ) : null}
      </EnterpriseObjectPage>
    </ModulePage>
  );
}
