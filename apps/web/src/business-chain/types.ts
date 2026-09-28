/**
 * CISNE — BUSINESS CHAIN (contrato do cliente).
 *
 * Espelho fiel do contrato server-side (`apps/api/src/business-chain/contracts`).
 *
 * REGRA DE AUTORIZACAO: o cliente NAO decide o que aparece. O backend omite o no nao
 * autorizado — sem rotulo, sem contagem, sem placeholder. Este modulo apenas renderiza os nos
 * que recebeu: se um dominio nao e autorizado, a cadeia simplesmente TERMINA ali, e a interface
 * nao tem como indicar existencia, porque nao recebeu nada sobre ela.
 */

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

export type BusinessChainAnchorKind =
  | 'CLIENT'
  | 'SERVICE_REQUEST'
  | 'PROPOSAL'
  | 'PURCHASE_ORDER'
  | 'SERVICE_ORDER'
  | 'MEASUREMENT'
  | 'BILLING_DOCUMENT'
  | 'RECEIVABLE';

export type BusinessChainRelation =
  | 'ROOT'
  | 'ORIGIN'
  | 'RESULT'
  | 'SETTLEMENT'
  | 'REVERSAL'
  | 'FISCAL'
  | 'ACCOUNTING';

export type BusinessChainNode = {
  id: string;
  kind: BusinessChainNodeKind;
  businessReference: string;
  status: string;
  occurredAt: string;
  route: string;
  relation: BusinessChainRelation;
  summary: string;
  unitId: string | null;
  clientId: string | null;
};

export type BusinessChainMilestone = {
  label: string;
  evidence: string;
  occurredAt: string;
};

export type BusinessChain = {
  anchor: { kind: BusinessChainNodeKind; id: string };
  nodes: BusinessChainNode[];
  milestones: BusinessChainMilestone[];
};

/** Nome do tipo de no em linguagem de negocio. Nunca o uuid, nunca a chave tecnica. */
export const CHAIN_KIND_LABELS: Record<BusinessChainNodeKind, string> = {
  CLIENT: 'Cliente',
  SERVICE_REQUEST: 'Solicitação',
  PROPOSAL: 'Proposta',
  PURCHASE_ORDER: 'Pedido do cliente',
  SERVICE_ORDER: 'Ordem de serviço',
  MEASUREMENT: 'Medição',
  BILLING_DOCUMENT: 'Nota/Fatura',
  RECEIVABLE: 'Recebível',
  SETTLEMENT: 'Liquidação',
  FISCAL_DOCUMENT: 'Documento fiscal',
  ACCOUNTING_ENTRY: 'Lançamento contábil',
};

/** O que a ligacao significa, em linguagem de negocio. */
export const CHAIN_RELATION_LABELS: Record<BusinessChainRelation, string> = {
  ROOT: 'Registro de origem',
  ORIGIN: 'Veio de',
  RESULT: 'Gerou',
  SETTLEMENT: 'Liquidado por',
  REVERSAL: 'Estornado por',
  FISCAL: 'Emitiu',
  ACCOUNTING: 'Contabilizado por',
};
