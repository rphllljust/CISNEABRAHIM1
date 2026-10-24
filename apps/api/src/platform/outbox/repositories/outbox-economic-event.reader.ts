import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../../infrastructure/database/database.service';
import type {
  EconomicOutboxReaderPort,
  PersistedEconomicEvent,
} from '../domain/economic-outbox-reader.port';

/**
 * F1.1 — IMPLEMENTAÇÃO DA PORTA DE LEITURA DA OUTBOX.
 *
 * Vive em PLATFORM, que é o dono de `evt.outbox_events`. ACCOUNTING depende da PORTA
 * (`accounting/domain/economic-outbox-reader.port`), nunca deste arquivo — a seta
 * PLATFORM ← ACCOUNTING não existe no grafo de bounded contexts.
 */
@Injectable()
export class OutboxEconomicEventReader implements EconomicOutboxReaderPort {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findById(outboxEventId: string): Promise<PersistedEconomicEvent | null> {
    const result = await this.pool().query<PersistedEconomicEvent>(
      `SELECT id, event_type::text AS event_type, aggregate_id, payload, status::text AS status
         FROM evt.outbox_events
        WHERE id = $1::uuid`,
      [outboxEventId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * F1.2 — regrava o motivo da falha após tentativa manual malsucedida.
   *
   * Só o MOTIVO muda. `status` permanece como está: um evento FAILED continua FAILED e
   * continua na fila. Promover/rebaixar status aqui mudaria a semântica do transporte.
   */
  async recordFailureReason(outboxEventId: string, reason: string): Promise<void> {
    await this.pool().query(
      `UPDATE evt.outbox_events
          SET last_error = $2,
              updated_at = NOW()
        WHERE id = $1::uuid`,
      [outboxEventId, reason.slice(0, 1000)],
    );
  }

  /**
   * Fecha o transporte após reprocessamento bem-sucedido.
   *
   * Só age sobre evento ainda não publicado (PENDING/FAILED/PROCESSING). Um evento já
   * PUBLISHED permanece como está — o método é idempotente por construção e nunca
   * "reabre" um transporte fechado.
   */
  async markPublishedIfPending(outboxEventId: string): Promise<void> {
    await this.pool().query(
      `UPDATE evt.outbox_events
          SET status = 'PUBLISHED',
              published_at = COALESCE(published_at, NOW()),
              lease_owner = NULL,
              lease_expires_at = NULL,
              last_error = NULL,
              updated_at = NOW()
        WHERE id = $1::uuid
          AND status <> 'PUBLISHED'`,
      [outboxEventId],
    );
  }
}
