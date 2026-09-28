import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { parseBankStatementListQuery } from '../dto/bank-statement-list.dto';
import { BankReconciliationAccessService } from '../services/bank-reconciliation-access.service';

/**
 * Descoberta de extratos bancários.
 *
 * A conciliação antes só era alcançável por `GET /finance/bank-reconciliation/statements/:id`:
 * o operador precisava já saber o identificador. Este controller expõe a listagem autorizada,
 * paginada no servidor e recortada pelo escopo de unidade das concessões do ator.
 */
@Controller('finance/bank-statements')
@UseGuards(JwtAuthGuard)
export class BankStatementsController {
  constructor(private readonly reconciliation: BankReconciliationAccessService) {}

  @Get()
  listStatements(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.reconciliation.listStatements(
      { identityId: auth.sub, sessionId: auth.sid },
      parseBankStatementListQuery(query),
    );
  }
}
