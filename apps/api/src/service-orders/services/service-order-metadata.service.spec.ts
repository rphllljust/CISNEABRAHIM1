import { describe, expect, it } from 'vitest';
import { SERVICE_ORDER_STATUSES } from '../domain/service-order';
import { ServiceOrderMetadataService } from './service-order-metadata.service';
import type { ServiceOrderMetadataRepository } from './service-order-metadata.repository';

function service() {
  return new ServiceOrderMetadataService({} as ServiceOrderMetadataRepository);
}

const PREPARE_PERMISSION = 'service-orders:service-order:prepare';
const CANCEL_PERMISSION = 'service-orders:service-order:cancel';

describe('ServiceOrderMetadataService command readiness', () => {
  it('does not publish prepare for DRAFT without a complete service definition', () => {
    const response = service().getAvailableActions(
      '11111111-1111-4111-8111-111111111111',
      {
        status: SERVICE_ORDER_STATUSES.Draft,
        serviceDefinitionId: null,
        serviceDefinitionVersionId: null,
      },
      new Set([PREPARE_PERMISSION, CANCEL_PERMISSION]),
    );

    expect(response.comandos_validos.map((entry) => entry.comando)).toEqual(['cancel']);
    expect(response.comandos_bloqueados_por_precondicao).toEqual(['prepare']);
  });

  it('publishes prepare when DRAFT has the required service definition links', () => {
    const response = service().getAvailableActions(
      '11111111-1111-4111-8111-111111111111',
      {
        status: SERVICE_ORDER_STATUSES.Draft,
        serviceDefinitionId: '22222222-2222-4222-8222-222222222222',
        serviceDefinitionVersionId: '33333333-3333-4333-8333-333333333333',
      },
      new Set([PREPARE_PERMISSION, CANCEL_PERMISSION]),
    );

    expect(response.comandos_validos.map((entry) => entry.comando)).toContain('prepare');
    expect(response.comandos_bloqueados_por_precondicao).not.toContain('prepare');
  });

  it('keeps prepare non-executable for an actor without the permission', () => {
    const response = service().getAvailableActions(
      '11111111-1111-4111-8111-111111111111',
      {
        status: SERVICE_ORDER_STATUSES.Draft,
        serviceDefinitionId: '22222222-2222-4222-8222-222222222222',
        serviceDefinitionVersionId: '33333333-3333-4333-8333-333333333333',
      },
      new Set([CANCEL_PERMISSION]),
    );

    const prepare = response.comandos_validos.find((entry) => entry.comando === 'prepare');
    expect(prepare?.usuario_tem_permissao).toBe(false);
  });

  it('does not publish prepare as valid for an incompatible state', () => {
    const response = service().getAvailableActions(
      '11111111-1111-4111-8111-111111111111',
      {
        status: SERVICE_ORDER_STATUSES.Prepared,
        serviceDefinitionId: '22222222-2222-4222-8222-222222222222',
        serviceDefinitionVersionId: '33333333-3333-4333-8333-333333333333',
      },
      new Set([PREPARE_PERMISSION]),
    );

    expect(response.comandos_validos.map((entry) => entry.comando)).not.toContain('prepare');
    expect(response.comandos_invalidos_para_status).toContain('prepare');
  });
});
