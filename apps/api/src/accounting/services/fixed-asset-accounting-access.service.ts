import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { assertUuid } from '../../platform/kernel/uuid';
import {
  POSTING_FAILURE_INJECTION,
  POSTING_FAILURE_STAGES,
  PostingFailureInjection,
} from '../../platform/kernel/posting-failure-injection';
import { isPositiveMoneyAmount } from '../../platform/kernel/money-math';
import { AccountingError } from '../domain/ledger';
import {
  FIXED_ASSET_ACCOUNTING_EVENTS,
  FIXED_ASSET_ACCOUNTING_ORIGIN,
  FIXED_ASSET_MOVEMENT_KINDS,
  FIXED_ASSET_STATUSES,
  assertDepreciationRateNotInvented,
  assertFixedAssetCanAcquire,
  isFixedAssetStatus,
  assertFixedAssetCanDispose,
  assertFixedAssetCanReverseAcquisition,
  assertFixedAssetCanTransfer,
  deriveFixedAssetBookValue,
} from '../domain/fixed-asset-accounting';
import {
  validateAcquireFixedAssetInput,
  validateDisposeFixedAssetInput,
  validateRegisterFixedAssetInput,
  validateReverseFixedAssetInput,
  validateTransferFixedAssetInput,
  type AcquireFixedAssetInput,
  type DisposeFixedAssetInput,
  type RegisterFixedAssetInput,
  type ReverseFixedAssetInput,
  type TransferFixedAssetInput,
} from '../domain/fixed-asset-accounting.validation';
import { FixedAssetAccountingRepository } from '../repositories/fixed-asset-accounting.repository';
import {
  toFixedAssetRegisterResponse,
  type FixedAssetRegisterResponse,
} from '../serializers/fixed-asset-accounting-response.serializer';
import { AccountingAccessAuthz } from './accounting-access.authz';
import { AccountingAccessService } from './accounting-access.service';
import { mapAccountingDomainError } from './accounting-access.errors';

/**
 * Pagina do registro de ativo imobilizado.
 *
 * MESMO contrato das demais listagens (`{ items, limit, offset, total, totalPages }`) — o
 * `HumanLookupField`, a paginacao server-side e os contadores sao os mesmos componentes.
 */
