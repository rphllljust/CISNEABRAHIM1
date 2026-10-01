import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import type { ServiceOrderStatus } from '../domain/service-order';
import { ServiceOrdersAccessService } from '../services/service-orders-access.service';
import {
  ServiceOrderMetadataService,
  type AuditTimelineResponse,
  type AvailableActionsResponse,
  type CommandCatalogResponse,
  type MeResponse,
} from '../services/service-order-metadata.service';

/**
 * Metadados de OS e identidade do usuario (B4).
 *
 * Estes endpoints APENAS EXPOEM o que o backend ja sabe, em contrato fixo
 * consumivel pelo frontend. Nenhuma regra de negocio, nenhum estado novo,
 * nenhum comando novo.
 *
 * ACESSO A OS: reutiliza `ServiceOrdersAccessService.getById`, que ja aplica
 * `requireServiceOrder` + `assertRecordAction` (RBAC/PDP + scope enforcement).
 * NAO existe segundo caminho de autorizacao. Consequencia declarada: uma OS
 * fora do escopo do usuario responde **403** (`SERVICE_ORDERS_DENIED`), que e
 * o comportamento vigente e testado do repositorio (ver
 * `documents.e2e.spec.ts:317` e `contextual-scope.e2e.spec.ts:139`), e nao 404.
 */
@Controller('service-orders')
@UseGuards(JwtAuthGuard)
export class ServiceOrderMetadataController {
  constructor(
    private readonly metadata: ServiceOrderMetadataService,
    private readonly serviceOrdersAccess: ServiceOrdersAccessService,
  ) {}

  /**
   * Catalogo global de comandos da state machine.
   *
   * Rota declarada ANTES de `:serviceOrderId` para que `command-catalog` nao
   * seja capturado como id de OS.
   */
  @Get('command-catalog')
  getCommandCatalog(): CommandCatalogResponse {
    return this.metadata.getCommandCatalog();
  }

  /** Comandos validos para uma OS neste estado, com a permissao de cada um. */
  @Get(':serviceOrderId/available-actions')
  async getAvailableActions(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
  ): Promise<AvailableActionsResponse> {
    const actor = { identityId: auth.sub, sessionId: auth.sid };
    const detail = await this.serviceOrdersAccess.getById(actor, serviceOrderId);
    const permissions = await this.metadata.getEffectivePermissions(actor);

    return this.metadata.getAvailableActions(
      serviceOrderId,
      detail.status as ServiceOrderStatus,
      permissions,
    );
  }

  /** Trilha de auditoria da OS, em ordem cronologica. */
  @Get(':serviceOrderId/audit-timeline')
  async getAuditTimeline(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<AuditTimelineResponse> {
    const actor = { identityId: auth.sub, sessionId: auth.sid };
    // Gate de acesso reutilizado: OS inexistente ou fora de escopo para aqui.
    await this.serviceOrdersAccess.getById(actor, serviceOrderId);

    return this.metadata.getAuditTimeline(
      serviceOrderId,
      parseOptionalInt(query['limit']),
      parseOptionalInt(query['offset']),
    );
  }
}

/**
 * Controller separado de `/me` — o recurso nao pertence a `service-orders`.
 * Mesmo modulo (ServiceOrdersModule), para nao criar modulo novo.
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly metadata: ServiceOrderMetadataService) {}

  @Get()
  getMe(@CurrentAuth() auth: AccessTokenClaims): Promise<MeResponse> {
    return this.metadata.getMe({ identityId: auth.sub, sessionId: auth.sid });
  }
}

function parseOptionalInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
