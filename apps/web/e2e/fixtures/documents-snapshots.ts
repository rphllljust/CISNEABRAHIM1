import type { DocumentDetail } from '../../src/documents/types/document.types';

/**
 * Snapshot deterministico da listagem de Documentos para a validacao visual focada.
 *
 * Os dados espelham o que a homologacao realmente mostra — e que motivou esta frente:
 *
 * - DOIS documentos com o MESMO titulo, criados com segundos de diferenca. Nao sao duplicatas: o
 *   runner de UAT cria um documento NOVO por execucao (`Evidência UAT — <cenario>`), com vinculo
 *   proprio. Eles precisam continuar aparecendo os dois E distinguiveis na tela.
 * - O identificador sintetico de unidade (`unit-synthetic-homolog`), que e codigo, nao nome: nao
 *   existe nome humano no contrato, entao ele e exibido como codigo.
 * - Um titulo longo, para exercitar o truncamento da coluna principal.
 */
export const DOCUMENTS_LIST_VISUAL_SNAPSHOT: DocumentDetail[] = [
  {
    id: 'dddddddd-dddd-4ddd-8ddd-000000000004',
    title: 'Evidência UAT — Locação de equipamento',
    categoryCode: 'EVIDENCE',
    classificationCode: 'INTERNAL',
    status: 'ACTIVE',
    unitId: 'unit-synthetic-homolog',
    currentVersionNumber: 1,
    createdAt: '2026-08-01T16:03:52.000Z',
    updatedAt: '2026-08-01T16:03:52.000Z',
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-000000000003',
    title: 'Evidência UAT — Locação de equipamento',
    categoryCode: 'EVIDENCE',
    classificationCode: 'INTERNAL',
    status: 'ACTIVE',
    unitId: 'unit-synthetic-homolog',
    currentVersionNumber: 1,
    createdAt: '2026-08-01T16:03:47.000Z',
    updatedAt: '2026-08-01T16:03:47.000Z',
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-000000000002',
    title:
      'Evidência UAT — Transporte de carga municipal com escolta autorizada e janela de descarga agendada',
    categoryCode: 'EVIDENCE',
    classificationCode: 'RESTRICTED',
    status: 'ACTIVE',
    unitId: 'unit-synthetic-homolog',
    currentVersionNumber: 2,
    createdAt: '2026-08-01T15:40:00.000Z',
    updatedAt: '2026-08-01T15:52:00.000Z',
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-000000000001',
    title: 'Contrato assinado',
    categoryCode: 'BILLING_DOCUMENT',
    classificationCode: 'RESTRICTED',
    status: 'ARCHIVED',
    unitId: 'unit-synthetic-homolog',
    currentVersionNumber: 3,
    createdAt: '2026-07-20T11:00:00.000Z',
    updatedAt: '2026-07-28T09:15:00.000Z',
  },
];
