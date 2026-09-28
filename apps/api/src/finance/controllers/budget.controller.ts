import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { parseFinanceListQuery } from '../dto/finance-list.dto';
import {
  validateCreateBudgetInput,
  validateCreateBudgetLineInput,
  validateCreateBudgetPeriodInput,
} from '../domain/budget.validation';
import { BudgetAccessService } from '../services/budget-access.service';

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
      parseFinanceListQuery(query),
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
  approve(@CurrentAuth() auth: AccessTokenClaims, @Param('budgetId') budgetId: string) {
    return this.budgets.approve({ identityId: auth.sub, sessionId: auth.sid }, budgetId);
  }

  @Post(':budgetId/versions')
  @HttpCode(200)
  createVersion(@CurrentAuth() auth: AccessTokenClaims, @Param('budgetId') budgetId: string) {
    return this.budgets.createVersion({ identityId: auth.sub, sessionId: auth.sid }, budgetId);
  }
}
