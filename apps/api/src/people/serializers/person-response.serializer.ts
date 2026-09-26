import type { PersonStatus } from '../domain/person-status';
import {
  toHistoryEventResponse as toSharedHistoryEventResponse,
  type HistoryEventResponse,
} from '../../infrastructure/http/contracts';

export type PersonRow = {
  id: string;
  member_code: string;
  legal_name: string;
  preferred_name: string | null;
  default_labor_type_code: string | null;
  default_labor_type_name: string | null;
  external_erp_id: string | null;
  status: PersonStatus;
  version: number;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  deactivation_reason: string | null;
};

export type PersonHistoryRow = {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor_identity_id: string | null;
  occurred_at: string;
};

export type PersonResponse = {
  id: string;
  memberCode: string;
  legalName: string;
  preferredName: string | null;
  defaultLaborTypeCode: string | null;
  defaultLaborTypeName: string | null;
  externalErpId: string | null;
  status: PersonStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  serviceOrderAllocationSupported: boolean;
};

export type PersonHistoryEventResponse = HistoryEventResponse;

export function toPersonResponse(row: PersonRow): PersonResponse {
  return {
    id: row.id,
    memberCode: row.member_code,
    legalName: row.legal_name,
    preferredName: row.preferred_name,
    defaultLaborTypeCode: row.default_labor_type_code,
    defaultLaborTypeName: row.default_labor_type_name,
    externalErpId: row.external_erp_id,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deactivatedAt: row.deactivated_at,
    deactivationReason: row.deactivation_reason,
    serviceOrderAllocationSupported: true,
  };
}

export function toPersonHistoryEventResponse(row: PersonHistoryRow): PersonHistoryEventResponse {
  return toSharedHistoryEventResponse(row);
}

const PERSON_SELECT = `
  m.id,
  m.member_code,
  m.legal_name,
  m.preferred_name,
  m.default_labor_type_code,
  lt.name AS default_labor_type_name,
  m.external_erp_id,
  m.status::text AS status,
  m.version,
  m.created_at,
  m.updated_at,
  m.deactivated_at,
  m.deactivation_reason
`;

export { PERSON_SELECT };
