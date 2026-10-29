import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { FinanceValidationFilter } from '../errors/finance-validation.filter';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { parseFinanceListQuery } from '../dto/finance-list.dto';
import {
  parseReceivableAdvancedFilter,
  type ReceivableAdvancedFilter,
} from '../repositories/receivable-list-sql';
import { FinanceHttpException } from '../errors/finance-http.exception';
import { FINANCE_ERROR_CODES } from '../errors/finance-error-codes';
import {
  validateCancelReceivableInput,
  validateReverseSettlementInput,
  validateSettleReceivableInput,
} from '../domain/receivable.validation';
import { ReceivablesAccessService } from '../services/receivables-access.service';

/**
 * Filtro composto inválido vira 400 com o código de validação do Financeiro.
 *
 * `parseAdvancedFilter` lança `AdvancedFilterParseError`, que é um `Error` comum: sem esta
 * conversão o `ApiExceptionFilter` (que só captura `HttpException`) não o trataria e o cliente
 * receberia 500 para um erro de entrada do operador. Recusar explicitamente também é o
 * comportamento correto: descartar a condição faria a tela exibir a lista inteira como se o
 * recorte tivesse sido aplicado.
 */
function parseReceivableAdvancedFilterOrThrow(
  value: unknown,
): ReceivableAdvancedFilter | undefined {
  try {
    return parseReceivableAdvancedFilter(value);
  } catch {
    throw new FinanceHttpException(
      HttpStatus.BAD_REQUEST,
      FINANCE_ERROR_CODES.VALIDATION_FAILED,
      'Invalid advanced filter.',
    );
  }
}

@Controller('finance/receivables')
@UseFilters(FinanceValidationFilter)
@UseGuards(JwtAuthGuard)
export class ReceivablesController {
  constructor(private readonly receivablesAccess: ReceivablesAccessService) {}

  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.receivablesAccess.list(
      { identityId: auth.sub, sessionId: auth.sid },
      {
        ...parseFinanceListQuery(query),
        // O filtro composto é validado contra o allow-list DESTA entidade antes de descer. Um
        // campo ou operador fora do contrato vira 400 aqui, e não um recorte silenciosamente
        // ignorado no SQL — que faria a lista inteira voltar como se fosse o resultado do filtro.
        advanced: parseReceivableAdvancedFilterOrThrow(query['filters']),
      },
    );
  }

  @Get('summary')
  summary(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.receivablesAccess.summary(
      { identityId: auth.sub, sessionId: auth.sid }, parseFinanceListQuery(query),
    );
  }

  @Get(':receivableId')
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('receivableId') receivableId: string) {
    return this.receivablesAccess.getById({ identityId: auth.sub, sessionId: auth.sid }, receivableId);
  }

  @Post(':receivableId/settlements')
  @HttpCode(200)
  settle(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('receivableId') receivableId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.receivablesAccess.settle(
      { identityId: auth.sub, sessionId: auth.sid },
      receivableId,
      validateSettleReceivableInput(request.body as never),
    );
  }

  @Post(':receivableId/settlements/:settlementId/reverse')
  @HttpCode(200)
  reverseSettlement(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('receivableId') receivableId: string,
    @Param('settlementId') settlementId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.receivablesAccess.reverseSettlement(
      { identityId: auth.sub, sessionId: auth.sid },
      receivableId,
      settlementId,
      validateReverseSettlementInput(request.body as never),
    );
  }

  @Post(':receivableId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('receivableId') receivableId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.receivablesAccess.cancel(
      { identityId: auth.sub, sessionId: auth.sid },
      receivableId,
      validateCancelReceivableInput(request.body as never),
    );
  }
}
