import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';
import { MeasurementsAcceptanceAuthz } from './application/measurements-acceptance.authz';
import { MeasurementsCapabilityService } from './application/measurements-capability.service';
import {
  MeasurementAcceptanceCommandController,
  MeasurementWorkbenchQueryController,
} from './controllers/measurement-workbench.controller';
import { MeasurementOperationsQueryController } from './controllers/measurement-operations.controller';
import { MeasurementsController } from './controllers/measurements.controller';
import { MeasurementCapabilityRepository } from './repositories/measurement-capability.repository';
import { MeasurementsRepository } from './repositories/measurements.repository';
import { MeasurementsAccessAuthz } from './services/measurements-access.authz';
import { MeasurementsAccessService } from './services/measurements-access.service';
import { MeasurementsCommercialResolutionService } from './services/measurements-commercial-resolution.service';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, AuditModule, OutboxModule, ServiceOrdersModule],
  controllers: [
    MeasurementsController,
    // MEASUREMENT → ACCEPTANCE → BILLING READINESS — leitura e comando separados.
    MeasurementWorkbenchQueryController,
    MeasurementOperationsQueryController,
    MeasurementAcceptanceCommandController,
  ],
  providers: [
    MeasurementsRepository,
    MeasurementCapabilityRepository,
    MeasurementsAccessAuthz,
    MeasurementsAcceptanceAuthz,
    MeasurementsCommercialResolutionService,
    MeasurementsAccessService,
    MeasurementsCapabilityService,
  ],
  exports: [MeasurementsRepository, MeasurementsAccessService, MeasurementsCapabilityService],
})
export class MeasurementsModule {}
