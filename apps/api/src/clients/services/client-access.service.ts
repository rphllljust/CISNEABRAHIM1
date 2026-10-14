import { HttpStatus, Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';

import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { ScopeContextRepository } from '../../authorization/repositories/scope-context.repository';
import { toResourceContextFromClient } from '../../authorization/scope/scope-matcher';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../../authorization/types/authz-scopes';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  assertCreateClientInput,
  assertDeactivationReason,
  assertParentClient,
  assertUpdateClientInput,
  ClientValidationError,
  type CreateClientInput,
  type UpdateClientInput,
} from '../domain/client.validation';
import { CLIENT_ERROR_CODES } from '../errors/client-error-codes';
import { ClientHttpException } from '../errors/client-http.exception';
import { mapValidationCodeToStatus } from '../errors/client-validation-status';
import {
  buildClientDataQuality,
  type ClientDataQuality,
} from '../domain/client-quality';
import {
  findClientDuplicates,
  normalizeClientTaxId,
  type ClientDuplicateCheck,
} from '../domain/client-duplicates';
import type { AddressPurpose, ContactPurpose } from '../domain/client-status';
import {
  ClientsRepository,
  type ClientContactCommand,
  type ClientHierarchyNode,
  type ClientUnitCommand,
} from '../repositories/clients.repository';
import { ClientAuditService, type ClientAuditTrailResponse } from './client-audit.service';
import { CLIENT_STATUSES } from '../domain/client-status';
import {
  buildClientListSqlParts,
  resolveClientListQuery,
  type ClientListRequest,
} from '../domain/client-list.query';
import {
  toClientResponse,
  toClientSummaryResponse,
  type ClientListResponse,
  type ClientResponse,
} from '../serializers/client-response.serializer';
import type {
  CommercialClientPort,
  CommercialClientView,
} from '../../platform/bounded-contexts/enterprise-core-ports';

/**
 * LIMITES DA TRAVESSIA DE HIERARQUIA.
 *
 * Declarados como constantes nomeadas, e não literais no meio do código, porque são o contrato
 * público do endpoint: o cliente HTTP precisa saber que a árvore pode vir truncada.
 */
export const CLIENT_HIERARCHY_MAX_DEPTH = 8;
export const CLIENT_HIERARCHY_MAX_NODES = 200;

/** Teto de candidatos comparados na detecção de duplicidade. Ver `findDuplicateCandidates`. */
export const CLIENT_DUPLICATE_CANDIDATE_LIMIT = 50;

/** Paginação da trilha de auditoria. Mesmos limites publicados pelos demais endpoints do módulo. */
export const CLIENT_AUDIT_DEFAULT_LIMIT = 20;
export const CLIENT_AUDIT_MAX_LIMIT = 100;

@Injectable()
export class ClientAccessService implements CommercialClientPort {
  constructor(
    private readonly clientsRepository: ClientsRepository,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly scopeContextRepository: ScopeContextRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
    private readonly scopeEnforcement: ScopeEnforcementService,
    private readonly securityAudit: SecurityAuditService,
    private readonly clientAudit: ClientAuditService,
  ) {}


  async create(actor: IdentityAuthzContext, input: CreateClientInput): Promise<ClientResponse> {
    await this.assertAction(actor, AUTHZ_ACTIONS.ClientCreate, undefined, AUTHZ_SCOPES.Global);

    let normalizedTaxId: string;
    try {
      normalizedTaxId = assertCreateClientInput(input);
    } catch (error) {
      if (error instanceof ClientValidationError) {
        throw new ClientHttpException(
          mapValidationCodeToStatus(error.code),
          CLIENT_ERROR_CODES.VALIDATION_FAILED,
          'Invalid request body.',
        );
      }
      throw error;
    }

    try {
      const created = await this.clientsRepository.create(
        {
          legalName: input.legalName,
          tradeName: input.tradeName,
          normalizedTaxId,
          externalErpId: input.externalErpId,
          contacts: input.contacts,
          addresses: input.addresses,
          units: input.units,
          purchaseOrderRequirement: input.purchaseOrderRequirement,
          groupName: input.groupName,
          parentClientId: input.parentClientId,
        },
        async (client, clientId) => {
          await this.scopeContextRepository.insertScopeRef(client, AUTHZ_SCOPES.Client, clientId);
        },
        // TRILHA DE AUDITORIA — DENTRO da mesma transação da criação. Uma criação que sofre
        // rollback não deixa rastro, e a trilha nunca afirma um fato que não persistiu.
        async (client, detail) => {
          await this.clientAudit.recordTransition(
            client,
            this.auditContext(actor),
            detail.id,
            null,
            detail,
          );
        },
      );

      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.ClientCreate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Client,
        resourceId: created.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      });

