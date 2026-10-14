import { Controller, Get, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { FinanceHttpException } from '../errors/finance-http.exception';
import { FINANCE_ERROR_CODES } from '../errors/finance-error-codes';
import { ClientFinancialContextService } from '../services/client-financial-context.service';

/**
 * CONTEXTO FINANCEIRO DO CLIENTE — POR CLIENTE, NÃO POR TÍTULO.
 *
 * A rota vive sob `finance/receivables` porque é ali que mora o vocabulário de autorização
 * (`finance:receivable:list`) e porque o RECURSO é um título a receber recortado por Cliente. A
 * ficha do Cliente consome este endpoint; ela não lê `fin.receivables` nem soma páginas.
 *
 * A UUID do cliente é validada AQUI e não desce como texto: um identificador malformado produziria
 * erro de cast no banco (500) em vez de 400 — um erro do operador virando falha do servidor.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('finance/receivables/clients')
@UseGuards(JwtAuthGuard)
export class ClientFinancialContextController {
  constructor(private readonly clientFinancialContext: ClientFinancialContextService) {}

  @Get(':clientId/financial-context')
  getForClient(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
  ) {
    if (!UUID_PATTERN.test(clientId)) {
      throw new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.VALIDATION_FAILED,
        'Invalid client id.',
      );
    }
    return this.clientFinancialContext.forClient(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
    );
  }
}
