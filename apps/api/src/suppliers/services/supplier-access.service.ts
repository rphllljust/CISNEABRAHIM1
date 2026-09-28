import { Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { SodEnforcementService } from '../../authorization/services/sod-enforcement.service';
import { SOD_DUTIES, resolveSodScope } from '../../authorization/domain/segregation-of-duties';
import type {
  CommercialSupplierPort,
  CommercialSupplierReference,
  CommercialSupplierView,
} from '../../platform/bounded-contexts/enterprise-core-ports';
import { assertUuid } from '../../platform/kernel/uuid';
import { SupplierError, SUPPLIER_HISTORY_KINDS, assertSupplierActive } from '../domain/supplier';
import {
  assertCreateSupplierInput,
  assertDeactivationReason,
  assertUpdateSupplierInput,
  type CreateSupplierInput,
  type UpdateSupplierInput,
} from '../domain/supplier.validation';
import { SuppliersRepository } from '../repositories/suppliers.repository';
import {
  toSupplierResponse,
  toSupplierSummaryResponse,
  type SupplierHistoryResponse,
  type SupplierListResponse,
  type SupplierResponse,
} from '../serializers/supplier-response.serializer';
import { SupplierAccessAuthz } from './supplier-access.authz';
import { mapSupplierDomainError, supplierAccessDenied } from './supplier-access.errors';
import type { SupplierListQuery } from '../dto/supplier-list.dto';

@Injectable()
export class SupplierAccessService implements CommercialSupplierPort {
  constructor(
    private readonly repository: SuppliersRepository,
    private readonly authz: SupplierAccessAuthz,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly securityAudit: SecurityAuditService,
    private readonly sod: SodEnforcementService,
  ) {}

  async create(actor: IdentityAuthzContext, input: CreateSupplierInput): Promise<SupplierResponse> {
    try {
      await this.authz.assertSupplierAction(actor, AUTHZ_ACTIONS.SupplierCreate, {
        id: actor.identityId,
      });
      const validated = assertCreateSupplierInput(input);
      const created = await this.repository.create({
        legalName: input.legalName,
        tradeName: input.tradeName,
        normalizedTaxId: validated.normalizedTaxId,
        externalErpId: input.externalErpId,
        paymentTerms: input.paymentTerms,
        currencyCode: validated.currencyCode,
        contacts: input.contacts,
        addresses: input.addresses,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.SupplierCreate, created.id);
      return this.assemble(created.id);
    } catch (error) {
      if (isUniqueTaxIdViolation(error)) {
        throw mapSupplierDomainError(new SupplierError('SUPPLIER_TAX_ID_CONFLICT'));
      }
      throw mapSupplierDomainError(error);
    }
  }

  /**
   * Listagem operacional de fornecedores. A autorização é a mesma classe usada nas demais ações
   * do recurso: exige concessão ativa de `supplier:supplier:list` no tipo de recurso Supplier.
   * Sem concessão a listagem é negada — a tela nunca lista o que o ator não pode ler.
   */
  async list(actor: IdentityAuthzContext, query: SupplierListQuery): Promise<SupplierListResponse> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.SupplierList,
      AUTHZ_RESOURCE_TYPES.Supplier,
    );
    if (grants.length === 0) {
      throw mapSupplierDomainError(supplierAccessDenied());
    }

    const whereParts: string[] = [];
    const params: unknown[] = [];

    if (query.status) {
      whereParts.push(`status = $${params.length + 1}::pty.supplier_status`);
      params.push(query.status);
    }
    if (query.q) {
      whereParts.push(
        `(legal_name ILIKE $${params.length + 1} OR trade_name ILIKE $${params.length + 1} OR normalized_tax_id ILIKE $${params.length + 1})`,
      );
      params.push(`%${query.q}%`);
    }

    const whereClause = whereParts.length > 0 ? whereParts.join(' AND ') : 'TRUE';

    const rows = await this.repository.listPage({
      whereClause,
      params,
      limit: query.limit,
      offset: query.offset,
    });

    /**
     * Página inicial incompleta prova que o conjunto acabou: não há linha depois dela, logo o
     * total é exatamente o devolvido. Evita COUNT redundante sem devolver total aproximado
     * quando a página está cheia.
     */
    const total =
      query.offset === 0 && rows.length < query.limit
        ? rows.length
        : await this.repository.countList(whereClause, params);

    return {
      items: rows.map(toSupplierSummaryResponse),
      limit: query.limit,
      offset: query.offset,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getById(actor: IdentityAuthzContext, supplierId: string): Promise<SupplierResponse> {
    assertUuid(supplierId, 'supplierId');
    try {
      const row = await this.repository.findRowById(supplierId);
      if (!row) {
        throw new SupplierError('SUPPLIER_NOT_FOUND');
      }
      await this.authz.assertSupplierAction(actor, AUTHZ_ACTIONS.SupplierRead, { id: row.id });
      return this.assemble(row.id);
    } catch (error) {
      throw mapSupplierDomainError(error);
    }
  }

  async update(
    actor: IdentityAuthzContext,
    supplierId: string,
    input: UpdateSupplierInput,
  ): Promise<SupplierResponse> {
    assertUuid(supplierId, 'supplierId');
    try {
      assertUpdateSupplierInput(input);
      const existing = await this.repository.findRowById(supplierId);
      if (!existing) {
        throw new SupplierError('SUPPLIER_NOT_FOUND');
      }
      await this.authz.assertSupplierAction(actor, AUTHZ_ACTIONS.SupplierUpdate, { id: existing.id });
      const updated = await this.repository.update({
        supplierId,
        expectedVersion: input.version,
        legalName: input.legalName,
        tradeName: input.tradeName,
        externalErpId: input.externalErpId,
        paymentTerms: input.paymentTerms,
        currencyCode: input.currencyCode,
        actorIdentityId: actor.identityId,
      });
      if (updated === null) {
        throw new SupplierError('SUPPLIER_NOT_FOUND');
      }
      if (updated === 'VERSION_CONFLICT') {
        throw new SupplierError('SUPPLIER_VERSION_CONFLICT');
      }
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.SupplierUpdate, supplierId);
      return this.assemble(supplierId);
    } catch (error) {
      throw mapSupplierDomainError(error);
    }
  }

  async deactivate(
    actor: IdentityAuthzContext,
    supplierId: string,
    version: number,
    reason: string,
  ): Promise<SupplierResponse> {
    assertUuid(supplierId, 'supplierId');
    try {
      assertDeactivationReason(reason);
      const existing = await this.repository.findRowById(supplierId);
      if (!existing) {
        throw new SupplierError('SUPPLIER_NOT_FOUND');
      }
      await this.authz.assertSupplierAction(actor, AUTHZ_ACTIONS.SupplierDeactivate, { id: existing.id });
      const updated = await this.repository.setStatus({
        supplierId,
        expectedVersion: version,
        status: 'INACTIVE',
        actorIdentityId: actor.identityId,
        reason,
      });
      if (updated === null) {
        throw new SupplierError('SUPPLIER_NOT_FOUND');
      }
      if (updated === 'VERSION_CONFLICT') {
        throw new SupplierError('SUPPLIER_VERSION_CONFLICT');
      }
      if (updated === 'INVALID_STATE') {
        throw new SupplierError('SUPPLIER_INVALID_STATE');
      }
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.SupplierDeactivate, supplierId);
      return this.assemble(supplierId);
    } catch (error) {
      throw mapSupplierDomainError(error);
    }
  }

  async activate(actor: IdentityAuthzContext, supplierId: string, version: number): Promise<SupplierResponse> {
    assertUuid(supplierId, 'supplierId');
    try {
      const existing = await this.repository.findRowById(supplierId);
      if (!existing) {
        throw new SupplierError('SUPPLIER_NOT_FOUND');
      }
      await this.authz.assertSupplierAction(actor, AUTHZ_ACTIONS.SupplierActivate, { id: existing.id });
      const history = await this.repository.listHistory(supplierId);
      const created = history.find((event) => event.event_kind === SUPPLIER_HISTORY_KINDS.Created);
      const scope = resolveSodScope();
      await this.sod.enforce(actor, {
        duty: SOD_DUTIES.SupplierActivate,
        originatorIdentityId: created?.actor_identity_id,
        ...scope,
      });
      const updated = await this.repository.setStatus({
        supplierId,
        expectedVersion: version,
        status: 'ACTIVE',
        actorIdentityId: actor.identityId,
      });
      if (updated === null) {
        throw new SupplierError('SUPPLIER_NOT_FOUND');
      }
      if (updated === 'VERSION_CONFLICT') {
        throw new SupplierError('SUPPLIER_VERSION_CONFLICT');
      }
      if (updated === 'INVALID_STATE') {
        throw new SupplierError('SUPPLIER_INVALID_STATE');
      }
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.SupplierActivate, supplierId);
      return this.assemble(supplierId);
    } catch (error) {
      throw mapSupplierDomainError(error);
    }
  }

  async history(actor: IdentityAuthzContext, supplierId: string): Promise<SupplierHistoryResponse[]> {
    assertUuid(supplierId, 'supplierId');
    try {
      const existing = await this.repository.findRowById(supplierId);
      if (!existing) {
        throw new SupplierError('SUPPLIER_NOT_FOUND');
      }
      await this.authz.assertSupplierAction(actor, AUTHZ_ACTIONS.SupplierRead, { id: existing.id });
      const rows = await this.repository.listHistory(supplierId);
      return rows.map((item) => ({
        id: item.id,
        eventKind: item.event_kind,
        actorIdentityId: item.actor_identity_id,
        occurredAt: item.occurred_at instanceof Date ? item.occurred_at.toISOString() : String(item.occurred_at),
      }));
    } catch (error) {
      throw mapSupplierDomainError(error);
    }
  }

  async findPublishedById(supplierId: string): Promise<CommercialSupplierView | null> {
    const row = await this.repository.findPublishedById(supplierId);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      status: row.status,
      currencyCode: row.currency_code,
      paymentTerms: row.payment_terms,
    };
  }

  async requireActive(supplierId: string): Promise<CommercialSupplierView> {
    const published = await this.findPublishedById(supplierId);
    if (!published) {
      throw new SupplierError('SUPPLIER_NOT_FOUND');
    }
    assertSupplierActive(published.status);
    return published;
  }

  async assertNotInactive(supplierId: string): Promise<void> {
    const published = await this.findPublishedById(supplierId);
    if (published) {
      assertSupplierActive(published.status);
    }
  }

  /**
   * Referências humanas para outros contextos (Compras, Financeiro). É a via legítima pela qual o
   * dado do fornecedor atravessa a fronteira do contexto Comercial: o consumidor nunca lê
   * `pty.suppliers` diretamente.
   */
  async findReferencesByIds(supplierIds: string[]): Promise<CommercialSupplierReference[]> {
    const rows = await this.repository.listReferencesByIds(supplierIds);
    return rows.map((row) => ({
      id: row.id,
      legalName: row.legal_name,
      tradeName: row.trade_name,
      taxId: row.normalized_tax_id,
    }));
  }

  async searchIdsByTerm(term: string, limit: number): Promise<string[]> {
    const trimmed = term.trim();
    if (trimmed.length === 0) {
      return [];
    }
    return this.repository.searchIdsByTerm(trimmed, limit);
  }

  private async assemble(supplierId: string): Promise<SupplierResponse> {
    const row = await this.repository.findRowById(supplierId);
    if (!row) {
      throw new SupplierError('SUPPLIER_NOT_FOUND');
    }
    const [contacts, addresses] = await Promise.all([
      this.repository.listContacts(supplierId),
      this.repository.listAddresses(supplierId),
    ]);
    return toSupplierResponse(row, contacts, addresses);
  }

  private async audit(
    actor: IdentityAuthzContext,
    action: (typeof SECURITY_AUDIT_ACTIONS)[keyof typeof SECURITY_AUDIT_ACTIONS],
    resourceId: string,
  ): Promise<void> {
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Supplier,
      resourceId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });
  }
}

function isUniqueTaxIdViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
