import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { AlertsModule } from '../alerts/alerts.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { FinanceModule } from '../finance/finance.module';
import { RequestsModule } from '../requests/requests.module';
import { WorkInboxController } from './controllers/work-inbox.controller';
import { WorkInboxService } from './services/work-inbox.service';
import { AccountingWorkSource } from './sources/accounting.source';
import { AlertsWorkSource } from './sources/alerts.source';
import { CommercialWorkSource } from './sources/commercial.source';
import { FinanceWorkSource } from './sources/finance.source';
import { WORK_ITEM_SOURCES, type WorkItemSource } from './sources/work-item-source';

/**
 * UNIFIED WORK INBOX — modulo da fila unica de trabalho.
 *
 * Cada fonte entra com a autoridade do PROPRIO dominio (os servicos de acesso injetados pelos modulos
 * abaixo). Este modulo nao declara politica de acesso, nao escreve SQL e nao executa nada: ele apenas
 * compoe as fontes que ja leem, cada uma no seu dominio, e publica a fila agregada.
 *
 * Todas as fontes sao registradas como provedores (para poderem ser testadas/injetadas
 * isoladamente) e a MESMA instancia e publicada na lista do token `WORK_ITEM_SOURCES` — a ordem
 * declarada aqui e a ordem de coleta.
 */
@Module({
  imports: [
    AlertsModule,
    FinanceModule,
    AccountingModule,
    RequestsModule,
    AuthModule,
    AuthorizationModule,
  ],
  controllers: [WorkInboxController],
  providers: [
    WorkInboxService,
    AlertsWorkSource,
    FinanceWorkSource,
    AccountingWorkSource,
    CommercialWorkSource,
    {
      provide: WORK_ITEM_SOURCES,
      useFactory: (
        alerts: AlertsWorkSource,
        finance: FinanceWorkSource,
        accounting: AccountingWorkSource,
        commercial: CommercialWorkSource,
      ): WorkItemSource[] => [alerts, finance, accounting, commercial],
      inject: [AlertsWorkSource, FinanceWorkSource, AccountingWorkSource, CommercialWorkSource],
    },
  ],
  exports: [WorkInboxService, WORK_ITEM_SOURCES],
})
export class WorkInboxModule {}
