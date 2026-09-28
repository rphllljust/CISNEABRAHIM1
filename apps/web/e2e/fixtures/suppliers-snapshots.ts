import type { SupplierListResponse } from '../../src/suppliers/types/supplier.types';

/**
 * Snapshot da listagem de Fornecedores para a validação visual focada.
 *
 * Cinco fornecedores sintéticos exercitam a tabela de fato: nome fantasia presente e ausente,
 * CNPJ, condição de pagamento presente e ausente, status ativo e inativo, e uma faixa de paginação
 * com total real. Nenhum dado empresarial real.
 */
const VISUAL_SUPPLIERS = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    legalName: 'Alfa Insumos LTDA',
    tradeName: 'Alfa Insumos',
    taxId: '11222333000181',
    paymentTerms: '30 DDL',
    currencyCode: 'BRL',
    status: 'ACTIVE',
    version: 2,
    updatedAt: '2026-09-25T16:00:00.000Z',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    legalName: 'Beta Pecas LTDA',
    tradeName: 'Beta Pecas',
    taxId: '33444555000103',
    paymentTerms: '28 DDL',
    currencyCode: 'BRL',
    status: 'ACTIVE',
    version: 1,
    updatedAt: '2026-09-24T16:00:00.000Z',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    legalName: 'Gama Servicos Industriais S/A',
    tradeName: null,
    taxId: '55666777000122',
    paymentTerms: null,
    currencyCode: 'BRL',
    status: 'ACTIVE',
    version: 1,
    updatedAt: '2026-09-23T16:00:00.000Z',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
    legalName: 'Delta Lubrificantes EIRELI',
    tradeName: 'Delta Lub',
    taxId: '77888999000144',
    paymentTerms: 'A vista',
    currencyCode: 'BRL',
    status: 'INACTIVE',
    version: 3,
    updatedAt: '2026-09-22T16:00:00.000Z',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5',
    legalName: 'Epsilon Ferramentas ME',
    tradeName: 'Epsilon',
    taxId: '99000111000166',
    paymentTerms: '45 DDL',
    currencyCode: 'BRL',
    status: 'ACTIVE',
    version: 1,
    updatedAt: '2026-09-21T16:00:00.000Z',
  },
];

export const SUPPLIERS_LIST_VISUAL_SNAPSHOT: SupplierListResponse = {
  items: VISUAL_SUPPLIERS,
  limit: 20,
  offset: 0,
  total: VISUAL_SUPPLIERS.length,
  totalPages: 1,
};