export type FixedAssetListResponse = {
  items: FixedAssetRegisterResponse[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

@Injectable()
export class FixedAssetAccountingAccessService {
  constructor(
    private readonly repository: FixedAssetAccountingRepository,
    private readonly accounting: AccountingAccessService,
    private readonly authz: AccountingAccessAuthz,
    private readonly securityAudit: SecurityAuditService,
    @Optional()
    @Inject(POSTING_FAILURE_INJECTION)
    private readonly failures?: PostingFailureInjection,
  ) {}

  async register(
    actor: IdentityAuthzContext,
    input: RegisterFixedAssetInput,
  ): Promise<FixedAssetRegisterResponse> {
    try {
      const validated = validateRegisterFixedAssetInput(input);
      assertUuid(validated.operationalAssetId, 'operationalAssetId');
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingFixedAssetRegister, {
        id: actor.identityId,
        unitId: validated.unitId,
      });
      const opened = await this.repository.register({
        ...validated,
        costCenterCode: validated.costCenterCode ?? null,
        actorIdentityId: actor.identityId,
      });
      if (!opened.idempotent) {
        await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingFixedAssetRegister, opened.register.id, {
          operationalAssetId: opened.register.operational_asset_id,
        });
      }
      return toFixedAssetRegisterResponse(opened.register, []);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async acquire(
    actor: IdentityAuthzContext,
    registerId: string,
    input: AcquireFixedAssetInput,
  ): Promise<FixedAssetRegisterResponse> {
    assertUuid(registerId, 'registerId');
    try {
      const validated = validateAcquireFixedAssetInput(input);
      return await this.repository.withLockedRegister(registerId, async (client, current) => {
        await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingFixedAssetAcquire, {
          id: current.id,
          unitId: current.unit_id,
        });
        assertFixedAssetCanAcquire(current.status);
        if (current.status === FIXED_ASSET_STATUSES.Capitalized) {
          const movements = await this.repository.listPostedMovements(client, current.id);
          return toFixedAssetRegisterResponse(current, movements);
        }
        this.failures?.consume(POSTING_FAILURE_STAGES.AfterFixedAssetMovement);
        const posted = await this.accounting.postConfirmedEvent({
          originKind: FIXED_ASSET_ACCOUNTING_ORIGIN,
          eventKind: FIXED_ASSET_ACCOUNTING_EVENTS.Acquired,
          sourceId: current.id,
          unitId: current.unit_id,
          amount: validated.amount,
          currencyCode: current.currency_code,
          occurredOn: validated.occurredOn,
          idempotencyKey: validated.idempotencyKey,
          sourceReference: current.operational_asset_id,
          actorIdentityId: actor.identityId,
          context: {
            operationalAssetId: current.operational_asset_id,
            usefulLifeMonths: current.useful_life_months,
          },
        });
        await this.repository.insertPostedMovement(client, {
          registerId: current.id,
          kind: FIXED_ASSET_MOVEMENT_KINDS.Acquisition,
          amount: validated.amount,
          currencyCode: current.currency_code,
          occurredOn: validated.occurredOn,
          journalEntryId: posted.journalEntryId,
          postingRequestId: posted.postingRequestId,
          idempotencyKey: validated.idempotencyKey ?? `faa-acq:${current.id}`,
          actorIdentityId: actor.identityId,
        });
        const updated = await this.repository.markCapitalized(client, {
          registerId: current.id,
          acquiredOn: validated.occurredOn,
          actorIdentityId: actor.identityId,
        });
        const movements = await this.repository.listPostedMovements(client, current.id);
        await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingFixedAssetAcquire, updated.id, {
          journalEntryId: posted.journalEntryId,
          amount: validated.amount,
        });
        return toFixedAssetRegisterResponse(updated, movements);
      });
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async dispose(
    actor: IdentityAuthzContext,
    registerId: string,
    input: DisposeFixedAssetInput,
  ): Promise<FixedAssetRegisterResponse> {
    assertUuid(registerId, 'registerId');
    try {
      const validated = validateDisposeFixedAssetInput(input);
      return await this.repository.withLockedRegister(registerId, async (client, current) => {
        await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingFixedAssetDispose, {
          id: current.id,
          unitId: current.unit_id,
        });
        assertFixedAssetCanDispose(current.status);
        const existing = await this.repository.listPostedMovements(client, current.id);
        if (current.status === FIXED_ASSET_STATUSES.Disposed) {
          return toFixedAssetRegisterResponse(current, existing);
        }
        const bookValue = deriveFixedAssetBookValue(
          existing.map((item) => ({ kind: item.kind, status: item.status, amount: item.amount })),
        );
        if (!isPositiveMoneyAmount(bookValue)) {
          throw new AccountingError('ACCOUNTING_FIXED_ASSET_INVALID');
        }
        const posted = await this.accounting.postConfirmedEvent({
          originKind: FIXED_ASSET_ACCOUNTING_ORIGIN,
          eventKind: FIXED_ASSET_ACCOUNTING_EVENTS.Disposed,
          sourceId: current.id,
          unitId: current.unit_id,
          amount: bookValue,
          currencyCode: current.currency_code,
          occurredOn: validated.occurredOn,
          idempotencyKey: validated.idempotencyKey,
          sourceReference: current.operational_asset_id,
          actorIdentityId: actor.identityId,
          context: { operationalAssetId: current.operational_asset_id },
        });
        await this.repository.insertPostedMovement(client, {
          registerId: current.id,
          kind: FIXED_ASSET_MOVEMENT_KINDS.Disposal,
          amount: bookValue,
          currencyCode: current.currency_code,
          occurredOn: validated.occurredOn,
          journalEntryId: posted.journalEntryId,
          postingRequestId: posted.postingRequestId,
          idempotencyKey: validated.idempotencyKey ?? `faa-disp:${current.id}`,
          actorIdentityId: actor.identityId,
        });
        const updated = await this.repository.markDisposed(client, {
          registerId: current.id,
          disposedOn: validated.occurredOn,
          actorIdentityId: actor.identityId,
        });
        const movements = await this.repository.listPostedMovements(client, current.id);
        await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingFixedAssetDispose, updated.id, {
          journalEntryId: posted.journalEntryId,
          amount: bookValue,
        });
        return toFixedAssetRegisterResponse(updated, movements);
      });
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async transfer(
    actor: IdentityAuthzContext,
    registerId: string,
    input: TransferFixedAssetInput,
  ): Promise<FixedAssetRegisterResponse> {
    assertUuid(registerId, 'registerId');
    try {
      const validated = validateTransferFixedAssetInput(input);
      return await this.repository.withLockedRegister(registerId, async (client, current) => {
        await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingFixedAssetTransfer, {
          id: current.id,
          unitId: current.unit_id,
        });
        assertFixedAssetCanTransfer(current.status);
        const existing = await this.repository.listPostedMovements(client, current.id);
        const bookValue = deriveFixedAssetBookValue(
          existing.map((item) => ({ kind: item.kind, status: item.status, amount: item.amount })),
        );
        if (!isPositiveMoneyAmount(bookValue)) {
          throw new AccountingError('ACCOUNTING_FIXED_ASSET_INVALID');
        }
        const movementId = crypto.randomUUID();
        const posted = await this.accounting.postConfirmedEvent({
          originKind: FIXED_ASSET_ACCOUNTING_ORIGIN,
          eventKind: FIXED_ASSET_ACCOUNTING_EVENTS.Transferred,
          sourceId: movementId,
          unitId: current.unit_id,
          amount: bookValue,
          currencyCode: current.currency_code,
          occurredOn: validated.occurredOn,
          idempotencyKey: validated.idempotencyKey,
          sourceReference: current.operational_asset_id,
          actorIdentityId: actor.identityId,
          context: {
            fromCostCenterCode: current.cost_center_code,
            toCostCenterCode: validated.toCostCenterCode,
          },
        });
        await this.repository.insertPostedMovement(client, {
          id: movementId,
          registerId: current.id,
          kind: FIXED_ASSET_MOVEMENT_KINDS.Transfer,
          amount: bookValue,
          currencyCode: current.currency_code,
          occurredOn: validated.occurredOn,
          fromCostCenterCode: current.cost_center_code,
          toCostCenterCode: validated.toCostCenterCode,
          journalEntryId: posted.journalEntryId,
          postingRequestId: posted.postingRequestId,
          idempotencyKey: validated.idempotencyKey ?? `faa-xfer:${movementId}`,
          actorIdentityId: actor.identityId,
        });
        const updated = await this.repository.markTransferred(client, {
          registerId: current.id,
          costCenterCode: validated.toCostCenterCode,
          actorIdentityId: actor.identityId,
        });
        const movements = await this.repository.listPostedMovements(client, current.id);
        await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingFixedAssetTransfer, updated.id, {
          toCostCenterCode: validated.toCostCenterCode,
        });
        return toFixedAssetRegisterResponse(updated, movements);
      });
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async reverseAcquisition(
    actor: IdentityAuthzContext,
    registerId: string,
    input: ReverseFixedAssetInput,
  ): Promise<FixedAssetRegisterResponse> {
    assertUuid(registerId, 'registerId');
    try {
      const validated = validateReverseFixedAssetInput(input);
      return await this.repository.withLockedRegister(registerId, async (client, current) => {
        await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingFixedAssetReverse, {
          id: current.id,
          unitId: current.unit_id,
        });
        assertFixedAssetCanReverseAcquisition(current.status);
        const existing = await this.repository.listPostedMovements(client, current.id);
        const acquisition = existing.find(
          (item) => item.kind === FIXED_ASSET_MOVEMENT_KINDS.Acquisition && item.status === 'POSTED',
        );
        if (!acquisition?.journal_entry_id) {
          throw new AccountingError('ACCOUNTING_FIXED_ASSET_NOT_CAPITALIZED');
        }
        const journal = await this.accounting.getJournal(actor, acquisition.journal_entry_id);
        await this.accounting.reverse(actor, journal.id, {
          rowVersion: journal.rowVersion,
          idempotencyKey: `faa-rev-acq:${current.id}`,
          reason: validated.reason,
        });
        const reversed = await this.repository.reverseAcquisition(client, {
          registerId: current.id,
          actorIdentityId: actor.identityId,
        });
        const movements = await this.repository.listPostedMovements(client, current.id);
        await this.audit(actor, SECURITY_AUDIT_ACTIONS.AccountingFixedAssetReverse, reversed.register.id, {
          reason: validated.reason,
        });
        return toFixedAssetRegisterResponse(reversed.register, movements);
      });
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async depreciate(): Promise<never> {
    try {
      assertDepreciationRateNotInvented();
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  async getById(actor: IdentityAuthzContext, registerId: string): Promise<FixedAssetRegisterResponse> {
    assertUuid(registerId, 'registerId');
    try {
      const register = await this.repository.findById(registerId);
      if (!register) {
        throw new AccountingError('ACCOUNTING_FIXED_ASSET_NOT_FOUND');
      }
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingFixedAssetRead, {
        id: register.id,
        unitId: register.unit_id,
      });
      const movements = await this.repository.listMovements(register.id);
      return toFixedAssetRegisterResponse(register, movements);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  /**
   * LISTAGEM do registro de ativo imobilizado.
   *
   * Fecha o `PARK: HUMAN_LOOKUP_API_GAP` que permanecia legitimo: o `GET` anterior era
   * `getByOperationalAsset` e EXIGIA `operationalAssetId`, entao nao havia como descobrir quais
   * registros existem — nem como vincula-los a um ativo operacional sem ja saber o UUID.
   *
   * Cada linha e serializada SEM movimentos (`movements: []`). A listagem nao carrega o
   * historico de cada registro: faze-lo seria uma consulta por linha (N+1) e a tela de lista nao
   * exibe movimentos. Quem precisa do historico pede o registro por `getByOperationalAsset`.
   *
   * ARQUIVO DE AUDITORIA NAO E USADO AQUI: listagem e leitura, nao comando de negocio.
   */
  async list(
    actor: IdentityAuthzContext,
    query: { unitId: string; status?: string; search?: string; limit: number; offset: number },
  ): Promise<FixedAssetListResponse> {
    await this.authz.assertFixedAssetList(actor);

    const statusCandidate = query.status?.toUpperCase();
    if (statusCandidate !== undefined && !isFixedAssetStatus(statusCandidate)) {
      throw mapAccountingDomainError(new AccountingError('ACCOUNTING_FIXED_ASSET_STATUS_INVALID'));
    }

    const filter = { unitId: query.unitId, status: statusCandidate, search: query.search };
    const total = await this.repository.count(filter);
    const rows = await this.repository.list({
      ...filter,
      limit: query.limit,
      offset: query.offset,
    });

    return {
      items: rows.map((row) => toFixedAssetRegisterResponse(row, [])),
      limit: query.limit,
      offset: query.offset,
      total,
      totalPages: query.limit > 0 ? Math.ceil(total / query.limit) : 0,
    };
  }

  async getByOperationalAsset(
    actor: IdentityAuthzContext,
    unitId: string,
    operationalAssetId: string,
  ): Promise<FixedAssetRegisterResponse> {
    assertUuid(operationalAssetId, 'operationalAssetId');
    try {
      const register = await this.repository.findByOperationalAsset(unitId, operationalAssetId);
      if (!register) {
        throw new AccountingError('ACCOUNTING_FIXED_ASSET_NOT_FOUND');
      }
      await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingFixedAssetRead, {
        id: register.id,
        unitId: register.unit_id,
      });
      const movements = await this.repository.listMovements(register.id);
      return toFixedAssetRegisterResponse(register, movements);
    } catch (error) {
      throw mapAccountingDomainError(error);
    }
  }

  private async audit(
    actor: IdentityAuthzContext,
    action: (typeof SECURITY_AUDIT_ACTIONS)[keyof typeof SECURITY_AUDIT_ACTIONS],
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.AccountingLedger,
      resourceId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
      metadata,
    });
  }
}
