import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * REGRESSAO DE ORDEM DE CLEANUP — `truncateServiceOrderTables`.
 *
 * DEFEITO QUE ESTE TESTE IMPEDE
 *
 * Run 39836194984, worker 2, `operational-dashboard.integration.spec.ts`:
 *
 *     update or delete on table "billing_records" violates foreign key constraint
 *     "billing_documents_billing_record_id_fkey"
 *
 * O helper removia `bil.billing_records` antes de `bil.billing_documents`, e a FK de `0025` e
 * RESTRICT (sem CASCADE). Bastava um teste anterior ter emitido documento fiscal para o
 * `beforeEach` do suite seguinte falhar deterministicamente — nao era concorrencia nem LPT.
 *
 * POR QUE UM TESTE ESTATICO E NAO SO INTEGRACAO
 *
 * O bug so aparece quando um teste anterior *deixa* documento. Depender disso deixa a regressao
 * visivel apenas em execucao completa, que e lenta e nao garante ordem entre arquivos. Este teste
 * le o proprio helper e o schema das migrations: se alguem reintroduzir pai-antes-de-filho, falha
 * imediatamente, sem precisar de banco.
 */
const repoRoot = resolve(__dirname, '../../../..');
const helperPath = join(repoRoot, 'packages/database/src/test-builders/service-order-builders.ts');
const helperSource = readFileSync(helperPath, 'utf8');

/**
 * SQL EXECUTAVEL — o fonte sem comentarios.
 *
 * As assercoes que procuram atalhos (`TRUNCATE CASCADE`, `session_replication_role`) precisam ver
 * apenas o que o Postgres recebe. Varrer o arquivo cru fazia o teste reprovar por causa dos
 * proprios comentarios que documentam a proibicao — um teste que falha por causa da documentacao
 * do que ele protege e um teste quebrado, nao um bug de producao.
 */
const executableSql = helperSource
  .replace(/\/\*[\s\S]*?\*\//g, '') // blocos /* */
  .replace(/^\s*\/\/.*$/gm, ''); // linhas //

/** Tabelas na ordem em que o helper as remove. */
function deletionOrder(): string[] {
  return [...helperSource.matchAll(/DELETE FROM\s+([a-z_]+\.[a-z_]+)/g)].map((m) => m[1]);
}

/**
 * FKs RESTRICT/SEM-CASCADE conhecidas, como `[filho, pai]`.
 *
 * Curado a partir das migrations, nao gerado: um gerador exigiria banco populado e o objetivo aqui
 * e falhar rapido no CI. Cada par abaixo tem a migration indicada no comentario.
 */
const RESTRICT_RELATIONSHIPS: Array<{ child: string; parent: string; source: string }> = [
  // 0025_billing_documents.sql: billing_record_id REFERENCES bil.billing_records(id)  (sem CASCADE)
  { child: 'bil.billing_documents', parent: 'bil.billing_records', source: '0025' },
  { child: 'bil.billing_document_items', parent: 'bil.billing_documents', source: '0025 (CASCADE)' },
  { child: 'bil.billing_document_history_events', parent: 'bil.billing_documents', source: '0025' },
  { child: 'bil.billing_document_command_idempotency', parent: 'bil.billing_documents', source: '0025' },
  { child: 'bil.billing_document_command_idempotency', parent: 'bil.billing_records', source: '0025' },
  // 0037_purchase_order_balance.sql: ON DELETE restrict
  { child: 'com.purchase_order_consumption_entries', parent: 'bil.billing_records', source: '0037' },
  // 0073_recurring_billing_schedule.sql: subject_service_order_id ON DELETE RESTRICT
  { child: 'bil.recurring_billing_schedules', parent: 'so.service_orders', source: '0073' },
  { child: 'bil.recurring_billing_periods', parent: 'bil.recurring_billing_schedules', source: '0073' },
];

describe('truncateServiceOrderTables — ordem de cleanup respeita FKs', () => {
  const order = deletionOrder();
  const positionOf = (table: string) => order.indexOf(table);

  it('remove todas as tabelas conhecidas do helper', () => {
    expect(order.length).toBeGreaterThan(20);
    expect(order).toContain('bil.billing_records');
    expect(order).toContain('bil.billing_documents');
    expect(order).toContain('so.service_orders');
  });

  it('nunca remove tabela inexistente no helper (sanidade da leitura)', () => {
    for (const table of order) {
      expect(table).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
    // Sem duplicatas: limpar duas vezes esconderia ordem errada.
    expect(new Set(order).size).toBe(order.length);
  });

  describe.each(RESTRICT_RELATIONSHIPS)(
    '$child deve sair ANTES de $parent ($source)',
    ({ child, parent }) => {
      it('respeita filho -> pai', () => {
        const childPos = positionOf(child);
        const parentPos = positionOf(parent);

        // Se o helper limpa o pai, o filho PRECISA estar na lista e vir primeiro.
        // A FK RESTRICT torna isso obrigatorio, nao opcional.
        if (parentPos >= 0) {
          expect(childPos, `${child} deve aparecer no helper`).toBeGreaterThanOrEqual(0);
          expect(
            childPos,
            `${child} (pos ${childPos}) deve vir antes de ${parent} (pos ${parentPos})`,
          ).toBeLessThan(parentPos);
        }
      });
    },
  );

  it('billing_documents sai antes de billing_records (defeito do run 39836194984)', () => {
    const docs = positionOf('bil.billing_documents');
    const records = positionOf('bil.billing_records');
    expect(docs).toBeGreaterThanOrEqual(0);
    expect(records).toBeGreaterThanOrEqual(0);
    expect(docs).toBeLessThan(records);
  });

  it('recurring_billing_periods sai antes de recurring_billing_schedules', () => {
    const periods = positionOf('bil.recurring_billing_periods');
    const schedules = positionOf('bil.recurring_billing_schedules');
    expect(periods).toBeGreaterThanOrEqual(0);
    expect(schedules).toBeGreaterThanOrEqual(0);
    expect(periods).toBeLessThan(schedules);
  });

  it('nao usa atalhos que escondem violacao de FK', () => {
    // TRUNCATE CASCADE, session_replication_role e similares apagariam estado fora do contrato do
    // helper e mascarariam ordem errada. O contrato e ordem explicita.
    //
    // IMPORTANTE: a checagem roda sobre o SQL REAL, nao sobre o texto do arquivo. A primeira
    // versao varria o fonte inteiro e falhava por causa dos proprios comentarios que documentam
    // (e recusam) estes atalhos — um teste que reprova a documentacao do que ele protege.
    expect(executableSql).not.toMatch(/TRUNCATE[\s\S]{0,40}CASCADE/i);
    expect(executableSql).not.toMatch(/session_replication_role/i);
    expect(executableSql).not.toMatch(/SET\s+CONSTRAINTS\s+ALL\s+DEFERRED/i);
    expect(executableSql).not.toMatch(/SET\s+session_replication_role/i);
  });
});
