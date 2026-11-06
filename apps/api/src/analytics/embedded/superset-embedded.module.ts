import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AuthorizationModule } from '../../authorization/authorization.module';
import { SupersetEmbeddedController } from './superset-embedded.controller';
import { SupersetEmbeddedService } from './superset-embedded.service';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [SupersetEmbeddedController],
  providers: [SupersetEmbeddedService],
})
export class SupersetEmbeddedModule {}
