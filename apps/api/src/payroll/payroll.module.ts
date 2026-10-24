import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { ENTERPRISE_CORE_PORT } from '../platform/bounded-contexts/enterprise-core-ports';
import { PayrollController } from './controllers/payroll.controller';
import { PayrollRepository } from './repositories/payroll.repository';
import { PayrollAccessAuthz } from './services/payroll-access.authz';
import { PayrollAccessService } from './services/payroll-access.service';
import { PayrollAccountingIntegrationService } from './services/payroll-accounting-integration.service';

/**
 * PAYROLL write owner of pay.*. EmploymentContract is not Person identity.
 * Legal formulas remain UNDECIDED. CLOSED periods are immutable.
 * Ledger writes go through Accounting via PayrollClosed / PayrollReopened.
 */
@Global()
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AuthorizationModule,
    AuditModule,
    /**
     * F1.2 — o repositorio publica o fato economico na outbox transacional, dentro da
     * propria transacao do comando. DOMINIO -> PLATFORM e dependencia permitida.
     */
    OutboxModule,
  ],
  controllers: [PayrollController],
  providers: [
    PayrollRepository,
    PayrollAccessAuthz,
    PayrollAccountingIntegrationService,
    PayrollAccessService,
    {
      provide: ENTERPRISE_CORE_PORT.PayrollContract,
      useExisting: PayrollAccessService,
    },
  ],
  exports: [
    PayrollAccessService,
    PayrollAccountingIntegrationService,
    ENTERPRISE_CORE_PORT.PayrollContract,
  ],
})
export class PayrollModule {}
