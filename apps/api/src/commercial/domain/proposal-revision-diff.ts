import { PROPOSAL_PRICING_STRUCTURES } from './proposal';
import { formatMoneyAmountForApi } from './money';

/**
 * Comparacao entre duas revisoes comerciais.
 *
 * O diff e CALCULADO, nunca persistido: compara apenas campos que existem em
 * `com.proposal_versions` e `com.proposal_items`. Nao existe diff semantico inventado nem
 * reaproveitamento do historico de auditoria como se fosse revisao comercial.
 *
 * A identidade de uma linha entre revisoes usa, nesta ordem: o servico referenciado
 * (`service_definition_id` + versao) quando existir, senao o numero da linha. E a unica chave
 * estavel que o modelo oferece — descricao livre nao identifica linha.
 */

export type ProposalRevisionDiffField = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

export type ProposalRevisionDiffLine = {
  change: 'ADDED' | 'REMOVED' | 'CHANGED';
  key: string;
  description: string;
  fields: ProposalRevisionDiffField[];
};

export type ProposalRevisionDiff = {
  fromRevisionNumber: number;
  toRevisionNumber: number;
  fields: ProposalRevisionDiffField[];
  lines: ProposalRevisionDiffLine[];
  totals: {
    linesAdded: number;
    linesRemoved: number;
    linesChanged: number;
  };
};

export type ProposalVersionDiffSource = {
  version_number: number;
  pricing_structure: string;
  currency_code: string;
  global_sale_price_amount: string | null;
  items_sale_total_amount: string | null;
  valid_until: string | null;
  notes: string | null;
  commercial_terms: Record<string, unknown>;
};

export type ProposalItemDiffSource = {
  proposal_version_id: string;
  line_number: number;
  description: string;
  service_definition_id: string | null;
  service_definition_version_id: string | null;
  quantity: string | null;
  unit_code: string | null;
  line_sale_amount: string | null;
};

function itemKey(item: ProposalItemDiffSource): string {
  if (item.service_definition_id) {
    return `service:${item.service_definition_id}:${item.service_definition_version_id ?? ''}`;
  }
  return `line:${item.line_number}`;
}

function normalizeAmount(value: string | null | undefined): string | null {
  return formatMoneyAmountForApi(value ?? null);
}

function amountField(
  field: string,
  label: string,
  before: string | null,
  after: string | null,
): ProposalRevisionDiffField | null {
  if (before === after) {
    return null;
  }
  return { field, label, before, after };
}

function textField(
  field: string,
  label: string,
  before: string | null,
  after: string | null,
): ProposalRevisionDiffField | null {
  if ((before ?? '') === (after ?? '')) {
    return null;
  }
  return { field, label, before, after };
}

function saleTotalOf(version: ProposalVersionDiffSource): string | null {
  const amount =
    version.pricing_structure === PROPOSAL_PRICING_STRUCTURES.GlobalPrice
      ? version.global_sale_price_amount
      : version.items_sale_total_amount;
  return normalizeAmount(amount);
}

function compareItems(
  before: ProposalItemDiffSource[],
  after: ProposalItemDiffSource[],
): ProposalRevisionDiffLine[] {
  const lines: ProposalRevisionDiffLine[] = [];
  const beforeByKey = new Map(before.map((item) => [itemKey(item), item]));
  const afterByKey = new Map(after.map((item) => [itemKey(item), item]));

  for (const [key, item] of afterByKey) {
    const previous = beforeByKey.get(key);
    if (!previous) {
      lines.push({
        change: 'ADDED',
        key,
        description: item.description,
        fields: [
          {
            field: 'lineSaleAmount',
            label: 'Valor da linha',
            before: null,
            after: normalizeAmount(item.line_sale_amount),
          },
        ],
      });
      continue;
    }
    const fields = [
      textField('description', 'Descrição', previous.description, item.description),
      textField('quantity', 'Quantidade', previous.quantity, item.quantity),
      textField('unitCode', 'Unidade', previous.unit_code, item.unit_code),
      amountField(
        'lineSaleAmount',
        'Valor da linha',
        normalizeAmount(previous.line_sale_amount),
        normalizeAmount(item.line_sale_amount),
      ),
    ].filter((field): field is ProposalRevisionDiffField => field !== null);

    if (fields.length > 0) {
      lines.push({ change: 'CHANGED', key, description: item.description, fields });
    }
  }

  for (const [key, item] of beforeByKey) {
    if (afterByKey.has(key)) {
      continue;
    }
    lines.push({
      change: 'REMOVED',
      key,
      description: item.description,
      fields: [
        {
          field: 'lineSaleAmount',
          label: 'Valor da linha',
          before: normalizeAmount(item.line_sale_amount),
          after: null,
        },
      ],
    });
  }

  return lines;
}

export function compareProposalRevisions(input: {
  from: ProposalVersionDiffSource;
  to: ProposalVersionDiffSource;
  fromItems: ProposalItemDiffSource[];
  toItems: ProposalItemDiffSource[];
}): ProposalRevisionDiff {
  const fields = [
    amountField(
      'saleTotal',
      'Valor comercial',
      saleTotalOf(input.from),
      saleTotalOf(input.to),
    ),
    textField('pricingStructure', 'Estrutura de preço', input.from.pricing_structure, input.to.pricing_structure),
    textField('currencyCode', 'Moeda', input.from.currency_code, input.to.currency_code),
    textField('validUntil', 'Validade', input.from.valid_until, input.to.valid_until),
    textField('notes', 'Observações', input.from.notes, input.to.notes),
    textField(
      'commercialTerms',
      'Condições comerciais',
      Object.keys(input.from.commercial_terms ?? {}).length === 0
        ? null
        : JSON.stringify(input.from.commercial_terms),
      Object.keys(input.to.commercial_terms ?? {}).length === 0
        ? null
        : JSON.stringify(input.to.commercial_terms),
    ),
  ].filter((field): field is ProposalRevisionDiffField => field !== null);

  const lines = compareItems(input.fromItems, input.toItems);

  return {
    fromRevisionNumber: input.from.version_number,
    toRevisionNumber: input.to.version_number,
    fields,
    lines,
    totals: {
      linesAdded: lines.filter((line) => line.change === 'ADDED').length,
      linesRemoved: lines.filter((line) => line.change === 'REMOVED').length,
      linesChanged: lines.filter((line) => line.change === 'CHANGED').length,
    },
  };
}
