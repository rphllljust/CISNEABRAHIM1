import { Inject, Injectable, Optional } from '@nestjs/common';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  ENTERPRISE_CORE_PORT,
  type AccountingLedgerPort,
} from '../../platform/bounded-contexts/enterprise-core-ports';
import { isPositiveMoneyAmount, normalizeMoneyAmount } from '../../platform/kernel/money-math';
import {
  INVENTORY_ACCOUNTING_CURRENCY,
  INVENTORY_ACCOUNTING_EVENTS,
  INVENTORY_ACCOUNTING_ORIGIN,
} from '../domain/inventory-accounting';
import { InventoryError } from '../domain/inventory';
import { InventoryRepository } from '../repositories/inventory.repository';
import { InventoryAccessAuthz } from './inventory-access.authz';

@Injectable()
export class InventoryAccountingIntegrationService {
  constructor(
    private readonly repository: InventoryRepository,
    private readonly authz: InventoryAccessAuthz,
    @Optional()
    @Inject(ENTERPRISE_CORE_PORT.AccountingLedger)
    private readonly accounting?: AccountingLedgerPort,
  ) {}

  isAvailable(): boolean {
    return Boolean(this.accounting);
  }

  async postPostedMovement(
    actor: IdentityAuthzContext,
    movementId: string,
  ): Promise<{ journalEntryId: string; postingRequestId: string; idempotent: boolean } | null> {
    const movement = await this.requireMovement(movementId);
    await this.authz.assertInventoryAction(actor, AUTHZ_ACTIONS.InventoryMove, {
      id: movement.inventory_item_id,
      unitId: movement.unit_id,
    });
    if (!movement.total_cost || !isPositiveMoneyAmount(movement.total_cost)) {
      return null;
    }
    const accounting = this.requireAccounting();
    return accounting.postConfirmedEvent({
      originKind: INVENTORY_ACCOUNTING_ORIGIN,
      eventKind: INVENTORY_ACCOUNTING_EVENTS.MovementPosted,
      sourceId: movement.id,
      unitId: movement.unit_id,
      amount: normalizeMoneyAmount(movement.total_cost),
      currencyCode: INVENTORY_ACCOUNTING_CURRENCY,
      occurredOn: movement.occurred_on.slice(0, 10),
      sourceReference: movement.idempotency_key,
      actorIdentityId: actor.identityId,
      context: {
        origin: movement.origin_kind,
        costingRuleVersionId: movement.costing_rule_version_id,
        quantity: movement.quantity,
      },
    });
  }

  /**
   * F1.1 — REMOVIDOS: `tryPostPostedMovement` / `tryPostPostedMovements`.
   *
   * Eram `catch { return; }` sobre posting contábil obrigatório de movimentação com
   * custo: o estoque era movimentado e o journal podia não existir, em silêncio.
   *
   * O chamador passa a usar `postPostedMovement`, que PROPAGA a falha. Nenhum
   * substituto best-effort foi reintroduzido.
   */

  private requireAccounting(): AccountingLedgerPort {
    if (!this.accounting) {
      throw new InventoryError('INVENTORY_NOT_FOUND');
    }
    return this.accounting;
  }

  private async requireMovement(movementId: string) {
    const row = await this.repository.findMovementById(movementId);
    if (!row) {
      throw new InventoryError('INVENTORY_NOT_FOUND');
    }
    return row;
  }
}
