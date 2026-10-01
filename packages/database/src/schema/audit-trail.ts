import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgEnum, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { auditSchema } from './audit';

/**
 * Canal AUDIT_TRAIL — trilha de auditoria de mudança de valor.
 *
 * Distinto dos canais já implementados:
 *  - SECURITY_AUDIT (audit.security_audit_events): registra ACÃO/resultado, sem valor anterior.
 *  - DOMAIN_HISTORY (so.service_order_history_events): eventos por agregado, dentro da transação.
 *
 * Este canal registra o PAR dado_antigo/dado_novo, que nenhum dos dois cobre.
 * Declarado em apps/api/src/audit/types/audit-channels.ts como AUDIT_TRAIL.
 *
 * Sem FK para tabelas de domínio, por decisão de escopo: a trilha deve sobreviver à
 * remoção do registro auditado (inclusive exclusão física técnica).
 */
export const auditActionEnum = pgEnum('audit_action', [
  'CREATE',
  'UPDATE',
  'DELETE',
  'TRANSITION',
]);

export const auditLogs = auditSchema.table(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nome da tabela de domínio — texto livre de propósito, sem FK.
    tabela: varchar('tabela', { length: 100 }).notNull(),
    // UUID do registro auditado. Sem FK: ver nota acima.
    registroId: uuid('registro_id').notNull(),
    acao: auditActionEnum('acao').notNull(),
    // Campos de estado já redigidos pelo chamador (ver AuditService).
    dadosAntigos: jsonb('dados_antigos'),
    dadosNovos: jsonb('dados_novos'),
    // Identidade do autor. Sem FK pelo mesmo motivo de registroId.
    usuarioId: uuid('usuario_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('audit_logs_tabela_not_empty_chk', sql`length(trim(${table.tabela})) > 0`),
    index('audit_logs_tabela_registro_id_idx').on(table.tabela, table.registroId),
    index('audit_logs_usuario_id_idx').on(table.usuarioId),
    // DESC no created_at: leitura operacional é sempre "mais recentes primeiro".
    index('audit_logs_created_at_idx').on(table.createdAt.desc()),
  ],
);
