import { describe, expect, it } from 'vitest';
import {
  BUSINESS_CHAIN_NODE_KINDS,
  buildBusinessChain,
  containsRawIdentifier,
  deduplicateChainNodes,
  deriveChainMilestones,
  normalizeBusinessChain,
  type BusinessChainNode,
} from './business-chain.contract';

/**
 * INVARIANTES DA CADEIA EMPRESARIAL.
 *
 * Estes testes protegem as regras que fazem a cadeia ser AUDITAVEL e nao decorativa:
 * ordem canonica, deduplicacao, ausencia de identificador como rotulo, preservacao do
 * passado (cancelado/revertido) e marcos derivados so de estados reais.
 */

function node(partial: Partial<BusinessChainNode> & Pick<BusinessChainNode, 'kind' | 'id'>): BusinessChainNode {
  return {
    businessReference: `REF-${partial.id}`,
    status: 'ACTIVE',
    occurredAt: '2026-01-01T00:00:00.000Z',
    route: '/app/nowhere',
    relation: 'RESULT',
    summary: 'fato',
    unitId: 'UNIDADE-1',
    clientId: null,
    ...partial,
  };
}

describe('business chain — ordem canonica', () => {
  it('ordena do pedido ao dinheiro e do dinheiro a contabilidade', () => {
    const normalized = normalizeBusinessChain([
      node({ kind: 'ACCOUNTING_ENTRY', id: 'j1' }),
      node({ kind: 'CLIENT', id: 'c1' }),
      node({ kind: 'RECEIVABLE', id: 'r1' }),
      node({ kind: 'SERVICE_REQUEST', id: 'sr1' }),
      node({ kind: 'SERVICE_ORDER', id: 'so1' }),
      node({ kind: 'BILLING_DOCUMENT', id: 'bd1' }),
      node({ kind: 'MEASUREMENT', id: 'm1' }),
      node({ kind: 'PROPOSAL', id: 'p1' }),
      node({ kind: 'PURCHASE_ORDER', id: 'po1' }),
      node({ kind: 'SETTLEMENT', id: 's1' }),
      node({ kind: 'FISCAL_DOCUMENT', id: 'f1' }),
    ]);

    expect(normalized.map((entry) => entry.kind)).toEqual([
      'CLIENT',
      'SERVICE_REQUEST',
      'PROPOSAL',
      'PURCHASE_ORDER',
      'SERVICE_ORDER',
      'MEASUREMENT',
      'BILLING_DOCUMENT',
      'RECEIVABLE',
      'SETTLEMENT',
      'FISCAL_DOCUMENT',
      'ACCOUNTING_ENTRY',
    ]);
  });

  it('a ordem e deterministica e independente da ordem de chegada', () => {
    const a = node({ kind: 'MEASUREMENT', id: 'm2', occurredAt: '2026-03-01T00:00:00.000Z' });
    const b = node({ kind: 'MEASUREMENT', id: 'm1', occurredAt: '2026-02-01T00:00:00.000Z' });

    expect(normalizeBusinessChain([a, b]).map((entry) => entry.id)).toEqual(['m1', 'm2']);
    expect(normalizeBusinessChain([b, a]).map((entry) => entry.id)).toEqual(['m1', 'm2']);
  });
});

describe('business chain — deduplicacao', () => {
  it('nunca apresenta o mesmo fato duas vezes, mesmo alcancado por dois caminhos reais', () => {
    const so = node({ kind: 'SERVICE_ORDER', id: 'so1' });
    const duplicated = deduplicateChainNodes([so, { ...so, relation: 'ORIGIN' }, so]);

    expect(duplicated).toHaveLength(1);
    expect(duplicated[0]?.relation).toBe('RESULT');
  });

  it('nao confunde nos de naturezas diferentes com o mesmo id tecnico', () => {
    const deduped = deduplicateChainNodes([
      node({ kind: 'SERVICE_ORDER', id: 'x' }),
      node({ kind: 'MEASUREMENT', id: 'x' }),
    ]);

    expect(deduped).toHaveLength(2);
  });
});

