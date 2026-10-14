import { HttpStatus } from '@nestjs/common';
import {
  ADDRESS_PURPOSES,
  CONTACT_PURPOSES,
  CONTACT_ROLES,
  isPurchaseOrderRequirement,
  type AddressPurpose,
  type ContactPurpose,
  type ContactRole,
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
const CONTACT_ROLE_SET = new Set<string>(Object.values(CONTACT_ROLES));

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

/** Booleano opcional. Qualquer outro tipo é recusado com 400 em vez de coagido. */
function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return value;
}

function parseContact(value: unknown): {
  name: string;
  purpose: ContactPurpose;
  role?: ContactRole;
  isPrimary?: boolean;
  deactivated?: boolean;
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
  // Papel, quando presente, precisa pertencer ao enum publicado. `null` é aceito e significa
  // "não declarado" — é assim que o operador REMOVE um papel atribuído antes.
  const rawRole = record['role'];
  let role: ContactRole | undefined;
  if (rawRole !== undefined && rawRole !== null) {
    if (typeof rawRole !== 'string' || !CONTACT_ROLE_SET.has(rawRole)) {
      throw new ClientHttpException(
        HttpStatus.BAD_REQUEST,
        CLIENT_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    role = rawRole as ContactRole;
  }
  return {
    name,
    purpose: purpose as ContactPurpose,
    role,
    isPrimary: parseOptionalBoolean(record['isPrimary']),
    deactivated: parseOptionalBoolean(record['deactivated']),
    email: parseOptionalString(record['email']),
    phone: parseOptionalString(record['phone']),
  };
}

function parseUnit(value: unknown): {
  name: string;
  isHeadquarters?: boolean;
  city?: string;
  state?: string;
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
  if (!name) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return {
    name,
    isHeadquarters: parseOptionalBoolean(record['isHeadquarters']),
    city: parseOptionalString(record['city']),
    state: parseOptionalString(record['state']),
  };
}

function parseAddress(value: unknown): {
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
    // Endereço é qualificado pela unidade por NOME no contrato HTTP, e o repositório resolve o
    // nome para o id dentro da transação. Publicar `unitId` cru obrigaria o cliente a conhecer
    // identificadores internos da unidade, que a listagem de detalhe acabou de devolver.
    unitName: parseOptionalString(record['unitName']),
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

/**
 * Lê uma coleção opcional com o parser do seu elemento.
 *
 * Genérico de propósito: sem o parâmetro de tipo o resultado seria `unknown[]` e cada chamador
 * teria de recorrer a um cast — que é exatamente como um payload não validado entra no serviço.
 * Ausente devolve `undefined` (o PATCH é parcial); presente precisa ser ARRAY, senão 400.
 */
function parseCollection<T>(value: unknown, parser: (entry: unknown) => T): T[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return value.map(parser);
}

/** Traduz o erro de domínio para o 400 já publicado deste módulo. */
function parseOrBadRequest<T>(operation: () => T): T {
  try {
    return operation();
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
  const addresses = parseCollection(record['addresses'], parseAddress);
  const units = parseCollection(record['units'], parseUnit);

  const parsed: CreateClientInput = {
    legalName,
    tradeName: parseOptionalString(record['tradeName']),
    taxId,
    externalErpId: parseOptionalString(record['externalErpId']),
    contacts,
    addresses,
    units,
    purchaseOrderRequirement: parsePurchaseOrderRequirement(record['purchaseOrderRequirement']),
    groupName: parseOptionalString(record['groupName']),
    parentClientId: parseOptionalString(record['parentClientId']),
  };

  return parseOrBadRequest(() => {
    assertCreateClientInput(parsed);
    return parsed;
  });
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
  const contacts = parseCollection(record['contacts'], parseContact);
  const addresses = parseCollection(record['addresses'], parseAddress);
  const units = parseCollection(record['units'], parseUnit);

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
    units,
    purchaseOrderRequirement: parsePurchaseOrderRequirement(record['purchaseOrderRequirement']),
    // `null` EXPLÍCITO remove o vínculo (o Cliente sai do grupo / deixa de ter pai). `undefined`
    // significa "não mexe" — a distinção é o que permite ao PATCH ser parcial sem apagar dado.
    groupName:
      record['groupName'] === null
        ? null
        : record['groupName'] === undefined
          ? undefined
          : parseOptionalString(record['groupName']),
    parentClientId:
      record['parentClientId'] === null
        ? null
        : record['parentClientId'] === undefined
          ? undefined
          : parseOptionalString(record['parentClientId']),
  };
}

/**
 * COMANDOS SEMÂNTICOS DE CONTATO.
 *
 * Ação empresarial não é "editar o cadastro inteiro": marcar o contato principal, ativar/desativar
 * um contato e removê-lo são INTENÇÕES próprias, com payload mínimo e validação própria. Um PATCH
 * genérico de status não conseguiria expressar nenhuma delas sem reenviar a coleção inteira — o que
 * transformaria cada ação em uma corrida de concorrência contra qualquer outra edição do cadastro.
 */
export function parseContactCommandInput(body: unknown): { version: number } {
  const record = assertObject(body);
  if (
    typeof record['version'] !== 'number' ||
    !Number.isInteger(record['version']) ||
    record['version'] < 1
  ) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return { version: record['version'] };
}

export function parseUnitCommandInput(body: unknown): { version: number } {
  return parseContactCommandInput(body);
}

/**
 * COMANDO DE ADICIONAR CONTATO — validado como um payload de criação, e não como um objeto solto.
 *
 * Devolve a variante `add` já tipada, de modo que o controller não precise recorrer a conversão
 * forçada de `name`/`purpose`/`role`. Era exatamente por ali que um papel inválido ou uma
 * finalidade inexistente entrariam no serviço sem passar pelo allow-list.
 */
export function parseAddContactCommandInput(body: unknown): {
  version: number;
  name: string;
  purpose: ContactPurpose;
  role?: ContactRole;
  email?: string;
  phone?: string;
} {
  const record = assertObject(body);
  const { version } = parseContactCommandInput(record);
  const name = parseOptionalString(record['name']);
  const purpose = record['purpose'];
  if (!name || typeof purpose !== 'string' || !CONTACT_PURPOSE_SET.has(purpose)) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  const rawRole = record['role'];
  let role: ContactRole | undefined;
  if (rawRole !== undefined && rawRole !== null) {
    if (typeof rawRole !== 'string' || !CONTACT_ROLE_SET.has(rawRole)) {
      throw new ClientHttpException(
        HttpStatus.BAD_REQUEST,
        CLIENT_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    role = rawRole as ContactRole;
  }
  return {
    version,
    name,
    purpose: purpose as ContactPurpose,
    role,
    email: parseOptionalString(record['email']),
    phone: parseOptionalString(record['phone']),
  };
}

/**
 * PAPEL DO CONTATO — `null` REMOVE, `undefined` não aparece, string válida atribui.
 *
 * A distinção entre `null` e `undefined` é o contrato inteiro deste comando: sem ela, não haveria
 * como o operador desfazer uma atribuição de papel sem reenviar a coleção de contatos.
 */
export function parseContactRoleCommandInput(body: unknown): {
  version: number;
  role: ContactRole | null;
} {
  const record = assertObject(body);
  const { version } = parseContactCommandInput(record);
  const rawRole = record['role'];
  if (rawRole === null || rawRole === undefined) {
    return { version, role: null };
  }
  if (typeof rawRole !== 'string' || !CONTACT_ROLE_SET.has(rawRole)) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return { version, role: rawRole as ContactRole };
}

/** COMANDO DE ADICIONAR UNIDADE — nome obrigatório, matriz opcional. */
export function parseAddUnitCommandInput(body: unknown): {
  version: number;
  name: string;
  isHeadquarters: boolean;
  city?: string;
  state?: string;
} {
  const record = assertObject(body);
  const { version } = parseUnitCommandInput(record);
  const name = parseOptionalString(record['name']);
  if (!name) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return {
    version,
    name,
    isHeadquarters: parseOptionalBoolean(record['isHeadquarters']) === true,
    city: parseOptionalString(record['city']),
    state: parseOptionalString(record['state']),
  };
}

/**
 * VÍNCULO DE HIERARQUIA.
 *
 * `parentClientId` ausente e `groupId` ausente significam "não alterar"; `null` explícito remove o
 * vínculo. Os dois eixos viajam juntos porque a hierarquia é UMA decisão: declarar a matriz do
 * grupo sem dizer de que grupo se trata deixaria o cadastro em estado intermediário sem sentido.
 */
export function parseHierarchyInput(body: unknown): {
  version: number;
  parentClientId?: string | null;
  groupId?: string | null;
  groupName?: string | null;
} {
  const record = assertObject(body);
  if (
    typeof record['version'] !== 'number' ||
    !Number.isInteger(record['version']) ||
    record['version'] < 1
  ) {
    throw new ClientHttpException(
      HttpStatus.BAD_REQUEST,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  const readNullableUuid = (key: string): string | null | undefined => {
    const raw = record[key];
    if (raw === undefined) {
      return undefined;
    }
    if (raw === null) {
      return null;
    }
    if (typeof raw !== 'string') {
      throw new ClientHttpException(
        HttpStatus.BAD_REQUEST,
        CLIENT_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  return {
    version: record['version'],
    parentClientId: readNullableUuid('parentClientId'),
    groupId: readNullableUuid('groupId'),
    groupName:
      record['groupName'] === undefined
        ? undefined
        : record['groupName'] === null
          ? null
          : parseOptionalString(record['groupName']),
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
