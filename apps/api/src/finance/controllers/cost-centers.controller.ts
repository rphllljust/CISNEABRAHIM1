import { Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { parseFinanceListQuery } from '../dto/finance-list.dto';
import { validateCreateCostCenterInput } from '../domain/payable.validation';
import { CostCentersAccessService } from '../services/cost-centers-access.service';

/**
 * CENTRO DE CUSTO — superficie HTTP.
 *
 * Rota propria (`finance/cost-centers`) e nao sufixo de `payables`: o recurso e o CADASTRO de
 * referencia, nao um titulo a pagar. A separacao tambem mantem o contrato de `payables` intacto
 * para os consumidores existentes.
 *
 * O schema de centro de custo nao existia antes da migration 0118; por isso esta superficie e
 * nova e nao substitui nenhuma outra.
 */
@Controller('finance/cost-centers')
@UseGuards(JwtAuthGuard)
export class CostCentersController {
  constructor(private readonly costCenters: CostCentersAccessService) {}

  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.costCenters.list(
      { identityId: auth.sub, sessionId: auth.sid },
      parseFinanceListQuery(query),
    );
  }

  @Get(':costCenterId')
  get(@CurrentAuth() auth: AccessTokenClaims, @Param('costCenterId') costCenterId: string) {
    return this.costCenters.get({ identityId: auth.sub, sessionId: auth.sid }, costCenterId);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    return this.costCenters.create(
      { identityId: auth.sub, sessionId: auth.sid },
      validateCreateCostCenterInput(request.body as never),
    );
  }
}
