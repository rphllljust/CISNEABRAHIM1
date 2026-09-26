import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';

export type FiscalDocumentStatusCounts = Record<string, number>;

export type ComplianceSummaryRaw = {
  fiscalDocumentsByStatus: FiscalDocumentStatusCounts;
  fiscalPendingTransmissionCount: number;
  taxObligationsOpenCount: number;
  /** Soma sem populacao elegivel => null (NO_DATA), nunca '0' fabricado. */
  taxObligationsOpenAmount: string | null;
  accountingPeriodsOpenCount: number;
  accountingPeriodsClosedCount: number;
  journalEntriesPostedCount: number;
  journalEntriesDraftCount: number;
};

/**
 * BI DE CONFORMIDADE (fiscal + contabil) — leitura pura.
 *
 * Le SOMENTE o contrato publico de leitura (`rpt.*`, ADR-003) e nunca o schema base de outro
 * contexto: a fronteira de contexto e verificada pelo gate de arquitetura
 * (`module-boundary-rules.spec.ts`). Nao cria tabela, view ou segundo motor de calculo.
 * Toda consulta e escopada por unidade; nao existe varredura global por omissao.
 *
 * Politica de nulo: ausencia de populacao elegivel devolve `null` para somas (nunca '0'
 * fabricado) e contagem real para contagens.
 */
@Injectable()
export class ComplianceReadModelRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async summarize(input: {
    unitId: string;
    occurredFrom: string;
    occurredTo: string;
  }): Promise<ComplianceSummaryRaw> {
    const [fiscalStatus, pendingTransmission, obligations, periods, journals] = await Promise.all([
      this.pool().query<{ status: string; count: string }>(
        `SELECT status::text AS status, COUNT(*)::text AS count
         FROM rpt.read_fiscal_documents
         WHERE unit_id = $1
         GROUP BY status`,
        [input.unitId],
      ),
      this.pool().query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM rpt.read_fiscal_documents
         WHERE unit_id = $1
           AND status NOT IN ('AUTHORIZED', 'CANCELLED')
           AND issued_on BETWEEN $2::date AND $3::date`,
        [input.unitId, input.occurredFrom, input.occurredTo],
      ),
      this.pool().query<{ count: string; amount: string | null }>(
        `SELECT COUNT(*)::text AS count, SUM(amount)::text AS amount
         FROM rpt.read_tax_obligations
         WHERE unit_id = $1 AND status = 'OPEN'
           AND period_key >= to_char($2::date, 'YYYY-MM')
           AND period_key <= to_char($3::date, 'YYYY-MM')`,
        [input.unitId, input.occurredFrom, input.occurredTo],
      ),
      this.pool().query<{ status: string; count: string }>(
        `SELECT status::text AS status, COUNT(*)::text AS count
         FROM rpt.read_accounting_periods
         WHERE unit_id = $1
         GROUP BY status`,
        [input.unitId],
      ),
      this.pool().query<{ status: string; count: string }>(
        `SELECT status::text AS status, COUNT(*)::text AS count
         FROM rpt.read_journal_entries
         WHERE unit_id = $1
           AND occurred_on BETWEEN $2::date AND $3::date
         GROUP BY status`,
        [input.unitId, input.occurredFrom, input.occurredTo],
      ),
    ]);

    const fiscalDocumentsByStatus: FiscalDocumentStatusCounts = {};
    for (const row of fiscalStatus.rows) {
      fiscalDocumentsByStatus[row.status] = Number(row.count);
    }
    const periodCounts = new Map(periods.rows.map((row) => [row.status, Number(row.count)]));
    const journalCounts = new Map(journals.rows.map((row) => [row.status, Number(row.count)]));

    return {
      fiscalDocumentsByStatus,
      fiscalPendingTransmissionCount: Number(pendingTransmission.rows[0]?.count ?? '0'),
      taxObligationsOpenCount: Number(obligations.rows[0]?.count ?? '0'),
      taxObligationsOpenAmount: obligations.rows[0]?.amount ?? null,
      accountingPeriodsOpenCount: periodCounts.get('OPEN') ?? 0,
      accountingPeriodsClosedCount: periodCounts.get('CLOSED') ?? 0,
      journalEntriesPostedCount: journalCounts.get('POSTED') ?? 0,
      journalEntriesDraftCount: journalCounts.get('DRAFT') ?? 0,
    };
  }
}
