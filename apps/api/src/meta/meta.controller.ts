import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../auth/services/token.service';
import {
  MetaEntityNotFoundError,
  MetaService,
  type MetaEntitySchema,
  type MetaFieldDefinition,
  type MetaViewDefinition,
  type MetaWorkflowDefinition,
} from './meta.service';

/**
 * API de metadados (Camada 2 da engine).
 *
 * Toda resposta é filtrada pelo ator: campos acima do `permLevel` dele não saem daqui. O
 * frontend não decide o que esconder — ele recebe apenas o que pode renderizar.
 *
 * Só exige autenticação (`JwtAuthGuard`). Não exige permissão por entidade porque o
 * metadado JÁ é a resposta filtrada: um ator sem `service-orders:service-order:read` recebe
 * o schema sem os campos de nível restrito, e as transições vêm com `allowed: false`. Quem
 * barra a LEITURA do recurso continua sendo o módulo dono, na rota de dados.
 */
@Controller('meta')
@UseGuards(JwtAuthGuard)
export class MetaController {
  constructor(private readonly meta: MetaService) {}

  /** Entidades registradas no metadata store. */
  @Get()
  listEntities() {
    return this.meta.listEntities();
  }

  /** Schema completo: campos + views + workflow + permissões do ator. */
  @Get(':entity')
  async getEntity(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('entity') entity: string,
  ): Promise<MetaEntitySchema> {
    return this.run(() => this.meta.getEntitySchema(entity, this.actor(auth)));
  }

  /** Apenas os campos. */
  @Get(':entity/fields')
  async getFields(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('entity') entity: string,
  ): Promise<MetaFieldDefinition[]> {
    return this.run(() => this.meta.getEntityFields(entity, this.actor(auth)));
  }

  /** View específica de uma superfície (`form`/`list`/`kanban`/`calendar`). */
  @Get(':entity/views/:viewType')
  async getView(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('entity') entity: string,
    @Param('viewType') viewType: string,
  ): Promise<MetaViewDefinition | null> {
    return this.run(() => this.meta.getEntityView(entity, viewType, this.actor(auth)));
  }

  /** Workflow com as transições que o ator pode executar. */
  @Get(':entity/workflow')
  async getWorkflow(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('entity') entity: string,
  ): Promise<MetaWorkflowDefinition | null> {
    return this.run(() => this.meta.getEntityWorkflow(entity, this.actor(auth)));
  }

  private actor(auth: AccessTokenClaims) {
    return { identityId: auth.sub, sessionId: auth.sid };
  }

  /** Entidade não registrada é 404 — não vaza se o nome existe em outro schema. */
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof MetaEntityNotFoundError) {
        throw new NotFoundException('Entity is not registered in the metadata store.');
      }
      throw error;
    }
  }
}
