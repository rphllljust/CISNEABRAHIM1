/**
 * CISNE — BUSINESS CHAIN CONTRACT
 *
 * A cadeia empresarial responde, a partir de QUALQUER ponto da operacao:
 *
 *   De onde este registro veio?          -> nos de ORIGEM (a montante)
 *   O que aconteceu?                     -> `status` + `occurredAt` persistidos
 *   O que foi gerado a partir dele?      -> nos de RESULTADO (a jusante)
 *   Qual e a situacao financeira?        -> nos de RECEBIVEL/LIQUIDACAO
 *   Qual e o resultado fiscal/contabil?  -> nos FISCAL/CONTABIL (so quando autorizados)
 *
 * REGRAS INVIOLAVEIS (verificadas por teste):
 *
 * 1. NENHUM id interno aparece como rotulo. `id` existe para navegacao e chave; o texto
 *    exibido e sempre `businessReference` — referencia humana persistida no dominio.
 * 2. NENHUMA ligacao e inferida. Todo no existe porque uma FK real (ou o `source_id`
 *    declarado pelo contrato de origem do proprio dominio) o liga ao no anterior.
 * 3. UM no nao autorizado NAO EXISTE na resposta: sem rotulo, sem contagem, sem
 *    placeholder, sem a palavra "oculto". A cadeia simplesmente termina ali.
 * 4. A cadeia PRESERVA o passado: registro cancelado, revertido ou substituido
 *    permanece como fato historico com seu status real.
 * 5. A ordem e CANONICA (do pedido ao dinheiro, do dinheiro a contabilidade) e a
 *    deduplicacao e por (kind, id) — o mesmo fato nunca aparece duas vezes.
 */

/** Cadeia canonica: do pedido ao dinheiro, do dinheiro a contabilidade. */
export const BUSINESS_CHAIN_NODE_KINDS = [
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
] as const;

export type BusinessChainNodeKind = (typeof BUSINESS_CHAIN_NODE_KINDS)[number];

/** Posicao canonica. Tambem e a ordem de renderizacao. */
const KIND_POSITION: Record<BusinessChainNodeKind, number> = {
  CLIENT: 0,
  SERVICE_REQUEST: 1,
  PROPOSAL: 2,
  PURCHASE_ORDER: 3,
  SERVICE_ORDER: 4,
  MEASUREMENT: 5,
  BILLING_DOCUMENT: 6,
  RECEIVABLE: 7,
  SETTLEMENT: 8,
  FISCAL_DOCUMENT: 9,
  ACCOUNTING_ENTRY: 10,
};

/**
 * Tipo de ligacao com o no imediatamente anterior da cadeia.
 *
 * ROOT       -> no raiz (o proprio anchor).
 * ORIGIN     -> este no e a ORIGEM do no canonico anterior (subiu a montante).
 * RESULT     -> este no foi GERADO pelo anterior.
 * SETTLEMENT -> liquidacao de um recebivel.
 * REVERSAL   -> estorno/retificacao de um fato anterior (o passado continua visivel).
 * FISCAL     -> documento fiscal emitido a partir do documento de faturamento.
 * ACCOUNTING -> lancamento contabil originado por um evento economico real.
 */
export const BUSINESS_CHAIN_RELATIONS = [
  'ROOT',
  'ORIGIN',
  'RESULT',
  'SETTLEMENT',
  'REVERSAL',
  'FISCAL',
  'ACCOUNTING',
] as const;

export type BusinessChainRelation = (typeof BUSINESS_CHAIN_RELATIONS)[number];

/** No da cadeia. Todo campo e FATO persistido no dominio de origem. */
export type BusinessChainNode = {
  /** Chave interna. NUNCA usada como rotulo na interface. */
  id: string;
  kind: BusinessChainNodeKind;
  /** Referencia humana persistida (ex.: `OS-2026-0184`). Nunca uuid. */
  businessReference: string;
  /** Situacao real do dominio. `CANCELLED`, `REVERSED` e `VOIDED` sao estados legitimos. */
  status: string;
  /** ISO 8601 — quando o fato ocorreu. */
  occurredAt: string;
  /** Rota autorizada do objeto. Sempre um caminho real do shell. */
  route: string;
  relation: BusinessChainRelation;
  /** Resumo minimo derivado dos campos persistidos daquele no. */
  summary: string;
  unitId: string | null;
  clientId: string | null;
};

/** Linha compacta de resumo da cadeia (secao T). Derivada de estados reais, nunca de score. */
export type BusinessChainMilestone = {
  /** Nome do marco em linguagem de negocio. */
  label: string;
  /** Estado persistido que provou o marco. */
  evidence: string;
  /** Quando o marco aconteceu (do proprio no). */
  occurredAt: string;
};

