import { AUTHZ_ERROR_CODES } from '../errors/authz-error-codes';
import { AuthzHttpException } from '../errors/authz-http.exception';

const ALLOWED_CREATE_KEYS = new Set(['code', 'label', 'description', 'capabilities']);
const ALLOWED_UPDATE_KEYS = new Set([
  'label',
  'description',
  'status',
  'capabilities',
  'expectedVersion',
]);
const ALLOWED_ASSIGN_KEYS = new Set(['roleCode', 'identityId', 'scopeType', 'scopeAnchor']);

export type CreateAccessRoleCommand = {
  code: string;
  label: string;
  description?: string;
  capabilities: string[];
};

export type UpdateAccessRoleCommand = {
  label?: string;
  description?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  capabilities?: string[];
  expectedVersion: number;
};

export type AssignAccessRoleCommand = {
  roleCode: string;
  identityId: string;
  scopeType: string;
  scopeAnchor?: string;
};

function assertStrictObject(body: unknown, allowed: Set<string>): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AuthzHttpException(400, AUTHZ_ERROR_CODES.VALIDATION_FAILED, 'Invalid request body.');
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new AuthzHttpException(400, AUTHZ_ERROR_CODES.VALIDATION_FAILED, 'Invalid request body.');
    }
  }
  return record;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new AuthzHttpException(
      400,
      AUTHZ_ERROR_CODES.VALIDATION_FAILED,
      `Invalid ${field}.`,
    );
  }
  return value;
}

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new AuthzHttpException(
      400,
      AUTHZ_ERROR_CODES.VALIDATION_FAILED,
      `Invalid ${field}.`,
    );
  }
  return value as string[];
}

export function parseCreateAccessRoleInput(body: unknown): CreateAccessRoleCommand {
  const record = assertStrictObject(body, ALLOWED_CREATE_KEYS);
  const code = assertString(record['code'], 'code');
  const label = assertString(record['label'], 'label');
  const description = record['description'] === undefined ? undefined : assertString(record['description'], 'description');
  const capabilities = assertStringArray(record['capabilities'], 'capabilities');
  return { code, label, description, capabilities };
}

export function parseUpdateAccessRoleInput(body: unknown): UpdateAccessRoleCommand {
  const record = assertStrictObject(body, ALLOWED_UPDATE_KEYS);
  const expectedVersion = record['expectedVersion'];
  if (
    typeof expectedVersion !== 'number' ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 1
  ) {
    throw new AuthzHttpException(
      400,
      AUTHZ_ERROR_CODES.VALIDATION_FAILED,
      'Invalid expectedVersion.',
    );
  }
  const status = record['status'];
  if (
    status !== undefined &&
    status !== 'ACTIVE' &&
    status !== 'INACTIVE'
  ) {
    throw new AuthzHttpException(
      400,
      AUTHZ_ERROR_CODES.VALIDATION_FAILED,
      'Invalid status.',
    );
  }
  return {
    label: record['label'] === undefined ? undefined : assertString(record['label'], 'label'),
    description:
      record['description'] === undefined ? undefined : assertString(record['description'], 'description'),
    status: status,
    capabilities:
      record['capabilities'] === undefined
        ? undefined
        : assertStringArray(record['capabilities'], 'capabilities'),
    expectedVersion,
  };
}

export function parseAssignAccessRoleInput(body: unknown): AssignAccessRoleCommand {
  const record = assertStrictObject(body, ALLOWED_ASSIGN_KEYS);
  const roleCode = assertString(record['roleCode'], 'roleCode');
  const identityId = assertString(record['identityId'], 'identityId');
  const scopeType = assertString(record['scopeType'], 'scopeType');
  const scopeAnchor =
    record['scopeAnchor'] === undefined ? undefined : assertString(record['scopeAnchor'], 'scopeAnchor');
  return { roleCode, identityId, scopeType, scopeAnchor };
}
