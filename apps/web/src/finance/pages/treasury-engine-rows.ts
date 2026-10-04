import type { FinancialAccount } from '../types/finance.types';
import type { TreasuryReconciliation } from '../types/finance.types';

/**
 * Linha de conta financeira no formato que a engine consome.
 *
 * A engine indexa por NOME DE CAMPO do metadata store (`code`, `name`, `kind`,
 * `currency_code`, `lifecycle`, `created_at`), enquanto o DTO da API usa camelCase. Este
 * adaptador é o único lugar onde as duas nomenclaturas se encontram — mesmo padrão de
 * `budget-engine-rows.ts` e de `finance-engine-rows.ts`.
 *
 * A view `list` de `/api/v1/meta/treasury-accounts` declara exatamente
 * `code, name, kind, currency_code, lifecycle, created_at`. O adaptador preenche esses nomes e
 * mais nenhum: coluna que a view não declara não é desenhada.
 *
 * O SALDO não entra como coluna. Ele é reconstruído pelo servidor a cada leitura
 * (`toAccountResponse` soma os movimentos POSTED) e a tela o desenha fora da grade, no bloco de
 * reconciliação — passá-lo ao schema sugeriria que é campo do registro.
 */
export type TreasuryEngineRow = Record<string, unknown> & { id: string };

export function treasuryEngineRows(items: FinancialAccount[]): TreasuryEngineRow[] {
  return items.map((account) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    kind: account.kind,
    currency_code: account.currencyCode,
    lifecycle: account.lifecycle,
    created_at: account.createdAt,
    // Lidos pela TELA (fora da grade); a view `list` não os declara como coluna.
    balance: account.balance,
    row_version: account.rowVersion,
  }));
}

/**
 * Linha de RECONCILIAÇÃO publicada fora da grade.
 *
 * `TreasuryReconciliation` é um recurso separado do DTO da lista: créditos, débitos e contagem
 * de movimentos NÃO são colunas de `meta.fields` de treasury-accounts, e inventá-las no
 * metadado seria declarar campo que não existe no banco. A tela desenha esse bloco à parte,
 * exatamente como o detalhe da conta já faz.
 */
export type TreasuryReconciliationRow = {
  accountId: string;
  credits: string;
  debits: string;
  movementCount: number;
};

export function treasuryReconciliationRows(
  entries: Array<{ accountId: string; reconciliation: TreasuryReconciliation }>,
): TreasuryReconciliationRow[] {
  return entries.map((entry) => ({
    accountId: entry.accountId,
    credits: entry.reconciliation.credits,
    debits: entry.reconciliation.debits,
    movementCount: entry.reconciliation.movementCount,
  }));
}