export type BusinessChain = {
  anchor: { kind: BusinessChainNodeKind; id: string };
  /** Nos autorizados, em ordem canonica. */
  nodes: BusinessChainNode[];
  /** Marcos derivados APENAS dos estados reais presentes na cadeia. */
  milestones: BusinessChainMilestone[];
};

/** Ordem canonica + desempate deterministico por ocorrencia e referencia humana. */
export function compareChainNodes(left: BusinessChainNode, right: BusinessChainNode): number {
  const byKind = KIND_POSITION[left.kind] - KIND_POSITION[right.kind];
  if (byKind !== 0) {
    return byKind;
  }
  const leftAt = Date.parse(left.occurredAt);
  const rightAt = Date.parse(right.occurredAt);
  if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && leftAt !== rightAt) {
    return leftAt - rightAt;
  }
  const byReference = left.businessReference.localeCompare(right.businessReference, 'pt-BR');
  if (byReference !== 0) {
    return byReference;
  }
  return left.id.localeCompare(right.id, 'pt-BR');
}

/**
 * Deduplicacao por chave logica (kind, id).
 *
 * A MESMA obrigacao nunca entra duas vezes: uma OS alcancada por dois caminhos reais
 * (pedido e solicitacao) e UM no, nao dois.
 */
export function deduplicateChainNodes(nodes: BusinessChainNode[]): BusinessChainNode[] {
  const seen = new Set<string>();
  const unique: BusinessChainNode[] = [];

  for (const node of nodes) {
    const key = `${node.kind}:${node.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(node);
  }

  return unique;
}

/**
 * Normaliza a cadeia: deduplica, ordena e garante o no raiz primeiro.
 *
 * Nao inventa nos, nao preenche lacunas e nao remove registro cancelado/revertido —
 * lacuna real (uma OS sem PO, por exemplo) e um FATO da operacao e permanece visivel.
 */
export function normalizeBusinessChain(nodes: BusinessChainNode[]): BusinessChainNode[] {
  return deduplicateChainNodes(nodes).sort(compareChainNodes);
}

/** Um uuid exposto como rotulo e um defeito. O teste de invariante usa exatamente isto. */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function containsRawIdentifier(text: string): boolean {
  return UUID_PATTERN.test(text);
}

/**
 * Marcos da cadeia derivados SOMENTE de estados persistidos presentes nos nos.
 *
 * Nao existe score, nao existe status global novo e nao existe marco sem evidencia:
 * cada linha carrega o estado que a provou.
 */
const MILESTONE_RULES: Array<{
  kind: BusinessChainNodeKind;
  label: string;
  matches: (status: string) => boolean;
}> = [
  {
    kind: 'PROPOSAL',
    label: 'Comercial concluído',
    matches: (status) => status === 'ACCEPTED',
  },
  {
    kind: 'PURCHASE_ORDER',
    label: 'Pedido do cliente registrado',
    matches: (status) => status === 'REGISTERED',
  },
  {
    kind: 'SERVICE_ORDER',
    label: 'Operação concluída',
    matches: (status) => status === 'COMPLETED',
  },
  {
    kind: 'MEASUREMENT',
    label: 'Medição aprovada',
    matches: (status) => status === 'APPROVED',
  },
  {
    kind: 'BILLING_DOCUMENT',
    label: 'Faturado',
    matches: (status) => status === 'FINALIZED',
  },
  {
    kind: 'RECEIVABLE',
    label: 'Recebível em aberto',
    matches: (status) => status === 'OPEN' || status === 'PARTIALLY_SETTLED' || status === 'OVERDUE',
  },
  {
    kind: 'RECEIVABLE',
    label: 'Recebível liquidado',
    matches: (status) => status === 'SETTLED',
  },
];

export function deriveChainMilestones(nodes: BusinessChainNode[]): BusinessChainMilestone[] {
  const milestones: BusinessChainMilestone[] = [];

  for (const rule of MILESTONE_RULES) {
    const match = nodes.find((node) => node.kind === rule.kind && rule.matches(node.status));
    if (!match) {
      continue;
    }
    milestones.push({
      label: rule.label,
      evidence: `${match.businessReference} · ${match.status}`,
      occurredAt: match.occurredAt,
    });
  }

  return milestones;
}

/** Monta a cadeia final a partir dos nos JA autorizados. */
export function buildBusinessChain(
  anchor: { kind: BusinessChainNodeKind; id: string },
  authorizedNodes: BusinessChainNode[],
): BusinessChain {
  const nodes = normalizeBusinessChain(authorizedNodes);
  return { anchor, nodes, milestones: deriveChainMilestones(nodes) };
}
