import { insertGrant } from '@cisne/database';
import type { Pool } from 'pg';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_SCOPES } from '../../authorization/types/authz-scopes';
import { grantsForProfile } from '../../uat/uat-profiles';
import { resolveResourceType } from '../../uat/uat-vertical-runner';
import { assertHmlIsolation } from './hml-config';

export const HML_PILOT_OPERATOR_EXTRA_ACTIONS = [
  AUTHZ_ACTIONS.PlatformDiagnosticsRead,
  AUTHZ_ACTIONS.AccountingJournalRead,
  AUTHZ_ACTIONS.AccountingJournalList,
  AUTHZ_ACTIONS.AccountingPeriodOpen,
  AUTHZ_ACTIONS.FiscalDocumentRead,
  AUTHZ_ACTIONS.FiscalDocumentList,
  AUTHZ_ACTIONS.FiscalTaxRead,
  AUTHZ_ACTIONS.FiscalTaxAssessmentRead,
  AUTHZ_ACTIONS.FiscalPeriodRead,
] as const;

export function listHmlPilotOperatorActions(): readonly string[] {
  return [...new Set([...grantsForProfile('control_admin'), ...HML_PILOT_OPERATOR_EXTRA_ACTIONS])];
}

export type HmlPilotOperatorGrantResult = {
  login: string;
  identityId: string;
  granted: number;
  alreadyPresent: number;
  actions: string[];
};

export async function findIdentityIdByLogin(pool: Pool, login: string): Promise<string | null> {
  const normalized = login.trim().toLowerCase();
  const result = await pool.query<{ identity_id: string }>(
    `SELECT identity_id
     FROM identity.credentials
     WHERE login_identifier_normalized = $1`,
    [normalized],
  );
  return result.rows[0]?.identity_id ?? null;
}

export async function grantHmlPilotOperator(
  pool: Pool,
  input: { login: string; env?: NodeJS.ProcessEnv },
): Promise<HmlPilotOperatorGrantResult> {
  const env = input.env ?? process.env;
  assertHmlIsolation(env);

  const login = input.login.trim().toLowerCase();
  const identityId = await findIdentityIdByLogin(pool, login);
  if (!identityId) {
    throw new Error(`HML pilot operator identity not found for login ${login}`);
  }

  const existing = await pool.query<{ action: string }>(
    `SELECT action
     FROM "authorization".grants
     WHERE identity_id = $1
       AND revoked_at IS NULL`,
    [identityId],
  );
  const present = new Set(existing.rows.map((row) => row.action));
  const actions = listHmlPilotOperatorActions();
  let granted = 0;
  let alreadyPresent = 0;

  for (const action of actions) {
    if (present.has(action)) {
      alreadyPresent += 1;
      continue;
    }
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: resolveResourceType(action),
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
    granted += 1;
  }

  return { login, identityId, granted, alreadyPresent, actions: [...actions] };
}
