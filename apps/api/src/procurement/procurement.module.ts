import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { ENTERPRISE_CORE_PORT } from '../platform/bounded-contexts/enterprise-core-ports';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { ProcurementController } from './controllers/procurement.controller';
import { SupplierInvoicesController } from './controllers/supplier-invoices.controller';
import { ThreeWayMatchController } from './controllers/three-way-match.controller';
import { ProcurementFailureInjection } from './domain/procurement-failure-injection';
import { ProcurementRepository } from './repositories/procurement.repository';
import { SupplierInvoiceRepository } from './repositories/supplier-invoice.repository';
import { ThreeWayMatchRepository } from './repositories/three-way-match.repository';
import { ProcurementAccessAuthz } from './services/procurement-access.authz';
import { ProcurementAccessService } from './services/procurement-access.service';
import { ProcurementReceiptEvidenceService } from './services/procurement-receipt-evidence.service';
import { SupplierInvoiceAccessService } from './services/supplier-invoice-access.service';
import { ThreeWayMatchAccessService } from './services/three-way-match-access.service';

@Global()
@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, AuditModule, SuppliersModule],
  controllers: [ProcurementController, SupplierInvoicesController, ThreeWayMatchController],
  providers: [
    ProcurementRepository,
    SupplierInvoiceRepository,
    ThreeWayMatchRepository,
    ProcurementAccessAuthz,
    ProcurementFailureInjection,
    ProcurementAccessService,
    ProcurementReceiptEvidenceService,
    { provide: ENTERPRISE_CORE_PORT.ProcurementReceiptEvidence, useExisting: ProcurementReceiptEvidenceService },
    SupplierInvoiceAccessService,
    ThreeWayMatchAccessService,
  ],
  exports: [
    ProcurementAccessService,
    ENTERPRISE_CORE_PORT.ProcurementReceiptEvidence,
    SupplierInvoiceAccessService,
    ThreeWayMatchAccessService,
    ProcurementFailureInjection,
  ],
})
export class ProcurementModule {}
