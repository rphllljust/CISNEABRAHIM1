function metaField(
  name: string,
  label: string,
  type: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    label,
    type,
    required: false,
    readOnly: false,
    inList: false,
    inForm: true,
    inFilter: false,
    listOrder: 0,
    fieldOrder: 0,
    permLevel: 0,
    options: null,
    ...extra,
  };
}

/**
 * Cópia do FORMATO de `/api/v1/meta/suppliers` — não uma segunda fonte de verdade de negócio.
 * As colunas vivem na view `list`, exatamente como no store real.
 */
export const SUPPLIERS_META = {
  name: 'suppliers',
  label: 'Fornecedores',
  description: null,
  dataSchema: 'pty',
  dataTable: 'suppliers',
  labelField: 'legal_name',
  fields: [
    metaField('legal_name', 'Razão social', 'text', { inList: true, listOrder: 10 }),
    metaField('trade_name', 'Nome fantasia', 'text', { inList: true, listOrder: 20 }),
    metaField('normalized_tax_id', 'CNPJ', 'text', { inList: true, listOrder: 30 }),
    metaField('payment_terms', 'Condição de pagamento', 'text', { inList: true, listOrder: 40 }),
    metaField('currency_code', 'Moeda', 'text', { inList: false, listOrder: 50 }),
    metaField('status', 'Estado', 'select', {
      inList: true,
      listOrder: 60,
      inFilter: true,
      options: {
        options: [
          { value: 'ACTIVE', label: 'Ativo' },
          { value: 'INACTIVE', label: 'Inativo' },
          { value: 'ARCHIVED', label: 'Arquivado' },
        ],
      },
    }),
    metaField('created_at', 'Atualizado em', 'datetime', {
      readOnly: true,
      inList: true,
      listOrder: 70,
    }),
  ],
  views: [
    {
      viewType: 'list',
      label: 'Lista de fornecedores',
      layout: {
        columns: [
          'legal_name',
          'trade_name',
          'normalized_tax_id',
          'payment_terms',
          'status',
          'created_at',
        ],
      },
      isDefault: true,
    },
  ],
  workflow: null,
  permissions: [{ action: 'read', permLevel: 0, requiredPermission: null, allowed: true }],
  allowedPermLevels: [0],
};
