import { Controller, Get, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { BILLING_ERROR_CODES } from '../errors/billing-error-codes';
import { BillingHttpException } from '../errors/billing-http.exception';
import { BillingAccessService } from '../services/billing-access.service';

const BUCKETS = new Set([
  'cancelled_document',
  'terms_divergence',
  'measurement_pending',
  'billing_basis_missing',
  'document_state_unknown',
  'ready',
  'prepared',
  'issued',
]);

function integerParam(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BillingHttpException(HttpStatus.BAD_REQUEST, BILLING_ERROR_CODES.VALIDATION_FAILED, 'Invalid worklist query.');
  }
  return parsed;
}

@Controller('billing/worklist')
@UseGuards(JwtAuthGuard)
export class BillingWorklistController {
  constructor(private readonly billingAccess: BillingAccessService) {}

  @Get()
  list(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query() query: Record<string, unknown>,
  ) {
    const bucket = typeof query['bucket'] === 'string' ? query['bucket'] : undefined;
    const search = typeof query['q'] === 'string' ? query['q'].trim() : undefined;
    if ((bucket && !BUCKETS.has(bucket)) || (search && search.length > 120)) {
      throw new BillingHttpException(HttpStatus.BAD_REQUEST, BILLING_ERROR_CODES.VALIDATION_FAILED, 'Invalid worklist query.');
    }
    return this.billingAccess.listWorklist(
      { identityId: auth.sub, sessionId: auth.sid },
      {
        bucket,
        search,
        limit: integerParam(query['limit'], 20, 1, 100),
        offset: integerParam(query['offset'], 0, 0, 1_000_000),
      },
    );
  }
}
