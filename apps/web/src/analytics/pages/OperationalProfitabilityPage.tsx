import { useEffect, useState } from 'react';
import { Field, Select } from '../../ui';
import { Money } from '../../ui/Money';
import {
  FilterCard,
  ModulePage,
  ModulePageHeader,
  ModuleTableCard,
  moduleTableCellClass,
  moduleTableClass,
  moduleTableHeadClass,
  moduleTableHeaderCellClass,
  moduleTableRowClass,
} from '../../ui/module-layout';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { getOperationalProfitability } from '../api/operational-profitability-api';

function mapError(_code: string | undefined, status: number): string {
  if (status === 403) {
    return 'Você não tem permissão para ver a rentabilidade operacional.';
  }
  return 'Não foi possível carregar a rentabilidade operacional.';
}

export function OperationalProfitabilityPage() {
  const [period, setPeriod] = useState('week');
  const [groupBy, setGroupBy] = useState('none');
  const query = useBackofficeQuery({
    autoLoad: false,
    loader: (signal) => getOperationalProfitability({ period, groupBy }, signal),
    mapError,
  });

  useEffect(() => {
    void query.reload();
  }, [period, groupBy, query.reload]);

  return (
    <ModulePage>
      <ModulePageHeader
        title="Rentabilidade operacional"
        description="Receita operacional menos custo realizado, no recorte autorizado. Não substitui a contabilidade oficial."
      />
      <FilterCard>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Período" htmlFor="profitability-period">
            <Select
              id="profitability-period"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            >
              <option value="today">Hoje</option>
              <option value="week">Semana</option>
              <option value="month">Mês</option>
            </Select>
          </Field>
          <Field label="Agrupar por" htmlFor="profitability-group">
            <Select
              id="profitability-group"
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value)}
            >
              <option value="none">Sem agrupamento</option>
              <option value="service_order">Ordem de serviço</option>
              <option value="client">Cliente</option>
              <option value="contract">Contrato</option>
              <option value="service_type">Tipo de serviço</option>
            </Select>
          </Field>
        </div>
      </FilterCard>

      {query.state.phase === 'denied' ? (
        <p role="alert">Você não tem permissão para ver a rentabilidade operacional.</p>
      ) : null}
      {query.state.phase === 'error' ? (
        <p role="alert">{query.state.message}</p>
      ) : null}
      {query.state.phase === 'loading' ? <p>Carregando rentabilidade…</p> : null}
      {query.state.phase === 'ready' ? (
        <>
          <p className="mb-4 text-sm text-gray-500">
            {query.state.data.period.from} — {query.state.data.period.to}.{' '}
            {query.state.data.summary.disclaimer}
          </p>
          <dl className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase text-gray-500">Receita operacional</dt>
              <dd>
                <Money
                  value={query.state.data.summary.operationalRevenue}
                  currencyCode={query.state.data.summary.currencyCode}
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-gray-500">Custo realizado</dt>
              <dd>
                <Money
                  value={query.state.data.summary.realizedCost}
                  currencyCode={query.state.data.summary.currencyCode}
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-gray-500">Margem operacional</dt>
              <dd>
                <Money
                  value={query.state.data.summary.operationalMargin}
                  currencyCode={query.state.data.summary.currencyCode}
                  emphasis
                />
              </dd>
            </div>
          </dl>
          <ModuleTableCard>
            <table className={moduleTableClass} aria-label="Linhas de rentabilidade por OS">
              <thead className={moduleTableHeadClass}>
                <tr>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    OS
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Tipo
                  </th>
                  <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                    Receita
                  </th>
                  <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                    Custo
                  </th>
                  <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                    Margem
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.state.data.lines.length === 0 ? (
                  <tr className={moduleTableRowClass}>
                    <td className={moduleTableCellClass} colSpan={5}>
                      Nenhuma OS no período com dados de rentabilidade no seu escopo.
                    </td>
                  </tr>
                ) : (
                  query.state.data.lines.map((line) => (
                    <tr key={line.serviceOrderId} className={moduleTableRowClass}>
                      <td className={moduleTableCellClass}>
                        {line.serviceOrderCode ?? line.serviceOrderId}
                      </td>
                      <td className={moduleTableCellClass}>{line.serviceType ?? '—'}</td>
                      <td className={`${moduleTableCellClass} text-right`}>
                        <Money
                          value={line.summary.operationalRevenue}
                          currencyCode={line.summary.currencyCode}
                        />
                      </td>
                      <td className={`${moduleTableCellClass} text-right`}>
                        <Money
                          value={line.summary.realizedCost}
                          currencyCode={line.summary.currencyCode}
                        />
                      </td>
                      <td className={`${moduleTableCellClass} text-right`}>
                        <Money
                          value={line.summary.operationalMargin}
                          currencyCode={line.summary.currencyCode}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ModuleTableCard>
        </>
      ) : null}
    </ModulePage>
  );
}
