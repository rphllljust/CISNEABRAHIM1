import { Link } from 'react-router-dom';
import { cn } from '../../ui/utils/cn';
import { formatMoney } from '../utils/dashboard-formatters';
import { DASHBOARD_DRILL_DESTINATIONS } from '../utils/dashboard-semantics';
import type { ExecutiveDashboardSnapshot } from '../types/dashboard.types';

type FinancePanelProps = {
  snapshot: ExecutiveDashboardSnapshot;
};

type FinanceRow = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

function sumAgingCount(snapshot: ExecutiveDashboardSnapshot): number {
  return snapshot.charts.financialAging.buckets.reduce((total, bucket) => total + bucket.count, 0);
}

/**
 * FINANCEIRO — peso real de gestao, sem inventar saldo.
 *
 * TODOS os valores vem do snapshot autorizado:
 *  - quantidade vencida e exposicao: campos ja publicados pela metrica de aging;
 *  - distribuicao por faixa: mesma serie do aging configurado no backend.
 *
 * Carteira a receber e a pagar EXISTEM como titulos reais na cadeia financeira,
 * mas o snapshot executivo NAO publica contagem/valor deles. Este painel NAO
 * estima esses numeros: declara o recorte como fora do snapshot e entrega o
 * drilldown para a lista real (PARK_BI_GAP registrado no relatorio da wave).
 */
export function FinancePanel({ snapshot }: FinancePanelProps) {
  if (!snapshot.visibility.billing) {
    return null;
  }

  const aging = snapshot.charts.financialAging;
  const overdueItem = snapshot.attention.find((item) => item.id === 'overdue-receivables');
  const overdueCount = overdueItem?.count ?? sumAgingCount(snapshot);
  const overdueExposure = overdueItem?.detail
    ? overdueItem.detail.replace(/^Exposição:\s*/i, '')
    : null;
  const maxBucketCount = Math.max(1, ...aging.buckets.map((bucket) => bucket.count));

  const rows: FinanceRow[] = [
    {
      id: 'receivables-open',
      label: 'Carteira a receber',
      detail: 'contagem não publicada no snapshot executivo',
      href: DASHBOARD_DRILL_DESTINATIONS['receivables-open'],
    },
    {
      id: 'receivables-partial',
      label: 'Parcialmente recebidos',
      detail: 'contagem não publicada no snapshot executivo',
      href: DASHBOARD_DRILL_DESTINATIONS['receivables-partial'],
    },
    {
      id: 'payables-overdue',
      label: 'Títulos a pagar vencidos',
      detail: 'contagem não publicada no snapshot executivo',
      href: DASHBOARD_DRILL_DESTINATIONS['payables-overdue'],
    },
  ];

  return (
    <section aria-labelledby="finance-heading" className="dashboard-block">
      <header className="dashboard-section-head">
        <h2 id="finance-heading" className="dashboard-section-head__title">
          Financeiro
        </h2>
        <p className="dashboard-section-head__meta">
          Recebíveis, aging e carteiras. Todo valor é o publicado pelo servidor.
        </p>
      </header>

      <div className="dashboard-finance">
        <div className="dashboard-finance__exposure">
          <section aria-labelledby="exposure-heading" className="dashboard-panel dashboard-panel--money">
            <h3 id="exposure-heading" className="dashboard-panel__title">
              Exposição vencida
            </h3>
            {aging.available ? (
              <>
                <p className="dashboard-money tabular-nums">{overdueExposure ?? '—'}</p>
                <p className="dashboard-money__caption">
                  {overdueCount} {overdueCount === 1 ? 'título vencido' : 'títulos vencidos'} ·{' '}
                  {aging.summary}
                </p>
                <Link
                  className="dashboard-panel__cta"
                  to={DASHBOARD_DRILL_DESTINATIONS['receivables-overdue']}
                >
                  Abrir títulos vencidos
                </Link>
              </>
            ) : (
              <p className="dashboard-panel__empty" role="status">
                Aging financeiro não disponível para este acesso. Nenhum saldo é estimado na tela.
              </p>
            )}
          </section>

          <section aria-labelledby="aging-heading" className="dashboard-panel dashboard-panel--aging">
            <h3 id="aging-heading" className="dashboard-panel__title">
              Aging por faixa
            </h3>
            {aging.buckets.length === 0 ? (
              <p className="dashboard-panel__empty">Faixas de aging não configuradas no backend.</p>
            ) : (
              <ul className="dashboard-aging">
                {aging.buckets.map((bucket) => (
                  <li key={bucket.bandId} className="dashboard-aging__item">
                    <span className="dashboard-aging__label">{bucket.label}</span>
                    <span className="dashboard-aging__track" aria-hidden>
                      <span
                        className={cn(
                          'dashboard-aging__bar',
                          bucket.count > 0 && 'dashboard-aging__bar--filled',
                        )}
                        style={{ width: `${(bucket.count / maxBucketCount) * 100}%` }}
                      />
                    </span>
                    <span className="dashboard-aging__count tabular-nums">{bucket.count}</span>
                    <span className="dashboard-aging__amount tabular-nums">
                      {formatMoney(bucket.totalAmount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <nav className="dashboard-panel dashboard-panel--titles" aria-label="Carteiras financeiras">
          <h3 className="dashboard-panel__title">Carteiras</h3>
          <ul className="dashboard-titles">
            {rows.map((row) => (
              <li key={row.id} className="dashboard-titles__item">
                <Link className="dashboard-titles__link" to={row.href}>
                  <span className="dashboard-titles__label">{row.label}</span>
                  <span className="dashboard-titles__detail">{row.detail}</span>
                  <span aria-hidden className="dashboard-titles__arrow">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </section>
  );
}
