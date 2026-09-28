import { StatusBadge } from '../../ui/StatusBadge';
import type { ExecutionFactsComparison, ExecutionPeriodFactRow } from '../types/service-order-execution.types';
import { formatDateTime } from '../utils/service-order-labels';

type PlannedVsActualPanelProps = {
  comparison: ExecutionFactsComparison;
};

const PERIOD_SOURCE_LABELS: Record<ExecutionPeriodFactRow['source'], string> = {
  PLANNED_RESOURCE: 'Planejado',
  ALLOCATION: 'Alocado',
  EXECUTION_LIFECYCLE: 'Realizado',
};

function parseQuantity(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatQuantity(value: string | null): string {
  return value === null ? '—' : value;
}

function resolveDivergence(planned: string | null, actual: string): boolean {
  const plannedValue = parseQuantity(planned);
  const actualValue = parseQuantity(actual);
  if (plannedValue === null || actualValue === null) {
    return false;
  }
  return Math.abs(plannedValue - actualValue) > Number.EPSILON;
}

function formatPeriod(period: ExecutionPeriodFactRow): string {
  if (!period.startAt && !period.endAt) {
    return '—';
  }
  if (period.startAt && period.endAt) {
    return `${formatDateTime(period.startAt)} — ${formatDateTime(period.endAt)}`;
  }
  return formatDateTime((period.startAt ?? period.endAt) as string);
}

/**
 * Representa a separacao PLANEJADO x REALIZADO. Os numeros vem do backend
 * (comparison); a UI nao recalcula nem sobrescreve planejamento.
 */
export function PlannedVsActualPanel({ comparison }: PlannedVsActualPanelProps) {
  const { quantities, resources, periods } = comparison;

  return (
    <section className="execution-section" aria-labelledby="execution-planned-vs-actual">
      <h2 id="execution-planned-vs-actual">Planejado × realizado</h2>
      <p className="execution-hint">
        Comparação somente leitura entre o planejamento e o que foi efetivamente registrado.
      </p>

      <div className="planning-table-wrap">
        <table className="planning-table">
          <caption className="planning-sr-only">
            Quantidades planejadas e realizadas por unidade de medida
          </caption>
          <thead>
            <tr>
              <th scope="col">Unidade</th>
              <th scope="col">Planejado</th>
              <th scope="col">Realizado</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {quantities.length === 0 ? (
              <tr>
                <td colSpan={4}>Nenhuma quantidade medida até o momento.</td>
              </tr>
            ) : (
              quantities.map((row) => {
                const divergent = resolveDivergence(row.plannedQuantity, row.actualQuantity);
                return (
                  <tr key={row.unitCode}>
                    <td>{row.unitCode}</td>
                    <td>{formatQuantity(row.plannedQuantity)}</td>
                    <td>{row.actualQuantity}</td>
                    <td>
                      <StatusBadge
                        label={divergent ? 'Divergente' : 'Alinhado'}
                        tone={divergent ? 'warning' : 'success'}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="planning-table-wrap">
        <table className="planning-table">
          <caption className="planning-sr-only">
            Recursos planejados e alocações ativas por requisito
          </caption>
          <thead>
            <tr>
              <th scope="col">Tipo</th>
              <th scope="col">Código</th>
              <th scope="col">Quantidade planejada</th>
              <th scope="col">Alocações ativas</th>
            </tr>
          </thead>
          <tbody>
            {resources.length === 0 ? (
              <tr>
                <td colSpan={4}>Nenhum recurso planejado.</td>
              </tr>
            ) : (
              resources.map((row) => (
                <tr key={`${row.requirementKind}-${row.code}`}>
                  <td>{row.requirementKind === 'LABOR' ? 'Mão de obra' : 'Recurso físico'}</td>
                  <td>{row.code}</td>
                  <td>{row.plannedQuantity}</td>
                  <td>{row.allocatedActiveCount}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ul className="planning-list">
        {periods.length === 0 ? (
          <li>Nenhuma janela operacional registrada.</li>
        ) : (
          periods.map((period, index) => (
            <li key={`${period.source}-${period.label}-${index}`}>
              <strong>{PERIOD_SOURCE_LABELS[period.source]}</strong> — {period.label}:{' '}
              {formatPeriod(period)}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
