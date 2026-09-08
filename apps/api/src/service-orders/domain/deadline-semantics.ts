import { resolveApproachingDueThresholdDays } from '../../analytics/domain/aging-snapshot';

/**
 * DEADLINE-SEM-001 — núcleo único de prazo/vencimento de OS por janela operacional.
 *
 * Deadline de uma OS: menor `operational_end` entre janelas abertas
 * (`so.planned_resources` PLANNED | `res.resource_allocations` ACTIVE),
 * materializado pela função de banco `so.deadline_for(uuid)` (migration 0076).
 *
 * Comparações canônicas (alinhadas à política pura `service-order-overdue.policy`):
 *  - overdue      : deadline <= NOW() (e status não-terminal — filtro do chamador)
 *  - approaching  : deadline > NOW() e deadline <= NOW() + AGING_APPROACHING_DUE_DAYS
 *
 * Nenhuma cópia de SQL de prazo deve existir fora destas fábricas + da função SQL.
 */

export const DEADLINE_KERNEL_SCHEMA_FUNCTION = 'so.deadline_for';

export const OVERDUE_POLICY_TERMINAL_EXCLUDED = true;

export function resolveApproachingDueDays(): number {
  return resolveApproachingDueThresholdDays();
}

/**
 * Subconsulta escalar que materializa o deadline da OS numa query com alias `so`.
 * Ex.: `(SELECT so.deadline_for(so.id))` dentro de `SELECT`/`JOIN LATERAL`.
 */
export function deadlineScalarSql(serviceOrderAlias: string): string {
  return `(SELECT so.deadline_for(${serviceOrderAlias}.id))`;
}

/** Cláusula canônica de vencido: deadline <= NOW(). */
export function deadlineOverdueClause(deadlineColumn: string): string {
  return `${deadlineColumn} <= NOW()`;
}

/**
 * Cláusula canônica de "vencendo em breve": deadline > NOW() e
 * deadline <= NOW() + (thresholdParam * interval '1 day').
 * `thresholdParam` é o placeholder `$n` do parâmetro inteiro de dias.
 */
export function deadlineApproachingClause(deadlineColumn: string, thresholdParam: string): string {
  return `${deadlineColumn} > NOW() AND ${deadlineColumn} <= NOW() + (${thresholdParam}::int * interval '1 day')`;
}

/**
 * Cláusula canônica de atraso em dias (inteiro truncado).
 * `deadlineColumn` é uma expressão que retorna o deadline da OS.
 */
export function deadlineDelayDaysExpression(deadlineColumn: string): string {
  return `FLOOR(EXTRACT(EPOCH FROM (NOW() - ${deadlineColumn})) / 86400)::int`;
}
