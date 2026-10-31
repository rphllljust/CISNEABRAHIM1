import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import {
  parseAddContactCommandInput,
  parseAddUnitCommandInput,
  parseContactCommandInput,
  parseContactRoleCommandInput,
  parseCreateClientInput,
  parseDeactivateClientInput,
  parseHierarchyInput,
  parseListClientsQuery,
  parseStatusTransitionInput,
  parseUnitCommandInput,
  parseUpdateClientInput,
} from '../dto/client.dto';
import { ClientAccessService } from '../services/client-access.service';
import {
  CLIENT_AUDIT_DEFAULT_LIMIT,
  CLIENT_AUDIT_MAX_LIMIT,
} from '../services/client-access.service';

/**
 * Rotas de leitura pública `GET /clients/*` que NÃO são um `clientId`.
 *
 * Declaradas como lista fechada porque a rota de detalhe é `GET /clients/:clientId`: sem esta
 * separação, `GET /clients/duplicate-check` casaria a rota de detalhe, o valor `duplicate-check`
 * seria recusado como UUID inválido e a consulta prévia de duplicidade nunca responderia. A ordem
 * de declaração abaixo resolve isso — o Nest casa a rota mais específica primeiro — e a constante
 * existe para que o teste possa afirmar que toda rota literal está declarada ANTES do `:clientId`.
 */
export const CLIENT_LITERAL_ROUTES = ['duplicate-check'] as const;

