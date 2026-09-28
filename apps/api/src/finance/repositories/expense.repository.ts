import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { PAYABLE_ORIGIN_KINDS } from '../domain/payable';
import { EXPENSE_STATUSES, ExpenseError } from '../domain/expense';
import { ExpenseFailureInjection } from '../domain/expense-failure-injection';
import { PayablesRepository } from './payables.repository';
import type {
  CreateExpensePersistenceInput,
  DecideExpensePersistenceInput,
  ExpenseApprovalRow,
  ExpenseItemRow,
  ExpenseReimbursementRow,
  ExpenseRow,
} from './expense.repository.types';

const EXPENSE_RETURNING = `
  id, unit_id, requester_identity_id, expense_category_id, cost_center_id, cost_center_code,
  total_amount::text AS total_amount, currency_code, due_date::text AS due_date, payment_terms,
  description, receipt_document_id, reimbursable, status::text AS status, version, idempotency_key,
  created_at, updated_at, created_by_identity_id, updated_by_identity_id
`;

const ITEM_RETURNING = `
  id, expense_id, line_number, description, amount::text AS amount
`;

const APPROVAL_RETURNING = `
  id, expense_id, decision::text AS decision, actor_identity_id, approval_rule_id, reason, decided_at
`;

const REIMBURSEMENT_RETURNING = `
  id, expense_id, payable_id, amount::text AS amount, currency_code, created_at
`;

export type ExpenseAggregate = {
  expense: ExpenseRow;
  items: ExpenseItemRow[];
  approval: ExpenseApprovalRow | null;
  reimbursement: ExpenseReimbursementRow | null;
};

