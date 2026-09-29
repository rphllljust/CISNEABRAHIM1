import { useCallback, useState } from 'react';
import { DateTime, EmptyState, Field, Input, Money } from '../../ui';
import {
  ModulePage,
  ModulePageHeader,
  ModuleTableCard,
  moduleTableCellClass,
  moduleTableClass,
  moduleTableHeadClass,
  moduleTableHeaderCellClass,
  moduleTableRowClass,
} from '../../ui/module-layout';
import { CreateRecordForm } from '../../financial-ui/VersionedActionForm';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { getCashForecast } from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import type { CashForecast } from '../types/finance.types';
import { ObjectPanel, ObjectContextBlock, type ObjectContextField } from '../../enterprise-object';

/**
 * PREVISAO DE CAIXA — leitura de tesouraria, nao grafico decorativo.
 *
 * A tela responde, com o que o SERVIDOR devolve e nada mais:
 *   quanto entra? quanto sai? quando? qual o saldo projetado? qual o horizonte?
 *   qual a unidade? de onde vem? o que e REAL e o que e PREVISAO?
 *
 * Separacao nao negociavel: `realized` e dinheiro que ja aconteceu; `forecast` e o
 * que ainda nao aconteceu; `projectedCash` e a soma dos dois, calculada pelo
 * servidor. O navegador NAO soma titulo, NAO estima e NAO projeta.
 */

/** Rotulo humano do tipo de linha. Tipo desconhecido e mostrado como veio, nunca oculto. */
const LINE_KIND_LABELS: Record<string, string> = {
  RECEIVABLE: 'Recebível',
  PAYABLE: 'Pagável',
};

export function cashForecastLineLabel(kind: string): string {
  return LINE_KIND_LABELS[kind] ?? kind;
}

/**
 * Ha risco a declarar SOMENTE quando o servidor informou valor vencido maior que zero.
 * Zero nao e risco: e ausencia de fato, e a secao desaparece em vez de sugerir analise.
 */
export function hasOverdueRisk(forecast: CashForecast): boolean {
  const toNumber = (value: string): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return (
    toNumber(forecast.forecast.overdueInflows) > 0 || toNumber(forecast.forecast.overdueOutflows) > 0
  );
}

