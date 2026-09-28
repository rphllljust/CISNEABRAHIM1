import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { BusinessChainController } from './controllers/business-chain.controller';
import { BusinessChainRepository } from './repositories/business-chain.repository';
import { BusinessChainService } from './services/business-chain.service';

/**
 * BUSINESS CHAIN — modulo da linhagem de negocio ponta a ponta.
 *
 * Este modulo NAO tem dominio proprio: ele nao escreve, nao possui tabela e nao guarda estado.
 * Ele segue as FKs que os dominios donos ja mantem, atraves do contrato de leitura entre
 * contextos (`rpt.read_*`), e aplica a autorizacao com o MESMO ponto de decisao
 * (`PolicyDecisionPointService`) que os dominios usam — nenhuma politica paralela, nenhuma
 * segunda fonte de verdade.
 *
 * Nao depende de nenhum modulo de dominio: isso e deliberado. A cadeia le o contrato publicado
 * pelos contextos (views de leitura e tabelas de proveniencia), nunca o servico interno de outro
 * modulo, para que a linhagem nao crie acoplamento novo entre dominios.
 */
@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule],
  controllers: [BusinessChainController],
  providers: [BusinessChainRepository, BusinessChainService],
  exports: [BusinessChainService],
})
export class BusinessChainModule {}
