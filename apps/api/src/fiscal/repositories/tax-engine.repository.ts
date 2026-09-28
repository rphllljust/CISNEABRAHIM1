import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { publishedWindowsOverlap, TaxEngineError } from '../domain/tax-engine';
import type {
  PersistTaxCalculationInput,
  TaxCalculationAggregate,
  TaxCalculationLineRow,
  TaxCalculationListRow,
  TaxCalculationRow,
  TaxContextRow,
  TaxRuleListRow,
  TaxRuleRow,
  TaxRuleVersionRow,
} from './tax-engine.repository.types';

const RULE_RETURNING = `
  id, unit_id, code, name, status::text AS status, created_at, updated_at
`;

const VERSION_RETURNING = `
  v.id, v.tax_rule_id, v.version_number, v.status::text AS status,
  v.calculation_method::text AS calculation_method, v.rounding_mode::text AS rounding_mode,
  v.rate::text AS rate, v.fixed_amount::text AS fixed_amount, v.source_reference,
  v.effective_from::text AS effective_from, v.effective_to::text AS effective_to,
  v.specification, v.row_version, v.published_at, v.published_by_identity_id
`;

const CALCULATION_RETURNING = `
  id, unit_id, tax_rule_id, tax_rule_version_id, tax_context_id, inputs,
  base_amount::text AS base_amount, rate::text AS rate, result_amount::text AS result_amount,
  calculated_at, idempotency_key, source_kind, source_id
`;

