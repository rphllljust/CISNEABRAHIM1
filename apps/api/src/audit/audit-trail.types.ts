import type { PoolClient } from 'pg';

/**
 * Canal AUDIT_TRAIL — grade de contexto para a trilha de auditoria de mudança de valor.
 *
 * Distinto de SECURITY_AUDIT (ação/resultado) e DOMAIN_HISTORY (eventos por agregado).
 * Ver packages/database/src/schema/audit-trail.ts.
 */
export const AUDIT_ACTIONS = {
  Create: 'CREATE',
  Update: 'UPDATE',
  Delete: 'DELETE',
  Transition: 'TRANSITION',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/**
 * Campos de estado permitidos na trilha.
 *
 * O jsonb NUNCA recebe snapshot de domínio (client_snapshot, service_snapshot,
 * contract_snapshot) nem valores financeiros: tax_id, cost_amount e correlatos são
 * RESTRICTED/FINANCIAL em docs/13-data-model/column-semantics.md. A gravação passa por
 * redactAuditMetadata antes de persistir, como segunda barreira.
 */
export type AuditSnapshot = Record<string, unknown> | null;

export interface AuditEntry {
  tabela: string;
  registroId: string;
  acao: AuditAction;
  dadosAntigos: AuditSnapshot;
  dadosNovos: AuditSnapshot;
  usuarioId: string;
  correlationId: string;
}

/** Transação do chamador. O AuditService nunca abre transação própria. */
export type AuditTransaction = PoolClient;

export class AuditPersistenceError extends Error {
  constructor(message = 'audit_trail_persistence_failed') {
    super(message);
  }
}
