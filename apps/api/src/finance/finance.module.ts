import { Global, Module } from '@nestjs/common';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { ENTERPRISE_CORE_PORT } from '../platform/bounded-contexts/enterprise-core-ports';
import { CollectionsController } from './controllers/collections.controller';
import { ExpensesController } from './controllers/expenses.controller';
import { PayablesController } from './controllers/payables.controller';
import { ReceivablesController } from './controllers/receivables.controller';
import { TreasuryController } from './controllers/treasury.controller';
import { BankReconciliationController } from './controllers/bank-reconciliation.controller';
import { BankStatementsController } from './controllers/bank-statements.controller';
import { BudgetController } from './controllers/budget.controller';
import { CashFlowForecastController } from './controllers/cash-flow-forecast.controller';
import { BankReconciliationRepository } from './repositories/bank-reconciliation.repository';
import { BudgetRepository } from './repositories/budget.repository';
import { BankReconciliationAccessService } from './services/bank-reconciliation-access.service';
import { BudgetAccessAuthz } from './services/budget-access.authz';
import { BudgetAccessService } from './services/budget-access.service';
import { CashFlowForecastRepository } from './repositories/cash-flow-forecast.repository';
import { CashFlowForecastAccessAuthz } from './services/cash-flow-forecast-access.authz';
import { CashFlowForecastAccessService } from './services/cash-flow-forecast-access.service';
import { ExpenseFailureInjection } from './domain/expense-failure-injection';
import { CollectionsRepository } from './repositories/collections.repository';
import { ExpenseRepository } from './repositories/expense.repository';
import { PayablesRepository } from './repositories/payables.repository';
import { ExpenseAccessAuthz } from './services/expense-access.authz';
import { ExpenseAccessService } from './services/expense-access.service';
import { ReceivablesRepository } from './repositories/receivables.repository';
import { TreasuryRepository } from './repositories/treasury.repository';
import { PayablesAccessAuthz } from './services/payables-access.authz';
import { PayablesAccessService } from './services/payables-access.service';
import { CollectionsAccessAuthz } from './services/collections-access.authz';
import { CollectionsAccessService } from './services/collections-access.service';
import { ReceivablesAccessAuthz } from './services/receivables-access.authz';
import { ReceivablesAccessService } from './services/receivables-access.service';
import { TreasuryAccessAuthz } from './services/treasury-access.authz';
import { TreasuryAccessService } from './services/treasury-access.service';

@Global()
@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, AuditModule, SuppliersModule],
  controllers: [
    ReceivablesController,
    CollectionsController,
    PayablesController,
    ExpensesController,
    TreasuryController,
    BankReconciliationController,
    BankStatementsController,
    BudgetController,
    CashFlowForecastController,
  ],
  providers: [
    ReceivablesRepository,
    ReceivablesAccessAuthz,
    ReceivablesAccessService,
    CollectionsRepository,
    CollectionsAccessAuthz,
    CollectionsAccessService,
    PayablesRepository,
    PayablesAccessAuthz,
    PayablesAccessService,
    ExpenseRepository,
    ExpenseAccessAuthz,
    ExpenseAccessService,
    ExpenseFailureInjection,
    TreasuryRepository,
    TreasuryAccessAuthz,
    TreasuryAccessService,
    BankReconciliationRepository,
    BankReconciliationAccessService,
    BudgetRepository,
    BudgetAccessAuthz,
    BudgetAccessService,
    CashFlowForecastRepository,
    CashFlowForecastAccessAuthz,
    CashFlowForecastAccessService,
    {
      provide: ENTERPRISE_CORE_PORT.FinanceReceivable,
      useExisting: ReceivablesAccessService,
    },
    {
      provide: ENTERPRISE_CORE_PORT.FinancePayable,
      useExisting: PayablesAccessService,
    },
  ],
  exports: [
    ReceivablesAccessService,
    CollectionsAccessService,
    PayablesAccessService,
    ExpenseAccessService,
    ExpenseFailureInjection,
    TreasuryAccessService,
    BankReconciliationAccessService,
    BudgetAccessService,
    CashFlowForecastAccessService,
    ENTERPRISE_CORE_PORT.FinanceReceivable,
    ENTERPRISE_CORE_PORT.FinancePayable,
  ],
})
export class FinanceModule {}
