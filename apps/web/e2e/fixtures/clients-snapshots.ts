import { CLIENT_STATUSES, type ClientListResponse } from '../../src/clients/types/client.types';

/**
 * Snapshot da listagem de Clientes para a validação visual focada.
 *
 * Independente de `COMMERCIAL_CLIENTS_SNAPSHOT`, que alimenta baselines já commitados de propostas
 * e pedidos de compra. Cinco Clientes com dados variados exercitam de fato a tabela: nome fantasia
 * presente e ausente, documento formatado, status ativo e inativo, e uma faixa de paginação real.
 *
 * A ESTRUTURA EMPRESARIAL VARIA DE PROPÓSITO: um Cliente com grupo e filiais, um sem vínculo
 * nenhum. A coluna de estrutura da worklist só é exercitada de verdade quando o snapshot contém
 * os dois casos — com todos preenchidos (ou todos vazios) o baseline não provaria nada.
 *
 * Dados 100% sintéticos — nenhum dado empresarial real, conforme a regra de governança.
 */
/** Cliente sem vínculo declarado: `null` é NÃO DECLARADO, e não "sem grupo". */
const NO_STRUCTURE = {
  groupId: null,
  groupName: null,
  parentClientId: null,
  parentClientName: null,
  childCount: 0,
} as const;

const VISUAL_CLIENTS = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    legalName: 'Alfa Madeira LTDA',
    tradeName: 'Alfa Madeira',
    taxId: '11222333000518',
    status: CLIENT_STATUSES.Active,
    version: 1,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-25T16:00:00.000Z',
    groupId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    groupName: 'Grupo Alfa',
    parentClientId: null,
    parentClientName: null,
    childCount: 2,
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    legalName: 'Beta Logistica LTDA',
    tradeName: 'Beta Log',
    taxId: '11222333000262',
    status: CLIENT_STATUSES.Active,
    version: 1,
    createdAt: '2026-08-02T12:00:00.000Z',
    updatedAt: '2026-08-24T16:00:00.000Z',
    groupId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    groupName: 'Grupo Alfa',
    parentClientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    parentClientName: 'Alfa Madeira LTDA',
    childCount: 0,
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    legalName: 'Gama Mineracao S/A',
    tradeName: null,
    taxId: '11222333000343',
    status: CLIENT_STATUSES.Active,
    version: 1,
    createdAt: '2026-08-03T12:00:00.000Z',
    updatedAt: '2026-08-23T16:00:00.000Z',
    ...NO_STRUCTURE,
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
    legalName: 'Delta Agropecuaria EIRELI',
    tradeName: 'Delta Agro',
    taxId: '11222333000424',
    status: CLIENT_STATUSES.Inactive,
    version: 1,
    createdAt: '2026-08-04T12:00:00.000Z',
    updatedAt: '2026-08-22T16:00:00.000Z',
    ...NO_STRUCTURE,
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
    legalName: 'Epsilon Transportes ME',
    tradeName: 'Epsilon',
    taxId: '11222333000607',
    status: CLIENT_STATUSES.Active,
    version: 1,
    createdAt: '2026-08-05T12:00:00.000Z',
    updatedAt: '2026-08-21T16:00:00.000Z',
    ...NO_STRUCTURE,
  },
];

export const CLIENTS_LIST_VISUAL_SNAPSHOT: ClientListResponse = {
  items: VISUAL_CLIENTS,
  limit: 20,
  offset: 0,
  total: VISUAL_CLIENTS.length,
  totalPages: 1,
};
