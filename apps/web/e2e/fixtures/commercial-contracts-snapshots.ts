import { CONTRACT_STATUSES, type Contract } from '../../src/contracts/types';

/**
 * O mesmo recorte determinístico do contrato usado em
 * src/contracts/contracts-fetch-mock.ts (Contrato ativo A/B, rascunho).
 * Serve a geometria da worklist comercial sem tocar em grants ou dados de produção.
 */
const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function contract(
  id: string,
  internalCode: string,
  contractNumber: string,
  title: string,
  unitId: string,
  status: Contract['status'],
  rowVersion: number,
  activatedAt: string | null,
): Contract {
  return {
    id,
    internalCode,
    clientId: CLIENT_ID,
    unitId,
    contractNumber,
    title,
    scopeDescription: null,
    validFrom: '2026-01-01',
    validTo: '2027-12-31',
    currencyCode: 'BRL',
    paymentTerms: null,
    paymentMethod: null,
    commercialTerms: {},
    clientSnapshot: {
      clientId: CLIENT_ID,
      legalName: 'Cliente Demo LTDA',
      tradeName: 'Demo',
      status: 'ACTIVE',
      snapshottedAt: '2026-01-01T12:00:00.000Z',
    },
    status,
    activatedAt,
    closedAt: null,
    closureReason: null,
    rowVersion,
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
  };
}

export const COMMERCIAL_CONTRACTS_VISUAL_SNAPSHOT: Contract[] = [
  contract('aaaaaaaa-aaaa-4aaa-8aaa-00000000000a', 'CTR-2026-A00001', 'CTR-ACT-001',
    'Contrato ativo A', 'UNIT-A', CONTRACT_STATUSES.Active, 2, '2026-02-01T12:00:00.000Z'),
  contract('bbbbbbbb-bbbb-4bbb-8bbb-00000000000b', 'CTR-2026-A00002', 'CTR-ACT-002',
    'Contrato ativo B', 'UNIT-B', CONTRACT_STATUSES.Active, 3, '2026-02-02T12:00:00.000Z'),
  contract('cccccccc-cccc-4ccc-8ccc-00000000000c', 'CTR-2026-A00003', 'CTR-DRAFT-001',
    'Rascunho de contrato', 'UNIT-A', CONTRACT_STATUSES.Draft, 1, null),
];
