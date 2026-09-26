import { useEffect, useState } from 'react';
import { EmptyState, Field, Money, Select } from '../../ui';
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
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import { getComplianceSnapshot } from '../api/compliance-api';
import type { ComplianceBlock, ComplianceMetric } from '../types/compliance.types';

/**
 * Rotulos de apresentacao. A semantica (fonte, engine, politica de nulo, autorizacao) fica no
 * SMC-001 no backend; aqui so ha o texto exibido.
 */
const METRIC_LABELS: Record<string, string> = {
  'fiscal.documents_pending_transmission_count': 'Documentos fiscais sem autorização',
  'fiscal.tax_obligations_open_count': 'Obrigações tributárias abertas',
  'fiscal.tax_obligations_open_amount': 'Valor das obrigações tributárias abertas',
  'accounting.periods_open_count': 'Períodos contábeis abertos',
  'accounting.journal_entries_posted_count': 'Lançamentos efetivados',
  'accounting.journal_entries_draft_count': 'Lançamentos em rascunho',
};

function mapError(_code: string | undefined, status: number): string {
  if (status === 403) {
    return 'Você não tem permissão para ver o painel de conformidade.';
  }
  if (status === 400) {
    return 'Selecione uma unidade autorizada para consultar o painel de conformidade.';
  }
  return 'Não foi possível carregar o painel de conformidade.';
}

export function ComplianceBiPage() {
  const { units, unitId, setUnitId } = useOperationalUnits();
  const [period, setPeriod] = useState('month');
  const query = useBackofficeQuery({
    autoLoad: false,
    loader: (signal) => getComplianceSnapshot({ unitId, period }, signal),
    mapError,
  });
  const reload = query.reload;

  useEffect(() => {
    if (unitId) {
      void reload();
    }
  }, [period, reload, unitId]);

  const gate = renderQueryGate(
    'Painel de conformidade',
    'Carregando painel de conformidade…',
    'Você não tem permissão para ver o painel de conformidade.',
    query.state,
    () => void reload(),
  );

  return (
    <ModulePage>
      <ModulePageHeader
        title="Conformidade fiscal e contábil"
        description="Agregados de conformidade lidos do servidor. Os números não são recalculados nesta tela."
      />

      <FilterCard>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="compliance-unit">
              Unidade
            </label>
            <Select
              id="compliance-unit"
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
            >
              {units.length === 0 ? <option value="">Nenhuma unidade disponível</option> : null}
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </Select>
          </div>
          <Field label="Período" htmlFor="compliance-period">
            <Select
              id="compliance-period"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            >
              <option value="today">Hoje</option>
              <option value="week">Semana</option>
              <option value="month">Mês</option>
            </Select>
          </Field>
        </div>
      </FilterCard>

      {gate}

      {query.state.phase === 'ready' ? (
        <>
          <p className="mb-6 text-sm text-text-secondary">
            Unidade <strong>{query.state.data.unitId}</strong> · {query.state.data.period.from} a{' '}
            {query.state.data.period.to} · fuso {query.state.data.businessTimezone}
          </p>
          <ComplianceBlockTable
            title="Fiscal"
            description="Documentos fiscais emitidos e obrigações tributárias abertas no período."
            block={query.state.data.fiscal}
          />
          <ComplianceBlockTable
            title="Contábil"
            description="Períodos contábeis, lançamentos efetivados e eventos de negócio lançados no período."
            block={query.state.data.accounting}
          />
        </>
      ) : null}
    </ModulePage>
  );
}

function ComplianceBlockTable({
  title,
  description,
  block,
}: {
  title: string;
  description: string;
  block: ComplianceBlock;
}) {
  if (!block.available) {
    return (
      <EmptyState
        title={`${title} indisponível`}
        description={`Você não tem permissão para ver os indicadores de ${title.toLowerCase()}.`}
      />
    );
  }
  return (
    <ModuleTableCard>
      <div className="border-b border-border-default px-4 py-3">
        <h2 className="cisne-type-section-title">{title}</h2>
        <p className="cisne-type-subtitle mt-1">{description}</p>
      </div>
      <table className={moduleTableClass} aria-label={`Indicadores de conformidade — ${title}`}>
        <thead className={moduleTableHeadClass}>
          <tr>
            <th scope="col" className={moduleTableHeaderCellClass}>
              Indicador
            </th>
            <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
              Valor
            </th>
          </tr>
        </thead>
        <tbody>
          {block.metrics.map((metric) => (
            <tr key={metric.metricId} className={moduleTableRowClass}>
              <td className={`${moduleTableCellClass} whitespace-normal`}>
                {METRIC_LABELS[metric.metricId] ?? metric.metricId}
              </td>
              <td className={`${moduleTableCellClass} text-right`}>
                <ComplianceMetricValueCell metric={metric} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ModuleTableCard>
  );
}

function ComplianceMetricValueCell({ metric }: { metric: ComplianceMetric }) {
  if (!metric.available || metric.value === null) {
    // NO_DATA != 0: ausencia de populacao elegivel nao vira zero.
    return <span className="text-text-secondary">sem dados no período</span>;
  }
  if (metric.valueType === 'decimal(18,4)') {
    return <Money value={String(metric.value)} currencyCode="BRL" />;
  }
  return <>{String(metric.value)}</>;
}
