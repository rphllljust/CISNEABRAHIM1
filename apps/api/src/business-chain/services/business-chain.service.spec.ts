import { describe, expect, it, vi } from 'vitest';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { AuthzEvaluationRequest } from '../../authorization/types/authz-decision';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { BusinessChainRepository } from '../repositories/business-chain.repository';
import type { ChainNodeFactRow } from '../repositories/business-chain.repository';
import { BusinessChainService, resolveRelation } from './business-chain.service';

/**
 * FRONTEIRA DE AUTORIZACAO DA CADEIA.
 *
 * Prova que o backend e o boundary: o no nao autorizado NAO EXISTE na resposta — sem rotulo,
 * sem contagem, sem placeholder e sem sinal de existencia. Prova tambem que a cadeia nao faz
 * N+1 e que a relacao de cada no vem do caminho real resolvido, nunca de heuristica.
 */

function fact(partial: Partial<ChainNodeFactRow> & Pick<ChainNodeFactRow, 'kind' | 'entity_id'>): ChainNodeFactRow {
  return {
    business_reference: `REF-${partial.entity_id}`,
    status: 'ACTIVE',
    occurred_at: '2026-01-01T00:00:00.000Z',
    unit_id: 'UNIDADE-1',
    client_id: 'cliente-1',
    context_id: null,
    summary: 'fato persistido',
    ...partial,
  };
}

function buildService(options: {
  facts: ChainNodeFactRow[];
  allowed?: (request: AuthzEvaluationRequest) => boolean;
}) {
  const resolveSpine = vi.fn(async () =>
    options.facts.map((row) => ({ kind: row.kind, entityId: row.entity_id })),
  );
  const loadNodeFacts = vi.fn(async (_entityIds: string[]) => options.facts);
  const decide = vi.fn(
    async (_actor: unknown, request: AuthzEvaluationRequest, _options?: { audit?: boolean }) => ({
      result: (options.allowed ? options.allowed(request) : true) ? 'ALLOW' : 'DENY',
      reasonCode: 'ALLOW',
      action: request.action,
      resourceType: request.resourceType,
    }),
  );

  const service = new BusinessChainService(
    { resolveSpine, loadNodeFacts } as unknown as BusinessChainRepository,
    { decide } as unknown as PolicyDecisionPointService,
  );

  return { service, resolveSpine, loadNodeFacts, decide };
}

const ACTOR = { identityId: 'identidade-1', sessionId: 'sessao-1' };

describe('business chain — autorizacao negativa', () => {
  it('omite o no nao autorizado por completo: sem rotulo, sem contagem, sem placeholder', async () => {
    const facts = [
      fact({ kind: 'SERVICE_ORDER', entity_id: 'so-1', business_reference: 'OS-2026-0184' }),
      fact({ kind: 'ACCOUNTING_ENTRY', entity_id: 'j-1', business_reference: 'Lançamento 42', status: 'POSTED' }),
    ];
    const { service } = buildService({
      facts,
      allowed: (request) => request.resourceType !== AUTHZ_RESOURCE_TYPES.AccountingLedger,
    });

    const chain = await service.getChain(ACTOR, 'SERVICE_ORDER', 'so-1');

    expect(chain.nodes.map((entry) => entry.kind)).toEqual(['SERVICE_ORDER']);
    const serialized = JSON.stringify(chain);
    expect(serialized).not.toContain('Lançamento');
    expect(serialized).not.toContain('j-1');
    expect(serialized).not.toContain('ocult');
  });

  it('a cadeia TERMINA no ultimo no autorizado quando o dominio seguinte e negado', async () => {
    const facts = [
      fact({ kind: 'MEASUREMENT', entity_id: 'm-1' }),
      fact({ kind: 'BILLING_DOCUMENT', entity_id: 'bd-1', business_reference: 'NF-2026-0005' }),
      fact({ kind: 'RECEIVABLE', entity_id: 'r-1', status: 'OPEN' }),
    ];
    const { service } = buildService({
      facts,
      allowed: (request) =>
        request.resourceType !== AUTHZ_RESOURCE_TYPES.FinanceReceivable,
    });

    const chain = await service.getChain(ACTOR, 'MEASUREMENT', 'm-1');

    expect(chain.nodes.map((entry) => entry.kind)).toEqual(['MEASUREMENT', 'BILLING_DOCUMENT']);
  });

  it('nega a leitura quando o proprio anchor nao e autorizado', async () => {
    const { service } = buildService({
      facts: [fact({ kind: 'RECEIVABLE', entity_id: 'r-1' })],
      allowed: () => false,
    });

    await expect(service.getChain(ACTOR, 'RECEIVABLE', 'r-1')).rejects.toMatchObject({ status: 403 });
  });

  it('avalia cada no com a capability do PROPRIO dominio e no escopo do proprio registro', async () => {
    const facts = [
      fact({ kind: 'SERVICE_REQUEST', entity_id: 'sr-1', unit_id: 'UNIDADE-1' }),
      fact({ kind: 'SERVICE_ORDER', entity_id: 'so-1', unit_id: 'UNIDADE-2' }),
    ];
    const { service, decide } = buildService({ facts });

    await service.getChain(ACTOR, 'SERVICE_REQUEST', 'sr-1');

    const evaluated = decide.mock.calls.map((call) => call[1]);
    const request = evaluated.find((item) => item.action === AUTHZ_ACTIONS.RequestsServiceRequestRead);
    const order = evaluated.find((item) => item.action === AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead);

    expect(request?.context?.unitId).toBe('UNIDADE-1');
    expect(order?.action).toBe(AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead);
    expect(order?.resourceType).toBe(AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder);
    expect(order?.context?.unitId).toBe('UNIDADE-2');
  });

  it('nao avalia dominio de contabilidade nem fiscal quando eles nao existem na linhagem', async () => {
    const { service, decide } = buildService({
      facts: [fact({ kind: 'SERVICE_ORDER', entity_id: 'so-1' })],
    });

    await service.getChain(ACTOR, 'SERVICE_ORDER', 'so-1');

    const actions = decide.mock.calls.map((call) => (call[1]).action);
    expect(actions).not.toContain(AUTHZ_ACTIONS.AccountingJournalRead);
    expect(actions).not.toContain(AUTHZ_ACTIONS.FiscalDocumentRead);
  });

  it('audita o acesso uma vez (no anchor) e nao um evento por no', async () => {
    const { service, decide } = buildService({
      facts: [
        fact({ kind: 'SERVICE_ORDER', entity_id: 'so-1' }),
        fact({ kind: 'MEASUREMENT', entity_id: 'm-1' }),
      ],
    });

    await service.getChain(ACTOR, 'SERVICE_ORDER', 'so-1');

    const audited = decide.mock.calls.filter((call) => call[2]?.audit === true);
    expect(audited).toHaveLength(1);
  });
});

