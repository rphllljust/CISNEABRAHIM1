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
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import { SodEnforcementService } from '../../authorization/services/sod-enforcement.service';
import { SOD_DUTIES, resolveSodScope } from '../../authorization/domain/segregation-of-duties';
import { assertUuid } from '../../platform/kernel/uuid';
import {
  AUTO_EXACT_MATCH_CRITERIA,
  BANK_LINE_MATCH_STATUSES,
  RECONCILIATION_MATCH_METHODS,
  RECONCILIATION_STATUSES,
  BankReconciliationError,
  assertConfirmedImmutable,
  assertFinancialReconciliationIntegrity,
  assertNotAmountApproximation,
  assertReconciliationConfirmable,
  assertReconciliationUnreconcilable,
  classifyAutoMatch,
  isExactMatchCandidate,
  targetIdFromMovement,
  targetKindFromOrigin,
} from '../domain/bank-reconciliation';
import {
  BANK_IMPORT_FORMATS,
  BANK_IMPORT_STATUSES,
  BANK_LINE_IDENTITY_KINDS,
  buildLineIdentity,
  normalizeBankImportLines,
  parseCisneStatementV1,
  validateBankImportUpload,
} from '../domain/bank-import';
import {
  validateImportBankFileInput,
  type ImportBankFileInput,
} from '../domain/bank-import.validation';
import {
  validateImportBankStatementInput,
  validateManualMatchInput,
  type ImportBankStatementInput,
  type ManualMatchInput,
} from '../domain/bank-reconciliation.validation';
import { FINANCIAL_ACCOUNT_KINDS } from '../domain/treasury';
import {
  assertBankStatementStatus,
  type BankStatementListQuery,
} from '../dto/bank-statement-list.dto';
import {
  toBankStatementSummaryResponse,
  type BankStatementListResponse,
} from '../serializers/bank-statement-list-response.serializer';
import { toBankImportResponse, type BankImportResponse } from '../serializers/bank-import-response.serializer';
import { BankReconciliationRepository } from '../repositories/bank-reconciliation.repository';
import type {
  BankStatementLineRow,
  EligibleMovementRow,
} from '../repositories/bank-reconciliation.repository.types';
import { TreasuryRepository } from '../repositories/treasury.repository';
import {
  toReconciliationResponse,
  toStatementResponse,
  type BankStatementResponse,
  type ReconciliationResponse,
} from '../serializers/bank-reconciliation-response.serializer';
import { bankReconAccessDenied, mapBankReconciliationError } from './bank-reconciliation-access.errors';
import { TreasuryAccessAuthz } from './treasury-access.authz';

@Injectable()
export class BankReconciliationAccessService {
  constructor(
    private readonly repository: BankReconciliationRepository,
    private readonly treasuryRepository: TreasuryRepository,
    private readonly authz: TreasuryAccessAuthz,
    private readonly securityAudit: SecurityAuditService,
    private readonly sod: SodEnforcementService,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly scopeEnforcement: ScopeEnforcementService,
  ) {}

