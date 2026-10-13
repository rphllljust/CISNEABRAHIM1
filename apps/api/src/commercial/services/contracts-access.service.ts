import { Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import type {
  CloseContractInput,
  CreateContractInput,
  LinkContractDocumentInput,
  UpdateContractDraftInput,
} from '../domain/contract.validation';
import { assertContractActivationValidity } from '../domain/contract-operational';
import { ContractsRepository } from '../repositories/contracts.repository';
import {
  buildContractListOrderClause,
  buildContractListWhere,
  type ContractAdvancedFilter,
  type ContractListDirection,
  type ContractListSort,
} from '../repositories/contract-list-sql';
import type { ContractRow } from '../repositories/contracts.repository.types';
import {
  toContractDetailResponse,
  toContractResponse,
  type ContractDetailResponse,
} from '../serializers/contracts-response.serializer';
import { ContractsAccessAuthz } from './contracts-access.authz';
import {
  isDuplicateContractViolation,
  contractsAccessNotFound,
  contractsClientNotFound,
  contractsDuplicate,
  contractsInvalidState,
  contractsVersionConflict,
} from './contracts-access.errors';
import {
  assertValidContractId,
  generateContractInternalCode,
  resolveActivateContractInput,
  resolveCloseContractInput,
  resolveCreateContractInput,
  resolveLinkContractDocumentInput,
  resolveUpdateContractDraftInput,
} from './contracts-input-resolution';
import { ContractsReferenceValidationService } from './contracts-reference-validation.service';

/**
 * Consulta da área de trabalho de contratos.
 *
 * Espelha `ProposalListQuery`/`PurchaseOrderListQuery`: escopo (cliente/unidade), enumeração de
 * situação, moeda, janela de VIGÊNCIA, busca livre, ordenação por allow-list e filtro avançado.
 */
export type ContractListQuery = {
  clientId?: string;
  unitId?: string;
  status?: string;
  currencyCode?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  search?: string;
  advanced?: ContractAdvancedFilter;
  sort?: ContractListSort;
  direction?: ContractListDirection;
  limit: number;
  offset: number;
};

@Injectable()
export class ContractsAccessService {
  constructor(
    private readonly contractsRepository: ContractsRepository,
    private readonly authz: ContractsAccessAuthz,
    private readonly referenceValidation: ContractsReferenceValidationService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async create(
    actor: IdentityAuthzContext,
    input: CreateContractInput,
  ): Promise<ContractDetailResponse> {
    const validated = resolveCreateContractInput(input);

    await this.authz.assertCreateAction(actor, input.clientId, input.unitId);
    await this.referenceValidation.assertUnitRegistered(input.unitId);
    await this.referenceValidation.assertClientActive(input.clientId);
    await this.referenceValidation.assertServiceReferences(validated.items);

    try {
      const created = await this.contractsRepository.createContract({
        internalCode: generateContractInternalCode(),
        clientId: input.clientId,
        unitId: input.unitId,
        contractNumber: validated.contractNumber,
        title: validated.title,
        scopeDescription: validated.scopeDescription,
        validFrom: validated.validFrom,
        validTo: validated.validTo,
        currencyCode: validated.currencyCode,
        paymentTerms: input.paymentTerms?.trim() || null,
        paymentMethod: input.paymentMethod?.trim() || null,
        commercialTerms: validated.commercialTerms,
        items: validated.items,
        actorIdentityId: actor.identityId,
      });

      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.CommercialContractCreate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialContract,
        resourceId: created.contract.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        metadata: {
          contractNumber: created.contract.contract_number,
          internalCode: created.contract.internal_code,
        },
      });

      return toContractDetailResponse(created.contract, created.items, []);
    } catch (error) {
      if (isDuplicateContractViolation(error)) {
        throw contractsDuplicate();
      }
      throw error;
    }
  }

  async updateDraft(
    actor: IdentityAuthzContext,
    contractId: string,
    input: UpdateContractDraftInput,
  ): Promise<ContractDetailResponse> {
    assertValidContractId(contractId);
    await this.requireContract(actor, contractId, AUTHZ_ACTIONS.CommercialContractUpdate);

    const validated = resolveUpdateContractDraftInput(input);

    if (validated.items) {
      await this.referenceValidation.assertServiceReferences(validated.items);
    }

    try {
      const updated = await this.contractsRepository.updateDraft({
        contractId,
        rowVersion: validated.rowVersion,
        contractNumber: validated.contractNumber,
        title: validated.title,
        scopeDescription: validated.scopeDescription,
        validFrom: validated.validFrom,
        validTo: validated.validTo,
        currencyCode: validated.currencyCode,
        paymentTerms: validated.paymentTerms,
        paymentMethod: validated.paymentMethod,
        commercialTerms: validated.commercialTerms,
        items: validated.items,
        actorIdentityId: actor.identityId,
      });

      if (updated === 'VERSION_CONFLICT') {
        throw contractsVersionConflict();
      }
      if (updated === 'INVALID_STATE') {
        throw contractsInvalidState();
      }

      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.CommercialContractUpdate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialContract,
        resourceId: contractId,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      });

      const documentLinks = await this.contractsRepository.listDocumentLinks(contractId);
      return toContractDetailResponse(updated.contract, updated.items, documentLinks);
    } catch (error) {
      if (isDuplicateContractViolation(error)) {
        throw contractsDuplicate();
      }
      throw error;
    }
  }

  async activate(
    actor: IdentityAuthzContext,
    contractId: string,
    input: { rowVersion: number },
  ): Promise<ContractDetailResponse> {
    assertValidContractId(contractId);
    const contract = await this.requireContract(
      actor,
      contractId,
      AUTHZ_ACTIONS.CommercialContractActivate,
    );

    const validated = resolveActivateContractInput(input);

    assertContractActivationValidity({
      validFrom: contract.valid_from,
      validTo: contract.valid_to,
    });

    await this.referenceValidation.assertClientActive(contract.client_id);
    const client = await this.contractsRepository.findClientById(contract.client_id);
    if (!client) {
      throw contractsClientNotFound();
    }

    const items = await this.contractsRepository.listItems(contractId);
    const itemSnapshots = await Promise.all(
      items.map(async (item) => {
        if (!item.service_definition_id) {
          return { lineNumber: item.line_number, serviceSnapshot: null };
        }
        const service = await this.contractsRepository.findServiceSnapshot(
          item.service_definition_id,
          item.service_definition_version_id ?? undefined,
        );
        return {
          lineNumber: item.line_number,
          serviceSnapshot: service
            ? {
                serviceDefinitionId: service.service_definition_id,
                serviceDefinitionVersionId: service.service_definition_version_id,
                code: service.code,
                name: service.name,
                version: service.version,
                versionStatus: service.version_status,
              }
            : null,
        };
      }),
    );

    const activated = await this.contractsRepository.activate({
      contractId,
      rowVersion: validated.rowVersion,
      clientSnapshot: {
        clientId: client.id,
        legalName: client.legal_name,
        tradeName: client.trade_name,
        normalizedTaxId: client.normalized_tax_id,
        status: client.status,
        snapshottedAt: new Date().toISOString(),
      },
      itemSnapshots,
      actorIdentityId: actor.identityId,
    });

    if (activated === 'VERSION_CONFLICT') {
      throw contractsVersionConflict();
    }
    if (activated === 'INVALID_STATE') {
      throw contractsInvalidState();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CommercialContractActivate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialContract,
      resourceId: contractId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { contractNumber: activated.contract_number },
    });

    const activatedItems = await this.contractsRepository.listItems(contractId);
    const documentLinks = await this.contractsRepository.listDocumentLinks(contractId);
    return toContractDetailResponse(activated, activatedItems, documentLinks);
  }

  async close(
    actor: IdentityAuthzContext,
    contractId: string,
    input: CloseContractInput,
  ): Promise<ContractDetailResponse> {
    assertValidContractId(contractId);
    await this.requireContract(actor, contractId, AUTHZ_ACTIONS.CommercialContractClose);

    const validated = resolveCloseContractInput(input);

    const closed = await this.contractsRepository.close({
      contractId,
      rowVersion: validated.rowVersion,
      closureReason: validated.closureReason,
      actorIdentityId: actor.identityId,
    });

    if (closed === 'VERSION_CONFLICT') {
      throw contractsVersionConflict();
    }
    if (closed === 'INVALID_STATE') {
      throw contractsInvalidState();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CommercialContractClose,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialContract,
      resourceId: contractId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });

    const items = await this.contractsRepository.listItems(contractId);
    const documentLinks = await this.contractsRepository.listDocumentLinks(contractId);
    return toContractDetailResponse(closed, items, documentLinks);
  }

  /**
   * Expiração por vencimento: ACTIVE além de valid_to -> EXPIRED. Transição
   * persistida com evento de histórico; contratos terminais permanecem
   * imutáveis (histórico nunca é reescrito).
   */
  async expire(
    actor: IdentityAuthzContext,
    contractId: string,
  ): Promise<ContractDetailResponse> {
    assertValidContractId(contractId);
    await this.requireContract(actor, contractId, AUTHZ_ACTIONS.CommercialContractExpire);

    const expired = await this.contractsRepository.markExpired({
      contractId,
      actorIdentityId: actor.identityId,
    });

    if (expired === 'INVALID_STATE') {
      throw contractsInvalidState();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CommercialContractExpire,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialContract,
      resourceId: contractId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });

    const items = await this.contractsRepository.listItems(contractId);
    const documentLinks = await this.contractsRepository.listDocumentLinks(contractId);
    return toContractDetailResponse(expired, items, documentLinks);
  }

  async linkDocument(
    actor: IdentityAuthzContext,
    contractId: string,
    input: LinkContractDocumentInput,
  ): Promise<ContractDetailResponse> {
    assertValidContractId(contractId);
    const contract = await this.requireContract(
      actor,
      contractId,
      AUTHZ_ACTIONS.CommercialContractUpdate,
    );

    const validated = resolveLinkContractDocumentInput(input);

    await this.referenceValidation.assertDocumentUnitMatch(validated.documentId, contract.unit_id);

    await this.contractsRepository.linkDocument(
      contractId,
      validated.documentId,
      validated.linkPurpose,
      actor.identityId,
    );

    return this.getById(actor, contractId);
  }

  async getById(
    actor: IdentityAuthzContext,
    contractId: string,
  ): Promise<ContractDetailResponse> {
    assertValidContractId(contractId);
    const contract = await this.requireContract(
      actor,
      contractId,
      AUTHZ_ACTIONS.CommercialContractRead,
    );
    const items = await this.contractsRepository.listItems(contractId);
    const documentLinks = await this.contractsRepository.listDocumentLinks(contractId);
    return toContractDetailResponse(contract, items, documentLinks);
  }

  async list(
    actor: IdentityAuthzContext,
    query: ContractListQuery,
  ): Promise<{ items: ReturnType<typeof toContractResponse>[]; limit: number; offset: number }> {
    const scopeFilter = await this.authz.buildListScopeFilter(actor);

    /*
     * PREDICADO ÚNICO, montado no plano de persistência.
     *
     * Antes o serviço concatenava `clauses`/`params` inline e conhecia apenas cliente e unidade.
     * Agora a montagem vive em `contract-list-sql`, ao lado do SQL e do allow-list de ordenação. A
     * autorização continua sendo o PRIMEIRO termo do predicado, como já era.
     */
    const where = buildContractListWhere(scopeFilter, query);

    const rows = await this.contractsRepository.listContracts(
      where.clause,
      where.params,
      query.limit,
      query.offset,
      buildContractListOrderClause(query.sort, query.direction),
    );

    return {
      items: rows.map(toContractResponse),
      limit: query.limit,
      offset: query.offset,
    };
  }

  private async requireContract(
    actor: IdentityAuthzContext,
    contractId: string,
    action: AuthzAction,
  ): Promise<ContractRow> {
    const contract = await this.contractsRepository.findById(contractId);
    if (!contract) {
      throw contractsAccessNotFound();
    }
    await this.authz.assertRecordAction(actor, action, contract);
    return contract;
  }
}
