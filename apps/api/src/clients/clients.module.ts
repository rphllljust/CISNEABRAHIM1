import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { ENTERPRISE_CORE_PORT } from '../platform/bounded-contexts/enterprise-core-ports';
import { ClientsController } from './controllers/clients.controller';
import { ClientsRepository } from './repositories/clients.repository';
import { ClientAccessService } from './services/client-access.service';
import { ClientAuditService } from './services/client-audit.service';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, AuditModule],
  controllers: [ClientsController],
  providers: [
    ClientsRepository,
    ClientAccessService,
    /**
     * Trilha de auditoria do cadastro. Depende do `AuditModule`, que é o dono do schema `audit` —
     * o serviço de Clientes nunca escreve SQL contra esse schema diretamente.
     */
    ClientAuditService,
    {
      provide: ENTERPRISE_CORE_PORT.CommercialClient,
      useExisting: ClientAccessService,
    },
  ],
  exports: [ClientAccessService, ENTERPRISE_CORE_PORT.CommercialClient],
})
export class ClientsModule {}