  async importStatement(
    actor: IdentityAuthzContext,
    input: ImportBankStatementInput,
  ): Promise<BankStatementResponse> {
    try {
      const validated = validateImportBankStatementInput(input);
      const account = await this.treasuryRepository.findAccountById(validated.financialAccountId);
      if (!account || account.unit_id !== validated.unitId) {
        throw new BankReconciliationError('BANK_RECON_NOT_FOUND');
      }
      if (account.kind !== FINANCIAL_ACCOUNT_KINDS.Bank) {
        throw new BankReconciliationError('BANK_RECON_NOT_BANK_ACCOUNT');
      }
      await this.authz.assertTreasuryAction(actor, AUTHZ_ACTIONS.FinanceBankStatementImport, {
        id: account.id,
        unitId: account.unit_id,
      });
      const persisted = await this.repository.withTransaction(async (client) => {
        const existing = await this.repository.findStatementByIdempotency(
          validated.unitId,
          validated.idempotencyKey,
          client,
        );
        if (existing) {
          const existingLines = await this.repository.listLines(existing.id);
          return { statement: existing, lines: existingLines, idempotent: true };
        }
        const statement = await this.repository.insertStatement(
          {
            ...validated,
            actorIdentityId: actor.identityId,
          },
          client,
        );
        const lines: Array<BankStatementLineRow & { duplicate?: boolean }> = [];
        for (const [index, line] of validated.lines.entries()) {
          const identity = buildLineIdentity(account.id, `stmt:${validated.idempotencyKey}`, {
            occurredOn: line.occurredOn,
            direction: line.direction,
            amount: line.amount,
            externalReference: line.externalReference ?? null,
            sourceLineKey: line.sourceLineKey,
            lineNumber: line.lineNumber ?? index + 1,
          });
          const inserted = await this.repository.insertLine(
            {
              bankStatementId: statement.id,
              lineNumber: line.lineNumber ?? index + 1,
              occurredOn: line.occurredOn,
              direction: line.direction,
              amount: line.amount,
              description: line.description,
              sourceLineKey: line.sourceLineKey,
              externalReference: line.externalReference ?? null,
              fingerprint: identity.fingerprint,
              identityKind: identity.identityKind,
            },
            client,
          );
          if (inserted.duplicate && inserted.row.bank_statement_id !== statement.id) {
            continue;
          }
          if (inserted.duplicate && lines.some((item) => item.id === inserted.row.id)) {
            continue;
          }
          lines.push({ ...inserted.row, duplicate: inserted.duplicate });
        }
        return { statement, lines, idempotent: false };
      });
      if (!persisted.idempotent) {
        await this.securityAudit.record({
          actorIdentityId: actor.identityId,
          actorSessionId: actor.sessionId,
          action: SECURITY_AUDIT_ACTIONS.FinanceBankStatementImport,
          resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinanceTreasury,
          resourceId: persisted.statement.id,
          outcome: SECURITY_AUDIT_OUTCOMES.Success,
          classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
          metadata: { sourceKind: persisted.statement.source_kind, lineCount: persisted.lines.length },
        });
      }
      return toStatementResponse(persisted.statement, persisted.lines, persisted.idempotent);
    } catch (error) {
      throw mapBankReconciliationError(error);
    }
  }