@Injectable()
export class ExpenseRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly payables: PayablesRepository,
  ) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findOwnedByIdempotencyKey(
    idempotencyKey: string,
    requesterIdentityId: string,
    unitId: string,
  ): Promise<ExpenseAggregate | null> {
    // Idempotency replay is scoped to the requester + unit that originally
    // created the expense, so a caller can never read back an expense owned
    // by another identity/unit that happens to reuse the same key.
    const result = await this.pool().query<ExpenseRow>(
      `SELECT ${EXPENSE_RETURNING}
       FROM fin.expenses
       WHERE idempotency_key = $1 AND requester_identity_id = $2 AND unit_id = $3`,
      [idempotencyKey, requesterIdentityId, unitId],
    );
    if (!result.rows[0]) {
      return null;
    }
    return this.loadAggregate(result.rows[0].id);
  }

  async findById(expenseId: string): Promise<ExpenseAggregate | null> {
    return this.loadAggregate(expenseId);
  }

  /**
   * Página de despesas sob o MESMO predicado da contagem. A linha é um resumo do próprio registro
   * (descrição, centro de custo, valor, vencimento e estado) — sem junções e sem dado de outro
   * contexto.
   */
  async listPage(input: {
    whereClause: string;
    params: unknown[];
    limit: number;
    offset: number;
  }): Promise<ExpenseRow[]> {
    const result = await this.pool().query<ExpenseRow>(
      `SELECT ${EXPENSE_RETURNING}
       FROM fin.expenses
       WHERE ${input.whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${input.params.length + 1}
       OFFSET $${input.params.length + 2}`,
      [...input.params, input.limit, input.offset],
    );
    return result.rows;
  }

  async countList(whereClause: string, params: unknown[]): Promise<number> {
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM fin.expenses WHERE ${whereClause}`,
      params,
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async documentExists(documentId: string): Promise<boolean> {
    const result = await this.pool().query<{ id: string }>(
      `SELECT id FROM rpt.read_documents WHERE id = $1`,
      [documentId],
    );
    return Boolean(result.rows[0]);
  }

  async create(input: CreateExpensePersistenceInput): Promise<ExpenseAggregate> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const category = await client.query<{ id: string; status: string }>(
        `SELECT id, status::text AS status FROM fin.expense_categories WHERE id = $1 FOR UPDATE`,
        [input.expenseCategoryId],
      );
      if (!category.rows[0] || category.rows[0].status !== 'ACTIVE') {
        throw new ExpenseError('EXPENSE_CATEGORY_NOT_FOUND');
      }
      const inserted = await client.query<ExpenseRow>(
        `INSERT INTO fin.expenses (
           unit_id, requester_identity_id, expense_category_id, cost_center_id, cost_center_code,
           total_amount, currency_code, due_date, payment_terms, description, receipt_document_id,
           reimbursable, idempotency_key, created_by_identity_id, updated_by_identity_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, $11, $12, $13, $14, $14)
         RETURNING ${EXPENSE_RETURNING}`,
        [
          input.unitId,
          input.requesterIdentityId,
          input.expenseCategoryId,
          input.costCenterId,
          input.costCenterCode,
          input.totalAmount,
          input.currencyCode,
          input.dueDate,
          input.paymentTerms,
          input.description,
          input.receiptDocumentId,
          input.reimbursable,
          input.idempotencyKey,
          input.actorIdentityId,
        ],
      );
      const expense = inserted.rows[0]!;
      let line = 0;
      for (const item of input.items) {
        line += 1;
        await client.query(
          `INSERT INTO fin.expense_items (expense_id, line_number, description, amount)
           VALUES ($1, $2, $3, $4)`,
          [expense.id, line, item.description, item.amount],
        );
      }
      await client.query('COMMIT');
      return (await this.loadAggregate(expense.id))!;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        // The unique idempotency_key was taken. Replay only when the winner is
        // the same requester+unit (a concurrent retry of this very request);
        // a key owned by a different requester/unit is a conflict, never a
        // silent read-back of another identity's expense.
        const raced = await this.findOwnedByIdempotencyKey(
          input.idempotencyKey,
          input.requesterIdentityId,
          input.unitId,
        );
        if (raced) {
          return raced;
        }
        throw new ExpenseError('EXPENSE_IDEMPOTENCY_KEY_CONFLICT');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async submit(expenseId: string, expectedVersion: number): Promise<ExpenseAggregate | 'VERSION_CONFLICT' | null> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await this.lockExpense(client, expenseId);
      if (!locked) {
        await client.query('ROLLBACK');
        return null;
      }
      if (locked.version !== expectedVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (locked.status !== EXPENSE_STATUSES.Draft) {
        throw new ExpenseError('EXPENSE_INVALID_STATE');
      }
      if (!locked.receipt_document_id) {
        throw new ExpenseError('EXPENSE_RECEIPT_REQUIRED');
      }
      const updated = await client.query<ExpenseRow>(
        `UPDATE fin.expenses
         SET status = 'SUBMITTED', version = version + 1, updated_at = NOW()
         WHERE id = $1 AND version = $2
         RETURNING ${EXPENSE_RETURNING}`,
        [expenseId, expectedVersion],
      );
      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      await client.query('COMMIT');
      return (await this.loadAggregate(expenseId))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async decide(
    input: DecideExpensePersistenceInput,
    failures?: ExpenseFailureInjection,
  ): Promise<ExpenseAggregate | 'VERSION_CONFLICT' | 'REPLAY' | null> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await this.lockExpense(client, input.expenseId);
      if (!locked) {
        await client.query('ROLLBACK');
        return null;
      }
      if (locked.status === EXPENSE_STATUSES.Approved || locked.status === EXPENSE_STATUSES.Rejected) {
        await client.query('COMMIT');
        return 'REPLAY';
      }
      if (locked.version !== input.expectedVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (locked.status !== EXPENSE_STATUSES.Submitted) {
        throw new ExpenseError('EXPENSE_INVALID_STATE');
      }

      await client.query(
        `INSERT INTO fin.expense_approvals (expense_id, decision, actor_identity_id, approval_rule_id, reason)
         VALUES ($1, $2::fin.expense_approval_decision, $3, $4, $5)`,
        [locked.id, input.decision, input.actorIdentityId, input.approvalRuleId, input.reason],
      );

      if (input.decision === 'APPROVED' && locked.reimbursable && input.openPayable) {
        const opened = await this.payables.openOnClient(client, {
          unitId: input.openPayable.unitId,
          counterpartyId: input.openPayable.counterpartyId,
          originKind: PAYABLE_ORIGIN_KINDS.OperationalExpense,
          originId: locked.id,
          originReference: `EXP-${locked.id.slice(0, 8)}`,
          expenseCategoryId: input.openPayable.expenseCategoryId,
          costCenterId: input.openPayable.costCenterId,
          costCenterCode: input.openPayable.costCenterCode,
          principal: input.openPayable.principal,
          currencyCode: input.openPayable.currencyCode,
          dueDate: input.openPayable.dueDate,
          paymentTerms: input.openPayable.paymentTerms,
          externalReference: null,
          actorIdentityId: input.actorIdentityId,
          installments: [
            {
              installmentNumber: 1,
              principal: input.openPayable.principal,
              dueDate: input.openPayable.dueDate,
            },
          ],
        });
        await client.query(
          `INSERT INTO fin.expense_reimbursements (expense_id, payable_id, amount, currency_code)
           VALUES ($1, $2, $3, $4)`,
          [locked.id, opened.payable.id, opened.payable.principal, opened.payable.currency_code],
        );
      }

      const updated = await client.query<ExpenseRow>(
        `UPDATE fin.expenses
         SET status = $2::fin.expense_status, version = version + 1, updated_at = NOW(),
             updated_by_identity_id = $3
         WHERE id = $1 AND version = $4
         RETURNING ${EXPENSE_RETURNING}`,
        [locked.id, input.decision, input.actorIdentityId, input.expectedVersion],
      );
      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      failures?.consume('after_expense_approval');
      await client.query('COMMIT');
      return (await this.loadAggregate(locked.id))!;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        const current = await this.loadAggregate(input.expenseId);
        if (current && current.expense.status !== EXPENSE_STATUSES.Submitted) {
          return 'REPLAY';
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockExpense(client: PoolClient, expenseId: string): Promise<ExpenseRow | null> {
    const result = await client.query<ExpenseRow>(
      `SELECT ${EXPENSE_RETURNING} FROM fin.expenses WHERE id = $1 FOR UPDATE`,
      [expenseId],
    );
    return result.rows[0] ?? null;
  }

  private async loadAggregate(expenseId: string): Promise<ExpenseAggregate | null> {
    const expense = await this.pool().query<ExpenseRow>(
      `SELECT ${EXPENSE_RETURNING} FROM fin.expenses WHERE id = $1`,
      [expenseId],
    );
    if (!expense.rows[0]) {
      return null;
    }
    const [items, approval, reimbursement] = await Promise.all([
      this.pool().query<ExpenseItemRow>(
        `SELECT ${ITEM_RETURNING} FROM fin.expense_items WHERE expense_id = $1 ORDER BY line_number`,
        [expenseId],
      ),
      this.pool().query<ExpenseApprovalRow>(
        `SELECT ${APPROVAL_RETURNING} FROM fin.expense_approvals WHERE expense_id = $1`,
        [expenseId],
      ),
      this.pool().query<ExpenseReimbursementRow>(
        `SELECT ${REIMBURSEMENT_RETURNING} FROM fin.expense_reimbursements WHERE expense_id = $1`,
        [expenseId],
      ),
    ]);
    return {
      expense: expense.rows[0],
      items: items.rows,
      approval: approval.rows[0] ?? null,
      reimbursement: reimbursement.rows[0] ?? null,
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
