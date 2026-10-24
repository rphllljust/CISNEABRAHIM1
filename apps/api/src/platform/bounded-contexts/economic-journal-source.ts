/**
 * F1.1 — VOCABULÁRIO DE ORIGEM DO LANÇAMENTO (ESPELHO DE CONTRATO).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * `JournalSourceKind` é vocabulário de ACCOUNTING e vive em
 * `accounting/domain/ledger.ts`. O contrato de evento econômico vive em
 * `platform/bounded-contexts/`. Se o contrato importasse o tipo de ACCOUNTING, o
 * grafo de dependências registraria `PLATFORM → ACCOUNTING` — seta proibida, e o gate
 * `module-boundary-rules.spec.ts` falha o build. Foi exatamente o que aconteceu na
 * primeira versão deste contrato, e o gate estava certo.
 *
 * A solução NÃO é afrouxar a regra de fronteira nem mover o contrato para dentro de
 * ACCOUNTING (o produtor é FINANCE). É declarar aqui o MÍNIMO que a fronteira
 * precisa — a lista de origens de lançamento — e provar por TESTE que este espelho
 * e a fonte real de ACCOUNTING são idênticos. Divergência futura quebra o teste, não
 * a arquitetura.
 *
 * Este arquivo NÃO contém regra contábil. É vocabulário compartilhado.
 */

/** Espelho estável de `JOURNAL_SOURCE_KINDS` (`accounting/domain/ledger.ts`). */
export const ECONOMIC_JOURNAL_SOURCE_KINDS = {
  Manual: 'MANUAL',
  Billing: 'BILLING',
  Settlement: 'SETTLEMENT',
  Payment: 'PAYMENT',
  Inventory: 'INVENTORY',
  Payroll: 'PAYROLL',
  Tax: 'TAX',
  FixedAsset: 'FIXED_ASSET',
} as const;

export type JournalSourceKind =
  (typeof ECONOMIC_JOURNAL_SOURCE_KINDS)[keyof typeof ECONOMIC_JOURNAL_SOURCE_KINDS];