      return toClientResponse(created);
    } catch (error) {
      if (this.isUniqueTaxIdViolation(error)) {
        throw new ClientHttpException(
          HttpStatus.CONFLICT,
          CLIENT_ERROR_CODES.TAX_ID_CONFLICT,
          'Client with this tax id already exists.',
        );
      }
      throw error;
    }
  }

  /**
   * CONSULTA PRÉVIA DE DUPLICIDADE — roda ANTES de criar, e nunca funde nada.
   *
   * Devolve os candidatos com a força da evidência separada (`certain` x suspeita). O domínio é
   * quem decide o que é coincidência e o que é semelhança; aqui só se orquestra a triagem no banco
   * e a comparação fina.
   */
  async checkDuplicates(
    actor: IdentityAuthzContext,
    probe: {
      legalName?: string;
      tradeName?: string;
      taxId?: string;
      externalErpId?: string;
      excludeClientId?: string;
    },
  ): Promise<ClientDuplicateCheck> {
    // Exige `ClientList`: a consulta varre a carteira, então quem não pode listar não pode usá-la
    // como canal lateral para descobrir se um CNPJ existe.
    await this.assertListAction(actor);

    const taxId = normalizeClientTaxId(probe.taxId);
    const candidates = await this.clientsRepository.findDuplicateCandidates({
      taxId,
      externalErpId: probe.externalErpId ?? null,
      legalName: probe.legalName ?? null,
      tradeName: probe.tradeName ?? null,
      excludeClientId: probe.excludeClientId ?? null,
      limit: CLIENT_DUPLICATE_CANDIDATE_LIMIT,
    });

    const matches = findClientDuplicates(
      {
        legalName: probe.legalName ?? '',
        tradeName: probe.tradeName ?? null,
        taxId,
        externalErpId: probe.externalErpId ?? null,
        excludeClientId: probe.excludeClientId ?? null,
      },
      candidates.map((row) => ({
        id: row.id,
        legalName: row.legal_name,
        tradeName: row.trade_name,
        normalizedTaxId: row.normalized_tax_id,
        externalErpId: row.external_erp_id,
        status: row.status,
      })),
    );

    return {
      checked: true,
      certainCount: matches.filter((match) => match.certain).length,
      suspectedCount: matches.filter((match) => !match.certain).length,
      matches,
    };
  }

  /**
   * QUALIDADE DOS DADOS DO CADASTRO.
   *
   * Derivada de fatos PERSISTIDOS, com os apontamentos montados em `domain/client-quality`. Este
   * método não decide o que é um problema — apenas lê os fatos e delega a avaliação, para que a
   * regra exista em um só lugar e possa ser exercitada sem banco.
   */
  async getDataQuality(
    actor: IdentityAuthzContext,
    clientId: string,
  ): Promise<ClientDataQuality> {
    this.assertValidClientId(clientId);
    const client = await this.clientsRepository.findById(clientId);
    if (!client) {
      throw this.notFound();
    }
    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.ClientRead,
      toResourceContextFromClient(client),
      undefined,
    );

    const facts = await this.clientsRepository.loadQualityFacts(clientId);
    if (!facts) {
      throw this.notFound();
    }

    return buildClientDataQuality({
      status: facts.status as ClientResponse['status'],
      hasExternalReference: facts.has_external_reference,
      // Os arrays vêm do banco como `text[]`; os valores são o enum publicado, então a conversão
      // é a mesma que o serializer já faz em toda resposta do módulo.
      contactPurposes: facts.contact_purposes as ContactPurpose[],
      usableContactPurposes: facts.usable_contact_purposes as ContactPurpose[],
      activeContactCount: Number(facts.active_contact_count ?? 0),
      primaryContactCount: Number(facts.primary_contact_count ?? 0),
      addressPurposes: facts.address_purposes as AddressPurpose[],
      unitCount: Number(facts.unit_count ?? 0),
    });
  }

  /**
   * HIERARQUIA EMPRESARIAL DECLARADA.
   *
   * A árvore é montada por travessia do vínculo `parent_client_id`, que é DADO — não há inferência
   * por nome nem por CNPJ em nenhum ponto. `truncated` declara honestamente quando o teto de
   * profundidade ou de nós foi atingido, em vez de devolver uma árvore curta como se fosse completa.
   */
  async getHierarchy(
    actor: IdentityAuthzContext,
    clientId: string,
  ): Promise<{
    rootId: string;
    nodes: ClientHierarchyNode[];
    truncated: boolean;
    maxDepth: number;
  }> {
    this.assertValidClientId(clientId);
    const client = await this.clientsRepository.findById(clientId);
    if (!client) {
      throw this.notFound();
    }
    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.ClientRead,
      toResourceContextFromClient(client),
      undefined,
    );

    const { nodes, rootId, truncated } = await this.clientsRepository.loadHierarchy(
      clientId,
      CLIENT_HIERARCHY_MAX_DEPTH,
      CLIENT_HIERARCHY_MAX_NODES,
    );
    return { rootId, nodes, truncated, maxDepth: CLIENT_HIERARCHY_MAX_DEPTH };
  }

  /**
   * TRILHA DE AUDITORIA DO CADASTRO.
   *
   * Exige `ClientAuditRead`, que é deliberadamente SEPARADA de `ClientRead`: ver o cadastro e ver
   * quem o alterou são decisões distintas, e um perfil pode legitimamente ter a primeira sem a
   * segunda.
   */
  async getAuditTrail(
    actor: IdentityAuthzContext,
    clientId: string,
    limit: number,
    offset: number,
  ): Promise<ClientAuditTrailResponse> {
    this.assertValidClientId(clientId);
    const client = await this.clientsRepository.findById(clientId);
    if (!client) {
      throw this.notFound();
    }
    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.ClientAuditRead,
      toResourceContextFromClient(client),
      undefined,
    );

    const safeLimit = Math.min(Math.max(limit, 1), CLIENT_AUDIT_MAX_LIMIT);
    const safeOffset = Math.max(offset, 0);
    return this.clientAudit.listForClient(clientId, safeLimit, safeOffset);
  }

  /**
   * APLICA UM COMANDO SEMÂNTICO DE CONTATO.
   *
   * Cada comando é uma INTENÇÃO própria, e não um "editar cadastro": adicionar, atribuir papel,
   * marcar como principal e inativar têm payload mínimo e não reenviam a coleção inteira. Reenviar
   * a coleção transformaria cada ação em uma corrida de concorrência contra qualquer outra edição
   * do cadastro — o defeito clássico de tratar ação de negócio como PATCH de formulário.
   */
  async applyContactCommand(
    actor: IdentityAuthzContext,
    clientId: string,
    command: ClientContactCommand,
  ): Promise<ClientResponse> {
    this.assertValidClientId(clientId);
    const existing = await this.clientsRepository.findById(clientId);
    if (!existing) {
      throw this.notFound();
    }
    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.ClientContactManage,
      toResourceContextFromClient(existing),
      undefined,
    );
    this.assertVersionMatches(existing.version, command.version);

    const result = await this.clientsRepository.applyContactCommand({
      clientId,
      expectedVersion: command.version,
      command,
    });

    if (result === null) {
      throw this.notFound();
    }
    if (result === 'VERSION_CONFLICT') {
      throw this.versionConflict();
    }
    if (result === 'CONTACT_NOT_FOUND') {
      throw new ClientHttpException(
        HttpStatus.NOT_FOUND,
        CLIENT_ERROR_CODES.CHILD_NOT_FOUND,
        'Contact not found for this client.',
      );
    }
    if (result === 'PRIMARY_CONFLICT') {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.INVALID_STATE,
        'Another contact is already the primary contact.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ClientContactManage,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Client,
      resourceId: clientId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { command: command.kind, contactCommand: command.kind },
    });

    return toClientResponse(result);
  }

  /**
   * DECLARA A HIERARQUIA EMPRESARIAL (grupo econômico e matriz).
   *
   * Antes de gravar, caminha a CADEIA DE ANCESTRAIS do novo pai. Se o Cliente já aparece ACIMA
   * dele, atribuir o vínculo fecharia um ciclo — e um ciclo em `parent_client_id` faria a travessia
   * da árvore girar para sempre. A checagem é do servidor, com teto de saltos, e o banco protege
   * apenas o caso que uma linha consegue provar (auto-referência).
   */
  async setHierarchy(
    actor: IdentityAuthzContext,
    clientId: string,
    input: { version: number; parentClientId?: string | null; groupId?: string | null; groupName?: string | null },
  ): Promise<ClientResponse> {
    this.assertValidClientId(clientId);
    const existing = await this.clientsRepository.findById(clientId);
    if (!existing) {
      throw this.notFound();
    }
    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.ClientHierarchyManage,
      toResourceContextFromClient(existing),
      undefined,
    );
    this.assertVersionMatches(existing.version, input.version);

    const parentClientId = input.parentClientId;
    if (parentClientId !== undefined && parentClientId !== null) {
      this.assertValidClientId(parentClientId);
      try {
        assertParentClient(clientId, parentClientId);
      } catch (error) {
        throw this.mapValidationError(error);
      }

      const parent = await this.clientsRepository.findById(parentClientId);
      if (!parent) {
        throw new ClientHttpException(
          HttpStatus.NOT_FOUND,
          CLIENT_ERROR_CODES.CHILD_NOT_FOUND,
          'Parent client not found.',
        );
      }

      const ancestors = await this.clientsRepository.loadAncestorChain(parentClientId);
      if (ancestors.includes(clientId)) {
        throw new ClientHttpException(
          HttpStatus.CONFLICT,
          CLIENT_ERROR_CODES.HIERARCHY_CYCLE,
          'This hierarchy link would create a cycle.',
        );
      }
    }

    // `groupName` (texto) e `groupId` (identificador) são caminhos alternativos para o MESMO
    // vínculo. `groupName` cria/reaproveita o grupo pelo nome, que é como a tela trabalha.
    let groupId: string | null | undefined = input.groupId;
    if (input.groupName !== undefined) {
      groupId =
        input.groupName === null
          ? null
          : await this.clientsRepository.resolveGroupIdByName(input.groupName);
    }

    const result = await this.clientsRepository.setHierarchy({
      clientId,
      expectedVersion: input.version,
      parentClientId,
      groupId,
    });

    if (result === null) {
      throw this.notFound();
    }
    if (result === 'VERSION_CONFLICT') {
      throw this.versionConflict();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ClientHierarchyManage,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Client,
      resourceId: clientId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });

    return toClientResponse(result);
  }

  /**
   * APLICA UM COMANDO SEMÂNTICO DE UNIDADE (adicionar / marcar matriz / remover).
   *
   * Mesma razão dos comandos de contato: declarar uma filial é uma INTENÇÃO, e o índice parcial
   * do banco garante que existe no máximo uma matriz por Cliente.
   */
  async applyUnitCommand(
    actor: IdentityAuthzContext,
    clientId: string,
    command: ClientUnitCommand,
  ): Promise<ClientResponse> {
    this.assertValidClientId(clientId);
    const existing = await this.clientsRepository.findById(clientId);
    if (!existing) {
      throw this.notFound();
    }
    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.ClientUnitManage,
      toResourceContextFromClient(existing),
      undefined,
    );
    this.assertVersionMatches(existing.version, command.version);

    const result = await this.clientsRepository.applyUnitCommand({
      clientId,
      expectedVersion: command.version,
      command,
    });

    if (result === null) {
      throw this.notFound();
    }
    if (result === 'VERSION_CONFLICT') {
      throw this.versionConflict();
    }
    if (result === 'UNIT_NOT_FOUND') {
      throw new ClientHttpException(
        HttpStatus.NOT_FOUND,
        CLIENT_ERROR_CODES.CHILD_NOT_FOUND,
        'Unit not found for this client.',
      );
    }
    if (result === 'HEADQUARTERS_CONFLICT') {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.INVALID_STATE,
        'Another unit is already the headquarters.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ClientUnitManage,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Client,
      resourceId: clientId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { command: command.kind },
    });

    return toClientResponse(result);
  }

  /**
   * AUSÊNCIA DE CONCORRÊNCIA OTIMISTA É RECUSADA, NÃO IGNORADA.
   *
   * Todo comando de escrita carrega a `version` lida. Divergir significa que outro operador alterou
   * o cadastro no intervalo, e gravar assim mesmo sobrescreveria a alteração dele em silêncio. A
   * recusa é explícita, com o mesmo código que o repositório devolve no caminho de corrida.
   */
  private assertVersionMatches(current: number, expected: number): void {
    if (current !== expected) {
      throw this.versionConflict();
    }
  }

  private versionConflict(): ClientHttpException {
    return new ClientHttpException(
      HttpStatus.CONFLICT,
      CLIENT_ERROR_CODES.VERSION_CONFLICT,
      'Client was modified by another request.',
    );
  }

  private mapValidationError(error: unknown): ClientHttpException {
    if (error instanceof ClientValidationError) {
      return new ClientHttpException(
        mapValidationCodeToStatus(error.code),
        CLIENT_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    if (error instanceof ClientHttpException) {
      return error;
    }
    throw error;
  }

  async getById(actor: IdentityAuthzContext, clientId: string): Promise<ClientResponse> {
    this.assertValidClientId(clientId);
    const client = await this.clientsRepository.findById(clientId);
    if (!client) {
      throw this.notFound();
    }

    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.ClientRead,
      toResourceContextFromClient(client),
      undefined,
    );
    return toClientResponse(client);
  }

  async list(actor: IdentityAuthzContext, request: ClientListRequest): Promise<ClientListResponse> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.ClientList,
      AUTHZ_RESOURCE_TYPES.Client,
    );
    if (grants.length === 0) {
      throw this.denied();
    }

    const scopeFilter = this.scopeEnforcement.buildClientListFilter(grants);
    if (scopeFilter.clause === 'FALSE') {
      throw this.denied();
    }

    const query = resolveClientListQuery(request);
    const sqlParts = buildClientListSqlParts(query, scopeFilter);

    const items = await this.clientsRepository.listSummaries(sqlParts, query.limit, query.offset);

    /**
     * Primeira página incompleta prova que o conjunto acabou: não há linha alguma depois dela, logo
     * o total é exatamente o que foi devolvido. Evita o COUNT quando ele seria redundante, sem
     * nunca devolver um total aproximado quando a página está cheia.
     */
    const total =
      query.offset === 0 && items.length < query.limit
        ? items.length
        : await this.clientsRepository.countClientList(sqlParts.whereClause, sqlParts.params);

    return {
      items: items.map(toClientSummaryResponse),
      limit: query.limit,
      offset: query.offset,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async update(
    actor: IdentityAuthzContext,
    clientId: string,
    input: UpdateClientInput,
  ): Promise<ClientResponse> {
    this.assertValidClientId(clientId);

    try {
      assertUpdateClientInput(input);
    } catch (error) {
      if (error instanceof ClientValidationError) {
        throw new ClientHttpException(
          mapValidationCodeToStatus(error.code),
          CLIENT_ERROR_CODES.VALIDATION_FAILED,
          'Invalid request body.',
        );
      }
      throw error;
    }

    const existing = await this.clientsRepository.findById(clientId);
    if (!existing) {
      throw this.notFound();
    }

    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.ClientUpdate,
      toResourceContextFromClient(existing),
      undefined,
    );

    /*
     * CICLO DE HIERARQUIA — barrado ANTES da gravação, pelo mesmo motivo do endpoint dedicado.
     *
     * O `PATCH` do cadastro também pode declarar o pai. Deixar a checagem só no endpoint de
     * hierarquia abriria um segundo caminho para o mesmo defeito — e um ciclo em
     * `parent_client_id` faria a travessia da árvore girar indefinidamente.
     */
    if (input.parentClientId !== undefined && input.parentClientId !== null) {
      this.assertValidClientId(input.parentClientId);
      try {
        assertParentClient(clientId, input.parentClientId);
      } catch (error) {
        throw this.mapValidationError(error);
      }
      const parent = await this.clientsRepository.findById(input.parentClientId);
      if (!parent) {
        throw new ClientHttpException(
          HttpStatus.NOT_FOUND,
          CLIENT_ERROR_CODES.CHILD_NOT_FOUND,
          'Parent client not found.',
        );
      }
      const ancestors = await this.clientsRepository.loadAncestorChain(input.parentClientId);
      if (ancestors.includes(clientId)) {
        throw new ClientHttpException(
          HttpStatus.CONFLICT,
          CLIENT_ERROR_CODES.HIERARCHY_CYCLE,
          'This hierarchy link would create a cycle.',
        );
      }
    }

    const updated = await this.clientsRepository.update(
      {
        clientId,
        expectedVersion: input.version,
        legalName: input.legalName,
        tradeName: input.tradeName,
        externalErpId: input.externalErpId,
        contacts: input.contacts,
        addresses: input.addresses,
        units: input.units,
        purchaseOrderRequirement: input.purchaseOrderRequirement,
        groupName: input.groupName,
        parentClientId: input.parentClientId,
      },
      // Trilha de valor: registra O QUE mudou, dentro da mesma transação do UPDATE.
      async (client, before, after) => {
        await this.clientAudit.recordTransition(
          client,
          this.auditContext(actor),
          clientId,
          before,
          after,
        );
      },
    );

    if (updated === null) {
      throw this.notFound();
    }
    if (updated === 'VERSION_CONFLICT') {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.VERSION_CONFLICT,
        'Client was modified by another request.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ClientUpdate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Client,
      resourceId: clientId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });

    return toClientResponse(updated);
  }

  async deactivate(
    actor: IdentityAuthzContext,
    clientId: string,
    version: number,
    reason: string,
  ): Promise<ClientResponse> {
    this.assertValidClientId(clientId);

    try {
      assertDeactivationReason(reason);
    } catch (error) {
      if (error instanceof ClientValidationError) {
        throw new ClientHttpException(
          mapValidationCodeToStatus(error.code),
          CLIENT_ERROR_CODES.VALIDATION_FAILED,
          'Invalid request body.',
        );
      }
      throw error;
    }

    const existing = await this.clientsRepository.findById(clientId);
    if (!existing) {
      throw this.notFound();
    }

    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.ClientDeactivate,
      toResourceContextFromClient(existing),
      undefined,
    );

    const updated = await this.clientsRepository.setStatus(
      clientId,
      version,
      'INACTIVE',
      actor.identityId,
      reason,
      // A transição de situação é gravada com `acao = TRANSITION` na trilha, e o motivo entra pela
      // trilha de segurança abaixo. Os dois canais respondem perguntas diferentes e ambos valem.
      async (client, before, after) => {
        await this.clientAudit.recordTransition(
          client,
          this.auditContext(actor),
          clientId,
          before,
          after,
        );
      },
    );

    if (updated === null) {
      throw this.notFound();
    }
    if (updated === 'VERSION_CONFLICT') {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.VERSION_CONFLICT,
        'Client was modified by another request.',
      );
    }
    if (updated === 'INVALID_STATE') {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.INVALID_STATE,
        'Client is already inactive.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ClientDeactivate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Client,
      resourceId: clientId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { reason },
    });

    return toClientResponse(updated);
  }

  async activate(
    actor: IdentityAuthzContext,
    clientId: string,
    version: number,
  ): Promise<ClientResponse> {
    this.assertValidClientId(clientId);

    const existing = await this.clientsRepository.findById(clientId);
    if (!existing) {
      throw this.notFound();
    }

    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.ClientActivate,
      toResourceContextFromClient(existing),
      undefined,
    );

    const updated = await this.clientsRepository.setStatus(
      clientId,
      version,
      'ACTIVE',
      actor.identityId,
      undefined,
      async (client, before, after) => {
        await this.clientAudit.recordTransition(
          client,
          this.auditContext(actor),
          clientId,
          before,
          after,
        );
      },
    );

    if (updated === null) {
      throw this.notFound();
    }
    if (updated === 'VERSION_CONFLICT') {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.VERSION_CONFLICT,
        'Client was modified by another request.',
      );
    }
    if (updated === 'INVALID_STATE') {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.INVALID_STATE,
        'Client is already active.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ClientActivate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Client,
      resourceId: clientId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });

    return toClientResponse(updated);
  }

  async findPublishedById(clientId: string): Promise<CommercialClientView | null> {
    const row = await this.clientsRepository.findPublishedById(clientId);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      status: row.status,
      purchaseOrderRequirement: row.purchase_order_requirement,
    };
  }

  async requireActive(clientId: string): Promise<CommercialClientView> {
    const published = await this.findPublishedById(clientId);
    if (!published) {
      throw this.notFound();
    }
    if (published.status !== CLIENT_STATUSES.Active) {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.INACTIVE,
        'Client is inactive.',
      );
    }
    return published;
  }

  async assertNotInactive(clientId: string): Promise<void> {
    const published = await this.findPublishedById(clientId);
    if (published && published.status !== CLIENT_STATUSES.Active) {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.INACTIVE,
        'Client is inactive.',
      );
    }
  }

  private async assertAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    context: ReturnType<typeof toResourceContextFromClient> | undefined,
    requiredScope: typeof AUTHZ_SCOPES.Global | undefined,
  ): Promise<void> {
    const decision = await this.policyDecisionPoint.decide(
      actor,
      {
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.Client,
        context,
      },
      { audit: true },
    );

    if (decision.result === 'DENY') {
      throw this.denied();
    }

    if (requiredScope === AUTHZ_SCOPES.Global) {
      const grants = await this.authorizationRepository.findActiveGrants(
        actor.identityId,
        action,
        AUTHZ_RESOURCE_TYPES.Client,
      );
      const hasGlobal = grants.some(
        (grant) => grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null,
      );
      if (!hasGlobal) {
        throw this.denied();
      }
    }
  }

  /**
   * CONTEXTO DE AUDITORIA a partir do ator autenticado.
   *
   * O `sessionId` do token é um UUID de sessão, e não um correlation id de requisição: usá-lo como
   * `correlation_id` da trilha faria todas as requisições da MESMA sessão compartilharem uma
   * correlação, destruindo a capacidade de distinguir duas alterações feitas pelo mesmo operador
   * em sequência. A trilha gera um id próprio por transição, que é o comportamento correto.
   */
  private auditContext(actor: IdentityAuthzContext): { identityId: string } {
    return { identityId: actor.identityId };
  }

  /**
   * Exige `ClientList` SEM escopo de recurso.
   *
   * Usado pela consulta de duplicidade, que varre a CARTEIRA e não um registro: um ator que só
   * pode ler um Cliente específico não deve poder usar a busca de duplicidade como canal lateral
   * para descobrir se um CNPJ existe no sistema. A checagem é a mesma da listagem, e não uma
   * permissão nova — duplicar o vocabulário de autorização seria pior que reusá-lo.
   */
  private async assertListAction(actor: IdentityAuthzContext): Promise<void> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.ClientList,
      AUTHZ_RESOURCE_TYPES.Client,
    );
    if (grants.length === 0) {
      throw this.denied();
    }
    const scopeFilter = this.scopeEnforcement.buildClientListFilter(grants);
    if (scopeFilter.clause === 'FALSE') {
      throw this.denied();
    }
  }

  private assertValidClientId(clientId: string): void {
    try {
      this.scopeEnforcement.assertValidClientResourceId(clientId);
    } catch {
      throw this.notFound();
    }
  }

  private denied(): ClientHttpException {
    return new ClientHttpException(
      HttpStatus.FORBIDDEN,
      CLIENT_ERROR_CODES.DENIED,
      'Access denied.',
    );
  }

  private notFound(): ClientHttpException {
    return new ClientHttpException(
      HttpStatus.NOT_FOUND,
      CLIENT_ERROR_CODES.NOT_FOUND,
      'Client not found.',
    );
  }

  private isUniqueTaxIdViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const pgError = error as { code?: string; constraint?: string };
    return (
      pgError.code === '23505' &&
      (pgError.constraint === 'clients_normalized_tax_id_uidx' ||
        (typeof pgError.constraint === 'string' && pgError.constraint.includes('tax_id')))
    );
  }
}
