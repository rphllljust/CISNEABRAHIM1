import { Link } from 'react-router-dom';
import { cn } from '../../ui/utils/cn';
import type { ExecutiveDashboardSnapshot } from '../types/dashboard.types';
import { formatDateLabel } from '../utils/dashboard-formatters';

const SLA_MINIMUM_ELIGIBLE = 3;

type OperationPanelProps = {
  snapshot: ExecutiveDashboardSnapshot;
};

function statusHref(status: string): string {
  return `/app/service-orders?status=${status}`;
}

/**
 * OPERACAO — 2/3 distribuicao real + 1/3 contexto de prazo.
 *
 * Regra de area (anti-espaco-morto):
 *  - grafico so ocupa area quando HA dado; sem dado, o estado e uma linha;
 *  - SLA so reserva area quando existe AMOSTRA suficiente; abaixo do minimo a
 *    secao colapsa em uma linha de estado, sem card gigante vazio;
 *  - a evolucao temporal aparece como contexto compacto, nunca como 1/3 da tela.
 */
export function OperationPanel({ snapshot }: OperationPanelProps) {
  const status = snapshot.charts.serviceOrdersByStatus;
  const sla = snapshot.charts.sla;
  const trend = snapshot.charts.throughputTrend;

  const totalActive = status.items.reduce((sum, item) => sum + item.count, 0);
  const maxCount = Math.max(1, ...status.items.map((item) => item.count));
  const eligible = sla.points.reduce((sum, point) => sum + point.eligible, 0);
  const onTime = sla.points.reduce((sum, point) => sum + point.onTime, 0);
  const overdue = sla.points.reduce((sum, point) => sum + point.overdue, 0);
  const hasSlaSample = eligible >= SLA_MINIMUM_ELIGIBLE;
  const lastPoint = trend.points[trend.points.length - 1] ?? null;

  return (
    <section aria-labelledby="operation-heading" className="dashboard-block">
      <header className="dashboard-section-head">
        <h2 id="operation-heading" className="dashboard-section-head__title">
          Operação
        </h2>
        <p className="dashboard-section-head__meta">
          {totalActive} ordens ativas no escopo · distribuição, evolução e cumprimento de prazo
        </p>
      </header>

      <div className="dashboard-operation">
        <section aria-labelledby="status-heading" className="dashboard-panel dashboard-panel--main">
          <h3 id="status-heading" className="dashboard-panel__title">
            OS ativas por status
          </h3>
          {status.items.length === 0 ? (
            <p className="dashboard-panel__empty">Sem ordens ativas no escopo autorizado.</p>
          ) : (
            <ul className="dashboard-status-list">
              {status.items.map((item) => (
                <li key={item.status} className="dashboard-status-list__item">
                  <Link
                    className="dashboard-status-list__link"
                    to={statusHref(item.status)}
                    aria-label={`${item.label}: ${item.count} ordens`}
                  >
                    <span className="dashboard-status-list__label">{item.label}</span>
                    <span className="dashboard-status-list__track" aria-hidden>
                      <span
                        className={cn(
                          'dashboard-status-list__bar',
                          item.status === 'IN_EXECUTION' && 'dashboard-status-list__bar--active',
                          item.status === 'PAUSED' && 'dashboard-status-list__bar--paused',
                        )}
                        style={{ width: `${(item.count / maxCount) * 100}%` }}
                      />
                    </span>
                    <span className="dashboard-status-list__value tabular-nums">{item.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="dashboard-panel__note">{status.summary}</p>
        </section>

        <section aria-labelledby="sla-heading" className="dashboard-panel dashboard-panel--side">
          <h3 id="sla-heading" className="dashboard-panel__title">
            Cumprimento de prazo
          </h3>
          {hasSlaSample ? (
            <>
              <p className="dashboard-sla__rate tabular-nums">
                {((onTime / eligible) * 100).toFixed(1)}
                <span className="dashboard-sla__rate-unit">%</span>
              </p>
              <p className="dashboard-sla__split">
                <span className="dashboard-sla__split-item dashboard-sla__split-item--ok tabular-nums">
                  {onTime} no prazo
                </span>
                <span className="dashboard-sla__split-item dashboard-sla__split-item--late tabular-nums">
                  {overdue} fora
                </span>
              </p>
              <p className="dashboard-panel__note">
                Base: {eligible} conclusões elegíveis com prazo no período.
              </p>
            </>
          ) : (
            <p className="dashboard-panel__empty" role="status">
              Amostra insuficiente para taxa de prazo ({eligible} de {SLA_MINIMUM_ELIGIBLE} conclusões
              elegíveis). O indicador aparece quando houver base real.
            </p>
          )}

          <div className="dashboard-trend">
            <p className="dashboard-trend__title">Último dia com movimento</p>
            {lastPoint ? (
              <p className="dashboard-trend__value tabular-nums">
                {formatDateLabel(lastPoint.date)} · {lastPoint.opened} abertas · {lastPoint.completed}{' '}
                concluídas
              </p>
            ) : (
              <p className="dashboard-panel__empty">Sem movimento no período selecionado.</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
