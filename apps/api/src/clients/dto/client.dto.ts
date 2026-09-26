import { HttpStatus } from '@nestjs/common';
import {
  ADDRESS_PURPOSES,
  CONTACT_PURPOSES,
  isPurchaseOrderRequirement,
  type AddressPurpose,
  type ContactPurpose,
  type PurchaseOrderRequirement,
} from '../domain/client-status';
import { ClientValidationError, assertCreateClientInput, type CreateClientInput } from '../domain/client.validation';
import {
  ClientListQueryError,
  parseListClientsQuery as parseClientListQueryDomain,
  type ClientListRequest,
} from '../domain/client-list.query';
import { ClientHttpException } from '../errors/client-http.exception';
import { CLIENT_ERROR_CODES } from '../errors/client-error-codes';
import { mapValidationCodeToStatus } from '../errors/client-validation-status';
import { assertNoPrivilegedFields } from '../../security/domain/forbidden-payload-fields';

const CONTACT_PURPOSE_SET = new Set<string>(Object.values(CONTACT_PURPOSES));
const ADDRESS_PURPOSE_SET = new Set<string>(Object.values(ADDRESS_PURPOSES));

function assertObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return body as Record<string, unknown>;
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseContact(value: unknown): {
  name: string;
  purpose: ContactPurpose;
  email?: string;
  phone?: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  const record = value as Record<string, unknown>;
  const name = parseOptionalString(record['name']);
  const purpose = record['purpose'];
  if (!name || typeof purpose !== 'string' || !CONTACT_PURPOSE_SET.has(purpose)) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return {
    name,
    purpose: purpose as ContactPurpose,
    email: parseOptionalString(record['email']),
    phone: parseOptionalString(record['phone']),
  };
}

function parseAddress(value: unknown): {
  purpose: AddressPurpose;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  const record = value as Record<string, unknown>;
  const purpose = record['purpose'];
  if (typeof purpose !== 'string' || !ADDRESS_PURPOSE_SET.has(purpose)) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return {
    purpose: purpose as AddressPurpose,
    street: parseOptionalString(record['street']),
    number: parseOptionalString(record['number']),
    complement: parseOptionalString(record['complement']),
    district: parseOptionalString(record['district']),
    city: parseOptionalString(record['city']),
    state: parseOptionalString(record['state']),
    postalCode: parseOptionalString(record['postalCode']),
    country: parseOptionalString(record['country']),
  };
}

export function parseCreateClientInput(body: unknown) {
  const record = assertObject(body);
  assertNoPrivilegedFields(record);
  const legalName = parseOptionalString(record['legalName']);
  const taxId = parseOptionalString(record['taxId']);
  if (!legalName || !taxId) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  if (!Array.isArray(record['contacts'])) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  const contacts = record['contacts'].map(parseContact);
  const addresses = Array.isArray(record['addresses'])
    ? record['addresses'].map(parseAddress)
    : undefined;

  const parsed: CreateClientInput = {
    legalName,
    tradeName: parseOptionalString(record['tradeName']),
    taxId,
    externalErpId: parseOptionalString(record['externalErpId']),
    contacts,
    addresses,
    purchaseOrderRequirement: parsePurchaseOrderRequirement(record['purchaseOrderRequirement']),
  };

  try {
    assertCreateClientInput(parsed);
  } catch (error) {
    if (error instanceof ClientValidationError) {
      throw new ClientHttpException(
        mapValidationCodeToStatus(error.code),
        CLIENT_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    throw error;
  }

  return parsed;
}

export function parseUpdateClientInput(body: unknown) {
  const record = assertObject(body);
  assertNoPrivilegedFields(record, { allowVersion: true });
  if (typeof record['version'] !== 'number') {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  const contacts = Array.isArray(record['contacts'])
    ? record['contacts'].map(parseContact)
    : undefined;
  const addresses = Array.isArray(record['addresses'])
    ? record['addresses'].map(parseAddress)
    : undefined;

  return {
    version: record['version'],
    legalName:
      record['legalName'] === undefined ? undefined : parseOptionalString(record['legalName']),
    tradeName:
      record['tradeName'] === null
        ? null
        : record['tradeName'] === undefined
          ? undefined
          : parseOptionalString(record['tradeName']),
    externalErpId:
      record['externalErpId'] === null
        ? null
        : record['externalErpId'] === undefined
          ? undefined
          : parseOptionalString(record['externalErpId']),
    contacts,
    addresses,
    purchaseOrderRequirement: parsePurchaseOrderRequirement(record['purchaseOrderRequirement']),
  };
}

export function parseStatusTransitionInput(body: unknown): { version: number; reason?: string } {
  const record = assertObject(body);
  if (typeof record['version'] !== 'number' || !Number.isInteger(record['version']) || record['version'] < 1) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  const reason = parseOptionalString(record['reason']);
  return { version: record['version'], reason };
}

export function parseDeactivateClientInput(body: unknown): { reason: string } {
  const record = assertObject(body);
  const reason = parseOptionalString(record['reason']);
  if (!reason) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return { reason };
}

function parsePurchaseOrderRequirement(value: unknown): PurchaseOrderRequirement | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || !isPurchaseOrderRequirement(value)) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return value;
}

/**
 * Contrato HTTP da listagem. A interpretação (allow-lists, limites, semântica da busca) vive em
 * `domain/client-list.query.ts`; aqui só se traduz o erro de campo para o 400 já publicado deste
 * módulo, preservando a assinatura consumida pelo controller e pelos testes.
 */
export function parseListClientsQuery(query: Record<string, unknown>): ClientListRequest {
  try {
    return parseClientListQueryDomain(query);
  } catch (error) {
    if (error instanceof ClientListQueryError) {
      throw new ClientHttpException(
        HttpStatus.BAD_REQUEST,
        CLIENT_ERROR_CODES.VALIDATION_FAILED,
        'Invalid query parameters.',
      );
    }
    throw error;
  }
}
