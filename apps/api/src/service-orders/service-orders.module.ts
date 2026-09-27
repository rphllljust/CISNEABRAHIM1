import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { CommercialModule } from '../commercial/commercial.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { SERVICE_REQUEST_CONVERSION_PORT } from '../requests/domain/service-request-conversion.port';
import { ServiceOrderExecutionController } from './controllers/service-order-execution.controller';
import { OperationalCostController } from './controllers/operational-cost.controller';
import { ServiceOrdersController } from './controllers/service-orders.controller';
import { ServiceOrderPlanningController } from './controllers/service-order-planning.controller';
import { ServiceOrderExecutionRepository } from './repositories/service-order-execution.repository';
import { OperationalCostRepository } from './repositories/operational-cost.repository';
import { ServiceOrdersRepository } from './repositories/service-orders.repository';
import { ResourcePlanningRepository } from './repositories/resource-planning.repository';
import { ServiceOrdersAccessAuthz } from './services/service-orders-access.authz';
import { ServiceOrderExecutionAccessService } from './services/service-order-execution-access.service';
import { OperationalCostAccessService } from './services/operational-cost-access.service';
import { ServiceOrdersAccessService } from './services/service-orders-access.service';
import { ServiceOrderControlCenterAuthz } from './services/service-order-control-center.authz';
import { ServiceOrderPlanningAccessService } from './services/service-order-planning-access.service';
import { ServiceOrdersReferenceValidationService } from './services/service-orders-reference-validation.service';
import { ServiceRequestConversionService } from './services/service-request-conversion.service';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, AuditModule, OutboxModule, CommercialModule],
  controllers: [ServiceOrdersController, ServiceOrderPlanningController, ServiceOrderExecutionController, OperationalCostController],
  providers: [
    ServiceOrdersRepository,
    ResourcePlanningRepository,
    ServiceOrderExecutionRepository,
    OperationalCostRepository,
    ServiceOrdersAccessAuthz,
    ServiceOrdersReferenceValidationService,
    ServiceOrdersAccessService,
    ServiceOrderControlCenterAuthz,
    ServiceOrderPlanningAccessService,
    ServiceOrderExecutionAccessService,
    OperationalCostAccessService,
    ServiceRequestConversionService,
    {
      provide: SERVICE_REQUEST_CONVERSION_PORT,
      useExisting: ServiceRequestConversionService,
    },
  ],
  exports: [
    SERVICE_REQUEST_CONVERSION_PORT,
    ServiceOrdersRepository,
    ServiceOrdersAccessService,
    ServiceOrderControlCenterAuthz,
    ResourcePlanningRepository,
    ServiceOrderPlanningAccessService,
    ServiceOrderExecutionAccessService,
    OperationalCostAccessService,
  ],
})
export class ServiceOrdersModule {}
