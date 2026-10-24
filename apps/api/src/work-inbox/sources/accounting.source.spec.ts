import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PERIOD_STATUSES } from '../../accounting/domain/ledger';
import type { PeriodResponse } from '../../accounting/serializers/accounting-response.serializer';
import type { ClosingException } from '../../accounting/services/closing-readiness.service';
import { AccountingWorkSource, describeBlockers, toClosingWorkItem } from './accounting.source';

/**
 * FONTE CONTABIL — comportamento vinculante.
 *
 * O que estes testes protegem (sem banco):
 * - o item e DERIVADO da prontidao real: sem bloqueador persistido nao existe item;
 * - chave logica `CONTABILIDADE:CLOSING:<unitId>:<periodId>` e referencia humana (codigo da competencia);
 * - `reason` lista os codigos e as contagens REAIS dos bloqueadores;
 * - unidade/periodo sem autorizacao nao geram item nem sinal de existencia.
 */

const ACTOR = { identityId: 'identity-1', sessionId: 'session-1' };
const PERIOD_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function period(overrides: Partial<PeriodResponse> = {}): PeriodResponse {
  return {
    id: PERIOD_ID,
    chartId: 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    unitId: 'UN-A',
    code: '2026-09',
    startsOn: '2026-09-01',
    endsOn: '2026-09-30',
    status: PERIOD_STATUSES.Open,
    reopenCount: 0,
    rowVersion: 1,
    closedAt: null,
    reopenedAt: null,
    closeChecks: [],
    ...overrides,
  };
}

function blocker(overrides: Partial<ClosingException> = {}): ClosingException {
  return {
    kind: 'ACCOUNTING',
    severity: 'BLOCKING',
    observedCount: 2,
    detail: 'Draft journals remain in the period.',
    area: 'accounting',
    drilldown: { path: '/app/accounting/journals', label: 'Ver lançamentos não postados' },
    ...overrides,
  };
}

describe('accounting source — bloqueador real de fechamento', () => {
  it('deriva um BLOCKER por competencia, com codigo humano e rota real do fechamento', () => {
    const item = toClosingWorkItem({
      unitId: 'UN-A',
      period: period(),
      blockers: [blocker()],
    });

    expect(item).toMatchObject({
      id: `CONTABILIDADE:CLOSING:UN-A:${PERIOD_ID}`,
      domain: 'CONTABILIDADE',
      kind: 'BLOCKER',
      businessReference: '2026-09',
      status: PERIOD_STATUSES.Open,
      dueAt: null,
      occurredAt: '2026-09-30T00:00:00.000Z',
      targetRoute: '/app/closing',
      unitId: 'UN-A',
    });
    expect(item?.businessReference).not.toContain(PERIOD_ID);
    expect(item?.reason).toContain('ACCOUNTING');
    expect(item?.reason).toContain('2');
    expect(item?.reason).toContain('Draft journals remain in the period.');
  });

  it('sem bloqueador real nao existe item — a fila nao inventa pendencia de fechamento', () => {
    expect(
      toClosingWorkItem({ unitId: 'UN-A', period: period(), blockers: [] }),
    ).toBeNull();
  });

  it('competencia sem fim legivel omite o item em vez de inventar data', () => {
    expect(
      toClosingWorkItem({
        unitId: 'UN-A',
        period: period({ endsOn: '30/09/2026' }),
        blockers: [blocker()],
      }),
    ).toBeNull();
  });

  it('lista todos os bloqueadores devolvidos pelo servico, um a um', () => {
    const reason = describeBlockers([
      blocker(),
      blocker({ kind: 'FISCAL', observedCount: 3, detail: 'Fiscal documents not authorized.' }),
    ]);

    expect(reason).toContain('ACCOUNTING: 2 pendência(s)');
    expect(reason).toContain('FISCAL: 3 pendência(s)');
  });
});

