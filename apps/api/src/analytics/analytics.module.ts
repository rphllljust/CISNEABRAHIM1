import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { AgingController } from './controllers/aging.controller';
import { ComplianceController } from './controllers/compliance.controller';
import { OperationalProfitabilityController } from './controllers/operational-profitability.controller';
import { ProductivityController } from './controllers/productivity.controller';
import { AgingReadModelRepository } from './repositories/aging-read-model.repository';
import { ComplianceReadModelRepository } from './repositories/compliance-read-model.repository';
import { OperationalProfitabilityReadModelRepository } from './repositories/operational-profitability-read-model.repository';
import { ProductivityReadModelRepository } from './repositories/productivity-read-model.repository';
import { AgingAccessService } from './services/aging-access.service';
import { ComplianceAccessService } from './services/compliance-access.service';
import { OperationalProfitabilityAccessService } from './services/operational-profitability-access.service';
import { ProductivityAccessService } from './services/productivity-access.service';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule],
  controllers: [
    AgingController,
    ProductivityController,
    OperationalProfitabilityController,
    ComplianceController,
  ],
  providers: [
    AgingReadModelRepository,
    AgingAccessService,
    ProductivityReadModelRepository,
    ProductivityAccessService,
    OperationalProfitabilityReadModelRepository,
    OperationalProfitabilityAccessService,
    ComplianceReadModelRepository,
    ComplianceAccessService,
  ],
  exports: [
    AgingAccessService,
    ProductivityAccessService,
    ProductivityReadModelRepository,
    OperationalProfitabilityAccessService,
    OperationalProfitabilityReadModelRepository,
    ComplianceAccessService,
    ComplianceReadModelRepository,
  ],
})
export class AnalyticsModule {}
