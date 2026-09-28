import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FISCAL_STATUSES } from '../../fiscal/domain/fiscal-document';
import type { FiscalDocumentListItemResponse } from '../../fiscal/serializers/fiscal-response.serializer';
import {
  FISCAL_READ_PAGE_SIZE,
  FiscalWorkSource,
  toFiscalWorkItem,
  toIsoDateTime,
} from './fiscal.source';

/**
 * FONTE FISCAL — comportamento vinculante.
 *
 * O que estes testes protegem (sem banco):
 * - so entra na fila o estado persistido que exige pessoa (`REJECTED`); `FAILED` nao existe no
 *   enum `fis.fiscal_document_status` e nada e inventado a partir dele;
 * - chave logica `FISCAL:DOCUMENT:<id>`, natureza `EXCEPTION` e rota real do detalhe do documento;
 * - referencia humana (a `description` persistida) — nunca o uuid — e `dueAt` sempre `null`, porque
 *   o dominio fiscal nao persiste prazo;
 * - unidade sem autorizacao (403 do dominio dono) nao gera item, nem contagem, nem sinal de
 *   existencia; lista vazia continua vazia (nao ha item sintetico);
 * - leitura em lote paginado no teto do contrato do dominio, sem consulta por item.
 */

const ACTOR = { identityId: 'identity-1', sessionId: 'session-1' };
const DOCUMENT_ID = '11111111-2222-4333-8444-555555555555';

function document(
  overrides: Partial<FiscalDocumentListItemResponse> = {},
): FiscalDocumentListItemResponse {
  return {
    id: DOCUMENT_ID,
    unitId: 'UN-A',
    status: FISCAL_STATUSES.Rejected,
    sourceKind: 'BILLING_DOCUMENT',
    sourceId: null,
    billingDocumentId: null,
    establishmentId: null,
    description: 'NF de serviço — medição 2026-01',
    currencyCode: 'BRL',
    issuedOn: '2026-01-10',
    rowVersion: 3,
    submittedAt: '2026-01-10T12:00:00.000Z',
    authorizedAt: null,
    rejectedAt: '2026-01-10T12:30:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    lastProtocolCode: 'PROT-9911',
    lastAuthorizationOutcome: 'REJECTED',
    createdAt: '2026-01-05T09:00:00.000Z',
    ...overrides,
  };
}

describe('fiscal source — excecao persistida que exige pessoa', () => {
  it('documento REJEITADO entra como EXCEPTION com chave logica, referencia humana e deep link real', () => {
    const item = toFiscalWorkItem(document());

    expect(item).toMatchObject({
      id: `FISCAL:DOCUMENT:${DOCUMENT_ID}`,
      domain: 'FISCAL',
      kind: 'EXCEPTION',
      businessReference: 'NF de serviço — medição 2026-01',
      status: FISCAL_STATUSES.Rejected,
      occurredAt: '2026-01-10T12:30:00.000Z',
      dueAt: null,
      actionLabel: 'Abrir o documento fiscal rejeitado',
      targetRoute: `/app/fiscal/documents/${DOCUMENT_ID}`,
      unitId: 'UN-A',
    });
    expect(item?.businessReference).not.toContain(DOCUMENT_ID);
    expect(item?.reason).toContain('PROT-9911');
    expect(item?.reason).toContain('REJECTED');
    expect(item?.contextLabel).toContain('BILLING_DOCUMENT');
    expect(item?.contextLabel).toContain('2026-01-10');
  });

  it.each([
    FISCAL_STATUSES.Draft,
    FISCAL_STATUSES.Ready,
    FISCAL_STATUSES.Submitted,
    FISCAL_STATUSES.Authorized,
    FISCAL_STATUSES.Cancelled,
  ])('estado %s nao vira tarefa', (status) => {
    expect(toFiscalWorkItem(document({ status }))).toBeNull();
  });

  it('sem descricao utilizavel deriva rotulo humano dos dados reais, nunca do uuid', () => {
    const item = toFiscalWorkItem(document({ description: '   ' }));

    expect(item?.businessReference).toBe('Documento fiscal de 2026-01-10');
    expect(item?.businessReference).not.toContain(DOCUMENT_ID);
  });

  it('rejeicao sem instante legivel cai para a criacao; sem nenhum fato persistido o item e omitido', () => {
    expect(toFiscalWorkItem(document({ rejectedAt: null }))?.occurredAt).toBe(
      '2026-01-05T09:00:00.000Z',
    );
    expect(toFiscalWorkItem(document({ rejectedAt: null, createdAt: 'data inválida' }))).toBeNull();
  });

  it('timestamp persistido devolvido como Date (timestamptz sem normalizacao) vira ISO 8601', () => {
    const item = toFiscalWorkItem(
      document({ rejectedAt: new Date('2026-01-10T12:30:00.000Z') as unknown as string }),
    );

    expect(item?.occurredAt).toBe('2026-01-10T12:30:00.000Z');
    expect(toIsoDateTime('2026-01-10')).toBe('2026-01-10T00:00:00.000Z');
    expect(toIsoDateTime('')).toBeNull();
  });
});