describe('accounting source — leitura e autorizacao', () => {
  function build(input: {
    units: string[];
    periods: (query: { unitId: string; status: string }) => Promise<{
      unitId: string;
      items: PeriodResponse[];
    }>;
    readiness: (query: { unitId: string; periodId: string }) => Promise<{
      unitId: string;
      period: PeriodResponse;
      blockers: ClosingException[];
    }>;
  }) {
    const scopeContext = { listUnitScopeRefs: vi.fn().mockResolvedValue(input.units) };
    const accountingAccess = {
      listPeriodsByUnit: vi.fn((_actor: unknown, query: { unitId: string; status: string }) =>
        input.periods(query),
      ),
    };
    const closingReadiness = {
      readiness: vi.fn((_actor: unknown, query: { unitId: string; periodId: string }) =>
        input.readiness(query),
      ),
    };
    /**
     * F1.1 — o read model de posting é dependência da fonte. Por padrão devolve fila
     * vazia: os testes de fechamento abaixo medem SÓ o comportamento de fechamento.
     * Os testes de exceção de contabilização injetam um read model com itens.
     */
    const economicTrace = {
      worklist: vi.fn().mockResolvedValue({
        counts: { pending: 0, failed: 0, reversed: 0 },
        items: [],
        limit: 50,
        offset: 0,
        total: 0,
      }),
    };
    return {
      scopeContext,
      accountingAccess,
      closingReadiness,
      economicTrace,
      source: new AccountingWorkSource(
        closingReadiness as never,
        accountingAccess as never,
        scopeContext as never,
        economicTrace as never,
      ),
    };
  }

  it('le somente competencias ABERTAS da unidade, pela autoridade contabil', async () => {
    const { accountingAccess, closingReadiness, source } = build({
      units: ['UN-A'],
      periods: async () => ({ unitId: 'UN-A', items: [period()] }),
      readiness: async (query) => ({
        unitId: query.unitId,
        period: period(),
        blockers: [blocker()],
      }),
    });

    const items = await source.collect(ACTOR);

    expect(accountingAccess.listPeriodsByUnit).toHaveBeenCalledWith(ACTOR, {
      unitId: 'UN-A',
      status: PERIOD_STATUSES.Open,
    });
    expect(closingReadiness.readiness).toHaveBeenCalledWith(ACTOR, {
      unitId: 'UN-A',
      periodId: PERIOD_ID,
    });
    expect(items).toHaveLength(1);
  });

  it('unidade fora do escopo nao gera item nem contagem, e as demais seguem completas', async () => {
    const { source } = build({
      units: ['UN-A', 'UN-B'],
      periods: async (query) => {
        if (query.unitId === 'UN-B') {
          throw new HttpException('Access denied.', 403);
        }
        return { unitId: query.unitId, items: [period({ id: 'unit-a-period' })] };
      },
      readiness: async (query) => ({
        unitId: query.unitId,
        period: period({ id: 'unit-a-period' }),
        blockers: [blocker()],
      }),
    });

    const items = await source.collect(ACTOR);

    expect(items.map((item) => item.id)).toEqual(['CONTABILIDADE:CLOSING:UN-A:unit-a-period']);
  });

  it('periodo invisivel para o ator (404 do dominio) e descartado sem sinal', async () => {
    const { source } = build({
      units: ['UN-A'],
      periods: async () => ({ unitId: 'UN-A', items: [period()] }),
      readiness: async () => {
        throw new HttpException('Accounting journal not found.', 404);
      },
    });

    await expect(source.collect(ACTOR)).resolves.toEqual([]);
  });

  it('falha real na avaliacao do fechamento nao vira fila vazia', async () => {
    const { source } = build({
      units: ['UN-A'],
      periods: async () => ({ unitId: 'UN-A', items: [period()] }),
      readiness: async () => {
        throw new HttpException('Unexpected accounting error.', 500);
      },
    });

    await expect(source.collect(ACTOR)).rejects.toThrow('Unexpected accounting error.');
  });

  /**
   * F1.1 — EXCEÇÕES DE CONTABILIZAÇÃO NA FILA DE TRABALHO.
   *
   * O valor da fase não está em ter uma tela nova: está em a divergência aparecer no
   * MESMO lugar onde o operador já trabalha. Estes testes provam que a fonte contábil
   * publica o fato sem journal e que a chave lógica impede duplicação.
   */
  it('publica exceção de contabilização como item de trabalho', async () => {
    const { source, economicTrace } = build({
      units: ['UN-A'],
      periods: async () => ({ unitId: 'UN-A', items: [] }),
      readiness: async () => ({ unitId: 'UN-A', period: period(), blockers: [] }),
    });
    economicTrace.worklist.mockResolvedValue({
      counts: { pending: 0, failed: 1, reversed: 0 },
      items: [
        {
          factKind: 'SETTLEMENT',
          factId: 'settlement-1',
          unitId: 'UN-A',
          reference: 'RECEIVABLE_SETTLEMENT 12345678',
          amount: '500.0000',
          currencyCode: 'BRL',
          financialState: 'SETTLED',
          accountingState: 'FAILED',
          situation: 'ATTENTION',
          severity: 'CRITICAL',
          reason: 'Contabilização falhou após 3 tentativa(s): ACCOUNTING_RULE_NOT_CONFIGURED',
          firstFailedAt: '2026-10-15T10:00:00.000Z',
          attempts: 3,
          nextAction: {
            command: 'RETRY_POSTING',
            label: 'Reprocessar contabilização',
            reason: 'A contabilização falhou.',
            owner: 'accounting:posting-request',
          },
          availableCommands: ['RETRY_POSTING'],
          route: '/app/accounting/economic-trace/settlement/settlement-1',
        },
      ],
      limit: 50,
      offset: 0,
      total: 1,
    });

    const items = await source.collect(ACTOR);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'CONTABILIDADE:POSTING:SETTLEMENT:settlement-1',
      domain: 'CONTABILIDADE',
      kind: 'EXCEPTION',
      title: 'Liquidação sem contabilização',
      actionLabel: 'Reprocessar contabilização',
      targetRoute: '/app/accounting/economic-trace/settlement/settlement-1',
      unitId: 'UN-A',
    });
  });

  it('a mesma exceção nunca entra duas vezes na fila', async () => {
    const { source, economicTrace } = build({
      units: ['UN-A', 'UN-A'],
      periods: async () => ({ unitId: 'UN-A', items: [] }),
      readiness: async () => ({ unitId: 'UN-A', period: period(), blockers: [] }),
    });
    economicTrace.worklist.mockResolvedValue({
      counts: { pending: 0, failed: 1, reversed: 0 },
      items: [
        {
          factKind: 'SETTLEMENT',
          factId: 'settlement-1',
          unitId: 'UN-A',
          reference: 'REF',
          amount: '10.0000',
          currencyCode: 'BRL',
          financialState: 'SETTLED',
          accountingState: 'FAILED',
          situation: 'ATTENTION',
          severity: 'CRITICAL',
          reason: 'Falhou',
          firstFailedAt: null,
          attempts: 1,
          nextAction: { command: null, label: 'Ver', reason: '-', owner: null },
          availableCommands: [],
          route: '/app/accounting/economic-trace/settlement/settlement-1',
        },
      ],
      limit: 50,
      offset: 0,
      total: 1,
    });

    const items = await source.collect(ACTOR);
    expect(items).toHaveLength(1);
  });

  it('leitura negada do recorte de posting nao inventa item nem derruba a fonte', async () => {
    const { source, economicTrace } = build({
      units: ['UN-A'],
      periods: async () => ({ unitId: 'UN-A', items: [period()] }),
      readiness: async (query) => ({
        unitId: query.unitId,
        period: period(),
        blockers: [blocker()],
      }),
    });
    economicTrace.worklist.mockRejectedValue(new HttpException('Access denied.', 403));

    const items = await source.collect(ACTOR);

    // Nenhum item de posting, mas o bloqueador de fechamento continua na fila.
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toContain('CLOSING');
  });
});
