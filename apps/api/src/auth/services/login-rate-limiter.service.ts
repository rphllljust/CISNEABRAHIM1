import { Injectable } from '@nestjs/common';
import { EndpointRateLimitService } from '../../security/services/endpoint-rate-limit.service';

@Injectable()
export class LoginRateLimiterService {
  constructor(private readonly endpointRateLimit: EndpointRateLimitService) {}

  async assertAllowed(clientKey: string): Promise<void> {
    await this.endpointRateLimit.assertAllowed('login', clientKey);
  }
}
