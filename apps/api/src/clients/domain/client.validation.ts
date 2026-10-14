import {
  CONTACT_PURPOSES,
  isContactRole,
  isPurchaseOrderRequirement,
  type AddressPurpose,
  type ContactPurpose,
  type ContactRole,
  type PurchaseOrderRequirement,
} from './client-status';
import { isValidCnpjFormat, normalizeCnpj } from './cnpj';

export type ClientContactInput = {
  name: string;
  purpose: ContactPurpose;
  role?: ContactRole;
  isPrimary?: boolean;
  deactivated?: boolean;
  email?: string;
  phone?: string;
};

export type ClientAddressInput = {
  purpose: AddressPurpose;
  unitName?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

/**
 * UNIDADE DO CLIENTE — filial ou estabelecimento.
 *
 * `isHeadquarters` é marcação EXPLÍCITA, nunca derivada de nome, ordem de cadastro ou CNPJ. O
 * banco garante no máximo uma matriz por Cliente (índice parcial), então uma segunda matriz é
 * recusada como invariante de domínio e não como regra de tela.
 */
export type ClientUnitInput = {
  name: string;
  isHeadquarters?: boolean;
  city?: string;
  state?: string;
};

export type CreateClientInput = {
  legalName: string;
  tradeName?: string;
  taxId: string;
  externalErpId?: string;
  contacts: ClientContactInput[];
  addresses?: ClientAddressInput[];
  units?: ClientUnitInput[];
  purchaseOrderRequirement?: PurchaseOrderRequirement;
  groupName?: string;
  parentClientId?: string;
};

export type UpdateClientInput = {
  version: number;
  legalName?: string;
  tradeName?: string | null;
  externalErpId?: string | null;
  contacts?: ClientContactInput[];
  addresses?: ClientAddressInput[];
  units?: ClientUnitInput[];
  purchaseOrderRequirement?: PurchaseOrderRequirement;
  groupName?: string | null;
  parentClientId?: string | null;
};

export type ClientValidationErrorCode =
  | 'LEGAL_NAME_REQUIRED'
  | 'TAX_ID_INVALID'
  | 'CONTACT_REQUIRED'
  | 'CONTACT_NOT_USABLE'
  | 'VERSION_REQUIRED'
  | 'VERSION_INVALID'
  | 'DEACTIVATION_REASON_REQUIRED'
  | 'PURCHASE_ORDER_REQUIREMENT_INVALID'
  | 'CONTACT_ROLE_INVALID'
  | 'CONTACT_PRIMARY_DUPLICATED'
  | 'UNIT_NAME_REQUIRED'
  | 'UNIT_HEADQUARTERS_DUPLICATED'
  | 'PARENT_CLIENT_INVALID'
  | 'PARENT_CLIENT_SELF'
  | 'GROUP_NAME_REQUIRED';

export class ClientValidationError extends Error {
  constructor(readonly code: ClientValidationErrorCode) {
    super(code);
  }
}

const CONTACT_PURPOSE_SET = new Set<string>(Object.values(CONTACT_PURPOSES));

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUsableContact(contact: ClientContactInput): boolean {
  return (
    isNonEmptyString(contact.name) &&
    (isNonEmptyString(contact.email) || isNonEmptyString(contact.phone))
  );
}

/**
 * Invariantes dos CONTATOS, comuns a criação e atualização.
 *
 * 1. Nome obrigatório em todo contato.
 * 2. Papel, quando declarado, pertence ao enum publicado.
 * 3. No máximo UM contato principal por Cliente. O banco também protege a invariante (índice
 *    parcial `client_contacts_primary_uidx`), mas a checagem aqui existe para devolver 400 com
 *    causa legível em vez de um erro de unicidade cru.
 */
function assertContacts(contacts: ClientContactInput[]): void {
  let primaryCount = 0;
  for (const contact of contacts) {
    if (!isNonEmptyString(contact.name)) {
      throw new ClientValidationError('CONTACT_NOT_USABLE');
    }
    if (contact.role !== undefined && !isContactRole(contact.role)) {
      throw new ClientValidationError('CONTACT_ROLE_INVALID');
    }
    if (contact.isPrimary === true) {
      primaryCount += 1;
    }
  }
  if (primaryCount > 1) {
    throw new ClientValidationError('CONTACT_PRIMARY_DUPLICATED');
  }
}

function assertUnits(units: ClientUnitInput[]): void {
  let headquarters = 0;
  for (const unit of units) {
    if (!isNonEmptyString(unit.name)) {
      throw new ClientValidationError('UNIT_NAME_REQUIRED');
    }
    if (unit.isHeadquarters === true) {
      headquarters += 1;
    }
  }
  if (headquarters > 1) {
    throw new ClientValidationError('UNIT_HEADQUARTERS_DUPLICATED');
  }
}

export function assertCreateClientInput(input: CreateClientInput): string {
  if (!isNonEmptyString(input.legalName)) {
    throw new ClientValidationError('LEGAL_NAME_REQUIRED');
  }

  const normalizedTaxId = normalizeCnpj(input.taxId);
  if (!isValidCnpjFormat(normalizedTaxId)) {
    throw new ClientValidationError('TAX_ID_INVALID');
  }

  if (!Array.isArray(input.contacts) || input.contacts.length === 0) {
    throw new ClientValidationError('CONTACT_REQUIRED');
  }

  const hasOperational = input.contacts.some(
    (contact) =>
      contact.purpose === CONTACT_PURPOSES.Operational && isUsableContact(contact),
  );
  if (!hasOperational) {
    throw new ClientValidationError('CONTACT_NOT_USABLE');
  }

  for (const contact of input.contacts) {
    if (!CONTACT_PURPOSE_SET.has(contact.purpose)) {
      throw new ClientValidationError('CONTACT_NOT_USABLE');
    }
  }
  assertContacts(input.contacts);

  if (input.units !== undefined) {
    assertUnits(input.units);
  }

  if (input.groupName !== undefined && !isNonEmptyString(input.groupName)) {
    throw new ClientValidationError('GROUP_NAME_REQUIRED');
  }

  if (
    input.purchaseOrderRequirement !== undefined &&
    !isPurchaseOrderRequirement(input.purchaseOrderRequirement)
  ) {
    throw new ClientValidationError('PURCHASE_ORDER_REQUIREMENT_INVALID');
  }

  return normalizedTaxId;
}

export function assertUpdateClientInput(input: UpdateClientInput): void {
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new ClientValidationError('VERSION_INVALID');
  }

  if (input.legalName !== undefined && !isNonEmptyString(input.legalName)) {
    throw new ClientValidationError('LEGAL_NAME_REQUIRED');
  }

  if (input.contacts !== undefined) {
    if (input.contacts.length === 0) {
      throw new ClientValidationError('CONTACT_REQUIRED');
    }
    const hasOperational = input.contacts.some(
      (contact) =>
        contact.purpose === CONTACT_PURPOSES.Operational && isUsableContact(contact),
    );
    if (!hasOperational) {
      throw new ClientValidationError('CONTACT_NOT_USABLE');
    }
    assertContacts(input.contacts);
  }

  if (input.units !== undefined) {
    assertUnits(input.units);
  }

  if (input.groupName !== undefined && input.groupName !== null && !isNonEmptyString(input.groupName)) {
    throw new ClientValidationError('GROUP_NAME_REQUIRED');
  }

  if (
    input.purchaseOrderRequirement !== undefined &&
    !isPurchaseOrderRequirement(input.purchaseOrderRequirement)
  ) {
    throw new ClientValidationError('PURCHASE_ORDER_REQUIREMENT_INVALID');
  }
}

/**
 * O Cliente não pode ser pai de si mesmo.
 *
 * É a mesma invariante que o banco protege (`clients_parent_client_id_not_self_chk`); a checagem
 * antecipada existe para transformar a violação em 400 com causa legível. Ciclos mais longos
 * (A -> B -> A) são barrados no serviço, que já percorre a cadeia para publicar a hierarquia.
 */
export function assertParentClient(clientId: string, parentClientId: string | null): void {
  if (parentClientId !== null && parentClientId === clientId) {
    throw new ClientValidationError('PARENT_CLIENT_SELF');
  }
}

export function assertDeactivationReason(reason: string | undefined): void {
  if (!isNonEmptyString(reason)) {
    throw new ClientValidationError('DEACTIVATION_REASON_REQUIRED');
  }
}
