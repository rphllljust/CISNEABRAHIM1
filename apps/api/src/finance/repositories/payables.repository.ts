import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { classifyRowVersion } from '../../infrastructure/database/optimistic-lock';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { compareMoneyAmounts } from '../../platform/kernel/money-math';
import {
  PAYABLE_LIFECYCLES,
  PAYMENT_KINDS,
  PayableError,
  assertNoInstallmentOverpayment,
  assertNoOverpayment,
  assertPayableActive,
  assertPaymentAmount,
  assertPaymentCurrency,
  assertReversalAmount,
  netPaidAmount,
  type PostedPayment,
} from '../domain/payable';
import type {
  CancelPayablePersistenceInput,
  CreateExpenseCategoryPersistenceInput,
  ExpenseCategoryRow,
  OpenPayablePersistenceInput,
  PayPayablePersistenceInput,
  PayableInstallmentRow,
  PayableRow,
  PaymentRow,
  ReversePaymentPersistenceInput,
} from './payables.repository.types';
import {
  buildAgingBucketExpr,
  buildPayableAdvancedClause,
  type PayableAdvancedFilter,
} from './payable-list-sql';

const CATEGORY_RETURNING = `
  id, code, name, status::text AS status, created_at, updated_at, created_by_identity_id, updated_by_identity_id
`;

const PAYABLE_RETURNING = `
  id, unit_id, counterparty_id, origin_kind::text AS origin_kind, origin_id, origin_reference,
  expense_category_id, cost_center_id, cost_center_code,
  principal::text AS principal, currency_code, due_date::text AS due_date, payment_terms, external_reference,
  lifecycle::text AS lifecycle, cancelled_at, cancelled_by_identity_id, cancel_reason, row_version,
  created_at, updated_at, created_by_identity_id, updated_by_identity_id
`;

const INSTALLMENT_RETURNING = `
  id, payable_id, installment_number, principal::text AS principal, due_date::text AS due_date, created_at
`;

const PAYMENT_RETURNING = `
  id, payable_id, installment_id, kind::text AS kind, amount::text AS amount, currency_code,
  paid_at, idempotency_key, payment_reference, origin_kind::text AS origin_kind, origin_id, origin_reference,
  reverses_payment_id, actor_identity_id, created_at
`;

function toPosted(payments: PaymentRow[]): PostedPayment[] {
  return payments.map((item) => ({
    kind: item.kind,
    amount: item.amount,
    installmentId: item.installment_id,
    reversesPaymentId: item.reverses_payment_id,
  }));
}

