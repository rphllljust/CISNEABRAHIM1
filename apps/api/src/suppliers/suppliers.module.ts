import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { ENTERPRISE_CORE_PORT } from '../platform/bounded-contexts/enterprise-core-ports';
import { SuppliersController } from './controllers/suppliers.controller';
import { SupplierMetadataController } from './controllers/supplier-metadata.controller';
import { SuppliersRepository } from './repositories/suppliers.repository';
import { SupplierAccessAuthz } from './services/supplier-access.authz';
import { SupplierAccessService } from './services/supplier-access.service';
import { SupplierMetadataService } from './services/supplier-metadata.service';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, AuditModule],
  controllers: [SuppliersController, SupplierMetadataController],
  providers: [
    SuppliersRepository,
    SupplierAccessAuthz,
    SupplierAccessService,
    SupplierMetadataService,
    {
      provide: ENTERPRISE_CORE_PORT.CommercialSupplier,
      useExisting: SupplierAccessService,
    },
  ],
  exports: [SupplierAccessService, SupplierMetadataService, ENTERPRISE_CORE_PORT.CommercialSupplier],
})
export class SuppliersModule {}
