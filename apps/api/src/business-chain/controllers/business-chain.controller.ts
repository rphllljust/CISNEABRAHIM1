import { BadRequestException, Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { assertUuid } from '../../platform/kernel/uuid';
import { BUSINESS_CHAIN_NODE_KINDS, type BusinessChainNodeKind } from '../contracts/business-chain.contract';
import { BusinessChainService } from '../services/business-chain.service';

/**
 * BUSINESS CHAIN — UMA requisicao monta a linhagem inteira de negocio.
 *
 * `GET /business-chain/:anchorKind/:anchorId`
 *
 *   anchorKind ∈ CLIENT | SERVICE_REQUEST | PROPOSAL | PURCHASE_ORDER | SERVICE_ORDER |
 *                MEASUREMENT | BILLING_DOCUMENT | RECEIVABLE
 *
 * Somente leitura. Nenhuma transicao e executada aqui: a cadeia e LIDA, nao conduzida.
 *
 * A object page nao dispara uma requisicao por no da cadeia — ela dispara UMA. Toda a
 * autorizacao ja foi aplicada no servidor: o que o ator nao pode ler nao vem na resposta.
 */
@Controller('business-chain')
@UseGuards(JwtAuthGuard)
export class BusinessChainController {
  constructor(private readonly businessChain: BusinessChainService) {}

  @Get(':anchorKind/:anchorId')
  getChain(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('anchorKind') anchorKind: string,
    @Param('anchorId') anchorId: string,
  ) {
    const kind = resolveAnchorKind(anchorKind);
    assertUuid(anchorId, 'anchorId');
    return this.businessChain.getChain({ identityId: auth.sub, sessionId: auth.sid }, kind, anchorId);
  }
}

/** O vocabulario do anchor e FECHADO: rota inexistente nao vira leitura generica. */
function resolveAnchorKind(value: string): BusinessChainNodeKind {
  const candidate = value.trim().toUpperCase();
  const match = BUSINESS_CHAIN_NODE_KINDS.find((kind) => kind === candidate);
  if (!match) {
    throw new BadRequestException({ code: 'BUSINESS_CHAIN_UNKNOWN_ANCHOR_KIND' });
  }
  return match;
}
