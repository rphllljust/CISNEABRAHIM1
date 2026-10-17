import {
  assertClientEligibleForServiceOrderRelease,
  ClientReleaseEligibilityError,
} from '../../clients/domain/client-service-order-guard';
import type { ClientStatus } from '../../clients/domain/client-status';
import { SERVICE_ORDER_STATUSES } from './service-order';

export type ServiceOrderReleaseCandidate = {
  status: string;
  client_id: string | null;
  service_definition_id: string | null;
  service_definition_version_id: string | null;
  service_snapshot: Record<string, unknown>;
};

export type ServiceOrderPrepareReadinessCandidate = {
  status: string;
  serviceDefinitionId: string | null;
  serviceDefinitionVersionId: string | null;
};

export type ServiceOrderPreparePreconditionCode = 'INVALID_STATE' | 'SERVICE_REQUIRED';

export function serviceOrderPreparePreconditionCode(
  order: ServiceOrderPrepareReadinessCandidate,
): ServiceOrderPreparePreconditionCode | null {
  if (order.status !== SERVICE_ORDER_STATUSES.Draft) {
    return 'INVALID_STATE';
  }
  if (!order.serviceDefinitionId || !order.serviceDefinitionVersionId) {
    return 'SERVICE_REQUIRED';
  }
  return null;
}

export type ClientReleaseLookup = {
  id: string;
  status: ClientStatus;
} | null;

export class ServiceOrderReleaseError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function assertServiceOrderReleasePreconditions(
  order: ServiceOrderReleaseCandidate,
  client: ClientReleaseLookup,
): void {
  if (order.status !== SERVICE_ORDER_STATUSES.Prepared) {
    throw new ServiceOrderReleaseError('INVALID_STATE');
  }
  if (!order.service_definition_id || !order.service_definition_version_id) {
    throw new ServiceOrderReleaseError('SERVICE_REQUIRED');
  }
  const serviceCode = order.service_snapshot?.['serviceCode'];
  if (typeof serviceCode !== 'string' || serviceCode.trim().length === 0) {
    throw new ServiceOrderReleaseError('SERVICE_SNAPSHOT_REQUIRED');
  }
  if (!order.client_id) {
    throw new ServiceOrderReleaseError('CLIENT_REQUIRED');
  }
  if (!client) {
    throw new ServiceOrderReleaseError('CLIENT_NOT_FOUND');
  }
  if (client.id !== order.client_id) {
    throw new ServiceOrderReleaseError('CLIENT_NOT_FOUND');
  }

  try {
    assertClientEligibleForServiceOrderRelease({
      id: client.id,
      status: client.status,
    });
  } catch (error) {
    if (error instanceof ClientReleaseEligibilityError) {
      throw new ServiceOrderReleaseError(error.code);
    }
    throw error;
  }
}

export function assertServiceOrderPreparePreconditions(order: ServiceOrderReleaseCandidate): void {
  const code = serviceOrderPreparePreconditionCode({
    status: order.status,
    serviceDefinitionId: order.service_definition_id,
    serviceDefinitionVersionId: order.service_definition_version_id,
  });
  if (code) {
    throw new ServiceOrderReleaseError(code);
  }
}
