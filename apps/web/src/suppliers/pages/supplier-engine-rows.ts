import type { SupplierSummary } from '../types/supplier.types';

/**
 * Linha da lista de fornecedor no formato que a engine consome.
 *
 * A engine trabalha com `Record<string, unknown> & { id }` indexado por NOME DE CAMPO do
 * metadata store. Os nomes abaixo (`legal_name`, `normalized_tax_id`, …) são os mesmos de
 * `meta.fields`, então `DynamicList` resolve cada coluna sem mapa de tradução.
 *
 * Este adaptador existe porque o RESPONSE da API usa camelCase do DTO, enquanto o metadado
 * usa o nome da COLUNA. Um dos dois tem de ceder; cede o adaptador, que é onde a diferença
 * é visível e testável — em vez de espalhar renomeação por dentro da engine.
 */
export type SupplierEngineRow = Record<string, unknown> & { id: string };

export function supplierEngineRows(items: SupplierSummary[]): SupplierEngineRow[] {
  return items.map((item) => ({
    id: item.id,
    legal_name: item.legalName,
    trade_name: item.tradeName,
    normalized_tax_id: item.taxId,
    payment_terms: item.paymentTerms,
    currency_code: item.currencyCode,
    status: item.status,
    version: item.version,
    created_at: item.updatedAt,
  }));
}

/** Linha única — usada pelo detalhe. */
export function supplierEngineRow(item: {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  paymentTerms: string | null;
  currencyCode: string;
  status: string;
  version: number;
}): SupplierEngineRow {
  return {
    id: item.id,
    legal_name: item.legalName,
    trade_name: item.tradeName,
    normalized_tax_id: item.taxId,
    payment_terms: item.paymentTerms,
    currency_code: item.currencyCode,
    status: item.status,
    version: item.version,
  };
}
