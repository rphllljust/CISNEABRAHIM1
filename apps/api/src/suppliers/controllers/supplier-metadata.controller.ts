import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { SupplierAccessService } from '../services/supplier-access.service';
import {
  SupplierMetadataService,
  type SupplierAuditTimelineResponse,
  type SupplierAvailableActionsResponse,
  type SupplierCommandCatalogResponse,
} from '../services/supplier-metadata.service';

/**
 * Endpoints "meta" de Fornecedor (Fase B).
 *
 * Espelha `ServiceOrderMetadataController` (B5) propositalmente: mesmo shape de rota,
 * mesmo gate de acesso por `getById`, mesmo contrato de resposta. É essa simetria que
 * permite que o frontend consuma Fornecedores com os componentes genéricos que já servem OS.
 *
 * O que NÃO é compartilhado (e é específico do domínio): o mapa de comandos, que vive em
 * `SupplierMetadataService` e não importa `service-orders/domain/`.
 */
@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SupplierMetadataController {
  constructor(
    private readonly metadata: SupplierMetadataService,
    private readonly suppliers: SupplierAccessService,
  ) {}

  /**
   * Catálogo global de comandos do fornecedor.
   *
   * Rota declarada ANTES de `:supplierId` para não ser capturada como id — mesma precaução
   * que `command-catalog` exigiu em service-orders.
   */
  @Get('command-catalog')
  getCommandCatalog(): SupplierCommandCatalogResponse {
    return this.metadata.getCommandCatalog();
  }

  /** Comandos válidos para o fornecedor no estado atual, com a permissão de cada um. */
  @Get(':supplierId/available-actions')
  async getAvailableActions(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('supplierId') supplierId: string,
  ): Promise<SupplierAvailableActionsResponse> {
    const actor = { identityId: auth.sub, sessionId: auth.sid };
    // Gate de acesso reutilizado: fornecedor inexistente ou fora de escopo para aqui.
    const supplier = await this.suppliers.getById(actor, supplierId);
    const permissions = await this.metadata.getEffectivePermissions(actor);

    return this.metadata.getAvailableActions(supplierId, supplier.status, permissions);
  }

  /** Trilha de auditoria do fornecedor, em ordem cronológica. */
  @Get(':supplierId/audit-timeline')
  async getAuditTimeline(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('supplierId') supplierId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<SupplierAuditTimelineResponse> {
    const actor = { identityId: auth.sub, sessionId: auth.sid };
    await this.suppliers.getById(actor, supplierId);

    return this.metadata.getAuditTimeline(
      supplierId,
      parseOptionalInt(query['limit']),
      parseOptionalInt(query['offset']),
    );
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