/** Fatos de contexto: o recorte exato da projecao e a natureza de cada bloco. */
export function buildForecastContextFields(forecast: CashForecast): ObjectContextField[] {
  return [
    { label: 'Unidade', value: forecast.unitId },
    { label: 'Moeda', value: forecast.currencyCode },
    { label: 'Posição (as of)', value: forecast.asOf.slice(0, 10) },
    { label: 'Horizonte até', value: forecast.horizonEndsOn.slice(0, 10) },
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

export function CashForecastPage() {
  const [unitId, setUnitId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('BRL');
  const [asOf, setAsOf] = useState('');
  const [horizonEndsOn, setHorizonEndsOn] = useState('');
  const [query, setQuery] = useState<{ unitId: string; currencyCode: string; asOf?: string; horizonEndsOn?: string } | null>(
    null,
  );

  const loader = useCallback(
    (signal?: AbortSignal) =>
      getCashForecast(
        {
          unitId: query?.unitId ?? '',
          currencyCode: query?.currencyCode ?? 'BRL',
          asOf: query?.asOf,
          horizonEndsOn: query?.horizonEndsOn,
        },
        signal,
      ),
    [query],
  );
  const { state, reload } = useBackofficeQuery<CashForecast>({
    loader,
    mapError: mapFinanceErrorToMessage,
    enabled: Boolean(query),
    autoLoad: Boolean(query),
  });

  const gate = query
    ? renderQueryGate(
        'Previsão de caixa',
        'Projetando caixa…',
        'Você não tem permissão para consultar a previsão de caixa.',
        state,
        () => void reload(),
      )
    : null;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Previsão de caixa"
        description="Saldos projetados são os devolvidos pelo servidor. O navegador não soma títulos."
      />
      <CreateRecordForm
        title="Parâmetros da projeção"
        description="Unidade e moeda são enviados à API de forecast."
        submitLabel="Projetar"
        mapError={mapFinanceErrorToMessage}
        onSubmit={async () => {
          setQuery({
            unitId: unitId.trim(),
            currencyCode: currencyCode.trim() || 'BRL',
            asOf: asOf.trim() || undefined,
            horizonEndsOn: horizonEndsOn.trim() || undefined,
          });
        }}
      >
        <Field label="Unidade" htmlFor="forecast-unit" required>
          <Input id="forecast-unit" value={unitId} onChange={(event) => setUnitId(event.target.value)} required />
        </Field>
        <Field label="Moeda" htmlFor="forecast-currency" required>
          <Input
            id="forecast-currency"
            value={currencyCode}
            onChange={(event) => setCurrencyCode(event.target.value)}
            required
          />
        </Field>
        <Field label="Posição em" htmlFor="forecast-as-of">
          <Input id="forecast-as-of" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
        </Field>
        <Field label="Horizonte até" htmlFor="forecast-horizon">
          <Input
            id="forecast-horizon"
            type="date"
            value={horizonEndsOn}
            onChange={(event) => setHorizonEndsOn(event.target.value)}
          />
        </Field>
      </CreateRecordForm>
      {gate}
      {!query ? (
        <EmptyState title="Nenhuma projeção carregada" description="Informe a unidade para consultar o servidor." />
      ) : null}
      {state.phase === 'ready' ? (
        <>
          {/*
            HORIZONTE E UNIDADE — a projecao so significa algo com o recorte explicito.
            "de X a Y, na unidade Z, em BRL" responde quando, qual horizonte e qual unidade.
          */}
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
            <span>
              <span className="text-gray-500">Unidade: </span>
              <strong className="font-semibold text-gray-800">{state.data.unitId}</strong>
            </span>
            <span>
              <span className="text-gray-500">Moeda: </span>
              <strong className="font-semibold text-gray-800">{state.data.currencyCode}</strong>
            </span>
            <span>
              <span className="text-gray-500">Posição: </span>
              <DateTime value={state.data.asOf} mode="date" />
            </span>
            <span>
              <span className="text-gray-500">Horizonte até: </span>
              <DateTime value={state.data.horizonEndsOn} mode="date" />
            </span>
            {state.data.status === 'NO_DATA' ? (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800 ring-1 ring-amber-500/20 ring-inset">
                Sem dados projetados
              </span>
            ) : null}
          </div>

          {/*
            REAL x PREVISTO — a distincao que a tesouraria exige. Cada bloco declara a
            sua natureza; o saldo projetado aparece como a soma que o SERVIDOR fez.
          */}
          <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <ObjectPanel title="Realizado (fato)">
              <dl className="m-0 flex flex-col gap-1.5 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-gray-500">Saldo de caixa</dt>
                  <dd className="m-0 font-semibold text-gray-900">
                    <Money value={state.data.realized.cashBalance} currencyCode={state.data.currencyCode} />
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-gray-500">Entradas</dt>
                  <dd className="m-0 text-gray-800">
                    <Money value={state.data.realized.inflows} currencyCode={state.data.currencyCode} />
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-gray-500">Saídas</dt>
                  <dd className="m-0 text-gray-800">
                    <Money value={state.data.realized.outflows} currencyCode={state.data.currencyCode} />
                  </dd>
                </div>
              </dl>
            </ObjectPanel>

            <ObjectPanel title="Previsto no horizonte">
              <dl className="m-0 flex flex-col gap-1.5 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-gray-500">Entradas previstas</dt>
                  <dd className="m-0 font-semibold text-emerald-700">
                    <Money value={state.data.forecast.inflows} currencyCode={state.data.currencyCode} />
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-gray-500">Saídas previstas</dt>
                  <dd className="m-0 font-semibold text-red-700">
                    <Money value={state.data.forecast.outflows} currencyCode={state.data.currencyCode} />
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2 border-t border-gray-100 pt-1.5">
                  <dt className="text-gray-500">Efeito líquido</dt>
                  <dd className="m-0 font-semibold text-gray-900">
                    <Money value={state.data.forecast.net} currencyCode={state.data.currencyCode} />
                  </dd>
                </div>
              </dl>
            </ObjectPanel>

            <ObjectPanel title="Saldo projetado">
              <p className="m-0 text-2xl font-semibold tracking-tight text-gray-900">
                <Money value={state.data.projectedCash.amount} currencyCode={state.data.currencyCode} emphasis />
              </p>
              <p className="m-0 mt-1 text-xs text-gray-500">
                Realizado mais o efeito líquido previsto no horizonte, calculado pelo servidor.
              </p>
            </ObjectPanel>
          </div>

          {/*
            RISCO — so aparece quando existe FATO: titulo vencido dentro do horizonte.
            Sem vencido, a secao inteira desaparece em vez de exibir um risco zerado
            que sugere analise.
          */}
          {hasOverdueRisk(state.data) ? (
            <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-500/20 ring-inset">
              <p className="m-0 font-semibold">Exceção no horizonte: títulos já vencidos</p>
              <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
                <li>
                  A receber vencido:{' '}
                  <Money value={state.data.forecast.overdueInflows} currencyCode={state.data.currencyCode} />{' '}
                  — entrada prevista que depende de cobrança.
                </li>
                <li>
                  A pagar vencido:{' '}
                  <Money value={state.data.forecast.overdueOutflows} currencyCode={state.data.currencyCode} />{' '}
                  — saída já em atraso.
                </li>
              </ul>
            </div>
          ) : null}

          {/* DE ONDE VEM: as linhas que o servidor devolveu, por tipo de origem. */}
          <ObjectContextBlock
            title="Composição e origem"
            columns={3}
            fields={buildForecastContextFields(state.data)}
          />

          {state.data.lines.length === 0 ? (
            <EmptyState
              title="Sem linhas de forecast"
              description="O servidor não devolveu movimentos para o horizonte informado."
            />
          ) : (
            <ModuleTableCard>
              <table className={moduleTableClass} aria-label="Linhas da previsão de caixa">
                <thead className={moduleTableHeadClass}>
                  <tr>
                    <th scope="col" className={moduleTableHeaderCellClass}>Tipo</th>
                    <th scope="col" className={moduleTableHeaderCellClass}>Natureza</th>
                    <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>Valor informado</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.lines.map((line, index) => (
                    <tr key={`${line.kind}-${index}`} className={moduleTableRowClass}>
                      <td className={moduleTableCellClass}>{cashForecastLineLabel(line.kind)}</td>
                      <td className={moduleTableCellClass}>
                        {line.sourceKind ? cashForecastLineLabel(line.sourceKind) : '—'}
                      </td>
                      <td className={`${moduleTableCellClass} text-right`}>
                        <Money value={line.amount} currencyCode={state.data.currencyCode} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ModuleTableCard>
          )}
        </>
      ) : null}
    </ModulePage>
  );
}
