export const CLIENT_STATUSES = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const;

export type ClientStatus = (typeof CLIENT_STATUSES)[keyof typeof CLIENT_STATUSES];

export const CONTACT_PURPOSES = {
  Operational: 'operational',
  Commercial: 'commercial',
  Billing: 'billing',
} as const;

export type ContactPurpose = (typeof CONTACT_PURPOSES)[keyof typeof CONTACT_PURPOSES];

export const ADDRESS_PURPOSES = {
  Operational: 'operational',
  Billing: 'billing',
  Correspondence: 'correspondence',
} as const;

export type AddressPurpose = (typeof ADDRESS_PURPOSES)[keyof typeof ADDRESS_PURPOSES];

/**
 * PAPEL do contato dentro da empresa do Cliente — eixo DIFERENTE de `CONTACT_PURPOSES`.
 *
 * `purpose` diz COM O QUE o contato se relaciona no CISNE (operacional/comercial/faturamento);
 * `role` diz QUEM é a pessoa na organização do CLIENTE (compras, fiscal, contratos, diretoria).
 * Reaproveitar um eixo como o outro impediria representar o caso real mais comum — um contato de
 * COMPRAS que no CISNE responde por assuntos COMERCIAIS — e faria "operacional" significar duas
 * coisas ao mesmo tempo.
 *
 * AUSENTE É UM VALOR LEGÍTIMO: `null` significa "não declarado", e o backfill da migration 0097
 * deliberadamente não atribuiu papel a nenhum contato histórico. Inventar organização que o
 * operador não declarou seria pior do que exibir a ausência.
 */
export const CONTACT_ROLES = {
  Operational: 'operational',
  Commercial: 'commercial',
  Billing: 'billing',
  Purchasing: 'purchasing',
  Fiscal: 'fiscal',
  Contracts: 'contracts',
  Management: 'management',
} as const;

export type ContactRole = (typeof CONTACT_ROLES)[keyof typeof CONTACT_ROLES];

const CONTACT_ROLE_SET = new Set<string>(Object.values(CONTACT_ROLES));

export function isContactRole(value: string): value is ContactRole {
  return CONTACT_ROLE_SET.has(value);
}


/** SRC-008 / BR-048 — exigência de PO é configuração do cliente, não identidade. */
export const PURCHASE_ORDER_REQUIREMENTS = {
  NotRequired: 'NOT_REQUIRED',
  BeforeExecution: 'BEFORE_EXECUTION',
  BeforeBilling: 'BEFORE_BILLING',
} as const;

export type PurchaseOrderRequirement =
  (typeof PURCHASE_ORDER_REQUIREMENTS)[keyof typeof PURCHASE_ORDER_REQUIREMENTS];

const PURCHASE_ORDER_REQUIREMENT_SET = new Set<string>(Object.values(PURCHASE_ORDER_REQUIREMENTS));

export function isPurchaseOrderRequirement(value: string): value is PurchaseOrderRequirement {
  return PURCHASE_ORDER_REQUIREMENT_SET.has(value);
}