@Injectable()
export class PayablesRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async createExpenseCategory(input: CreateExpenseCategoryPersistenceInput): Promise<ExpenseCategoryRow> {
    try {
      const result = await this.pool().query<ExpenseCategoryRow>(
        `INSERT INTO fin.expense_categories (code, name, created_by_identity_id, updated_by_identity_id)
         VALUES ($1, $2, $3, $3)
         RETURNING ${CATEGORY_RETURNING}`,
        [input.code, input.name, input.actorIdentityId],
      );
      return result.rows[0]!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new PayableError('EXPENSE_CATEGORY_DUPLICATE');
      }
      throw error;
    }
  }

  async findExpenseCategoryById(categoryId: string): Promise<ExpenseCategoryRow | null> {
    const result = await this.pool().query<ExpenseCategoryRow>(
      `SELECT ${CATEGORY_RETURNING} FROM fin.expense_categories WHERE id = $1`,
      [categoryId],
    );
    return result.rows[0] ?? null;
  }

  async findById(payableId: string): Promise<PayableRow | null> {
    const result = await this.pool().query<PayableRow>(
      `SELECT ${PAYABLE_RETURNING} FROM fin.payables WHERE id = $1`,
      [payableId],
    );
    return result.rows[0] ?? null;
  }

  async findByOrigin(originKind: string, originId: string): Promise<PayableRow | null> {
    const result = await this.pool().query<PayableRow>(
      `SELECT ${PAYABLE_RETURNING} FROM fin.payables WHERE origin_kind = $1::fin.payable_origin_kind AND origin_id = $2`,
      [originKind, originId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Pagina de contas a pagar, com ESCOPO, FILTRO e PAGINACAO resolvidos em SQL.
   *
   * Espelha `ReceivablesRepository.listPage`: substitui `listAll()` (tabela inteira sem
   * `WHERE`/`LIMIT`, autorizacao e paginacao em memoria) por uma pagina real cujo `total`
   * conta sob o MESMO escopo e filtro da pagina.
   *
   * NOTA DE ESQUEMA (verificada em `fin.payables`): nao existe coluna `status`. O status e
   * DERIVADO por `derivePayableStatus` de `lifecycle` + pagamentos liquidados + `due_date`;
   * o filtro de status e traduzido para esses predicados reais.
   */
  async listPage(input: {
    scopeClause: string;
    scopeParams: unknown[];
    status?: string;
    dueFrom?: string;
    dueTo?: string;
    search?: string;
    /** Filtro composto já validado pelo contrato; ausente = sem recorte composto. */
    advanced?: PayableAdvancedFilter;
    /** Faixa de aging — predicado canônico, o mesmo do summary e do aging agregado. */
    agingBucket?: string;
    limit: number;
    offset: number;
    sortBy: 'due_date' | 'created_at';
    sortDir: 'asc' | 'desc';
  }): Promise<{ rows: PayableRow[]; total: number }> {
    const params: unknown[] = [...input.scopeParams];
    const where: string[] = [input.scopeClause];

    // Espelha `remainingBalance`: estornos (`reverses_payment_id IS NOT NULL`) subtraem.
    const paidExpr = `COALESCE((
        SELECT sum(CASE WHEN p.reverses_payment_id IS NULL THEN p.amount ELSE -p.amount END)
        FROM fin.payments p WHERE p.payable_id = r.id), 0)`;
    const remainingExpr = `(r.principal - ${paidExpr})`;

    const statusPredicates: Record<string, string> = {
      CANCELLED: `r.lifecycle = 'CANCELLED'`,
      PAID: `r.lifecycle <> 'CANCELLED' AND ${remainingExpr} <= 0`,
      OVERDUE: `r.lifecycle <> 'CANCELLED' AND ${remainingExpr} > 0 AND r.due_date < CURRENT_DATE`,
      OPEN: `r.lifecycle <> 'CANCELLED' AND ${remainingExpr} > 0 AND r.due_date >= CURRENT_DATE AND ${paidExpr} = 0`,
      PARTIALLY_PAID: `r.lifecycle <> 'CANCELLED' AND ${remainingExpr} > 0 AND ${paidExpr} > 0`,
    };

    if (input.status) {
      where.push(statusPredicates[input.status] ?? 'FALSE');
    }
    if (input.dueFrom) {
      params.push(input.dueFrom);
      where.push(`r.due_date >= $${params.length}::date`);
    }
    if (input.dueTo) {
      params.push(input.dueTo);
      where.push(`r.due_date <= $${params.length}::date`);
    }
    if (input.search) {
      // Curinga escapado: o termo e do operador, nunca vira padrao livre no servidor.
      params.push(`%${input.search.replace(/[%_\\]/g, '\\$&')}%`);
      where.push(`r.external_reference ILIKE $${params.length}`);
    }

    /*
     * FILTRO COMPOSTO — entra como UM predicado entre os demais, convivendo por conjunção com o
     * escopo de autorização, a situação, a janela de vencimento e a busca. A tradução de cada
     * condição (coluna real, operador, cast e parâmetro) vive em `payable-list-sql`, junto do
     * allow-list que o parser valida — leitura e escrita do contrato no mesmo lugar.
     */
    if (input.advanced) {
      const advanced = buildPayableAdvancedClause(input.advanced, params.length + 1);
      if (advanced) {
        where.push(advanced.clause);
        params.push(...advanced.params);
      }
    }

    /*
     * FAIXA DE AGING — primeiro passo de filtragem de faixa no SERVIDOR.
     *
     * Antes, `agingBucket` existia só na serialização: era um rótulo calculado depois que a
     * página já tinha sido escolhida. Como consequência, "filtrar por 31-60" não recortava
     * nada — a tela filtrava em memória sobre a página atual e o `total` continuava sendo o
     * da carteira. Agora entra no `WHERE`, então `total`, paginação e drilldown falam da
     * MESMA faixa.
     */
    if (input.agingBucket) {
      params.push(input.agingBucket);
      where.push(`${buildAgingBucketExpr('CURRENT_DATE')} = $${params.length}`);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    // Ordenacao por allow-list; `due_date` + `id` garante ordem TOTAL (sem empate entre paginas).
    const sortColumn = input.sortBy === 'due_date' ? 'r.due_date' : 'r.created_at';
    const sortDir = input.sortDir === 'asc' ? 'ASC' : 'DESC';

    const countResult = await this.pool().query<{ total: string }>(
      `SELECT count(*)::text AS total FROM fin.payables r ${whereSql}`,
      params,
    );

    params.push(input.limit, input.offset);
    const rows = await this.pool().query<PayableRow>(
      `SELECT ${PAYABLE_RETURNING}
       FROM fin.payables r
       ${whereSql}
       ORDER BY ${sortColumn} ${sortDir}, r.id ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { rows: rows.rows, total: Number(countResult.rows[0]?.total ?? '0') };
  }

  /** Agregados autoritativos sob o mesmo escopo/filtros da listagem; valores separados por moeda. */
  async summarize(input: {
    scopeClause: string;
    scopeParams: unknown[];
    status?: string;
    dueFrom?: string;
    dueTo?: string;
    search?: string;
    /** Faixa de aging — MESMO predicado da lista e do aging agregado. */
    agingBucket?: string;
  }): Promise<Array<{
    currency_code: string;
    total_count: string;
    open_count: string;
    overdue_count: string;
    due_count: string;
    paid_count: string;
    aging_90_plus_count: string;
    open_amount: string;
    overdue_amount: string;
    due_amount: string;
  }>> {
    const params: unknown[] = [...input.scopeParams];
    const where: string[] = [input.scopeClause];
    const paidExpr = `COALESCE((SELECT sum(CASE WHEN p.reverses_payment_id IS NULL THEN p.amount ELSE -p.amount END)
        FROM fin.payments p WHERE p.payable_id = r.id), 0)`;
    const remainingExpr = `(r.principal - ${paidExpr})`;
    const statusPredicates: Record<string, string> = {
      CANCELLED: `r.lifecycle = 'CANCELLED'`,
      PAID: `r.lifecycle <> 'CANCELLED' AND ${remainingExpr} <= 0`,
      OVERDUE: `r.lifecycle <> 'CANCELLED' AND ${remainingExpr} > 0 AND r.due_date < CURRENT_DATE`,
      OPEN: `r.lifecycle <> 'CANCELLED' AND ${remainingExpr} > 0 AND r.due_date >= CURRENT_DATE AND ${paidExpr} = 0`,
      PARTIALLY_PAID: `r.lifecycle <> 'CANCELLED' AND ${remainingExpr} > 0 AND ${paidExpr} > 0`,
    };
    if (input.status) where.push(statusPredicates[input.status] ?? 'FALSE');
    if (input.dueFrom) { params.push(input.dueFrom); where.push(`r.due_date >= ${params.length}::date`); }
    if (input.dueTo) { params.push(input.dueTo); where.push(`r.due_date <= ${params.length}::date`); }
    if (input.search) {
      /*
       * Curinga escapado, mesmo tratamento de `listPage`: o termo e do operador e nunca vira
       * padrao livre no servidor. O placeholder PRECISA ser substituido por `$n` — o valor
       * `params.length` sozinho produz `ILIKE 3`, que o Postgres rejeita.
       */
      params.push(`%${input.search.replace(/[%_\\]/g, '\\$&')}%`);
      where.push(`r.external_reference ILIKE $${params.length}`);
    }
    if (input.agingBucket) {
      /*
       * Sumário respeita a faixa: se a tela mostra "31-60", os totais publicados são os da
       * faixa, não os da carteira inteira. Mesma expressão da lista — impossível concordarem
       * por acidente e divergirem por manutenção.
       */
      params.push(input.agingBucket);
      where.push(`${buildAgingBucketExpr('CURRENT_DATE')} = $${params.length}`);
    }
    const result = await this.pool().query<{
      currency_code: string; total_count: string; open_count: string; overdue_count: string;
      due_count: string; paid_count: string; aging_90_plus_count: string; open_amount: string;
      overdue_amount: string; due_amount: string;
    }>(
      `SELECT r.currency_code,
         count(*)::text AS total_count,
         count(*) FILTER (WHERE r.lifecycle <> 'CANCELLED' AND ${remainingExpr} > 0)::text AS open_count,
         count(*) FILTER (WHERE r.lifecycle <> 'CANCELLED' AND ${remainingExpr} > 0 AND r.due_date < CURRENT_DATE)::text AS overdue_count,
         count(*) FILTER (WHERE r.lifecycle <> 'CANCELLED' AND ${remainingExpr} > 0 AND r.due_date >= CURRENT_DATE)::text AS due_count,
         count(*) FILTER (WHERE r.lifecycle <> 'CANCELLED' AND ${remainingExpr} <= 0)::text AS paid_count,
         count(*) FILTER (WHERE r.lifecycle <> 'CANCELLED' AND ${remainingExpr} > 0 AND r.due_date < CURRENT_DATE - INTERVAL '90 days')::text AS aging_90_plus_count,
         COALESCE(sum(CASE WHEN r.lifecycle <> 'CANCELLED' AND ${remainingExpr} > 0 THEN ${remainingExpr} ELSE 0 END), 0)::text AS open_amount,
         COALESCE(sum(CASE WHEN r.lifecycle <> 'CANCELLED' AND ${remainingExpr} > 0 AND r.due_date < CURRENT_DATE THEN ${remainingExpr} ELSE 0 END), 0)::text AS overdue_amount,
         COALESCE(sum(CASE WHEN r.lifecycle <> 'CANCELLED' AND ${remainingExpr} > 0 AND r.due_date >= CURRENT_DATE THEN ${remainingExpr} ELSE 0 END), 0)::text AS due_amount
       FROM fin.payables r
       WHERE ${where.join(' AND ')}
       GROUP BY r.currency_code ORDER BY r.currency_code`,
      params,
    );
    return result.rows;
  }

  /**
   * AGING AUTORITATIVO — agregacao no BANCO sobre a carteira INTEIRA do escopo.
   *
   * ANTES: `PayablesAccessService.aging()` pedia `list({ limit: AGING_SCAN_LIMIT })` e
   * agregava as linhas em memoria. Isso fazia a pagina representar a carteira: com mais
   * titulos que o limite, o resto simplesmente nao existia no calculo, e o aging publicado
   * era o aging da PRIMEIRA PAGINA. Page != dataset.
   *
   * AGORA: uma unica consulta agrega por faixa. O `WHERE` de escopo/filtro e o MESMO da
   * listagem, entao lista, summary e aging falam do mesmo conjunto por construcao.
   *
   * A classificacao reproduz `classifyPayableAging` no SQL, e nao em TS, para que o numero
   * publicado nao dependa de quantas linhas couberam na memoria:
   *   - lifecycle = 'CANCELLED'                 -> CANCELLED
   *   - restante <= 0                           -> SETTLED
   *   - dias de atraso <= 0                     -> CURRENT
   *   - <= 30 / <= 60 / <= 90 / > 90            -> 1_30 / 31_60 / 61_90 / 90_PLUS
   *
   * `as_of` entra como parametro tipado: o corte de data e o mesmo que a tela exibe, sem
   * depender do relogio do processo nem do fuso do servidor.
   */
  async agingBuckets(input: {
    scopeClause: string;
    scopeParams: unknown[];
    asOf: string;
  }): Promise<Array<{ bucket: string; count: string; remaining: string; currency_code: string }>> {
    const params: unknown[] = [...input.scopeParams];
    params.push(input.asOf);
    const asOfParam = `$${params.length}::date`;

    // Faixa vem da expressão CANÔNICA compartilhada com a lista e o filtro composto.
    const bucketExpr = buildAgingBucketExpr(asOfParam);

    // Saldo restante precisa usar a MESMA expressão que a faixa — senão o valor somado em
    // "1_30" poderia não ser o saldo do título que foi classificado em "1_30".
    const paidExpr = `COALESCE((
        SELECT sum(CASE WHEN p.reverses_payment_id IS NULL THEN p.amount ELSE -p.amount END)
        FROM fin.payments p WHERE p.payable_id = r.id), 0)`;
    const remainingExpr = `(r.principal - ${paidExpr})`;

    const result = await this.pool().query<{
      bucket: string;
      count: string;
      remaining: string;
      currency_code: string;
    }>(
      `SELECT ${bucketExpr} AS bucket,
              count(*)::text AS count,
              COALESCE(sum(${remainingExpr}), 0)::text AS remaining,
              r.currency_code
         FROM fin.payables r
        WHERE ${input.scopeClause}
        GROUP BY ${bucketExpr}, r.currency_code
        ORDER BY bucket, r.currency_code`,
      params,
    );
    return result.rows;
  }

  async listAll(): Promise<PayableRow[]> {
    const result = await this.pool().query<PayableRow>(
      `SELECT ${PAYABLE_RETURNING} FROM fin.payables ORDER BY created_at DESC`,
    );
    return result.rows;
  }

  async listInstallments(payableId: string): Promise<PayableInstallmentRow[]> {
    const result = await this.pool().query<PayableInstallmentRow>(
      `SELECT ${INSTALLMENT_RETURNING}
       FROM fin.payable_installments
       WHERE payable_id = $1
       ORDER BY installment_number`,
      [payableId],
    );
    return result.rows;
  }

  async listPayments(payableId: string): Promise<PaymentRow[]> {
    const result = await this.pool().query<PaymentRow>(
      `SELECT ${PAYMENT_RETURNING}
       FROM fin.payments
       WHERE payable_id = $1
       ORDER BY paid_at, created_at`,
      [payableId],
    );
    return result.rows;
  }

  /**
   * Leitura EM LOTE dos filhos de uma listagem — mesmo desenho do equivalente de recebiveis:
   * uma query por colecao em vez de uma por linha, preservando a ordenacao por linha.
   */
  async listInstallmentsByPayableIds(payableIds: string[]): Promise<PayableInstallmentRow[]> {
    if (payableIds.length === 0) {
      return [];
    }
    const result = await this.pool().query<PayableInstallmentRow>(
      `SELECT ${INSTALLMENT_RETURNING}
       FROM fin.payable_installments
       WHERE payable_id = ANY($1::uuid[])
       ORDER BY payable_id, installment_number`,
      [payableIds],
    );
    return result.rows;
  }

  async listPaymentsByPayableIds(payableIds: string[]): Promise<PaymentRow[]> {
    if (payableIds.length === 0) {
      return [];
    }
    const result = await this.pool().query<PaymentRow>(
      `SELECT ${PAYMENT_RETURNING}
       FROM fin.payments
       WHERE payable_id = ANY($1::uuid[])
       ORDER BY payable_id, paid_at, created_at`,
      [payableIds],
    );
    return result.rows;
  }

  async openOnClient(
    client: PoolClient,
    input: OpenPayablePersistenceInput,
  ): Promise<{ payable: PayableRow; installments: PayableInstallmentRow[]; idempotent: boolean }> {
    const existing = await client.query<PayableRow>(
      `SELECT ${PAYABLE_RETURNING}
       FROM fin.payables
       WHERE origin_kind = $1::fin.payable_origin_kind AND origin_id = $2`,
      [input.originKind, input.originId],
    );
    if (existing.rows[0]) {
      const installments = await this.listInstallmentsWithClient(client, existing.rows[0].id);
      return { payable: existing.rows[0], installments, idempotent: true };
    }

    const category = await client.query<ExpenseCategoryRow>(
      `SELECT ${CATEGORY_RETURNING} FROM fin.expense_categories WHERE id = $1 FOR UPDATE`,
      [input.expenseCategoryId],
    );
    if (!category.rows[0] || category.rows[0].status !== 'ACTIVE') {
      throw new PayableError('EXPENSE_CATEGORY_NOT_FOUND');
    }

    const payableId = randomUUID();
    const inserted = await client.query<PayableRow>(
      `INSERT INTO fin.payables (
         id, unit_id, counterparty_id, origin_kind, origin_id, origin_reference,
         expense_category_id, cost_center_id, cost_center_code,
         principal, currency_code, due_date, payment_terms, external_reference,
         created_by_identity_id, updated_by_identity_id
       )
       VALUES (
         $1, $2, $3, $4::fin.payable_origin_kind, $5, $6, $7, $8, $9, $10, $11, $12::date, $13, $14, $15, $15
       )
       RETURNING ${PAYABLE_RETURNING}`,
      [
        payableId,
        input.unitId,
        input.counterpartyId,
        input.originKind,
        input.originId,
        input.originReference,
        input.expenseCategoryId,
        input.costCenterId,
        input.costCenterCode,
        input.principal,
        input.currencyCode,
        input.dueDate,
        input.paymentTerms,
        input.externalReference,
        input.actorIdentityId,
      ],
    );
    const payable = inserted.rows[0]!;
    const installments: PayableInstallmentRow[] = [];
    for (const installment of input.installments) {
      const row = await client.query<PayableInstallmentRow>(
        `INSERT INTO fin.payable_installments (payable_id, installment_number, principal, due_date)
         VALUES ($1, $2, $3, $4::date)
         RETURNING ${INSTALLMENT_RETURNING}`,
        [payable.id, installment.installmentNumber, installment.principal, installment.dueDate],
      );
      installments.push(row.rows[0]!);
    }
    return { payable, installments, idempotent: false };
  }

  async open(
    input: OpenPayablePersistenceInput,
  ): Promise<{ payable: PayableRow; installments: PayableInstallmentRow[]; idempotent: boolean }> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const opened = await this.openOnClient(client, input);
      await client.query('COMMIT');
      return opened;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        const raced = await this.findByOrigin(input.originKind, input.originId);
        if (raced) {
          const installments = await this.listInstallments(raced.id);
          return { payable: raced, installments, idempotent: true };
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async pay(
    input: PayPayablePersistenceInput,
  ): Promise<{ payable: PayableRow; payment: PaymentRow; idempotent: boolean }> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<PayableRow>(
        `SELECT ${PAYABLE_RETURNING} FROM fin.payables WHERE id = $1 FOR UPDATE`,
        [input.payableId],
      );
      const payable = locked.rows[0];
      if (!payable) {
        throw new PayableError('PAYABLE_NOT_FOUND');
      }

      const cached = await client.query<PaymentRow>(
        `SELECT ${PAYMENT_RETURNING}
         FROM fin.payments
         WHERE payable_id = $1 AND idempotency_key = $2`,
        [input.payableId, input.idempotencyKey],
      );
      if (cached.rows[0]) {
        await client.query('COMMIT');
        return { payable, payment: cached.rows[0], idempotent: true };
      }

      assertPayableActive(payable.lifecycle);
      const version = classifyRowVersion(payable, input.rowVersion);
      if (version === 'mismatch') {
        throw new PayableError('PAYABLE_VERSION_CONFLICT');
      }

      const amount = assertPaymentAmount(input.amount);
      assertPaymentCurrency(payable.currency_code, input.currencyCode);

      const installments = await client.query<PayableInstallmentRow>(
        `SELECT ${INSTALLMENT_RETURNING}
         FROM fin.payable_installments
         WHERE payable_id = $1
         ORDER BY installment_number
         FOR UPDATE`,
        [payable.id],
      );
      if (installments.rows.length === 0) {
        throw new PayableError('PAYABLE_INSTALLMENT_NOT_FOUND');
      }

      const payments = await client.query<PaymentRow>(
        `SELECT ${PAYMENT_RETURNING}
         FROM fin.payments
         WHERE payable_id = $1
         FOR UPDATE`,
        [payable.id],
      );
      const posted = toPosted(payments.rows);
      assertNoOverpayment(payable.principal, posted, amount);

      const installment = resolveInstallment(installments.rows, input.installmentId, posted, amount);
      const installmentLocked = await client.query<PayableInstallmentRow>(
        `SELECT ${INSTALLMENT_RETURNING}
         FROM fin.payable_installments
         WHERE id = $1 AND payable_id = $2
         FOR UPDATE`,
        [installment.id, payable.id],
      );
      if (!installmentLocked.rows[0]) {
        throw new PayableError('PAYABLE_INSTALLMENT_NOT_FOUND');
      }
      assertNoInstallmentOverpayment(installment.principal, posted, installment.id, amount);

      const inserted = await client.query<PaymentRow>(
        `INSERT INTO fin.payments (
           payable_id, installment_id, kind, amount, currency_code, paid_at,
           idempotency_key, payment_reference, origin_kind, origin_id, origin_reference, actor_identity_id
         )
         VALUES (
           $1, $2, $3::fin.payment_kind, $4, $5, $6::timestamptz, $7, $8,
           $9::fin.payable_origin_kind, $10, $11, $12
         )
         RETURNING ${PAYMENT_RETURNING}`,
        [
          payable.id,
          installment.id,
          PAYMENT_KINDS.Payment,
          amount,
          payable.currency_code,
          input.paidAt,
          input.idempotencyKey,
          input.paymentReference,
          payable.origin_kind,
          payable.origin_id,
          payable.origin_reference,
          input.actorIdentityId,
        ],
      );

      const updated = await client.query<PayableRow>(
        `UPDATE fin.payables
         SET row_version = row_version + 1, updated_at = NOW(), updated_by_identity_id = $2
         WHERE id = $1
         RETURNING ${PAYABLE_RETURNING}`,
        [payable.id, input.actorIdentityId],
      );

      await client.query('COMMIT');
      return { payable: updated.rows[0]!, payment: inserted.rows[0]!, idempotent: false };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        const cached = await this.pool().query<PaymentRow>(
          `SELECT ${PAYMENT_RETURNING}
           FROM fin.payments
           WHERE payable_id = $1 AND idempotency_key = $2`,
          [input.payableId, input.idempotencyKey],
        );
        const payable = await this.findById(input.payableId);
        if (cached.rows[0] && payable) {
          return { payable, payment: cached.rows[0], idempotent: true };
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async reverse(
    input: ReversePaymentPersistenceInput,
  ): Promise<{ payable: PayableRow; payment: PaymentRow; idempotent: boolean }> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<PayableRow>(
        `SELECT ${PAYABLE_RETURNING} FROM fin.payables WHERE id = $1 FOR UPDATE`,
        [input.payableId],
      );
      const payable = locked.rows[0];
      if (!payable) {
        throw new PayableError('PAYABLE_NOT_FOUND');
      }

      const cached = await client.query<PaymentRow>(
        `SELECT ${PAYMENT_RETURNING}
         FROM fin.payments
         WHERE payable_id = $1 AND idempotency_key = $2`,
        [input.payableId, input.idempotencyKey],
      );
      if (cached.rows[0]) {
        await client.query('COMMIT');
        return { payable, payment: cached.rows[0], idempotent: true };
      }

      assertPayableActive(payable.lifecycle);
      const version = classifyRowVersion(payable, input.rowVersion);
      if (version === 'mismatch') {
        throw new PayableError('PAYABLE_VERSION_CONFLICT');
      }

      const original = await client.query<PaymentRow>(
        `SELECT ${PAYMENT_RETURNING}
         FROM fin.payments
         WHERE id = $1 AND payable_id = $2
         FOR UPDATE`,
        [input.paymentId, payable.id],
      );
      const source = original.rows[0];
      if (!source) {
        throw new PayableError('PAYMENT_NOT_FOUND');
      }
      if (source.kind !== PAYMENT_KINDS.Payment) {
        throw new PayableError('PAYMENT_IMMUTABLE');
      }

      const reversals = await client.query<PaymentRow>(
        `SELECT ${PAYMENT_RETURNING}
         FROM fin.payments
         WHERE reverses_payment_id = $1
         FOR UPDATE`,
        [source.id],
      );
      const amount = assertReversalAmount(
        source.amount,
        reversals.rows.map((row) => row.amount),
        input.amount ?? source.amount,
      );

      const inserted = await client.query<PaymentRow>(
        `INSERT INTO fin.payments (
           payable_id, installment_id, kind, amount, currency_code, paid_at,
           idempotency_key, payment_reference, origin_kind, origin_id, origin_reference,
           reverses_payment_id, actor_identity_id
         )
         VALUES (
           $1, $2, $3::fin.payment_kind, $4, $5, NOW(), $6, $7,
           $8::fin.payable_origin_kind, $9, $10, $11, $12
         )
         RETURNING ${PAYMENT_RETURNING}`,
        [
          payable.id,
          source.installment_id,
          PAYMENT_KINDS.Reversal,
          amount,
          payable.currency_code,
          input.idempotencyKey,
          input.paymentReference,
          payable.origin_kind,
          payable.origin_id,
          payable.origin_reference,
          source.id,
          input.actorIdentityId,
        ],
      );

      const updated = await client.query<PayableRow>(
        `UPDATE fin.payables
         SET row_version = row_version + 1, updated_at = NOW(), updated_by_identity_id = $2
         WHERE id = $1
         RETURNING ${PAYABLE_RETURNING}`,
        [payable.id, input.actorIdentityId],
      );

      await client.query('COMMIT');
      return { payable: updated.rows[0]!, payment: inserted.rows[0]!, idempotent: false };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        const cached = await this.pool().query<PaymentRow>(
          `SELECT ${PAYMENT_RETURNING}
           FROM fin.payments
           WHERE payable_id = $1 AND idempotency_key = $2`,
          [input.payableId, input.idempotencyKey],
        );
        const payable = await this.findById(input.payableId);
        if (cached.rows[0] && payable) {
          return { payable, payment: cached.rows[0], idempotent: true };
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async cancel(input: CancelPayablePersistenceInput): Promise<{ payable: PayableRow; idempotent: boolean }> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<PayableRow>(
        `SELECT ${PAYABLE_RETURNING} FROM fin.payables WHERE id = $1 FOR UPDATE`,
        [input.payableId],
      );
      const payable = locked.rows[0];
      if (!payable) {
        throw new PayableError('PAYABLE_NOT_FOUND');
      }
      if (payable.lifecycle === PAYABLE_LIFECYCLES.Cancelled) {
        await client.query('COMMIT');
        return { payable, idempotent: true };
      }
      const version = classifyRowVersion(payable, input.rowVersion);
      if (version === 'mismatch') {
        throw new PayableError('PAYABLE_VERSION_CONFLICT');
      }
      const payments = await client.query<PaymentRow>(
        `SELECT ${PAYMENT_RETURNING} FROM fin.payments WHERE payable_id = $1 FOR UPDATE`,
        [payable.id],
      );
      if (compareMoneyAmounts(netPaidAmount(toPosted(payments.rows)), '0') > 0) {
        throw new PayableError('PAYABLE_HAS_PAYMENTS');
      }
      const updated = await client.query<PayableRow>(
        `UPDATE fin.payables
         SET lifecycle = $2,
             cancelled_at = NOW(),
             cancelled_by_identity_id = $3,
             cancel_reason = $4,
             row_version = row_version + 1,
             updated_at = NOW(),
             updated_by_identity_id = $3
         WHERE id = $1
         RETURNING ${PAYABLE_RETURNING}`,
        [payable.id, PAYABLE_LIFECYCLES.Cancelled, input.actorIdentityId, input.cancelReason],
      );
      await client.query('COMMIT');
      return { payable: updated.rows[0]!, idempotent: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async listInstallmentsWithClient(
    client: PoolClient,
    payableId: string,
  ): Promise<PayableInstallmentRow[]> {
    const result = await client.query<PayableInstallmentRow>(
      `SELECT ${INSTALLMENT_RETURNING}
       FROM fin.payable_installments
       WHERE payable_id = $1
       ORDER BY installment_number`,
      [payableId],
    );
    return result.rows;
  }
}

function resolveInstallment(
  installments: PayableInstallmentRow[],
  installmentId: string | undefined,
  posted: PostedPayment[],
  amount: string,
): PayableInstallmentRow {
  if (installmentId) {
    const match = installments.find((item) => item.id === installmentId);
    if (!match) {
      throw new PayableError('PAYABLE_INSTALLMENT_NOT_FOUND');
    }
    return match;
  }
  const withCapacity = installments.find((item) => {
    try {
      assertNoInstallmentOverpayment(item.principal, posted, item.id, amount);
      return true;
    } catch {
      return false;
    }
  });
  if (!withCapacity) {
    throw new PayableError('PAYABLE_OVERPAYMENT');
  }
  return withCapacity;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