  async importFile(actor: IdentityAuthzContext, input: ImportBankFileInput): Promise<BankImportResponse> {
    try {
      const validated = validateImportBankFileInput(input);
      const account = await this.treasuryRepository.findAccountById(validated.financialAccountId);
      if (!account || account.unit_id !== validated.unitId) {
        throw new BankReconciliationError('BANK_RECON_NOT_FOUND');
      }
      if (account.kind !== FINANCIAL_ACCOUNT_KINDS.Bank) {
        throw new BankReconciliationError('BANK_RECON_NOT_BANK_ACCOUNT');
      }
      await this.authz.assertTreasuryAction(actor, AUTHZ_ACTIONS.FinanceBankStatementImport, {
        id: account.id,
        unitId: account.unit_id,
      });

      const uploaded = validateBankImportUpload({
        content: validated.content,
        fileName: validated.fileName,
        declaredFormat: validated.declaredFormat,
      });
      const parsed = parseCisneStatementV1(validated.content);
      const normalized = normalizeBankImportLines(account.id, uploaded.fileChecksum, parsed.lines);
      const idempotencyKey = validated.idempotencyKey ?? `bank-import:${uploaded.fileChecksum}`;

      const replay = await this.replayFileImport(
        validated.unitId,
        account.id,
        uploaded.fileChecksum,
        idempotencyKey,
      );
      if (replay) {
        return replay;
      }

      const sufficientFingerprints = normalized.lines
        .filter((line) => line.identityKind === BANK_LINE_IDENTITY_KINDS.Sufficient)
        .map((line) => line.fingerprint);
      const existingByFingerprint = await this.repository.findLinesByFingerprints(sufficientFingerprints);
      const existingFingerprintSet = new Set(
        existingByFingerprint
          .map((row) => row.fingerprint)
          .filter((value): value is string => typeof value === 'string'),
      );
      const newLines = normalized.lines.filter(
        (line) =>
          line.identityKind !== BANK_LINE_IDENTITY_KINDS.Sufficient ||
          !existingFingerprintSet.has(line.fingerprint),
      );
      const duplicateLineCount =
        normalized.duplicateLineCount + (normalized.lines.length - newLines.length);

      const persisted = await this.repository.withTransaction(async (client) => {
        const existingImport = await this.repository.findImportByChecksum(
          validated.unitId,
          account.id,
          uploaded.fileChecksum,
          client,
        );
        if (existingImport?.bank_statement_id) {
          const statement = await this.repository.findStatementById(existingImport.bank_statement_id);
          const lines = statement ? await this.repository.listLines(statement.id) : [];
          return { importRow: existingImport, statement, lines, idempotent: true };
        }

        if (newLines.length === 0) {
          const owner = existingByFingerprint[0];
          if (!owner) {
            throw new BankReconciliationError('BANK_IMPORT_MALFORMED');
          }
          const statement = await this.repository.findStatementById(owner.bank_statement_id);
          const importRow = await this.repository.insertImport(
            {
              unitId: validated.unitId,
              financialAccountId: account.id,
              bankStatementId: owner.bank_statement_id,
              format: BANK_IMPORT_FORMATS.CisneStatementV1,
              fileName: validated.fileName,
              fileChecksum: uploaded.fileChecksum,
              byteSize: uploaded.byteSize,
              status: BANK_IMPORT_STATUSES.Imported,
              lineCount: parsed.lines.length,
              importedLineCount: 0,
              duplicateLineCount,
              idempotencyKey,
              actorIdentityId: actor.identityId,
            },
            client,
          );
          const lines = statement ? await this.repository.listLines(statement.id) : [];
          return { importRow, statement, lines, idempotent: false };
        }

        const statement = await this.repository.insertStatement(
          {
            unitId: validated.unitId,
            financialAccountId: account.id,
            sourceKind: parsed.sourceKind,
            sourceReference: parsed.sourceReference,
            periodStartsOn: parsed.periodStartsOn,
            periodEndsOn: parsed.periodEndsOn,
            currencyCode: parsed.currencyCode,
            idempotencyKey,
            actorIdentityId: actor.identityId,
            fileChecksum: uploaded.fileChecksum,
          },
          client,
        );
        const lines: BankStatementLineRow[] = [];
        let extraDuplicates = 0;
        for (const line of newLines) {
          const inserted = await this.repository.insertLine(
            {
              bankStatementId: statement.id,
              lineNumber: line.lineNumber,
              occurredOn: line.occurredOn,
              direction: line.direction,
              amount: line.amount,
              description: line.description,
              sourceLineKey: line.sourceLineKey,
              externalReference: line.externalReference,
              fingerprint: line.fingerprint,
              identityKind: line.identityKind,
            },
            client,
          );
          if (inserted.duplicate && inserted.row.bank_statement_id !== statement.id) {
            extraDuplicates += 1;
            continue;
          }
          if (inserted.duplicate && lines.some((item) => item.id === inserted.row.id)) {
            extraDuplicates += 1;
            continue;
          }
          lines.push(inserted.row);
        }
        if (lines.length === 0) {
          throw new BankReconciliationError('BANK_IMPORT_MALFORMED');
        }
        const importRow = await this.repository.insertImport(
          {
            unitId: validated.unitId,
            financialAccountId: account.id,
            bankStatementId: statement.id,
            format: BANK_IMPORT_FORMATS.CisneStatementV1,
            fileName: validated.fileName,
            fileChecksum: uploaded.fileChecksum,
            byteSize: uploaded.byteSize,
            status: BANK_IMPORT_STATUSES.Imported,
            lineCount: parsed.lines.length,
            importedLineCount: lines.length,
            duplicateLineCount: duplicateLineCount + extraDuplicates,
            idempotencyKey,
            actorIdentityId: actor.identityId,
          },
          client,
        );
        return { importRow, statement, lines, idempotent: false };
      });

      if (!persisted.statement) {
        throw new BankReconciliationError('BANK_RECON_NOT_FOUND');
      }

      if (!persisted.idempotent) {
        await this.securityAudit.record({
          actorIdentityId: actor.identityId,
          actorSessionId: actor.sessionId,
          action: SECURITY_AUDIT_ACTIONS.FinanceBankStatementImport,
          resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinanceTreasury,
          resourceId: persisted.statement.id,
          outcome: SECURITY_AUDIT_OUTCOMES.Success,
          classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
          metadata: {
            sourceKind: persisted.statement.source_kind,
            format: BANK_IMPORT_FORMATS.CisneStatementV1,
            fileChecksum: uploaded.fileChecksum,
            importedLineCount: persisted.importRow.imported_line_count,
            duplicateLineCount: persisted.importRow.duplicate_line_count,
          },
        });
      }

      const statementResponse = toStatementResponse(
        persisted.statement,
        persisted.lines,
        persisted.idempotent,
      );
      const reconciliation = persisted.idempotent
        ? null
        : await this.autoMatch(actor, persisted.statement.id);
      return toBankImportResponse({
        row: persisted.importRow,
        idempotent: persisted.idempotent,
        statement: statementResponse,
        reconciliation: reconciliation
          ? {
              statementId: reconciliation.statementId,
              suggested: reconciliation.suggested,
              reviewRequired: reconciliation.reviewRequired,
              unmatched: reconciliation.unmatched,
            }
          : null,
      });
    } catch (error) {
      throw mapBankReconciliationError(error);
    }
  }

