import { Injectable } from '@nestjs/common';
import {
  redactAuditMetadata,
  sanitizeAuditText,
} from './services/audit-redaction.service';
import {
  AuditPersistenceError,
  type AuditEntry,
  type AuditSnapshot,
  type AuditTransaction,
} from './audit-trail.types';

const MAX_TABELA_LENGTH = 100;

/**
 * Canal AUDIT_TRAIL — apenas inserção.
 *
 * Não abre transação: recebe a do chamador (PoolClient). Assim a linha de auditoria
 * faz rollback junto com a mutação de negócio, garantindo que uma operação rejeitada
 * não deixe rastro em audit_logs.
 *
 * Zero regra de negócio. Zero transformação além de redaction/sanitização.
 */
@Injectable()
export class AuditService {
  async registrar(entry: AuditEntry, tx: AuditTransaction): Promise<void> {
    const tabela = sanitizeAuditText(entry.tabela).slice(0, MAX_TABELA_LENGTH);
    if (tabela.length === 0) {
      throw new AuditPersistenceError('audit_trail_tabela_required');
    }

    const result = await tx.query<{ id: string }>(
      `INSERT INTO audit.audit_logs (
         tabela,
         registro_id,
         acao,
         dados_antigos,
         dados_novos,
         usuario_id,
         correlation_id
       ) VALUES ($1, $2, $3::audit.audit_action, $4::jsonb, $5::jsonb, $6, $7)
       RETURNING id`,
      [
        tabela,
        entry.registroId,
        entry.acao,
        toJsonParam(entry.dadosAntigos),
        toJsonParam(entry.dadosNovos),
        entry.usuarioId,
        entry.correlationId,
      ],
    );

    if (!result.rows[0]?.id) {
      throw new AuditPersistenceError();
    }
  }
}

function toJsonParam(snapshot: AuditSnapshot): string | null {
  if (snapshot === null) {
    return null;
  }
  return JSON.stringify(redactAuditMetadata(snapshot));
}
