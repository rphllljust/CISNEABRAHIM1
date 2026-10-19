import type { Pool, PoolClient } from 'pg';
import type { ProposalItemInput } from '../domain/proposal.validation';

type Queryable = Pool | PoolClient | { query: Pool['query'] };

export async function replaceProposalItems(
  client: Queryable,
  proposalVersionId: string,
  items: ProposalItemInput[],
): Promise<void> {
  await client.query(`DELETE FROM com.proposal_items WHERE proposal_version_id = $1`, [proposalVersionId]);

  for (const item of items) {
    await client.query(
      `INSERT INTO com.proposal_items (
         proposal_version_id, line_number, item_kind, description,
         service_definition_id, service_definition_version_id,
         quantity, unit_code, customer_item_reference, customer_unit_code, unit_sale_price_amount, unit_internal_cost_amount,
         line_sale_amount, line_internal_cost_amount
       )
       VALUES ($1, $2, $3::com.proposal_item_kind, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        proposalVersionId,
        item.lineNumber,
        item.itemKind,
        item.description,
        item.serviceDefinitionId ?? null,
        item.serviceDefinitionVersionId ?? null,
        item.quantity ?? null,
        item.unitCode ?? null,
        item.customerItemReference ?? null,
        item.customerUnitCode ?? null,
        item.unitSalePrice ?? null,
        item.unitInternalCost ?? null,
        item.lineSaleAmount ?? null,
        item.lineInternalCost ?? null,
      ],
    );
  }
}

export async function copyProposalItemsFromVersion(
  client: Queryable,
  targetVersionId: string,
  sourceItems: Array<{
    line_number: number;
    item_kind: string;
    description: string;
    service_definition_id: string | null;
    service_definition_version_id: string | null;
    service_snapshot: Record<string, unknown> | null;
    quantity: string | null;
    unit_code: string | null;
    customer_item_reference: string | null;
    customer_unit_code: string | null;
    unit_sale_price_amount: string | null;
    unit_internal_cost_amount: string | null;
    line_sale_amount: string | null;
    line_internal_cost_amount: string | null;
  }>,
): Promise<void> {
  for (const item of sourceItems) {
    await client.query(
      `INSERT INTO com.proposal_items (
         proposal_version_id, line_number, item_kind, description,
         service_definition_id, service_definition_version_id, service_snapshot,
         quantity, unit_code, customer_item_reference, customer_unit_code, unit_sale_price_amount, unit_internal_cost_amount,
         line_sale_amount, line_internal_cost_amount
       )
       VALUES ($1, $2, $3::com.proposal_item_kind, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        targetVersionId,
        item.line_number,
        item.item_kind,
        item.description,
        item.service_definition_id,
        item.service_definition_version_id,
        item.service_snapshot ? JSON.stringify(item.service_snapshot) : null,
        item.quantity,
        item.unit_code,
        item.customer_item_reference,
        item.customer_unit_code,
        item.unit_sale_price_amount,
        item.unit_internal_cost_amount,
        item.line_sale_amount,
        item.line_internal_cost_amount,
      ],
    );
  }
}
