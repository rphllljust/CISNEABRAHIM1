import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { MEASUREMENTS_ERROR_CODES } from '../errors/measurements-error-codes';
import { MeasurementsHttpException } from '../errors/measurements-http.exception';
import { MeasurementsCapabilityService } from '../application/measurements-capability.service';

/**
 * WORK QUEUE e REVENUE LEAKAGE — as duas leituras de CONJUNTO desta capability.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * POR QUE `unitId` É OBRIGATÓRIO
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Sem unidade não há escopo operacional. Devolver a fila de todas as unidades
 * misturaria escopos que o ator não pediu — e no caso do control tower
 * misturaria VALORES de unidades diferentes numa soma que ninguém autorizou a
 * ver. O escopo é conferido contra as concessões do ator; a unidade declarada é
 * a unidade sobre a qual ele é autorizado, não uma sugestão.
 */
@Controller('query/measurements')
@UseGuards(JwtAuthGuard)
export class MeasurementOperationsQueryController {
  constructor(private readonly capability: MeasurementsCapabilityService) {}

  /** FILA DE TRABALHO — o que exige ação nesta unidade, com dono e próxima ação. */
  @Get('queue')
  getWorkQueue(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query() query: Record<string, unknown>,
  ) {
    const unitId = readRequiredString(query['unitId'], 'unitId');
    return this.capability.getWorkQueue(
      { identityId: auth.sub, sessionId: auth.sid },
      {
        unitId,
        limit: readOptionalInt(query['limit']),
        at: readOptionalIsoInstant(query['at']),
      },
    );
  }

  /**
   * REVENUE LEAKAGE — a lacuna de receita por estágio da cadeia.
   *
   * O total vem do backend sobre o conjunto inteiro. O drill-down reconstrói o
   * MESMO número porque é literalmente a mesma lista de posições.
   */
  @Get('revenue-leakage')
  getRevenueLeakage(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query() query: Record<string, unknown>,
  ) {
    const unitId = readRequiredString(query['unitId'], 'unitId');
    return this.capability.getRevenueLeakage(
      { identityId: auth.sub, sessionId: auth.sid },
      {
        unitId,
        limit: readOptionalInt(query['limit']),
        at: readOptionalIsoInstant(query['at']),
      },
    );
  }
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MeasurementsHttpException(
      400,
      MEASUREMENTS_ERROR_CODES.VALIDATION_FAILED,
      `Campo inválido ou ausente: ${field}.`,
    );
  }
  return value.trim();
}

function readOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readOptionalIsoInstant(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new MeasurementsHttpException(
      400,
      MEASUREMENTS_ERROR_CODES.VALIDATION_FAILED,
      'Instante inválido.',
    );
  }
  return parsed.toISOString();
}
