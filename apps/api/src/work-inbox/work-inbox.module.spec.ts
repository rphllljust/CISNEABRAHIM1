import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { WorkInboxService } from './services/work-inbox.service';
import { AccountingWorkSource } from './sources/accounting.source';
import { AlertsWorkSource } from './sources/alerts.source';
import { CommercialWorkSource } from './sources/commercial.source';
import { FinanceWorkSource } from './sources/finance.source';
import { WORK_ITEM_SOURCES, type WorkItemSource } from './sources/work-item-source';
import { WorkInboxModule } from './work-inbox.module';

/**
 * FIACAO DO MODULO (sem banco, sem consulta).
 *
 * O modulo publica as quatro fontes pelo token `WORK_ITEM_SOURCES`; se qualquer modulo dono deixar de
 * exportar o servico de acesso injetado (ou a lista do token se perder), a fila fica vazia em silencio
 * em producao. Este teste falha alto nesse caso: compila o grafo de injecao e confere quem esta na
 * lista, na ordem declarada.
 */
describe('WorkInboxModule wiring', () => {
  let module: TestingModule;

  beforeAll(async () => {
    applyAuthTestEnv('postgresql://cisne_local_dev:password@127.0.0.1:5432/cisne_local_test');
    module = await Test.createTestingModule({
      imports: [DatabaseModule, WorkInboxModule],
    }).compile();
  });

  afterAll(async () => {
    await module?.close();
  });

  it('publica as quatro fontes na lista do token WORK_ITEM_SOURCES', () => {
    const sources = module.get<WorkItemSource[]>(WORK_ITEM_SOURCES);

    expect(sources).toHaveLength(4);
    expect(sources.map((source) => source.domain)).toEqual([
      'OPERACOES',
      'FINANCEIRO',
      'CONTABILIDADE',
      'COMERCIAL',
    ]);
    expect(sources[0]).toBeInstanceOf(AlertsWorkSource);
    expect(sources[1]).toBeInstanceOf(FinanceWorkSource);
    expect(sources[2]).toBeInstanceOf(AccountingWorkSource);
    expect(sources[3]).toBeInstanceOf(CommercialWorkSource);
  });

  it('injeta a mesma lista no servico da fila (uma instancia por fonte)', () => {
    const service = module.get(WorkInboxService);
    const sources = module.get<WorkItemSource[]>(WORK_ITEM_SOURCES);

    expect(service).toBeDefined();
    expect(sources[0]).toBe(module.get(AlertsWorkSource));
    expect(sources[1]).toBe(module.get(FinanceWorkSource));
    expect(sources[2]).toBe(module.get(AccountingWorkSource));
    expect(sources[3]).toBe(module.get(CommercialWorkSource));
  });
});