describe('business chain — sem N+1', () => {
  it('monta a cadeia inteira com exatamente duas leituras, qualquer que seja o tamanho', async () => {
    const facts = [
      fact({ kind: 'CLIENT', entity_id: 'c-1' }),
      fact({ kind: 'SERVICE_REQUEST', entity_id: 'sr-1' }),
      fact({ kind: 'PROPOSAL', entity_id: 'p-1' }),
      fact({ kind: 'PURCHASE_ORDER', entity_id: 'po-1' }),
      fact({ kind: 'SERVICE_ORDER', entity_id: 'so-1' }),
      fact({ kind: 'MEASUREMENT', entity_id: 'm-1' }),
      fact({ kind: 'BILLING_DOCUMENT', entity_id: 'bd-1' }),
      fact({ kind: 'RECEIVABLE', entity_id: 'r-1' }),
      fact({ kind: 'SETTLEMENT', entity_id: 's-1' }),
      fact({ kind: 'FISCAL_DOCUMENT', entity_id: 'f-1' }),
      fact({ kind: 'ACCOUNTING_ENTRY', entity_id: 'j-1' }),
    ];
    const { service, resolveSpine, loadNodeFacts } = buildService({ facts });

    const chain = await service.getChain(ACTOR, 'RECEIVABLE', 'r-1');

    expect(chain.nodes).toHaveLength(11);
    expect(resolveSpine).toHaveBeenCalledTimes(1);
    // UMA chamada de fatos, com TODOS os ids de uma vez — nunca uma consulta por no.
    expect(loadNodeFacts).toHaveBeenCalledTimes(1);
    expect(loadNodeFacts.mock.calls[0]?.[0]).toHaveLength(11);
  });
});

describe('business chain — proveniencia real', () => {
  it('classifica como ORIGIN quem esta a montante e RESULT quem foi gerado', () => {
    expect(resolveRelation('SERVICE_REQUEST', 'CONVERTED', 'SERVICE_ORDER')).toBe('ORIGIN');
    expect(resolveRelation('MEASUREMENT', 'APPROVED', 'SERVICE_ORDER')).toBe('RESULT');
  });

  it('o proprio anchor e ROOT', () => {
    expect(resolveRelation('SERVICE_ORDER', 'RELEASED', 'SERVICE_ORDER')).toBe('ROOT');
  });

  it('liquida estornada e REVERSAL; liquidacao vigente e SETTLEMENT', () => {
    expect(resolveRelation('SETTLEMENT', 'POSTED', 'RECEIVABLE')).toBe('SETTLEMENT');
    expect(resolveRelation('SETTLEMENT', 'REVERSED', 'RECEIVABLE')).toBe('REVERSAL');
  });

  it('fiscal e contabil carregam a relacao declarada pelo contrato de origem', () => {
    expect(resolveRelation('FISCAL_DOCUMENT', 'AUTHORIZED', 'BILLING_DOCUMENT')).toBe('FISCAL');
    expect(resolveRelation('ACCOUNTING_ENTRY', 'POSTED', 'BILLING_DOCUMENT')).toBe('ACCOUNTING');
  });

  it('a liquidacao herda o escopo de unidade do recebivel por FK real', async () => {
    const facts = [
      fact({ kind: 'RECEIVABLE', entity_id: 'r-1', unit_id: 'UNIDADE-7', client_id: 'cliente-9' }),
      fact({
        kind: 'SETTLEMENT',
        entity_id: 's-1',
        unit_id: null,
        client_id: null,
        context_id: 'r-1',
      }),
    ];
    const { service, decide } = buildService({ facts });

    await service.getChain(ACTOR, 'RECEIVABLE', 'r-1');

    const settlement = decide.mock.calls
      .map((call) => call[1])
      .find((item) => item.context?.resourceId === 's-1');

    expect(settlement?.context?.unitId).toBe('UNIDADE-7');
    expect(settlement?.context?.isFinancial).toBe(true);
  });
});
