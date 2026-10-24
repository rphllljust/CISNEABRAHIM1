import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ECONOMIC_EVENT_KINDS } from './economic-event-contract';

/**
 * O ENUM DO TRANSPORTE PRECISA CONHECER TODO FATO DO CONTRATO.
 *
 * DEFEITO REAL QUE ESTE TESTE IMPEDE DE VOLTAR
 *
 * A F1.2 passou FISCAL, INVENTORY e PAYROLL a publicar o fato econômico pela outbox.
 * Esses fatos entram em `evt.domain_events`, cujo `event_type` é o enum PostgreSQL
 * `evt.domain_event_type`. A migration 0104 registrou apenas os QUATRO valores de
 * FINANCE; os demais produtores gravavam um rótulo que o enum não conhecia:
 *
 *   invalid input value for enum evt.domain_event_type: "FISCAL_DOCUMENT_AUTHORIZED"
 *
 * O efeito era o pior possível: o documento fiscal era AUTORIZADO e a publicação do
 * fato estourava. `plt.economic_events.event_kind` é `text` com CHECK (não enum),
 * então o LEDGER aceitava o valor — só o TRANSPORTE reprovava. O produtor parecia
 * pronto em revisão de código e quebrava na primeira autorização real.
 *
 * POR QUE LER AS MIGRATIONS E NÃO O BANCO
 *
 * Este teste roda sem PostgreSQL. Ele confronta o CONTRATO (`ECONOMIC_EVENT_KINDS`,
 * que é a fonte de verdade e tem sua própria prova em `economic-event-contract.spec`)
 * com o que as migrations DIZEM registrar. Um valor no contrato sem ALTER TYPE
 * correspondente é exatamente a divergência que causou o defeito.
 *
 * O `ci-database-gate` complementa isto aplicando as migrations de fato num banco
 * vazio e conferindo o schema resultante.
 */
describe('evt.domain_event_type — o enum do transporte conhece todo fato do contrato', () => {
  const migrationsDir = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'database', 'migrations');

  function registeredDomainEventTypes(): Set<string> {
    const values = new Set<string>();
    const filePattern = /ALTER TYPE "evt"\."domain_event_type" ADD VALUE IF NOT EXISTS '([A-Z_]+)'/g;

    for (const file of readdirSync(migrationsDir)) {
      if (!file.endsWith('.sql')) {
        continue;
      }
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      for (const match of sql.matchAll(filePattern)) {
        values.add(match[1]!);
      }
    }
    return values;
  }

  it('todo `ECONOMIC_EVENT_KINDS` tem um valor correspondente no enum do transporte', () => {
    const registered = registeredDomainEventTypes();
    const contractKinds = Object.values(ECONOMIC_EVENT_KINDS);

    // Fonte de verdade: o contrato tem 16 fatos (ver economic-event-contract.spec).
    expect(contractKinds).toHaveLength(16);

    const missing = contractKinds.filter((kind) => !registered.has(kind));
    expect(missing).toEqual([]);
  });

  it('o registro cobre FISCAL, INVENTORY, PAYROLL e FIXED_ASSET — não apenas FINANCE', () => {
    const registered = registeredDomainEventTypes();
    // Cada produtor da F1.2 precisa de ao menos um valor registrado; foi a ausência
    // destes que quebrou a primeira autorização fiscal em produção de desenvolvimento.
    for (const kind of [
      'FISCAL_DOCUMENT_AUTHORIZED',
      'FISCAL_DOCUMENT_CANCELLED',
      'TAX_CALCULATION_CONFIRMED',
      'INVENTORY_MOVEMENT_POSTED',
      'PAYROLL_CLOSED',
      'PAYROLL_REOPENED',
      'FIXED_ASSET_ACQUIRED',
      'FIXED_ASSET_DEPRECIATED',
    ]) {
      expect(registered.has(kind), `enum sem valor para ${kind}`).toBe(true);
    }
  });
});