  async autoMatch(
    actor: IdentityAuthzContext,
    statementId: string,
  ): Promise<{
    statementId: string;
    suggested: ReconciliationResponse[];
    reviewRequired: string[];
    unmatched: string[];
    autoMatchedConfirmed: number;
  }> {
    try {
      const statement = await this.requireStatement(actor, statementId, AUTHZ_ACTIONS.FinanceReconciliationMatch);
      const movements = (await this.repository.listEligibleMovements(statement.financial_account_id)).map(
        toEligible,
      );
      const lines = await this.repository.listLines(statement.id);
      const suggested: ReconciliationResponse[] = [];
      const reviewRequired: string[] = [];
      const unmatched: string[] = [];
      for (const line of lines) {
        if (line.match_status === BANK_LINE_MATCH_STATUSES.Matched) {
          continue;
        }
        const candidates = movements.filter((movement) =>
          isExactMatchCandidate(
            {
              id: line.id,
              accountId: statement.financial_account_id,
              direction: line.direction,
              amount: line.amount,
              occurredOn: line.occurred_on,
            },
            movement,
          ),
        );
        const classified = classifyAutoMatch(candidates);
        if (classified.status === BANK_LINE_MATCH_STATUSES.ReviewRequired) {
          await this.repository.withLockedLine(line.id, async (client) => {
            await this.repository.markReviewRequired(client, line.id);
          });
          reviewRequired.push(line.id);
          continue;
        }
        if (!classified.selected) {
          unmatched.push(line.id);
          continue;
        }
        const created = await this.suggestExact(actor, statement.unit_id, line.id, classified.selected);
        suggested.push(created);
        movements.splice(
          movements.findIndex((item) => item.id === classified.selected?.id),
          1,
        );
      }
      return {
        statementId: statement.id,
        suggested,
        reviewRequired,
        unmatched,
        autoMatchedConfirmed: 0,
      };
    } catch (error) {
      throw mapBankReconciliationError(error);
    }
  }

