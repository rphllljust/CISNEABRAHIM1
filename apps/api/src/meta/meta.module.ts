import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';

/**
 * Módulo da engine de metadados.
 *
 * Global porque a engine é infraestrutura transversal: qualquer módulo que queira expor uma
 * entidade para renderização dinâmica depende dela, e importar o módulo em cada domínio
 * repetiria a mesma dependência sem ganho.
 */
@Global()
@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule],
  controllers: [MetaController],
  providers: [MetaService],
  exports: [MetaService],
})
export class MetaModule {}
