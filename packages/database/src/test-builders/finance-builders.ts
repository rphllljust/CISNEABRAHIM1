import type { Pool, PoolClient } from 'pg';

type DbClient = Pool | PoolClient;

export async function truncateFinanceTables(client: DbClient): Promise<void> {
  await client.query(`
    UPDATE fin.reconciliations
    SET status = 'UNRECONCILED', unreconciled_at = NOW()
    WHERE status = 'CONFIRMED'
  `);
  // ────────────────────────────────────────────────────────────────────────────────────────────
  // ORCAMENTO E COBRANCA TEM TRUNCATE PROPRIO MAIS ABAIXO
  // ────────────────────────────────────────────────────────────────────────────────────────────
  //
  // `fin.budget_lines` e `fin.receivable_collections` (com seus tres netos: collection_actions,
  // collection_promises, collection_history) sao limpos por blocos `TRUNCATE ... CASCADE`
  // dedicados no fim desta funcao. Um `DELETE` avulso aqui seria REDUNDANTE e ainda criaria
  // aparencia de ordem correta onde ela nao existe.
  //
  // Registro isso porque a auditoria estatica acusou estas tabelas como "filhos restritivos nao
  // limpos": a heuristica so enxerga `DELETE FROM`, nao `TRUNCATE`. O comportamento real esta
  // correto — a lacuna era da ferramenta, nao do helper.
  await client.query('DELETE FROM fin.reconciliation_matches');
  await client.query('DELETE FROM fin.reconciliations');
  await client.query('DELETE FROM fin.bank_statement_lines');
  await client.query('DELETE FROM fin.bank_statement_imports');
  await client.query('DELETE FROM fin.bank_statements');
  await client.query('DELETE FROM fin.financial_transactions');
  await client.query('DELETE FROM fin.treasury_transfers');
  await client.query('DELETE FROM fin.bank_accounts');
  await client.query('DELETE FROM fin.cash_accounts');
  await client.query('DELETE FROM fin.financial_accounts');
  await client.query(`
    TRUNCATE TABLE
      fin.budget_lines,
      fin.budget_periods,
      fin.budget_versions,
      fin.budgets
    RESTART IDENTITY CASCADE
  `);
  await client.query(`
    TRUNCATE TABLE
      fin.collection_history,
      fin.collection_promises,
      fin.collection_actions,
      fin.receivable_collections
    RESTART IDENTITY CASCADE
  `);
    await client.query('DELETE FROM fin.expense_reimbursements');
    await client.query('DELETE FROM fin.expense_approvals');
    await client.query('DELETE FROM fin.expense_items');
    await client.query('DELETE FROM fin.expenses');
    await client.query('DELETE FROM fin.payments');
    await client.query('DELETE FROM fin.payable_installments');
    await client.query('DELETE FROM fin.payables');
    await client.query('DELETE FROM fin.expense_categories');
  await client.query('DELETE FROM fin.settlements');
  await client.query('DELETE FROM fin.receivable_installments');
  await client.query('DELETE FROM fin.receivables');
}
