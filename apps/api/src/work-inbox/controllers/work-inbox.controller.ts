import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import {
  WorkInboxService,
  type WorkInboxQuery,
} from '../services/work-inbox.service';

/**
 * UNIFIED WORK INBOX — uma requisicao monta a fila real de todo o ERP.
 *
 * Somente leitura. A Inbox e torre de controle + navegacao para resolucao: nenhuma
 * transicao sensivel e executada aqui, e a autorizacao de cada objeto continua sendo
 * decidida no modulo dono (as fontes reutilizam os servicos de acesso daquele dominio).
 */
@Controller('work-inbox')
@UseGuards(JwtAuthGuard)
export class WorkInboxController {
  constructor(private readonly workInbox: WorkInboxService) {}

  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: WorkInboxQuery) {
    return this.workInbox.list({ identityId: auth.sub, sessionId: auth.sid }, query);
  }
}
