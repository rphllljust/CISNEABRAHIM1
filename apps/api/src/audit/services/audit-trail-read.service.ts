import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';

/**
 * Leitura do canal AUDIT_TRAIL por registro auditado.
 *
 * Este arquivo pertence ao contexto PLATFORM, que e o dono do schema `audit`
 * (ver `platform/bounded-contexts/schema-ownership.ts`). A leitura fica AQUI —
 * e nao no consumidor — porque SQL direto contra schema de outro contexto e
 * proibido pelo gate de fronteira (`module-boundary-rules.spec.ts`, regra
 * "zero cross-context private table access").
 *
 * Somente leitura. Nao ha INSERT/UPDATE/DELETE neste servico; a escrita do
 * canal continua exclusivamente com o `AuditService`, que exige a transacao do
 * chamador.
 */
export type AuditTimelineRow = {
  id: string;
  acao: string;
  dados_antigos: Record<string, unknown> | null;
  dados_novos: Record<string, unknown> | null;
  usuario_id: string;
  correlation_id: string;
  created_at: string;
};

export type AuditTrailPage = {
  rows: AuditTimelineRow[];
  total: number;
};

@Injectable()
export class AuditTrailReadService {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  /**
   * Trilha de um registro, em ordem cronologica ascendente.
   *
   * `total` e contado sem paginacao para que o chamador pagine sobre o
   * conjunto completo. O filtro e sempre `(tabela, registro_id)`, que e
   * exatamente o indice `audit_logs_tabela_registro_id_idx`.
   */
  async listByRecord(
    tabela: string,
    registroId: string,
    limit: number,
    offset: number,
  ): Promise<AuditTrailPage> {
    const [rows, countResult] = await Promise.all([
      this.pool().query<AuditTimelineRow>(
        `SELECT id, acao, dados_antigos, dados_novos, usuario_id, correlation_id, created_at
           FROM audit.audit_logs
          WHERE tabela = $1 AND registro_id = $2
          ORDER BY created_at ASC
          LIMIT $3 OFFSET $4`,
        [tabela, registroId, limit, offset],
      ),
      this.pool().query<{ total: string }>(
        `SELECT count(*)::text AS total
           FROM audit.audit_logs
          WHERE tabela = $1 AND registro_id = $2`,
        [tabela, registroId],
      ),
    ]);

    return {
      rows: rows.rows,
      total: Number(countResult.rows[0]?.total ?? '0'),
    };
  }
}
