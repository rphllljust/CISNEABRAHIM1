import { formatMoneyAmountForApi } from './money';
import type { ProposalItemKind } from './proposal';
import type { ProposalItemRow } from '../repositories/proposals.repository.types';

export type ProposalItemCommercialSnapshot = {
  itemKind: ProposalItemKind;
  description: string;
  unitCode: string | null;
  customerItemReference: string | null;
  customerUnitCode: string | null;
  quantity: string | null;
  unitSalePrice: string | null;
  unitInternalCost: string | null;
  lineSaleAmount: string | null;
  lineInternalCost: string | null;
  snapshottedAt: string;
};

export function buildCommercialItemSnapshot(
  item: Pick<
    ProposalItemRow,
    | 'item_kind'
    | 'description'
    | 'unit_code'
    | 'customer_item_reference'
    | 'customer_unit_code'
    | 'quantity'
    | 'unit_sale_price_amount'
    | 'unit_internal_cost_amount'
    | 'line_sale_amount'
    | 'line_internal_cost_amount'
  >,
  snapshottedAt: string,
): ProposalItemCommercialSnapshot {
  return {
    itemKind: item.item_kind as ProposalItemKind,
    description: item.description,
    unitCode: item.unit_code,
    customerItemReference: item.customer_item_reference,
    customerUnitCode: item.customer_unit_code,
    quantity: formatMoneyAmountForApi(item.quantity),
    unitSalePrice: formatMoneyAmountForApi(item.unit_sale_price_amount),
    unitInternalCost: formatMoneyAmountForApi(item.unit_internal_cost_amount),
    lineSaleAmount: formatMoneyAmountForApi(item.line_sale_amount),
    lineInternalCost: formatMoneyAmountForApi(item.line_internal_cost_amount),
    snapshottedAt,
  };
}

export function resolveCommercialItemFields(
  row: ProposalItemRow,
): Pick<
  ProposalItemCommercialSnapshot,
  | 'itemKind'
  | 'description'
  | 'unitCode'
  | 'customerItemReference'
  | 'customerUnitCode'
  | 'quantity'
  | 'unitSalePrice'
  | 'unitInternalCost'
  | 'lineSaleAmount'
  | 'lineInternalCost'
> {
  const snapshot = row.commercial_snapshot as ProposalItemCommercialSnapshot | null;
  if (snapshot) {
    return {
      itemKind: snapshot.itemKind,
      description: snapshot.description,
      unitCode: snapshot.unitCode,
      customerItemReference: snapshot.customerItemReference ?? null,
      customerUnitCode: snapshot.customerUnitCode ?? null,
      quantity: snapshot.quantity,
      unitSalePrice: snapshot.unitSalePrice,
      unitInternalCost: snapshot.unitInternalCost,
      lineSaleAmount: snapshot.lineSaleAmount,
      lineInternalCost: snapshot.lineInternalCost,
    };
  }

  return {
    itemKind: row.item_kind as ProposalItemKind,
    description: row.description,
    unitCode: row.unit_code,
    customerItemReference: row.customer_item_reference,
    customerUnitCode: row.customer_unit_code,
    quantity: formatMoneyAmountForApi(row.quantity),
    unitSalePrice: formatMoneyAmountForApi(row.unit_sale_price_amount),
    unitInternalCost: formatMoneyAmountForApi(row.unit_internal_cost_amount),
    lineSaleAmount: formatMoneyAmountForApi(row.line_sale_amount),
    lineInternalCost: formatMoneyAmountForApi(row.line_internal_cost_amount),
  };
}
