import { Injectable } from '@nestjs/common';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type {
  ProcurementReceiptEvidencePort,
  ProcurementReceiptLineEvidence,
} from '../../platform/bounded-contexts/enterprise-core-ports';
import { assertUuid } from '../../platform/kernel/uuid';
import { ProcurementRepository } from '../repositories/procurement.repository';
import { ProcurementAccessAuthz } from './procurement-access.authz';

/**
 * Cross-owner, fail-closed receipt evidence. This module OWNS the prc.* reads.
 * The port proves receipt, quantity, unit and receiver, never a SKU or cost.
 */
@Injectable()
export class ProcurementReceiptEvidenceService implements ProcurementReceiptEvidencePort {
  constructor(
    private readonly repository: ProcurementRepository,
    private readonly authz: ProcurementAccessAuthz,
  ) {}

  async readPostedLine(input: {
    receiptLineId: string;
    actorIdentityId: string;
    actorSessionId: string;
  }): Promise<ProcurementReceiptLineEvidence | null> {
    assertUuid(input.receiptLineId, 'receiptLineId');
    const row = await this.repository.findPostedReceiptLineEvidence(input.receiptLineId);
    if (!row) return null;
    const actor = { identityId: input.actorIdentityId, sessionId: input.actorSessionId };
    // A purchaser with read-only access cannot allocate received material.
    await this.authz.assertProcurementAction(actor, AUTHZ_ACTIONS.ProcurementOrderRead, {
      id: row.supplierOrderId,
    });
    await this.authz.assertProcurementAction(actor, AUTHZ_ACTIONS.ProcurementOrderReceive, {
      id: row.supplierOrderId,
    });
    return row;
  }
}
