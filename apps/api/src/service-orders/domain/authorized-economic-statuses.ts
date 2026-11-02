import type { BusinessChainNode } from '../../business-chain/contracts/business-chain.contract';

/**
 * Read-only projection of ALREADY AUTHORIZED owner facts.
 * The business-chain service performs PDP checks per node; this helper cannot
 * discover facts, query a database or infer eligibility from OS lifecycle.
 */
type AuthorizedNode = Pick<BusinessChainNode, 'kind' | 'status'>;

export function projectAuthorizedEconomicStatuses(
  nodes: readonly AuthorizedNode[],
): { billing: string; accounting: string } {
  const statusOf = (kind: 'BILLING_DOCUMENT' | 'ACCOUNTING_ENTRY'): string => {
    const states = new Set(
      nodes.filter((node) => node.kind === kind).map((node) => node.status.trim()).filter(Boolean),
    );
    if (states.size === 0) return 'UNKNOWN';
    if (states.size > 1) return 'MIXED';
    return [...states][0]!;
  };
  return {
    billing: statusOf('BILLING_DOCUMENT'),
    accounting: statusOf('ACCOUNTING_ENTRY'),
  };
}
