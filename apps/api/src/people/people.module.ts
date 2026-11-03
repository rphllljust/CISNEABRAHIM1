import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { PeopleController } from './controllers/people.controller';
import { PeopleRepository } from './repositories/people.repository';
import { PersonAccessService } from './services/person-access.service';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, AuditModule, ServiceOrdersModule],
  controllers: [PeopleController],
  providers: [PeopleRepository, PersonAccessService],
  exports: [PersonAccessService],
})
export class PeopleModule {}
