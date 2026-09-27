import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { parseFinanceListQuery } from '../dto/finance-list.dto';
import type {
  CreateExpenseInput,
  ExpenseVersionInput,
  RejectExpenseInput,
} from '../domain/expense.validation';
import { ExpenseAccessService } from '../services/expense-access.service';

@Controller('finance/expenses')
@UseGuards(JwtAuthGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpenseAccessService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentAuth() auth: AccessTokenClaims, @Body() body: CreateExpenseInput) {
    return this.expenses.create({ identityId: auth.sub, sessionId: auth.sid }, body);
  }

  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.expenses.list(
      { identityId: auth.sub, sessionId: auth.sid },
      parseFinanceListQuery(query),
    );
  }

  @Get(':expenseId')
  get(@CurrentAuth() auth: AccessTokenClaims, @Param('expenseId') expenseId: string) {
    return this.expenses.get({ identityId: auth.sub, sessionId: auth.sid }, expenseId);
  }

  @Post(':expenseId/submit')
  submit(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('expenseId') expenseId: string,
    @Body() body: ExpenseVersionInput,
  ) {
    return this.expenses.submit({ identityId: auth.sub, sessionId: auth.sid }, expenseId, body);
  }

  @Post(':expenseId/approve')
  approve(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('expenseId') expenseId: string,
    @Body() body: ExpenseVersionInput,
  ) {
    return this.expenses.approve({ identityId: auth.sub, sessionId: auth.sid }, expenseId, body);
  }

  @Post(':expenseId/reject')
  reject(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('expenseId') expenseId: string,
    @Body() body: RejectExpenseInput,
  ) {
    return this.expenses.reject({ identityId: auth.sub, sessionId: auth.sid }, expenseId, body);
  }
}
