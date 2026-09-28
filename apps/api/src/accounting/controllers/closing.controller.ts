import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import {
  ClosingReadinessService,
  type ClosingReadinessResponse,
} from '../services/closing-readiness.service';

/**
 * CLOSING CENTER — leitura agregada e autorizada do fechamento.
 *
 * Existe para o centro de fechamento NAO montar a tela com 5-10 requisicoes serializadas: a
 * resposta traz periodo, estado contabil, estado fiscal e as pendencias/acoes em uma unica
 * consulta. Nenhuma regra nova e nenhuma escrita: e leitura do que o fechamento real ja avalia.
 */
@Controller('closing')
@UseGuards(JwtAuthGuard)
export class ClosingController {
  constructor(private readonly readiness: ClosingReadinessService) {}

  @Get('readiness')
  readinessOfPeriod(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query('unitId') unitId: string,
    @Query('periodId') periodId: string,
  ): Promise<ClosingReadinessResponse> {
    return this.readiness.readiness(
      { identityId: auth.sub, sessionId: auth.sid },
      { unitId, periodId },
    );
  }
}
