import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';

const A = AUTHZ_ACTIONS;
const R = AUTHZ_RESOURCE_TYPES;

// Dashboard datasets must not expose more fields than the strongest requirement listed.
// New dashboard/dataset relationships require security review and updated tests.
export const SUPERSET_DASHBOARD_REQUIREMENTS = {
  'service-orders': [
    { action: A.ServiceOrdersServiceOrderList, resourceType: R.ServiceOrdersServiceOrder },
  ],
  'fleet-assets': [
    { action: A.ResourcesAssetList, resourceType: R.ResourcesAsset },
  ],
  'contracts-measurements': [
    { action: A.CommercialContractList, resourceType: R.CommercialContract },
    { action: A.MeasurementsMeasurementRead, resourceType: R.ServiceOrdersServiceOrder },
  ],
  'finance-treasury': [
    { action: A.FinanceReceivableList, resourceType: R.FinanceReceivable },
    { action: A.FinancePayableList, resourceType: R.FinancePayable },
    { action: A.FinanceTreasuryList, resourceType: R.FinanceTreasury },
  ],
  'operational-costs': [
    { action: A.ServiceOrdersServiceOrderList, resourceType: R.ServiceOrdersServiceOrder },
    { action: A.ServiceOrdersOperationalCostRead, resourceType: R.ServiceOrdersServiceOrder },
  ],
  'transport-rentals': [
    { action: A.ServiceOrdersServiceOrderList, resourceType: R.ServiceOrdersServiceOrder },
  ],
  'team-productivity': [
    { action: A.ServiceOrdersServiceOrderList, resourceType: R.ServiceOrdersServiceOrder },
    { action: A.MeasurementsMeasurementRead, resourceType: R.ServiceOrdersServiceOrder },
    { action: A.ServiceOrdersResourceAllocationRead, resourceType: R.ServiceOrdersServiceOrder },
  ],
  'executive': [
    { action: A.ServiceOrdersServiceOrderList, resourceType: R.ServiceOrdersServiceOrder },
    { action: A.ResourcesAssetList, resourceType: R.ResourcesAsset },
    { action: A.CommercialContractList, resourceType: R.CommercialContract },
    { action: A.MeasurementsMeasurementRead, resourceType: R.ServiceOrdersServiceOrder },
    { action: A.ServiceOrdersOperationalCostRead, resourceType: R.ServiceOrdersServiceOrder },
    { action: A.FinanceReceivableList, resourceType: R.FinanceReceivable },
    { action: A.FinancePayableList, resourceType: R.FinancePayable },
    { action: A.FinanceTreasuryList, resourceType: R.FinanceTreasury },
  ],
} as const;

export type SupersetDashboardKey = keyof typeof SUPERSET_DASHBOARD_REQUIREMENTS;
const DASHBOARD_KEYS: ReadonlySet<string> = new Set(Object.keys(SUPERSET_DASHBOARD_REQUIREMENTS));
const UNIT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSupersetDashboardKey(value: unknown): value is SupersetDashboardKey {
  return typeof value === 'string' && DASHBOARD_KEYS.has(value);
}

export function buildUnitRlsClause(unitId: unknown): string {
  if (typeof unitId !== 'string' || !UNIT_PATTERN.test(unitId)) {
    throw new BadRequestException('Invalid operational unit.');
  }
  return "unit_id = '" + unitId + "'";
}

type LoginResponse = { access_token?: unknown };
type GuestTokenResponse = { token?: unknown };

@Injectable()
export class SupersetEmbeddedService {
  constructor(private readonly policyDecisionPoint: PolicyDecisionPointService) {}

  async issueGuestToken(actor: IdentityAuthzContext, dashboardKey: unknown, unitId: unknown) {
    if (!isSupersetDashboardKey(dashboardKey)) {
      throw new BadRequestException('Unknown dashboard.');
    }
    const rlsClause = buildUnitRlsClause(unitId);
    const authorizedUnit = unitId as string;

    if (process.env['SUPERSET_EMBED_ENABLED'] !== 'true') {
      throw new ServiceUnavailableException('Embedded analytics is disabled.');
    }
    const envKey = 'SUPERSET_DASHBOARD_' + dashboardKey.toUpperCase().replace(/-/g, '_') + '_ID';
    const dashboardId = process.env[envKey];
    const internalUrl = process.env['SUPERSET_INTERNAL_URL'];
    const publicUrl = process.env['SUPERSET_PUBLIC_URL'];
    const username = process.env['SUPERSET_SERVICE_USERNAME'];
    const password = process.env['SUPERSET_SERVICE_PASSWORD'];
    if (!dashboardId || !UUID_PATTERN.test(dashboardId) ||
        !internalUrl || !publicUrl || !username || !password) {
      throw new ServiceUnavailableException('Embedded analytics is not configured.');
    }

    let internalOrigin: URL;
    let externalOrigin: URL;
    try {
      internalOrigin = new URL(internalUrl);
      externalOrigin = new URL(publicUrl);
      if (!['http:', 'https:'].includes(internalOrigin.protocol) ||
          !['http:', 'https:'].includes(externalOrigin.protocol) ||
          internalOrigin.username || internalOrigin.password || internalOrigin.pathname !== '/' ||
          externalOrigin.username || externalOrigin.password || externalOrigin.pathname !== '/' ||
          (process.env['NODE_ENV'] === 'production' && externalOrigin.protocol !== 'https:')) {
        throw new Error('Invalid Superset origin.');
      }
    } catch {
      throw new ServiceUnavailableException('Embedded analytics URL configuration is invalid.');
    }

    // The CISNE PDP checks grants, role-derived capabilities, revocations and unit context.
    // CLIENT/CONTRACT/OWN scopes do not match unit context and therefore fail closed.
    for (const requirement of SUPERSET_DASHBOARD_REQUIREMENTS[dashboardKey]) {
      const decision = await this.policyDecisionPoint.decide(actor, {
        action: requirement.action,
        resourceType: requirement.resourceType,
        context: { unitId: authorizedUnit },
      });
      if (decision.result !== 'ALLOW') {
        throw new ForbiddenException('No permission for this analytical scope.');
      }
    }

    const serviceToken = await this.login(internalOrigin, username, password);
    const guest = await this.requestJson<GuestTokenResponse>(
      new URL('/api/v1/security/guest_token/', internalOrigin),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + serviceToken },
        body: JSON.stringify({
          user: { username: 'cisne-' + actor.identityId },
          resources: [{ type: 'dashboard', id: dashboardId }],
          rls: [{ clause: rlsClause }],
        }),
      },
    );
    if (typeof guest.token !== 'string' || guest.token.length < 16) {
      throw new BadGatewayException('Superset guest token response is invalid.');
    }
    return { token: guest.token, dashboardId, supersetDomain: externalOrigin.origin };
  }

  private async login(origin: URL, username: string, password: string): Promise<string> {
    const result = await this.requestJson<LoginResponse>(
      new URL('/api/v1/security/login', origin),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, provider: 'db', refresh: true }),
      },
    );
    if (typeof result.access_token !== 'string' || result.access_token.length < 16) {
      throw new BadGatewayException('Superset service authentication failed.');
    }
    return result.access_token;
  }

  private async requestJson<T>(url: URL, init: RequestInit): Promise<T> {
    try {
      const response = await fetch(url, {
        ...init,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        throw new Error('Superset HTTP error.');
      }
      return (await response.json()) as T;
    } catch {
      // Never expose upstream response bodies, passwords, service tokens or JWTs.
      throw new BadGatewayException('Superset is unavailable.');
    }
  }
}
