import {
  PROPOSAL_PRICING_STRUCTURES,
  type CreateProposalPayload,
  type ProposalItemInput,
  type ProposalPricingStructure,
} from '../types/proposal.types';

/**
 * Linha da composicao da proposta.
 *
 * `rowId` e a chave LOCAL do repetidor: existe para o React reaproveitar os campos da linha
 * certa quando outra linha sai do meio (nunca aparece na tela nem no payload).
 * `lineSaleAmount` e o valor NORMALIZADO do `CurrencyField` (ex.: "1500.50") ou string vazia.
 */
export type ProposalItemFormValues = {
  rowId: string;
  description: string;
  lineSaleAmount: string;
};

export type ProposalFormValues = {
  clientId: string;
  unitId: string;
  title: string;
  pricingStructure: ProposalPricingStructure;
  currencyCode: string;
  globalSalePrice: string;
  validUntil: string;
  notes: string;
  /** Composicao da proposta, na ordem das linhas enviadas ao servidor. */
  items: ProposalItemFormValues[];
};

export type ProposalItemFieldErrors = {
  description?: string;
  lineSaleAmount?: string;
};

export type ProposalFormFieldErrors = Partial<
  Record<
    'clientId' | 'unitId' | 'title' | 'currencyCode' | 'globalSalePrice' | 'validUntil' | 'notes',
    string
  >
> & {
  /** Erro por linha da composicao, na MESMA ordem das linhas. */
  items?: ProposalItemFieldErrors[];
  /** Erro do bloco de composicao quando nao existe linha alguma para apontar. */
  itemsRequired?: string;
};

let rowSequence = 0;

/** Cria uma linha de composicao vazia com chave local estavel. */
export function createProposalItemRow(
  description = '',
  lineSaleAmount = '',
): ProposalItemFormValues {
  rowSequence += 1;
  return { rowId: `proposal-line-${rowSequence}`, description, lineSaleAmount };
}

export const EMPTY_PROPOSAL_FORM: ProposalFormValues = {
  clientId: '',
  unitId: '',
  title: '',
  pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
  currencyCode: 'BRL',
  globalSalePrice: '',
  validUntil: '',
  notes: '',
  items: [],
};

/**
 * Regras da tela: identificacao obrigatoria, preco global quando a estrutura e de preco global
 * e, na estrutura por itens, ao menos uma linha com descricao e valor de venda.
 *
 * O modo (`create`/`edit`) nao altera a regra — a assinatura e mantida porque as duas telas
 * ja a usam com o proprio modo.
 */
export function validateProposalForm(
  values: ProposalFormValues,
  _mode: 'create' | 'edit',
): ProposalFormFieldErrors {
  const errors: ProposalFormFieldErrors = {};

  if (!values.clientId.trim()) {
    errors.clientId = 'Selecione um cliente.';
  }
  if (!values.unitId.trim()) {
    errors.unitId = 'Informe a unidade operacional.';
  }
  if (!values.title.trim()) {
    errors.title = 'Informe o título da proposta.';
  }

  if (values.pricingStructure === PROPOSAL_PRICING_STRUCTURES.GlobalPrice) {
    if (!values.globalSalePrice.trim()) {
      errors.globalSalePrice = 'Informe o preço global de venda.';
    }
  }

  if (values.pricingStructure === PROPOSAL_PRICING_STRUCTURES.Itemized) {
    if (values.items.length === 0) {
      errors.itemsRequired = 'Inclua ao menos um item na composição da proposta.';
    } else {
      const itemErrors = values.items.map<ProposalItemFieldErrors>((item) => {
        const row: ProposalItemFieldErrors = {};
        if (!item.description.trim()) {
          row.description = 'Informe a descrição do item.';
        }
        if (!item.lineSaleAmount.trim()) {
          row.lineSaleAmount = 'Informe o valor de venda do item.';
        }
        return row;
      });
      if (itemErrors.some((row) => Object.keys(row).length > 0)) {
        errors.items = itemErrors;
      }
    }
  }

  return errors;
}

function buildItems(values: ProposalFormValues): ProposalItemInput[] | undefined {
  if (values.pricingStructure !== PROPOSAL_PRICING_STRUCTURES.Itemized) {
    return undefined;
  }
  return values.items.map((item, index) => ({
    lineNumber: index + 1,
    description: item.description.trim(),
    lineSaleAmount: item.lineSaleAmount.trim(),
  }));
}

export function buildCreateProposalPayload(values: ProposalFormValues): CreateProposalPayload {
  return {
    clientId: values.clientId.trim(),
    unitId: values.unitId.trim(),
    title: values.title.trim(),
    pricingStructure: values.pricingStructure,
    currencyCode: values.currencyCode.trim() || 'BRL',
    globalSalePrice:
      values.pricingStructure === PROPOSAL_PRICING_STRUCTURES.GlobalPrice
        ? values.globalSalePrice.trim()
        : undefined,
    validUntil: values.validUntil.trim() || undefined,
    notes: values.notes.trim() || undefined,
    items: buildItems(values),
  };
}

export function buildUpdateProposalPayload(
  values: ProposalFormValues,
  rowVersion: number,
) {
  return {
    rowVersion,
    title: values.title.trim(),
    pricingStructure: values.pricingStructure,
    currencyCode: values.currencyCode.trim() || 'BRL',
    globalSalePrice:
      values.pricingStructure === PROPOSAL_PRICING_STRUCTURES.GlobalPrice
        ? values.globalSalePrice.trim()
        : null,
    validUntil: values.validUntil.trim() || null,
    notes: values.notes.trim() || null,
    items: buildItems(values),
  };
}
