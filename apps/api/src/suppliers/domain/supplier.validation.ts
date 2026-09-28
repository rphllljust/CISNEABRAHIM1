import { isValidCnpjFormat, normalizeCnpj } from '../../clients/domain/cnpj';
import { ADDRESS_PURPOSES, CONTACT_PURPOSES } from '../../clients/domain/client-status';
import { assertCurrencyCode } from '../../platform/kernel/money-math';
import { SupplierError, SUPPLIER_STATUSES, type SupplierStatus } from './supplier';

export type SupplierContactInput = {
  name: string;
  purpose: 'operational' | 'commercial' | 'billing';
  email?: string;
  phone?: string;
};

export type SupplierAddressInput = {
  purpose: 'operational' | 'billing' | 'correspondence';
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

export type CreateSupplierInput = {
  legalName: string;
  tradeName?: string;
  taxId: string;
  externalErpId?: string;
  paymentTerms?: string;
  currencyCode?: string;
  contacts: SupplierContactInput[];
  addresses?: SupplierAddressInput[];
};

export type UpdateSupplierInput = {
  version: number;
  legalName?: string;
  tradeName?: string | null;
  externalErpId?: string | null;
  paymentTerms?: string | null;
  currencyCode?: string;
  contacts?: SupplierContactInput[];
  addresses?: SupplierAddressInput[];
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUsableContact(contact: SupplierContactInput): boolean {
  return isNonEmptyString(contact.name) && (isNonEmptyString(contact.email) || isNonEmptyString(contact.phone));
}

export function assertCreateSupplierInput(input: CreateSupplierInput): {
  normalizedTaxId: string;
  currencyCode: string;
} {
  if (!isNonEmptyString(input.legalName)) {
    throw new SupplierError('SUPPLIER_INVALID');
  }
  const normalizedTaxId = normalizeCnpj(input.taxId ?? '');
  if (!isValidCnpjFormat(normalizedTaxId)) {
    throw new SupplierError('SUPPLIER_TAX_ID_INVALID');
  }
  if (!Array.isArray(input.contacts) || input.contacts.length === 0) {
    throw new SupplierError('SUPPLIER_CONTACT_REQUIRED');
  }
  const hasOperational = input.contacts.some(
    (contact) => contact.purpose === CONTACT_PURPOSES.Operational && isUsableContact(contact),
  );
  if (!hasOperational) {
    throw new SupplierError('SUPPLIER_CONTACT_REQUIRED');
  }
  return {
    normalizedTaxId,
    currencyCode: assertCurrencyCode(input.currencyCode ?? 'BRL'),
  };
}

export function assertUpdateSupplierInput(input: UpdateSupplierInput): void {
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new SupplierError('SUPPLIER_VERSION_CONFLICT');
  }
  if (input.legalName !== undefined && !isNonEmptyString(input.legalName)) {
    throw new SupplierError('SUPPLIER_INVALID');
  }
  if (input.contacts !== undefined) {
    if (input.contacts.length === 0) {
      throw new SupplierError('SUPPLIER_CONTACT_REQUIRED');
    }
    const hasOperational = input.contacts.some(
      (contact) => contact.purpose === CONTACT_PURPOSES.Operational && isUsableContact(contact),
    );
    if (!hasOperational) {
      throw new SupplierError('SUPPLIER_CONTACT_REQUIRED');
    }
  }
  if (input.currencyCode !== undefined) {
    assertCurrencyCode(input.currencyCode);
  }
}

export function assertDeactivationReason(reason: string | undefined): void {
  if (!isNonEmptyString(reason)) {
    throw new SupplierError('SUPPLIER_INVALID');
  }
}

export function isSupplierStatus(value: string): value is SupplierStatus {
  return value === SUPPLIER_STATUSES.Active || value === SUPPLIER_STATUSES.Inactive;
}

export { ADDRESS_PURPOSES, CONTACT_PURPOSES };
