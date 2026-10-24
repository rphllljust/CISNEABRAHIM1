import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { ENTERPRISE_CORE_PORT } from '../platform/bounded-contexts/enterprise-core-ports';
import { InventoryController } from './controllers/inventory.controller';
import { InventoryRepository } from './repositories/inventory.repository';
import { InventoryAccessAuthz } from './services/inventory-access.authz';
import { InventoryAccessService } from './services/inventory-access.service';
import { InventoryAccountingIntegrationService } from './services/inventory-accounting-integration.service';

/**
 * INVENTORY write owner of inv.*. InventoryItem is quantity stock, not a physical asset.
 * Costing stays UNDECIDED until a business decision. Ledger writes go through Accounting.
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
  controllers: [InventoryController],
  providers: [
    InventoryRepository,
    InventoryAccessAuthz,
    InventoryAccountingIntegrationService,
    InventoryAccessService,
    {
      provide: ENTERPRISE_CORE_PORT.InventoryStock,
      useExisting: InventoryAccessService,
    },
  ],
  exports: [
    InventoryAccessService,
    InventoryAccountingIntegrationService,
    ENTERPRISE_CORE_PORT.InventoryStock,
  ],
})
export class InventoryModule {}
