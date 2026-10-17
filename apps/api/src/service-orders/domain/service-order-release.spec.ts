import { describe, expect, it } from 'vitest';
import { CLIENT_STATUSES } from '../../clients/domain/client-status';
import { SERVICE_ORDER_STATUSES } from './service-order';
import {
  assertServiceOrderPreparePreconditions,
  assertServiceOrderReleasePreconditions,
  serviceOrderPreparePreconditionCode,
  ServiceOrderReleaseError,
} from './service-order-release';

const baseOrder = {
  status: SERVICE_ORDER_STATUSES.Prepared,
  client_id: '11111111-1111-4111-8111-111111111111',
  service_definition_id: '22222222-2222-4222-8222-222222222222',
  service_definition_version_id: '33333333-3333-4333-8333-333333333333',
  service_snapshot: { serviceCode: 'SRV-001' },
};

describe('service-order-release', () => {
  it('denies release without client', () => {
    expect(() =>
      assertServiceOrderReleasePreconditions({ ...baseOrder, client_id: null }, null),
    ).toThrow(ServiceOrderReleaseError);
    try {
      assertServiceOrderReleasePreconditions({ ...baseOrder, client_id: null }, null);
    } catch (error) {
      expect((error as ServiceOrderReleaseError).code).toBe('CLIENT_REQUIRED');
    }
  });

  it('denies release when client is missing in database', () => {
    expect(() => assertServiceOrderReleasePreconditions(baseOrder, null)).toThrow(
      ServiceOrderReleaseError,
    );
    try {
      assertServiceOrderReleasePreconditions(baseOrder, null);
    } catch (error) {
      expect((error as ServiceOrderReleaseError).code).toBe('CLIENT_NOT_FOUND');
    }
  });

  it('denies release for inactive client', () => {
    expect(() =>
      assertServiceOrderReleasePreconditions(baseOrder, {
        id: baseOrder.client_id,
        status: CLIENT_STATUSES.Inactive,
      }),
    ).toThrow(ServiceOrderReleaseError);
    try {
      assertServiceOrderReleasePreconditions(baseOrder, {
        id: baseOrder.client_id,
        status: CLIENT_STATUSES.Inactive,
      });
    } catch (error) {
      expect((error as ServiceOrderReleaseError).code).toBe('CLIENT_INACTIVE');
    }
  });

  it('allows release for active client with service snapshot', () => {
    expect(() =>
      assertServiceOrderReleasePreconditions(baseOrder, {
        id: baseOrder.client_id,
        status: CLIENT_STATUSES.Active,
      }),
    ).not.toThrow();
  });

  it('uses the same prepare precondition policy for readiness and command execution', () => {
    expect(
      serviceOrderPreparePreconditionCode({
        status: SERVICE_ORDER_STATUSES.Draft,
        serviceDefinitionId: null,
        serviceDefinitionVersionId: null,
      }),
    ).toBe('SERVICE_REQUIRED');

    expect(
      serviceOrderPreparePreconditionCode({
        status: SERVICE_ORDER_STATUSES.Draft,
        serviceDefinitionId: baseOrder.service_definition_id,
        serviceDefinitionVersionId: baseOrder.service_definition_version_id,
      }),
    ).toBeNull();

    expect(
      serviceOrderPreparePreconditionCode({
        status: SERVICE_ORDER_STATUSES.Prepared,
        serviceDefinitionId: baseOrder.service_definition_id,
        serviceDefinitionVersionId: baseOrder.service_definition_version_id,
      }),
    ).toBe('INVALID_STATE');
  });

  it('requires service before prepare', () => {
    expect(() =>
      assertServiceOrderPreparePreconditions({
        ...baseOrder,
        status: SERVICE_ORDER_STATUSES.Draft,
        service_definition_id: null,
        service_definition_version_id: null,
      }),
    ).toThrow(ServiceOrderReleaseError);
  });
});