describe('fiscal source — leitura e autorizacao', () => {
  function build(input: {
    units: string[];
    listDocuments: (query: { unitId: string; status: string; page: number }) => Promise<{
      items: FiscalDocumentListItemResponse[];
    }>;
  }) {
    const scopeContext = { listUnitScopeRefs: vi.fn().mockResolvedValue(input.units) };
    const fiscalAccess = {
      listDocuments: vi.fn(
        (_actor: unknown, query: { unitId: string; status: string; page: number }) =>
          input.listDocuments(query),
      ),
    };
    return {
      scopeContext,
      fiscalAccess,
      source: new FiscalWorkSource(fiscalAccess as never, scopeContext as never),
    };
  }

  it('le somente documentos REJEITADOS da unidade, pela autoridade fiscal, em paginas no teto do dominio', async () => {
    const { fiscalAccess, source } = build({
      units: ['UN-A'],
      listDocuments: async () => ({ items: [document()] }),
    });

    const items = await source.collect(ACTOR);

    expect(fiscalAccess.listDocuments).toHaveBeenCalledTimes(1);
    expect(fiscalAccess.listDocuments).toHaveBeenCalledWith(ACTOR, {
      unitId: 'UN-A',
      status: FISCAL_STATUSES.Rejected,
      page: 0,
      pageSize: FISCAL_READ_PAGE_SIZE,
    });
    expect(items.map((item) => item.id)).toEqual([`FISCAL:DOCUMENT:${DOCUMENT_ID}`]);
  });

  it('sem autorizacao na unidade devolve lista VAZIA — nunca contagem, nunca item anonimizado', async () => {
    const { source } = build({
      units: ['UN-A', 'UN-B'],
      listDocuments: async (query) => {
        if (query.unitId === 'UN-B') {
          throw new HttpException('Access denied.', 403);
        }
        return { items: [] };
      },
    });

    await expect(source.collect(ACTOR)).resolves.toEqual([]);
  });

  it('unidade fora do escopo nao gera item nem sinal, e as unidades autorizadas seguem completas', async () => {
    const { source } = build({
      units: ['UN-A', 'UN-B'],
      listDocuments: async (query) => {
        if (query.unitId === 'UN-B') {
          throw new HttpException('Access denied.', 403);
        }
        return { items: [document()] };
      },
    });

    const items = await source.collect(ACTOR);

    expect(items.map((item) => item.id)).toEqual([`FISCAL:DOCUMENT:${DOCUMENT_ID}`]);
    expect(items.every((item) => item.unitId === 'UN-A')).toBe(true);
  });

  it('unidade autorizada sem documento rejeitado nao gera item sintetico, e as demais seguem completas', async () => {
    const { source } = build({
      units: ['UN-A', 'UN-B'],
      listDocuments: async (query) =>
        query.unitId === 'UN-A' ? { items: [document()] } : { items: [] },
    });

    const items = await source.collect(ACTOR);

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(`FISCAL:DOCUMENT:${DOCUMENT_ID}`);
  });

  it('pagina ate a ultima quando a pagina vem cheia, sem consulta por item', async () => {
    const fullPage = Array.from({ length: FISCAL_READ_PAGE_SIZE }, (_value, index) =>
      document({ id: `page-0-${index}` }),
    );
    const { fiscalAccess, source } = build({
      units: ['UN-A'],
      listDocuments: async (query) =>
        query.page === 0 ? { items: fullPage } : { items: [document({ id: 'ultimo' })] },
    });

    const items = await source.collect(ACTOR);

    expect(fiscalAccess.listDocuments).toHaveBeenCalledTimes(2);
    expect(fiscalAccess.listDocuments).toHaveBeenNthCalledWith(2, ACTOR, {
      unitId: 'UN-A',
      status: FISCAL_STATUSES.Rejected,
      page: 1,
      pageSize: FISCAL_READ_PAGE_SIZE,
    });
    expect(items).toHaveLength(FISCAL_READ_PAGE_SIZE + 1);
    expect(new Set(items.map((item) => item.id)).size).toBe(FISCAL_READ_PAGE_SIZE + 1);
  });

  it('falha real do dominio nao vira fila vazia', async () => {
    const { source } = build({
      units: ['UN-A'],
      listDocuments: async () => {
        throw new HttpException('Unexpected fiscal error.', 500);
      },
    });

    await expect(source.collect(ACTOR)).rejects.toThrow('Unexpected fiscal error.');
  });
});