  async matchManual(
    actor: IdentityAuthzContext,
    input: ManualMatchInput,
  ): Promise<ReconciliationResponse> {
    try {
      const validated = validateManualMatchInput(input);
      const line = await this.repository.findLineById(validated.bankStatementLineId);
      if (!line) {
        throw new BankReconciliationError('BANK_RECON_NOT_FOUND');
      }
      const statement = await this.requireStatement(
        actor,
        line.bank_statement_id,
        AUTHZ_ACTIONS.FinanceReconciliationMatch,
      );
      const movement = await this.repository.findMovementById(validated.financialTransactionId);
      if (!movement) {
        throw new BankReconciliationError('BANK_RECON_NOT_FOUND');
      }
      const eligible = toEligible(movement);
      if (
        !isExactMatchCandidate(
          {
            id: line.id,
            accountId: statement.financial_account_id,
            direction: line.direction,
            amount: line.amount,
            occurredOn: line.occurred_on,
          },
          eligible,
        )
      ) {
        assertNotAmountApproximation(line.amount, eligible.amount);
        throw new BankReconciliationError('BANK_RECON_AMOUNT_NOT_EXACT');
      }
      return this.suggestExact(actor, statement.unit_id, line.id, eligible, RECONCILIATION_MATCH_METHODS.Manual);
    } catch (error) {
      throw mapBankReconciliationError(error);
    }
  }

