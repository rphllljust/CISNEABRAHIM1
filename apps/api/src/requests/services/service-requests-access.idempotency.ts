import { Injectable } from '@nestjs/common';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import type { CreateServiceRequestInput } from '../domain/service-request.validation';
import type { ServiceRequestDetailResponse } from '../serializers/service-requests-response.serializer';
import { ServiceRequestsAccessAuthz } from './service-requests-access.authz';
import { ServiceRequestsAccessPersistence } from './service-requests-access.persistence';
import { ServiceRequestsAccessQuery } from './service-requests-access.query';

@Injectable()
export class ServiceRequestsAccessIdempotency {
  constructor(
    private readonly persistence: ServiceRequestsAccessPersistence,
    private readonly authz: ServiceRequestsAccessAuthz,
    private readonly query: ServiceRequestsAccessQuery,
  ) {}

  async resolveCreateReplay(
    actor: IdentityAuthzContext,
    input: CreateServiceRequestInput,
  ): Promise<ServiceRequestDetailResponse | null> {
    if (!input.idempotencyKey) {
      return null;
    }
    const existing = await this.persistence.findByIdempotencyKey(input.idempotencyKey.trim());
    if (!existing) {
      return null;
    }
    await this.authz.assertRecordAction(actor, AUTHZ_ACTIONS.RequestsServiceRequestRead, existing);
    return this.query.toDetail(actor, existing);
  }
}