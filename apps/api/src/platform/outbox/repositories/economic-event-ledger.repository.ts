import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../../infrastructure/database/database.service';
import { EconomicFactPublisher, type EconomicFactInput } from '../services/economic-fact.publisher';

/**
 * F1.2 — LEDGER DE FATOS ECONÔMICOS (PLATAFORMA).
 *
 * `plt.economic_events` + `evt.outbox_events`, escritos na MESMA transação do comando
 * de origem. Substitui o repositório específico de FINANCE da F1.1 pelo MECANISMO
 * comum — sem criar segunda espinha e sem duplicar contrato.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * GARANTIAS
 *
 * 1. ATOMICIDADE — recebe o `PoolClient` do chamador e nunca abre transação própria.
 *    Rollback do fato ⇒ rollback do evento. Não existe estado em que o negócio mudou
 *    e a contabilidade não foi avisada.
 * 2. DUPLICATE PREVENTION — `plt_economic_events_kind_source_uidx` impede segundo
 *    FATO; `outbox_events_idempotency_key_uidx` impede segundo TRANSPORTE.
 * 3. RASTREABILIDADE — a linha guarda `outbox_event_id` e `reverses_source_id`,
 *    fechando `fato → evento → posting → journal` e o estorno compensatório.
 *
 * Não decide contabilidade. Não escreve journal. Não lê `acc.*`.
 */

export type RecordEconomicFactResult = {
  economicEventId: string;
  outboxEventId: string;
  /** `true` quando o mesmo fato já havia sido registrado (replay idempotente). */
  idempotent: boolean;
};

@Injectable()
export class EconomicEventLedgerRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly publisher: EconomicFactPublisher,
  ) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  /**
   * Registra o fato e publica o evento. DEVE ser chamado dentro da transação do
   * comando que confirmou o fato.
   */
  async record(client: PoolClient, input: EconomicFactInput): Promise<RecordEconomicFactResult> {
    const existing = await client.query<{ id: string; outbox_event_id: string | null }>(
      `SELECT id, outbox_event_id
         FROM plt.economic_events
        WHERE event_kind = $1 AND source_id = $2`,
      [input.eventKind, input.sourceId],
    );
    const found = existing.rows[0];
    if (found?.outbox_event_id) {
      // Replay do mesmo fato: o evento e o transporte já existem.
      return { economicEventId: found.id, outboxEventId: found.outbox_event_id, idempotent: true };
    }

    const published = await this.publisher.publish(client, input);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO plt.economic_events (
         unit_id, event_kind, source_kind, source_id, amount, currency_code,
         occurred_on, actor_identity_id, payload, outbox_event_id, reverses_source_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9::jsonb, $10::uuid, $11::uuid)
       ON CONFLICT (event_kind, source_id) DO UPDATE
         SET outbox_event_id = COALESCE(plt.economic_events.outbox_event_id, EXCLUDED.outbox_event_id)
       RETURNING id`,
      [
        input.unitId,
        input.eventKind,
        input.sourceKind,
        input.sourceId,
        input.amount,
        input.currencyCode,
        toCivilDateForSql(input.occurredOn),
        input.actorIdentityId,
        JSON.stringify({ sourceReference: input.sourceReference ?? null, ...(input.context ?? {}) }),
        published.outboxEventId,
        input.reversesSourceId ?? null,
      ],
    );

    return {
      economicEventId: inserted.rows[0]!.id,
      outboxEventId: published.outboxEventId,
      idempotent: false,
    };
  }

  /**
   * Leitura de trilha para a superfície operacional. Lê o read model publicado
   * (`rpt.read_economic_events`) — o mesmo contrato `rpt.*` do DR-008.
   */
  async listByUnit(unitId: string, limit: number, offset: number): Promise<EconomicEventRow[]> {
    const result = await this.pool().query<EconomicEventRow>(
      `SELECT id, unit_id, event_kind, source_kind, source_id,
              amount::text AS amount, currency_code, occurred_on::text AS occurred_on,
              actor_identity_id, outbox_event_id, reverses_source_id, created_at
         FROM rpt.read_economic_events
        WHERE unit_id = $1
        ORDER BY occurred_on DESC, created_at DESC
        LIMIT $2 OFFSET $3`,
      [unitId, limit, offset],
    );
    return result.rows;
  }

  async countByUnit(unitId: string): Promise<number> {
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM rpt.read_economic_events WHERE unit_id = $1`,
      [unitId],
    );
    return Number.parseInt(result.rows[0]?.total ?? '0', 10);
  }
}

export type EconomicEventRow = {
  id: string;
  unit_id: string;
  event_kind: string;
  source_kind: string;
  source_id: string;
  amount: string;
  currency_code: string;
  occurred_on: string;
  actor_identity_id: string;
  outbox_event_id: string | null;
  reverses_source_id: string | null;
  created_at: string;
};

/**
 * Data civil para o parâmetro `::date`.
 *
 * Aceita `Date` porque `timestamptz` chega assim do driver — a F1.1 quebrou nisto.
 */
function toCivilDateForSql(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}
