/**
 * RECEIVABLE AGING (fonte financeira) — único SQL de aging de recebíveis.
 *
 * Posição = fin.receivables (lifecycle ACTIVE) com saldo
 *   remaining = principal − SUM(fin.settlements POSTED)
 * Status derivado igual a finance/domain/receivable.deriveReceivableStatus:
 *   - paid          : remaining <= 0
 *   - overdue       : remaining > 0 AND due_date < asOfDate
 *   - partially paid: remaining > 0 AND due_date >= asOfDate AND settled > 0
 *   - open          : remaining > 0 AND due_date >= asOfDate AND settled = 0
 * Nunca conta billing_documents sem baixa; nunca inventa valores.
 * `scopeClause` refere-se ao alias `bd` (colunas unit_id/client_id) — mesmo padrão
 * dos escopos de billing; fin.receivables expõe unit_id/client_id.
 */

export type ReceivableAgingSqlOptions = {
  scopeClause: string;
  tzParam: string;
  /** Data de referencia (ex.: $N de um placeholder date/texto) para classificar vencido x a vencer. */
  asOfParam?: string;
  /** Filtro extra (ex.: AND bd.unit_id = $N) aplicado antes da agregação. */
  extraClause?: string;
};

const POSITIONS = (opts: ReceivableAgingSqlOptions): string => {
  const extra = opts.extraClause ?? '';
  return `SELECT
            bd.unit_id,
            bd.client_id,
            bd.due_date,
            (bd.principal
             - COALESCE(
                 (SELECT SUM(s.amount)
                  FROM fin.settlements s
                  WHERE s.receivable_id = bd.id AND s.status = 'POSTED'),
                 0
               )
            ) AS remaining
          FROM fin.receivables bd
          WHERE ${opts.scopeClause}${extra}
            AND bd.lifecycle = 'ACTIVE'`;
};

export function buildOverdueReceivableAggregateSql(opts: ReceivableAgingSqlOptions): string {
  const { tzParam } = opts;
  return `SELECT COUNT(*)::int AS count,
                 COALESCE(SUM(remaining), 0)::text AS total_amount,
                 MAX(
                   ((NOW() AT TIME ZONE ${tzParam})::date - due_date)
                 )::int AS max_days_overdue
          FROM (${POSITIONS(opts)}) positions
          WHERE remaining > 0
            AND due_date < (NOW() AT TIME ZONE ${tzParam})::date`;
}

export function buildOverdueReceivableBucketsSql(opts: ReceivableAgingSqlOptions): string {
  const { tzParam } = opts;
  return `SELECT
            GREATEST(0, ((NOW() AT TIME ZONE ${tzParam})::date - due_date))::int AS days_overdue,
            COUNT(*)::int AS count,
            COALESCE(SUM(remaining), 0)::text AS total_amount
          FROM (${POSITIONS(opts)}) positions
          WHERE remaining > 0
            AND due_date < (NOW() AT TIME ZONE ${tzParam})::date
          GROUP BY 1`;
}

/**
 * Posicao canonica por recebivel (FIN-SEM-001):
 * remaining = principal - SUM(settlements POSTED); status derivado pela mesma
 * regra de finance/domain/receivable.deriveReceivableStatus usando data de
 * referencia (asOf) explicita (permite classificar vencido x a vencer).
 * Nenhuma formula duplicada em consumidores.
 */
export type ReceivablePositionStatus =
  | 'OPEN'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'
  | 'CANCELLED';

export function buildReceivablePositionsSql(opts: ReceivableAgingSqlOptions): string {
  const extra = opts.extraClause ?? '';
  const asOfDateExpr =
    opts.asOfParam !== undefined
      ? `(${opts.asOfParam})::date`
      : `(NOW() AT TIME ZONE ${opts.tzParam})::date`;
  return `SELECT
            bd.id,
            bd.unit_id,
            bd.client_id,
            bd.due_date,
            bd.principal,
            COALESCE(
              (SELECT SUM(s.amount)
               FROM fin.settlements s
               WHERE s.receivable_id = bd.id AND s.status = 'POSTED'),
              0
            ) AS settled,
            (bd.principal
             - COALESCE(
                 (SELECT SUM(s.amount)
                  FROM fin.settlements s
                  WHERE s.receivable_id = bd.id AND s.status = 'POSTED'),
                 0
               )
            ) AS remaining,
            CASE
              WHEN bd.lifecycle = 'CANCELLED' THEN 'CANCELLED'
              WHEN (bd.principal
                    - COALESCE(
                        (SELECT SUM(s.amount)
                         FROM fin.settlements s
                         WHERE s.receivable_id = bd.id AND s.status = 'POSTED'),
                        0
                      )) <= 0 THEN 'PAID'
              WHEN bd.due_date < ${asOfDateExpr} THEN 'OVERDUE'
              WHEN COALESCE(
                     (SELECT SUM(s.amount)
                      FROM fin.settlements s
                      WHERE s.receivable_id = bd.id AND s.status = 'POSTED'),
                     0
                   ) > 0 THEN 'PARTIALLY_PAID'
              ELSE 'OPEN'
            END AS status
          FROM fin.receivables bd
          WHERE ${opts.scopeClause}${extra}
            AND bd.lifecycle IN ('ACTIVE', 'CANCELLED')`;
}
