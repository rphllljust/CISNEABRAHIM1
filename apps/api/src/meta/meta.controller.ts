import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../auth/services/token.service';
import { AuthorizationGuard } from '../authorization/guards/authorization.guard';
import { RequireAuthz } from '../authorization/decorators/require-authz.decorator';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import {
  MetaEntityNotFoundError,
  MetaFieldConflictError,
  MetaFieldNotFoundError,
  MetaService,
  MetaValidationError,
  MetaViewNotFoundError,
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
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * ESCRITA EXIGE CAPABILITY PRÓPRIA (V4)
 *
 * As três rotas de escrita NÃO herdam a política frouxa da leitura. Elas exigem
 * `authz:access-admin:manage`, a mesma capability do console de acesso, porque alterar o
 * metadado altera a FORMA de toda tela da entidade — é mudança de configuração da plataforma,
 * não operação de negócio.
 *
 * A guarda é do SERVIDOR (`AuthorizationGuard`), não do frontend. O explorador de metadados
 * esconder o botão não é controle de autorização: um `curl` com o token do ator chega na rota
 * e é a guarda que barra.
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

  /* ══════════════════════════════════════════════════════════════════════════════════════
     ESCRITA (V4)

     Estes três endpoints são o canal que faltava: sem eles o explorador de metadados e o
     construtor de formulário TENTAVAM gravar, recebiam 404 e mostravam GAP_DE_API na tela.
     O cliente já falava exatamente este protocolo — nenhuma linha de frontend mudou.
     ══════════════════════════════════════════════════════════════════════════════════════ */

  /** Atualiza um campo de `meta.fields` (rótulo, tipo, nível, flags de superfície, ordem). */
  @Patch(':entity/fields/:name')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminManage,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  async patchField(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('entity') entity: string,
    @Param('name') name: string,
    @Req() request: FastifyRequest,
  ): Promise<MetaFieldDefinition> {
    const patch = this.asObject(request.body);
    return this.runWrite(() => this.meta.patchField(entity, name, patch));
  }

  /** Cria um campo novo em `meta.fields`. */
  @Post(':entity/fields')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminManage,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  async createField(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('entity') entity: string,
    @Req() request: FastifyRequest,
  ): Promise<MetaFieldDefinition> {
    const input = this.asObject(request.body);
    return this.runWrite(() => this.meta.createField(entity, input));
  }

  /** Atualiza uma view de `meta.views` — inclusive `layout`, que é o que dirige a engine. */
  @Patch(':entity/views/:viewType')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminManage,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  async patchView(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('entity') entity: string,
    @Param('viewType') viewType: string,
    @Req() request: FastifyRequest,
  ): Promise<MetaViewDefinition> {
    const patch = this.asObject(request.body);
    return this.runWrite(() => this.meta.patchView(entity, viewType, patch));
  }

  /**
   * Corpo precisa ser OBJETO.
   *
   * `null`, array ou escalar não são patches válidos, e deixá-los passar produziria um erro
   * confuso mais adiante (ou, pior, nenhuma alteração silenciosa). A conversão para 422 é
   * explícita aqui, no ponto de entrada.
   */
  private asObject(body: unknown): Record<string, unknown> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new UnprocessableEntityException('METADATA_BODY_INVALID: corpo deve ser um objeto JSON.');
    }
    return body as Record<string, unknown>;
  }

  /**
   * Traduz os erros de escrita para HTTP.
   *
   * Separado de `run` (que só conhece "entidade não encontrada") porque a escrita tem mais
   * modos de falha e cada um exige um status DIFERENTE — o cliente decide o que fazer pelo
   * status: 404 é "não existe", 409 é "já existe", 422 é "mandei torto".
   */
  private async runWrite<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof MetaEntityNotFoundError) {
        throw new NotFoundException('Entity is not registered in the metadata store.');
      }
      if (error instanceof MetaFieldNotFoundError || error instanceof MetaViewNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof MetaFieldConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof MetaValidationError) {
        throw new UnprocessableEntityException(error.message);
      }
      throw error;
    }
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

