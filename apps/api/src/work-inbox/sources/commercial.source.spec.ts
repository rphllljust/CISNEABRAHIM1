import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MAX_LIST_LIMIT } from '../../infrastructure/http/contracts';
import { SERVICE_REQUEST_STATUSES } from '../../requests/domain/service-request';
import type { ServiceRequestListItemResponse } from '../../requests/serializers/service-requests-response.serializer';
import { CommercialWorkSource, toRequestWorkItem } from './commercial.source';

/**
 * FONTE COMERCIAL — comportamento vinculante.
 *
 * O que estes testes protegem (sem banco):
 * - so entra na fila o estado que ESPERA pessoa (`SUBMITTED`); registro apenas aberto nao e tarefa;
 * - chave logica `COMERCIAL:REQUEST:<id>` e referencia humana (`requestCode`);
 * - contexto sem uuid (cliente/servico quando autorizados, senao a unidade);
 * - nenhum prazo inventado (`dueAt` sempre `null`) e rota real do detalhe da solicitacao;
 * - leitura em lote paginado, sem consulta por item, e lista vazia sem autorizacao (403).
 */

const ACTOR = { identityId: 'identity-1', sessionId: 'session-1' };
const REQUEST_ID = '11111111-2222-4333-8444-555555555555';

function request(
  overrides: Partial<ServiceRequestListItemResponse> = {},
): ServiceRequestListItemResponse {
  return {
    id: REQUEST_ID,
    requestCode: 'SR-2026-0001',
    unitId: 'UN-A',
    status: SERVICE_REQUEST_STATUSES.Submitted,
    originSource: 'PHONE',
    externalContact: {},
    externalOriginReference: null,
    clientId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
    serviceDefinitionId: null,
    serviceDefinitionVersionId: null,
    description: 'Cliente pediu reparo emergencial.',
    location: {},
    desiredStartAt: '2026-10-01T08:00:00.000Z',
    desiredEndAt: '2026-10-05T18:00:00.000Z',
    priority: 'HIGH',
    operationalNotes: null,
    proposalId: null,
    purchaseOrderId: null,
    submittedAt: '2026-09-20T12:00:00.000Z',
    reviewStartedAt: null,
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    cancelledAt: null,
    cancellationReason: null,
    convertedAt: null,
    convertedServiceOrderId: null,
    rowVersion: 1,
    createdByIdentityId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    createdAt: '2026-09-19T09:00:00.000Z',
    updatedAt: '2026-09-20T12:00:00.000Z',
    clientName: 'Cliente A',
    serviceLabel: 'Reparo elétrico',
    ...overrides,
  };
}

describe('commercial source — apenas o que espera pessoa', () => {
  it('solicitacao enviada e sem analise iniciada entra como trabalho de decisao pendente', () => {
    const item = toRequestWorkItem(request());

    expect(item).toMatchObject({
      id: `COMERCIAL:REQUEST:${REQUEST_ID}`,
      domain: 'COMERCIAL',
      kind: 'APPROVAL',
      businessReference: 'SR-2026-0001',
      status: SERVICE_REQUEST_STATUSES.Submitted,
      occurredAt: '2026-09-20T12:00:00.000Z',
      dueAt: null,
      targetRoute: `/app/requests/${REQUEST_ID}`,
      unitId: 'UN-A',
      contextLabel: 'Cliente A · Reparo elétrico',
    });
    expect(item?.businessReference).not.toContain(REQUEST_ID);
  });

  it.each([
    SERVICE_REQUEST_STATUSES.Draft,
    SERVICE_REQUEST_STATUSES.UnderReview,
    SERVICE_REQUEST_STATUSES.Approved,
    SERVICE_REQUEST_STATUSES.Rejected,
    SERVICE_REQUEST_STATUSES.Cancelled,
    SERVICE_REQUEST_STATUSES.Converted,
  ])('estado %s nao vira tarefa', (status) => {
    expect(toRequestWorkItem(request({ status }))).toBeNull();
  });

  it('sem cliente/servico autorizado o contexto cai para a unidade, nunca para o uuid', () => {
    const item = toRequestWorkItem(request({ clientName: null, serviceLabel: null }));

    expect(item?.contextLabel).toBe('Unidade UN-A');
  });

  it('envio ausente cai para a criacao como fato persistido', () => {
    const item = toRequestWorkItem(request({ submittedAt: null }));

    expect(item?.occurredAt).toBe('2026-09-19T09:00:00.000Z');
  });
});

describe('commercial source — leitura em lote e autorizacao', () => {
  it('pagina no tamanho maximo do contrato do dominio, sem consulta por item', async () => {
    const firstPage = Array.from({ length: MAX_LIST_LIMIT }, (_value, index) =>
      request({ id: `page-1-${index}`, requestCode: `SR-2026-${index}` }),
    );
    const list = vi
      .fn()
      .mockResolvedValueOnce({ items: firstPage, limit: MAX_LIST_LIMIT, offset: 0 })
      .mockResolvedValueOnce({ items: [request({ id: 'last' })], limit: MAX_LIST_LIMIT, offset: 100 });

    const items = await new CommercialWorkSource({ list } as never).collect(ACTOR);

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(1, ACTOR, {
      status: SERVICE_REQUEST_STATUSES.Submitted,
      limit: MAX_LIST_LIMIT,
      offset: 0,
    });
    expect(list).toHaveBeenNthCalledWith(2, ACTOR, {
      status: SERVICE_REQUEST_STATUSES.Submitted,
      limit: MAX_LIST_LIMIT,
      offset: MAX_LIST_LIMIT,
    });
    expect(items).toHaveLength(MAX_LIST_LIMIT + 1);
    expect(new Set(items.map((item) => item.id)).size).toBe(MAX_LIST_LIMIT + 1);
  });

  it('sem autorizacao devolve lista vazia — nunca contagem, nunca item anonimizado', async () => {
    const list = vi.fn().mockRejectedValue(new HttpException('Access denied.', 403));

    await expect(new CommercialWorkSource({ list } as never).collect(ACTOR)).resolves.toEqual([]);
  });

  it('falha real nao vira fila vazia', async () => {
    const list = vi.fn().mockRejectedValue(new Error('connection refused'));

    await expect(new CommercialWorkSource({ list } as never).collect(ACTOR)).rejects.toThrow(
      'connection refused',
    );
  });
});