  async confirm(
    actor: IdentityAuthzContext,
    reconciliationId: string,
  ): Promise<ReconciliationResponse> {
    try {
      const recon = await this.repository.findReconciliationById(reconciliationId);
      if (!recon) {
        throw new BankReconciliationError('BANK_RECON_NOT_FOUND');
      }
      await this.requireStatement(actor, recon.bank_statement_id, AUTHZ_ACTIONS.FinanceReconciliationConfirm);
      assertReconciliationConfirmable(recon.status);
      if (recon.status !== RECONCILIATION_STATUSES.Confirmed) {
        const scope = resolveSodScope(recon.unit_id);
        await this.sod.enforce(actor, {
          duty: SOD_DUTIES.ReconciliationConfirm,
          originatorIdentityId: recon.created_by_identity_id,
          ...scope,
        });
      }
      if (recon.status === RECONCILIATION_STATUSES.Confirmed) {
        const matches = await this.repository.listActiveMatches(recon.bank_statement_id);
        return toReconciliationResponse(
          recon,
          matches.find((item) => item.reconciliation_id === recon.id) ?? null,
        );
      }
      const confirmed = await this.repository.withLockedLine(recon.bank_statement_line_id, async (client) => {
        const confirmedCount = await this.repository.countConfirmedMatchesForLine(
          recon.bank_statement_line_id,
        );
        if (confirmedCount > 0) {
          throw new BankReconciliationError('BANK_RECON_LINE_ALREADY_MATCHED');
        }
        return this.repository.confirm(client, recon.id, actor.identityId);
      });
      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.FinanceReconciliationConfirm,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinanceTreasury,
        resourceId: confirmed.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
        metadata: { lineId: confirmed.bank_statement_line_id },
      });
      const matches = await this.repository.listActiveMatches(confirmed.bank_statement_id);
      return toReconciliationResponse(
        confirmed,
        matches.find((item) => item.reconciliation_id === confirmed.id) ?? null,
      );
    } catch (error) {
      throw mapBankReconciliationError(error);
    }
  }

  async unreconcile(
    actor: IdentityAuthzContext,
    reconciliationId: string,
  ): Promise<ReconciliationResponse> {
    try {
      const recon = await this.repository.findReconciliationById(reconciliationId);
      if (!recon) {
        throw new BankReconciliationError('BANK_RECON_NOT_FOUND');
      }
      await this.requireStatement(
        actor,
        recon.bank_statement_id,
        AUTHZ_ACTIONS.FinanceReconciliationUnreconcile,
      );
      assertReconciliationUnreconcilable(recon.status);
      const updated = await this.repository.withLockedLine(recon.bank_statement_line_id, async (client) => {
        return this.repository.unreconcile(client, recon.id, actor.identityId);
      });
      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.FinanceReconciliationUnreconcile,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinanceTreasury,
        resourceId: updated.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
        metadata: { lineId: updated.bank_statement_line_id },
      });
      return toReconciliationResponse(updated, null);
    } catch (error) {
      throw mapBankReconciliationError(error);
    }
  }

  /**
   * Descoberta de extratos bancários. Antes desta capacidade a conciliação só existia mediante um
   * identificador digitado: não havia listagem alguma.
   *
   * Autorização é fronteira do backend: sem concessão ativa de `finance:reconciliation:read` no
   * recurso FinanceTreasury a resposta é negada, e o predicado de escopo por unidade é aplicado na
   * própria consulta — quem não enxerga a unidade não enxerga a linha, nem a contagem dela.
   */
  async listStatements(
    actor: IdentityAuthzContext,
    query: BankStatementListQuery,
  ): Promise<BankStatementListResponse> {
    try {
      const grants = await this.authorizationRepository.findActiveGrants(
        actor.identityId,
        AUTHZ_ACTIONS.FinanceReconciliationRead,
        AUTHZ_RESOURCE_TYPES.FinanceTreasury,
      );
      if (grants.length === 0) {
        throw bankReconAccessDenied();
      }

      const scope = this.scopeEnforcement.buildBankStatementListFilter(grants);
      if (scope.clause === 'FALSE') {
        throw bankReconAccessDenied();
      }

      const status = query.status ? assertBankStatementStatus(query.status) : undefined;
      const filters = {
        scopeClause: scope.clause,
        scopeParams: scope.params,
        financialAccountId: query.financialAccountId,
        status,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      };

      const rows = await this.repository.listStatementsPage({
        ...filters,
        limit: query.limit,
        offset: query.offset,
      });
      const total =
        query.offset === 0 && rows.length < query.limit
          ? rows.length
          : await this.repository.countStatements(filters);

      return {
        items: rows.map(toBankStatementSummaryResponse),
        limit: query.limit,
        offset: query.offset,
        total,
        totalPages: Math.ceil(total / query.limit),
      };
    } catch (error) {
      throw mapBankReconciliationError(error);
    }
  }

  async getStatement(
    actor: IdentityAuthzContext,
    statementId: string,
  ): Promise<BankStatementResponse> {    try {
      const statement = await this.requireStatement(actor, statementId, AUTHZ_ACTIONS.FinanceReconciliationRead);
      const lines = await this.repository.listLines(statement.id);
      return toStatementResponse(statement, lines, false);
    } catch (error) {
      throw mapBankReconciliationError(error);
    }
  }

  async assertIntegrity(statementId: string): Promise<void> {
    const matches = await this.repository.listActiveMatches(statementId);
    const confirmed = matches.filter((match) => match.is_active);
    const lineIds = confirmed.map((match) => match.bank_statement_line_id);
    assertFinancialReconciliationIntegrity({
      confirmedLineIds: lineIds,
      uniqueConfirmedLineIds: [...new Set(lineIds)],
      confirmedAmountsEqual: true,
    });
  }

  private async suggestExact(
    actor: IdentityAuthzContext,
    unitId: string,
    lineId: string,
    movement: ReturnType<typeof toEligible>,
    method: string = RECONCILIATION_MATCH_METHODS.AutoExact,
  ): Promise<ReconciliationResponse> {
    return this.repository.withLockedLine(lineId, async (client, line) => {
      assertConfirmedImmutable(
        line.match_status === BANK_LINE_MATCH_STATUSES.Matched
          ? RECONCILIATION_STATUSES.Confirmed
          : RECONCILIATION_STATUSES.Draft,
        line.match_status === BANK_LINE_MATCH_STATUSES.Matched,
      );
      const existing = await this.repository.findActiveByLine(line.id);
      if (existing?.status === RECONCILIATION_STATUSES.Confirmed) {
        throw new BankReconciliationError('BANK_RECON_LINE_ALREADY_MATCHED');
      }
      if (existing?.status === RECONCILIATION_STATUSES.Draft) {
        const matches = await this.repository.listActiveMatches(existing.bank_statement_id);
        return toReconciliationResponse(
          existing,
          matches.find((item) => item.reconciliation_id === existing.id) ?? null,
        );
      }
      const created = await this.repository.insertDraft(client, {
        unitId,
        bankStatementId: line.bank_statement_id,
        bankStatementLineId: line.id,
        matchMethod: method,
        matchCriteria: AUTO_EXACT_MATCH_CRITERIA,
        targetKind: targetKindFromOrigin(movement.originKind, movement.transferId),
        targetId: targetIdFromMovement(movement),
        financialTransactionId: movement.id,
        amount: movement.amount,
        actorIdentityId: actor.identityId,
      });
      return toReconciliationResponse(created.reconciliation, created.match);
    });
  }

  private async replayFileImport(
    unitId: string,
    financialAccountId: string,
    fileChecksum: string,
    idempotencyKey: string,
  ): Promise<BankImportResponse | null> {
    const existingImport =
      (await this.repository.findImportByChecksum(unitId, financialAccountId, fileChecksum)) ??
      (await this.repository.findImportByIdempotency(unitId, idempotencyKey));
    if (!existingImport?.bank_statement_id) {
      const existingStatement = await this.repository.findStatementByFileChecksum(
        unitId,
        financialAccountId,
        fileChecksum,
      );
      if (!existingStatement) {
        return null;
      }
      const lines = await this.repository.listLines(existingStatement.id);
      return toBankImportResponse({
        row: {
          id: existingStatement.id,
          unit_id: existingStatement.unit_id,
          financial_account_id: existingStatement.financial_account_id,
          bank_statement_id: existingStatement.id,
          format: BANK_IMPORT_FORMATS.CisneStatementV1,
          file_name: existingStatement.source_reference,
          file_checksum: fileChecksum,
          byte_size: 0,
          status: BANK_IMPORT_STATUSES.Imported,
          rejection_code: null,
          line_count: lines.length,
          imported_line_count: lines.length,
          duplicate_line_count: 0,
          idempotency_key: existingStatement.idempotency_key,
        },
        idempotent: true,
        statement: toStatementResponse(existingStatement, lines, true),
        reconciliation: null,
      });
    }
    const statement = await this.repository.findStatementById(existingImport.bank_statement_id);
    if (!statement) {
      return null;
    }
    const lines = await this.repository.listLines(statement.id);
    return toBankImportResponse({
      row: existingImport,
      idempotent: true,
      statement: toStatementResponse(statement, lines, true),
      reconciliation: null,
    });
  }

  private async requireStatement(
    actor: IdentityAuthzContext,
    statementId: string,
    action: (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS],
  ) {
    const id = assertUuid(statementId, 'statementId');
    const statement = await this.repository.findStatementById(id);
    if (!statement) {
      throw new BankReconciliationError('BANK_RECON_NOT_FOUND');
    }
    await this.authz.assertTreasuryAction(actor, action, {
      id: statement.financial_account_id,
      unitId: statement.unit_id,
    });
    return statement;
  }
}

function toEligible(row: EligibleMovementRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    direction: row.direction,
    amount: row.amount,
    occurredOn: row.occurred_on,
    originKind: row.origin_kind,
    originId: row.origin_id,
    transferId: row.transfer_id,
  };
}
