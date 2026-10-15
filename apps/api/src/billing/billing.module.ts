import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DocumentsModule } from '../documents/documents.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { CommercialModule } from '../commercial/commercial.module';
import { MeasurementsModule } from '../measurements/measurements.module';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';
import { IssuerRegistryModule } from '../establishments/issuer-registry.module';
import { BillingController } from './controllers/billing.controller';
import { BillingDocumentController } from './controllers/billing-document.controller';
import { BillingWorklistController } from './controllers/billing-worklist.controller';
import { BillingRepository } from './repositories/billing.repository';
import { BillingDocumentRepository } from './repositories/billing-document.repository';
import { BillingAccessService } from './services/billing-access.service';
import { BillingDocumentAccessAuthz } from './services/billing-document-access.authz';
import { BillingDocumentAccessService } from './services/billing-document-access.service';
import { BillingDocumentArtifactService } from './services/billing-document-artifact.service';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AuthorizationModule,
    AuditModule,
    OutboxModule,
    DocumentsModule,
    CommercialModule,
    ServiceOrdersModule,
    MeasurementsModule,
    IssuerRegistryModule,
  ],
  controllers: [BillingController, BillingDocumentController, BillingWorklistController],
  providers: [
    BillingRepository,
    BillingDocumentRepository,
    BillingDocumentAccessAuthz,
    BillingDocumentArtifactService,
    BillingAccessService,
    BillingDocumentAccessService,
  ],
  exports: [
    BillingRepository,
    BillingDocumentRepository,
    BillingAccessService,
    BillingDocumentAccessService,
  ],
})
export class BillingModule {}
