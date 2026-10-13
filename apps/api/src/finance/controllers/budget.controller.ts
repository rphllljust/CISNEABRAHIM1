import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { parseFinanceListQuery } from '../dto/finance-list.dto';
import {
  parseBudgetAdvancedFilter,
  type BudgetAdvancedFilter,
} from '../repositories/budget-list-sql';
import { FinanceHttpException } from '../errors/finance-http.exception';
import { FINANCE_ERROR_CODES } from '../errors/finance-error-codes';
import {
  validateApproveBudgetInput,
  validateCreateBudgetInput,
  validateCreateBudgetLineInput,
  validateCreateBudgetPeriodInput,
} from '../domain/budget.validation';
import { BudgetAccessService } from '../services/budget-access.service';

/**
 * Filtro composto inválido vira 400 com o código de validação do Financeiro.
 *
 * `parseAdvancedFilter` lança `AdvancedFilterParseError`, que é um `Error` comum: sem esta conversão
 * o `ApiExceptionFilter` (que só captura `HttpException`) não o trataria e o cliente receberia 500
 * para um erro de entrada do operador. Descartar a condição também seria errado: faria a tela exibir
 * a lista inteira como se o recorte tivesse sido aplicado.
 */
function parseBudgetAdvancedFilterOrThrow(value: unknown): BudgetAdvancedFilter | undefined {
  try {
    return parseBudgetAdvancedFilter(value);
  } catch {
    throw new FinanceHttpException(
      HttpStatus.BAD_REQUEST,
      FINANCE_ERROR_CODES.VALIDATION_FAILED,
      'Invalid advanced filter.',
    );
  }
}

@Controller('finance/budgets')
@UseGuards(JwtAuthGuard)
export class BudgetController {
  constructor(private readonly budgets: BudgetAccessService) {}

  @Post()
  @HttpCode(200)
  create(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.budgets.create({ identityId: auth.sub, sessionId: auth.sid }, validateCreateBudgetInput(body));
  }

  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.budgets.list(
      { identityId: auth.sub, sessionId: auth.sid },
      {
        ...parseFinanceListQuery(query),
        advanced: parseBudgetAdvancedFilterOrThrow(query['filters']),
      },
    );
  }

  @Get(':budgetId/comparison')
  compare(@CurrentAuth() auth: AccessTokenClaims, @Param('budgetId') budgetId: string) {
    return this.budgets.compare({ identityId: auth.sub, sessionId: auth.sid }, budgetId);
  }

  @Get(':budgetId')
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('budgetId') budgetId: string) {
    return this.budgets.getById({ identityId: auth.sub, sessionId: auth.sid }, budgetId);
  }

  @Post(':budgetId/periods')
  @HttpCode(200)
  addPeriod(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('budgetId') budgetId: string,
    @Body() body: never,
  ) {
    return this.budgets.addPeriod(
      { identityId: auth.sub, sessionId: auth.sid },
      budgetId,
      validateCreateBudgetPeriodInput(body),
    );
  }

  @Post(':budgetId/lines')
  @HttpCode(200)
  addLine(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('budgetId') budgetId: string,
    @Body() body: never,
  ) {
    return this.budgets.addLine(
      { identityId: auth.sub, sessionId: auth.sid },
      budgetId,
      validateCreateBudgetLineInput(body),
    );
  }

  @Post(':budgetId/approve')
  @HttpCode(200)
  approve(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('budgetId') budgetId: string,
    @Body() body: never,
  ) {
    // A versao carregada pelo aprovador e OBRIGATORIA: sem ela o servidor recusaria a
    // requisicao em vez de aprovar sobre um estado que pode ter mudado.
    const { version } = validateApproveBudgetInput(body);
    return this.budgets.approve({ identityId: auth.sub, sessionId: auth.sid }, budgetId, version);
  }

  @Post(':budgetId/versions')
  @HttpCode(200)
  createVersion(@CurrentAuth() auth: AccessTokenClaims, @Param('budgetId') budgetId: string) {
    return this.budgets.createVersion({ identityId: auth.sub, sessionId: auth.sid }, budgetId);
  }
}