@Controller('clients')
@UseGuards(JwtAuthGuard)
export class ClientsController {
  constructor(private readonly clientAccess: ClientAccessService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    const input = parseCreateClientInput(request.body);
    return this.clientAccess.create({ identityId: auth.sub, sessionId: auth.sid }, input);
  }

  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    const parsed = parseListClientsQuery(query);
    return this.clientAccess.list({ identityId: auth.sub, sessionId: auth.sid }, parsed);
  }

  /**
   * CONSULTA PRÉVIA DE DUPLICIDADE — declarada ANTES de `:clientId` de propósito.
   *
   * É a rota que o formulário de novo Cliente chama enquanto o operador digita, para avisar sobre
   * um cadastro provavelmente existente antes de criar um segundo. NÃO funde nada: devolve os
   * candidatos com a força da evidência, e a decisão continua com o operador.
   */
  @Get('duplicate-check')
  checkDuplicates(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query() query: Record<string, unknown>,
  ) {
    return this.clientAccess.checkDuplicates(
      { identityId: auth.sub, sessionId: auth.sid },
      {
        legalName: readQueryString(query, 'legalName'),
        tradeName: readQueryString(query, 'tradeName'),
        taxId: readQueryString(query, 'taxId'),
        externalErpId: readQueryString(query, 'externalErpId'),
        excludeClientId: readQueryString(query, 'excludeClientId'),
      },
    );
  }

  @Get(':clientId/360')
  get360(@CurrentAuth() auth: AccessTokenClaims, @Param('clientId') clientId: string) {
    return this.clientAccess.get360({ identityId: auth.sub, sessionId: auth.sid }, clientId);
  }

  @Get(':clientId')
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('clientId') clientId: string) {
    return this.clientAccess.getById({ identityId: auth.sub, sessionId: auth.sid }, clientId);
  }

  /** QUALIDADE DOS DADOS — apontamentos reais derivados do cadastro persistido. */
  @Get(':clientId/data-quality')
  getDataQuality(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
  ) {
    return this.clientAccess.getDataQuality(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
    );
  }

  /** HIERARQUIA EMPRESARIAL declarada — grupo econômico, matriz e filiais. */
  @Get(':clientId/hierarchy')
  getHierarchy(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
  ) {
    return this.clientAccess.getHierarchy(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
    );
  }

  /**
   * TRILHA DE AUDITORIA do cadastro.
   *
   * Capability própria (`client:audit:read`): ver o cadastro e ver QUEM o alterou são decisões
   * distintas. A leitura é registrada no canal de segurança, como qualquer outra leitura
   * autorizada deste módulo.
   */
  @Get(':clientId/audit-trail')
  getAuditTrail(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.clientAccess.getAuditTrail(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
      readQueryInt(query, 'limit', CLIENT_AUDIT_DEFAULT_LIMIT, CLIENT_AUDIT_MAX_LIMIT),
      readQueryInt(query, 'offset', 0, Number.MAX_SAFE_INTEGER),
    );
  }

  @Patch(':clientId')
  update(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
    @Req() request: FastifyRequest,
  ) {
    const input = parseUpdateClientInput(request.body);
    return this.clientAccess.update(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
      input,
    );
  }

  /**
   * COMANDOS SEMÂNTICOS DE CONTATO.
   *
   * São rotas de INTENÇÃO, e não um `PATCH` de coleção: adicionar, atribuir papel, marcar o
   * principal e inativar têm payload mínimo e concorrência otimista própria. O verbo é `POST`
   * porque cada uma CRIA um fato no histórico do relacionamento — não é uma substituição de estado.
   */
  @Post(':clientId/contacts')
  @HttpCode(200)
  addContact(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
    @Req() request: FastifyRequest,
  ) {
    const input = parseAddContactCommandInput(request.body);
    return this.clientAccess.applyContactCommand(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
      { kind: 'add', ...input },
    );
  }

  @Post(':clientId/contacts/:contactId/primary')
  @HttpCode(200)
  setPrimaryContact(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
    @Param('contactId') contactId: string,
    @Req() request: FastifyRequest,
  ) {
    const { version } = parseContactCommandInput(request.body);
    return this.clientAccess.applyContactCommand(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
      { kind: 'setPrimary', version, contactId },
    );
  }

  @Post(':clientId/contacts/:contactId/role')
  @HttpCode(200)
  setContactRole(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
    @Param('contactId') contactId: string,
    @Req() request: FastifyRequest,
  ) {
    const { version, role } = parseContactRoleCommandInput(request.body);
    return this.clientAccess.applyContactCommand(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
      // `null` REMOVE o papel — distinto de "não mexe", que é `undefined`.
      { kind: 'setRole', version, contactId, role },
    );
  }

  @Post(':clientId/contacts/:contactId/deactivate')
  @HttpCode(200)
  deactivateContact(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
    @Param('contactId') contactId: string,
    @Req() request: FastifyRequest,
  ) {
    const { version } = parseContactCommandInput(request.body);
    return this.clientAccess.applyContactCommand(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
      { kind: 'deactivate', version, contactId },
    );
  }

  @Post(':clientId/contacts/:contactId/reactivate')
  @HttpCode(200)
  reactivateContact(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
    @Param('contactId') contactId: string,
    @Req() request: FastifyRequest,
  ) {
    const { version } = parseContactCommandInput(request.body);
    return this.clientAccess.applyContactCommand(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
      { kind: 'reactivate', version, contactId },
    );
  }

  @Delete(':clientId/contacts/:contactId')
  @HttpCode(200)
  removeContact(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
    @Param('contactId') contactId: string,
    @Req() request: FastifyRequest,
  ) {
    const { version } = parseContactCommandInput(request.body);
    return this.clientAccess.applyContactCommand(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
      { kind: 'remove', version, contactId },
    );
  }

  /** COMANDOS SEMÂNTICOS DE UNIDADE — declarar filial, marcar matriz, remover. */
  @Post(':clientId/units')
  @HttpCode(200)
  addUnit(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
    @Req() request: FastifyRequest,
  ) {
    const input = parseAddUnitCommandInput(request.body);
    return this.clientAccess.applyUnitCommand(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
      { kind: 'add', ...input },
    );
  }

  @Post(':clientId/units/:unitId/headquarters')
  @HttpCode(200)
  setUnitHeadquarters(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
    @Param('unitId') unitId: string,
    @Req() request: FastifyRequest,
  ) {
    const { version } = parseUnitCommandInput(request.body);
    return this.clientAccess.applyUnitCommand(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
      { kind: 'setHeadquarters', version, unitId },
    );
  }

  @Delete(':clientId/units/:unitId')
  @HttpCode(200)
  removeUnit(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
    @Param('unitId') unitId: string,
    @Req() request: FastifyRequest,
  ) {
    const { version } = parseUnitCommandInput(request.body);
    return this.clientAccess.applyUnitCommand(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
      { kind: 'remove', version, unitId },
    );
  }

  /**
   * HIERARQUIA EMPRESARIAL — declaração explícita do grupo econômico e da matriz.
   *
   * Verbo `PATCH` porque é a substituição de UM vínculo declarado, não a criação de um objeto
   * novo: o grupo é criado/reaproveitado pelo nome e o Cliente passa a apontar para ele.
   */
  @Patch(':clientId/hierarchy')
  @HttpCode(200)
  setHierarchy(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
    @Req() request: FastifyRequest,
  ) {
    const input = parseHierarchyInput(request.body);
    return this.clientAccess.setHierarchy(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
      input,
    );
  }

  @Post(':clientId/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
    @Req() request: FastifyRequest,
  ) {
    const transition = parseStatusTransitionInput(request.body);
    const body = parseDeactivateClientInput(request.body);
    return this.clientAccess.deactivate(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
      transition.version,
      body.reason,
    );
  }

  @Post(':clientId/activate')
  @HttpCode(200)
  activate(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('clientId') clientId: string,
    @Req() request: FastifyRequest,
  ) {
    const transition = parseStatusTransitionInput(request.body);
    return this.clientAccess.activate(
      { identityId: auth.sub, sessionId: auth.sid },
      clientId,
      transition.version,
    );
  }
}

/** Parâmetro de consulta textual. Ausente devolve `undefined`; presente precisa ser string. */
function readQueryString(query: Record<string, unknown>, key: string): string | undefined {
  const value = query[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Parâmetro de consulta inteiro, com teto explícito.
 *
 * Um valor não numérico cai no PADRÃO em vez de virar `NaN` — que chegaria ao `LIMIT` do banco
 * como erro de sintaxe. A recusa silenciosa aqui é aceitável porque a paginação é paginação: um
 * `limit` malformado não muda o significado do recorte, apenas o tamanho da página.
 */
function readQueryInt(
  query: Record<string, unknown>,
  key: string,
  fallback: number,
  max: number,
): number {
  const raw = query[key];
  const parsed =
    typeof raw === 'number' && Number.isInteger(raw)
      ? raw
      : typeof raw === 'string' && /^\d+$/.test(raw)
        ? Number.parseInt(raw, 10)
        : null;
  if (parsed === null || parsed < 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}
