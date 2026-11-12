import { Injectable } from '@nestjs/common';
import { InboxAuthFailureError } from '../domain/inbox-errors';
import type {
  ReceiveIntegrationMessageInput,
  ReceiveIntegrationMessageResult,
} from '../domain/inbox-message.types';
import { IntegrationInboxRepository } from '../repositories/integration-inbox.repository';
import { IntegrationPayloadHasherService } from './integration-payload-hasher.service';
import { IntegrationWebhookAuthService } from './integration-webhook-auth.service';
import { EndpointRateLimitService } from '../../../security/services/endpoint-rate-limit.service';

@Injectable()
export class IntegrationInboxReceiveService {
  constructor(
    private readonly repository: IntegrationInboxRepository,
    private readonly payloadHasher: IntegrationPayloadHasherService,
    private readonly webhookAuth: IntegrationWebhookAuthService,
    private readonly endpointRateLimit: EndpointRateLimitService,
  ) {}

  async receive(input: ReceiveIntegrationMessageInput): Promise<ReceiveIntegrationMessageResult> {
    await this.endpointRateLimit.assertAllowed('webhook', input.provider);
    const rawBody = input.rawBody ?? JSON.stringify(input.payload);
    try {
      this.webhookAuth.validateSignature({
        provider: input.provider,
        rawBody,
        signature: input.signature,
      });
    } catch (error) {
      if (error instanceof InboxAuthFailureError) {
        throw error;
      }
      throw error;
    }

    const payloadHash = this.payloadHasher.hashPayload(input.payload);
    return this.repository.receive({
      ...input,
      payloadHash,
    });
  }
}