@Injectable()
export class TaxEngineRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Página de cálculos tributários da unidade, no MESMO predicado da contagem. A linha é o
   * resultado persistido (regra via junção de código, base, alíquota e valor) — sem hidratar
   * linhas de componentes, que ficam no detalhe.
   */
  async listCalculationPage(input: {
    unitId: string;
    q?: string;
    limit: number;
    offset: number;
  }): Promise<TaxCalculationListRow[]> {
    const params: unknown[] = [input.unitId];
    let where = 'c.unit_id = $1';
    if (input.q && input.q.trim().length > 0) {
      params.push(`%${input.q.trim()}%`);
      where += ` AND (r.code ILIKE $${params.length} OR r.name ILIKE $${params.length} OR c.source_kind ILIKE $${params.length})`;
    }
    const result = await this.pool().query<TaxCalculationListRow>(
      `SELECT c.id, c.unit_id, c.tax_rule_id, c.tax_rule_version_id, c.base_amount::text AS base_amount,
              c.rate::text AS rate, c.result_amount::text AS result_amount,
              c.calculated_at, c.source_kind, c.source_id,
              r.code AS rule_code, r.name AS rule_name,
              v.version_number
       FROM fis.tax_calculations c
       JOIN fis.tax_rules r ON r.id = c.tax_rule_id
       JOIN fis.tax_rule_versions v ON v.id = c.tax_rule_version_id
       WHERE ${where}
       ORDER BY c.calculated_at DESC, c.id DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, input.limit, input.offset],
    );
    return result.rows;
  }

  async countCalculationList(input: { unitId: string; q?: string }): Promise<number> {
    const params: unknown[] = [input.unitId];
    let where = 'c.unit_id = $1';
    if (input.q && input.q.trim().length > 0) {
      params.push(`%${input.q.trim()}%`);
      where += ` AND (r.code ILIKE $${params.length} OR r.name ILIKE $${params.length} OR c.source_kind ILIKE $${params.length})`;
    }
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM fis.tax_calculations c
       JOIN fis.tax_rules r ON r.id = c.tax_rule_id
       WHERE ${where}`,
      params,
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findRuleById(id: string): Promise<TaxRuleRow | null> {
    const result = await this.pool().query<TaxRuleRow>(
      `SELECT ${RULE_RETURNING} FROM fis.tax_rules WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findRuleByCode(unitId: string, code: string): Promise<TaxRuleRow | null> {
    const result = await this.pool().query<TaxRuleRow>(
      `SELECT ${RULE_RETURNING} FROM fis.tax_rules WHERE unit_id = $1 AND code = $2`,
      [unitId, code],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Lista paginada de regras tributarias da unidade com a versao publicada vigente
   * (LATERAL, uma consulta). Somente leitura: nenhuma aliquota e inventada aqui.
   */
  async listRulePage(input: {
    unitId: string;
    status?: string;
    page: number;
    pageSize: number;
  }): Promise<{ total: number; items: TaxRuleListRow[] }> {
    const conditions: string[] = ['r.unit_id = $1'];
    const params: unknown[] = [input.unitId];
    if (input.status) {
      params.push(input.status);
      conditions.push(`r.status = $${params.length}::fis.tax_rule_status`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const count = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fis.tax_rules r ${where}`,
      params,
    );
    const pageParams = [...params, input.pageSize, input.page * input.pageSize];
    const rows = await this.pool().query<TaxRuleListRow>(
      `SELECT
         r.id, r.unit_id, r.code, r.name, r.status::text AS status, r.created_at, r.updated_at,
         published.id AS published_version_id,
         published.version_number AS published_version_number,
         published.status::text AS published_version_status,
         published.calculation_method::text AS published_calculation_method,
         published.rate::text AS published_rate,
         published.fixed_amount::text AS published_fixed_amount,
         published.source_reference AS published_source_reference,
         published.effective_from::text AS published_effective_from,
         published.effective_to::text AS published_effective_to,
         published.published_at AS published_at,
         versions.version_count AS version_count
       FROM fis.tax_rules r
       LEFT JOIN LATERAL (
         SELECT v.id, v.version_number, v.status, v.calculation_method, v.rate, v.fixed_amount,
                v.source_reference, v.effective_from, v.effective_to, v.published_at
         FROM fis.tax_rule_versions v
         WHERE v.tax_rule_id = r.id AND v.status = 'PUBLISHED'
         ORDER BY v.version_number DESC
         LIMIT 1
       ) published ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS version_count
         FROM fis.tax_rule_versions v
         WHERE v.tax_rule_id = r.id
       ) versions ON TRUE
       ${where}
       ORDER BY r.code ASC, r.created_at DESC
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams,
    );
    return { total: Number(count.rows[0]?.count ?? '0'), items: rows.rows };
  }

  async findVersionById(id: string): Promise<TaxRuleVersionRow | null> {
    const result = await this.pool().query<TaxRuleVersionRow>(
      `SELECT ${VERSION_RETURNING} FROM fis.tax_rule_versions v WHERE v.id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findPublishedVersionForEffectiveOn(
    unitId: string,
    code: string,
    effectiveOn: string,
  ): Promise<TaxRuleVersionRow | null> {
    const result = await this.pool().query<TaxRuleVersionRow>(
      `SELECT ${VERSION_RETURNING}
       FROM fis.tax_rule_versions v
       INNER JOIN fis.tax_rules r ON r.id = v.tax_rule_id
       WHERE r.unit_id = $1
         AND r.code = $2
         AND r.status = 'ACTIVE'
         AND v.status = 'PUBLISHED'
         AND v.effective_from <= $3::date
         AND (v.effective_to IS NULL OR v.effective_to >= $3::date)`,
      [unitId, code, effectiveOn],
    );
    if (result.rows.length !== 1) {
      return null;
    }
    return result.rows[0] ?? null;
  }

  async findCalculationById(id: string): Promise<TaxCalculationAggregate | null> {
    const calculation = await this.pool().query<TaxCalculationRow>(
      `SELECT ${CALCULATION_RETURNING} FROM fis.tax_calculations WHERE id = $1`,
      [id],
    );
    if (!calculation.rows[0]) {
      return null;
    }
    return this.hydrate(calculation.rows[0]);
  }

  async findCalculationByIdempotency(
    unitId: string,
    idempotencyKey: string,
  ): Promise<TaxCalculationAggregate | null> {
    const calculation = await this.pool().query<TaxCalculationRow>(
      `SELECT ${CALCULATION_RETURNING}
       FROM fis.tax_calculations
       WHERE unit_id = $1 AND idempotency_key = $2`,
      [unitId, idempotencyKey],
    );
    if (!calculation.rows[0]) {
      return null;
    }
    return this.hydrate(calculation.rows[0]);
  }

  async createRule(input: {
    unitId: string;
    code: string;
    name: string;
    actorIdentityId: string;
  }): Promise<TaxRuleRow> {
    const result = await this.pool().query<TaxRuleRow>(
      `INSERT INTO fis.tax_rules (
         unit_id, code, name, created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, $4, $4)
       RETURNING ${RULE_RETURNING}`,
      [input.unitId, input.code, input.name, input.actorIdentityId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
    }
    return row;
  }

  async createDraftVersion(input: {
    taxRuleId: string;
    calculationMethod: string;
    roundingMode: string;
    rate: string | null;
    fixedAmount: string | null;
    sourceReference: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    specification: Record<string, unknown>;
    actorIdentityId: string;
  }): Promise<TaxRuleVersionRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      await this.lockRule(client, input.taxRuleId);
      const next = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next
         FROM fis.tax_rule_versions
         WHERE tax_rule_id = $1`,
        [input.taxRuleId],
      );
      const versionNumber = next.rows[0]?.next ?? 1;
      const created = await client.query<TaxRuleVersionRow>(
        `INSERT INTO fis.tax_rule_versions AS v (
           tax_rule_id, version_number, status, calculation_method, rounding_mode,
           rate, fixed_amount, source_reference, effective_from, effective_to,
           specification, created_by_identity_id, updated_by_identity_id
         ) VALUES (
           $1, $2, 'DRAFT', $3::fis.tax_calculation_method, $4::fis.tax_rounding_mode,
           $5, $6, $7, $8::date, $9::date, $10::jsonb, $11, $11
         )
         RETURNING ${VERSION_RETURNING}`,
        [
          input.taxRuleId,
          versionNumber,
          input.calculationMethod,
          input.roundingMode,
          input.rate,
          input.fixedAmount,
          input.sourceReference,
          input.effectiveFrom,
          input.effectiveTo,
          JSON.stringify(input.specification),
          input.actorIdentityId,
        ],
      );
      await client.query('COMMIT');
      const row = created.rows[0];
      if (!row) {
        throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
      }
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async publishVersion(input: {
    versionId: string;
    actorIdentityId: string;
  }): Promise<TaxRuleVersionRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<TaxRuleVersionRow>(
        `SELECT ${VERSION_RETURNING} FROM fis.tax_rule_versions v WHERE v.id = $1 FOR UPDATE`,
        [input.versionId],
      );
      const version = current.rows[0];
      if (!version) {
        throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
      }
      if (version.status === 'PUBLISHED') {
        throw new TaxEngineError('TAX_VERSION_IMMUTABLE');
      }
      await this.lockRule(client, version.tax_rule_id);
      const published = await client.query<TaxRuleVersionRow>(
        `SELECT ${VERSION_RETURNING}
         FROM fis.tax_rule_versions v
         WHERE v.tax_rule_id = $1 AND v.status = 'PUBLISHED'`,
        [version.tax_rule_id],
      );
      for (const existing of published.rows) {
        if (
          publishedWindowsOverlap(
            { effectiveFrom: existing.effective_from, effectiveTo: existing.effective_to },
            { effectiveFrom: version.effective_from, effectiveTo: version.effective_to },
          )
        ) {
          throw new TaxEngineError('TAX_VERSION_OVERLAP');
        }
      }
      const updated = await client.query<TaxRuleVersionRow>(
        `UPDATE fis.tax_rule_versions AS v
         SET status = 'PUBLISHED',
             published_at = NOW(),
             published_by_identity_id = $2,
             updated_at = NOW(),
             updated_by_identity_id = $2,
             row_version = row_version + 1
         WHERE v.id = $1 AND v.status = 'DRAFT'
         RETURNING ${VERSION_RETURNING}`,
        [input.versionId, input.actorIdentityId],
      );
      await client.query('COMMIT');
      const row = updated.rows[0];
      if (!row) {
        throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
      }
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async persistCalculation(input: PersistTaxCalculationInput): Promise<TaxCalculationAggregate> {
    const existing = await this.findCalculationByIdempotency(input.unitId, input.idempotencyKey);
    if (existing) {
      return existing;
    }
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const context = await client.query<TaxContextRow>(
        `INSERT INTO fis.tax_contexts (
           unit_id, currency_code, base_amount, effective_on, attributes, created_by_identity_id
         ) VALUES ($1, $2, $3, $4::date, $5::jsonb, $6)
         RETURNING id, unit_id, currency_code, base_amount::text AS base_amount,
                   effective_on::text AS effective_on, attributes`,
        [
          input.unitId,
          input.currencyCode,
          input.baseAmount,
          input.effectiveOn,
          JSON.stringify(input.attributes),
          input.actorIdentityId,
        ],
      );
      const contextRow = context.rows[0];
      if (!contextRow) {
        throw new TaxEngineError('TAX_INVALID_CONTEXT');
      }
      try {
        const calculation = await client.query<TaxCalculationRow>(
          `INSERT INTO fis.tax_calculations (
             unit_id, tax_rule_id, tax_rule_version_id, tax_context_id, inputs,
             base_amount, rate, result_amount, idempotency_key, source_kind, source_id,
             created_by_identity_id
           ) VALUES (
             $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12
           )
           RETURNING ${CALCULATION_RETURNING}`,
          [
            input.unitId,
            input.taxRuleId,
            input.taxRuleVersionId,
            contextRow.id,
            JSON.stringify(input.inputs),
            input.baseAmount,
            input.rate,
            input.resultAmount,
            input.idempotencyKey,
            input.sourceKind,
            input.sourceId,
            input.actorIdentityId,
          ],
        );
        const calculationRow = calculation.rows[0];
        if (!calculationRow) {
          throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
        }
        await client.query(
          `INSERT INTO fis.tax_calculation_lines (
             tax_calculation_id, line_number, component_label, base_amount, rate,
             result_amount, detail_snapshot
           ) VALUES ($1, 1, $2, $3, $4, $5, $6::jsonb)`,
          [
            calculationRow.id,
            input.componentLabel,
            input.baseAmount,
            input.rate,
            input.resultAmount,
            JSON.stringify({
              ruleVersionId: input.taxRuleVersionId,
              calculationOnly: true,
              postsToLedger: false,
              writesFiscalDocument: false,
            }),
          ],
        );
        await client.query('COMMIT');
        const hydrated = await this.findCalculationById(calculationRow.id);
        if (!hydrated) {
          throw new TaxEngineError('TAX_CALCULATION_NOT_FOUND');
        }
        return hydrated;
      } catch (error) {
        await client.query('ROLLBACK');
        if (isUniqueViolation(error)) {
          const replay = await this.findCalculationByIdempotency(input.unitId, input.idempotencyKey);
          if (replay) {
            return replay;
          }
        }
        throw error;
      }
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async hydrate(calculation: TaxCalculationRow): Promise<TaxCalculationAggregate> {
    const [context, lines, version, rule] = await Promise.all([
      this.pool().query<TaxContextRow>(
        `SELECT id, unit_id, currency_code, base_amount::text AS base_amount,
                effective_on::text AS effective_on, attributes
         FROM fis.tax_contexts WHERE id = $1`,
        [calculation.tax_context_id],
      ),
      this.pool().query<TaxCalculationLineRow>(
        `SELECT id, tax_calculation_id, line_number, component_label,
                base_amount::text AS base_amount, rate::text AS rate,
                result_amount::text AS result_amount, detail_snapshot
         FROM fis.tax_calculation_lines
         WHERE tax_calculation_id = $1
         ORDER BY line_number`,
        [calculation.id],
      ),
      this.pool().query<TaxRuleVersionRow>(
        `SELECT ${VERSION_RETURNING} FROM fis.tax_rule_versions v WHERE v.id = $1`,
        [calculation.tax_rule_version_id],
      ),
      this.pool().query<TaxRuleRow>(
        `SELECT ${RULE_RETURNING} FROM fis.tax_rules WHERE id = $1`,
        [calculation.tax_rule_id],
      ),
    ]);
    const contextRow = context.rows[0];
    const versionRow = version.rows[0];
    const ruleRow = rule.rows[0];
    if (!contextRow || !versionRow || !ruleRow) {
      throw new TaxEngineError('TAX_CALCULATION_NOT_FOUND');
    }
    return {
      calculation,
      context: contextRow,
      lines: lines.rows,
      version: versionRow,
      rule: ruleRow,
    };
  }

  private async lockRule(client: PoolClient, taxRuleId: string): Promise<void> {
    const locked = await client.query(`SELECT id FROM fis.tax_rules WHERE id = $1 FOR UPDATE`, [
      taxRuleId,
    ]);
    if (!locked.rows[0]) {
      throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
