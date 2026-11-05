import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { DocumentsModule } from '../documents/documents.module';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';
import { ServiceRequestsController } from './controllers/service-requests.controller';
import { ServiceRequestsRepository } from './repositories/service-requests.repository';
import { ServiceRequestsAccessAuthz } from './services/service-requests-access.authz';
import { ServiceRequestsAccessAudit } from './services/service-requests-access.audit';
import { ServiceRequestsAccessCommands } from './services/service-requests-access.commands';
import { ServiceRequestsAccessIdempotency } from './services/service-requests-access.idempotency';
import { ServiceRequestsAccessPersistence } from './services/service-requests-access.persistence';
import { ServiceRequestsAccessQuery } from './services/service-requests-access.query';
import { ServiceRequestsAccessService } from './services/service-requests-access.service';
import { ServiceRequestsDocumentEvidenceService } from './services/service-requests-document-evidence.service';
import { ServiceRequestsAccessValidation } from './services/service-requests-access.validation';
import { ServiceRequestsReferenceValidationService } from './services/service-requests-reference-validation.service';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, AuditModule, OutboxModule, ServiceOrdersModule, DocumentsModule],
  controllers: [ServiceRequestsController],
  providers: [
    ServiceRequestsRepository,
    ServiceRequestsAccessAuthz,
    ServiceRequestsAccessAudit,
    ServiceRequestsAccessPersistence,
    ServiceRequestsAccessValidation,
    ServiceRequestsAccessQuery,
    ServiceRequestsAccessIdempotency,
    ServiceRequestsAccessCommands,
    ServiceRequestsDocumentEvidenceService,
    ServiceRequestsReferenceValidationService,
    ServiceRequestsAccessService,
  ],
  exports: [ServiceRequestsRepository, ServiceRequestsAccessService],
})
export class RequestsModule {}