describe('business chain — nenhum identificador como rotulo', () => {
  it('a referencia humana persistida nunca e um uuid', () => {
    const chain = buildBusinessChain({ kind: 'SERVICE_ORDER', id: 'so1' }, [
      node({ kind: 'SERVICE_ORDER', id: 'so1', businessReference: 'OS-2026-0184', relation: 'ROOT' }),
    ]);

    for (const entry of chain.nodes) {
      expect(containsRawIdentifier(entry.businessReference)).toBe(false);
      expect(containsRawIdentifier(entry.summary)).toBe(false);
    }
  });

  it('detecta uuid exposto como texto (guarda contra regressao)', () => {
    expect(containsRawIdentifier('7f3a1c2e-1111-4222-8333-444455556666')).toBe(true);
    expect(containsRawIdentifier('OS-2026-0184')).toBe(false);
  });

  it('todo no traz rota autorizada nao vazia', () => {
    const chain = buildBusinessChain({ kind: 'CLIENT', id: 'c1' }, [
      node({ kind: 'CLIENT', id: 'c1', relation: 'ROOT' }),
      node({ kind: 'SERVICE_ORDER', id: 'so1' }),
    ]);

    for (const entry of chain.nodes) {
      expect(entry.route.startsWith('/app/')).toBe(true);
    }
  });
});

describe('business chain — o passado nao e apagado', () => {
  it('preserva registro cancelado e liquidacao estornada como fatos historicos', () => {
    const chain = buildBusinessChain({ kind: 'RECEIVABLE', id: 'r1' }, [
      node({ kind: 'RECEIVABLE', id: 'r1', relation: 'ROOT', status: 'CANCELLED' }),
      node({ kind: 'SETTLEMENT', id: 's1', status: 'REVERSED', relation: 'REVERSAL' }),
    ]);

    expect(chain.nodes.map((entry) => entry.status)).toEqual(['CANCELLED', 'REVERSED']);
    expect(chain.nodes[1]?.relation).toBe('REVERSAL');
  });

  it('preserva documento de faturamento anulado e lancamento estornado', () => {
    const chain = buildBusinessChain({ kind: 'BILLING_DOCUMENT', id: 'bd1' }, [
      node({ kind: 'BILLING_DOCUMENT', id: 'bd1', relation: 'ROOT', status: 'VOIDED' }),
      node({ kind: 'ACCOUNTING_ENTRY', id: 'j1', status: 'POSTED', relation: 'ACCOUNTING' }),
    ]);

    expect(chain.nodes.some((entry) => entry.status === 'VOIDED')).toBe(true);
    expect(chain.nodes.some((entry) => entry.kind === 'ACCOUNTING_ENTRY')).toBe(true);
  });
});

describe('business chain — marcos derivados so de estados reais', () => {
  it('nao inventa marco sem evidencia persistida', () => {
    const milestones = deriveChainMilestones([
      node({ kind: 'SERVICE_ORDER', id: 'so1', status: 'IN_EXECUTION' }),
    ]);

    expect(milestones).toEqual([]);
  });

  it('cada marco carrega o estado que o provou', () => {
    const milestones = deriveChainMilestones([
      node({ kind: 'MEASUREMENT', id: 'm1', status: 'APPROVED', businessReference: 'Medição de OS-1' }),
      node({ kind: 'BILLING_DOCUMENT', id: 'bd1', status: 'FINALIZED', businessReference: 'NF-2026-0005' }),
      node({ kind: 'RECEIVABLE', id: 'r1', status: 'OPEN', businessReference: 'Cobrança da NF-2026-0005' }),
    ]);

    expect(milestones.map((entry) => entry.label)).toEqual([
      'Medição aprovada',
      'Faturado',
      'Recebível em aberto',
    ]);
    expect(milestones[1]?.evidence).toBe('NF-2026-0005 · FINALIZED');
  });

  it('a cadeia parcial real nao recebe marcador de etapa ausente', () => {
    const chain = buildBusinessChain({ kind: 'SERVICE_ORDER', id: 'so1' }, [
      node({ kind: 'SERVICE_ORDER', id: 'so1', relation: 'ROOT', status: 'COMPLETED' }),
    ]);

    expect(chain.milestones.map((entry) => entry.label)).toEqual(['Operação concluída']);
  });
});

describe('business chain — vocabulario fechado', () => {
  it('declara exatamente a cadeia-alvo do pedido ao resultado contabil', () => {
    expect([...BUSINESS_CHAIN_NODE_KINDS]).toEqual([
      'CLIENT',
      'SERVICE_REQUEST',
      'PROPOSAL',
      'PURCHASE_ORDER',
      'SERVICE_ORDER',
      'MEASUREMENT',
      'BILLING_DOCUMENT',
      'RECEIVABLE',
      'SETTLEMENT',
      'FISCAL_DOCUMENT',
      'ACCOUNTING_ENTRY',
    ]);
  });
});
