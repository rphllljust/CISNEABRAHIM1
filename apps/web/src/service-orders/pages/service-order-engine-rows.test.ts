import { describe, expect, it } from 'vitest';
import type { ServiceOrderSummary } from '../api/service-orders-api';
import { serviceOrderEngineRows } from './service-order-engine-rows';

/**
 * WORKLIST DE OS — "Origem" e "Criada em" mostravam "—".
 *
 * DEFEITO REPRODUZIDO (antes desta correção):
 *
 * O adaptador da listagem preenchia `origin: null` e `created_at: null` com a justificativa de que
 * `ServiceOrderSummary` não traria esses campos. A justificativa era FALSA: o endpoint de listagem
 * responde `ServiceOrderListResponse = ServiceOrderResponse & { deadlineAt }`, e
 * `ServiceOrderResponse` traz `origin` e `createdAt`. O payload real de produção devolve
 * `origin: "PROPOSAL"` e `createdAt: "2026-10-19T16:01:34.417Z"`.
 *
 * Ou seja: o dado sempre veio; o cliente o descartava. As duas colunas ficavam vazias por omissão
 * do adaptador, não por ausência no backend.
 *
 * O QUE ESTE TESTE TRAVA:
 *
 * 1. `origin` sai do campo PERSISTIDO recebido, nunca de rótulo deduzido de outro campo.
 * 2. `created_at` recebe o `createdAt` real — não `updatedAt` (que faria a coluna "Criada em"
 *    exibir a última alteração e mentir sobre a idade do registro).
 * 3. Nome do cliente sai do SNAPSHOT, sem quebra de linha embutida.
 */
const summary = (overrides: Partial<ServiceOrderSummary> = {}): ServiceOrderSummary => ({
  id: '163016a3-fef5-4cca-9a76-6170500eddfd',
  orderNumber: 'OS-2026-E870CB41',
  unitId: 'CISNE-RO-PVH',
  status: 'COMPLETED',
  origin: 'PROPOSAL',
  clientId: 'c67b4b13-1b90-4dbf-9039-c36124cc4031',
  clientSnapshot: {
    status: 'ACTIVE',
    clientId: 'c67b4b13-1b90-4dbf-9039-c36124cc4031',
    legalName: 'AMAGGI EXPORTACAO E IMPORTACAO LTDA',
    tradeName: 'AMAGGI',
    snapshottedAt: '2026-10-19T16:01:45.916Z',
    normalizedTaxId: '77294254006125',
  },
  description: 'Locação de caminhão-pipa',
  rowVersion: 4,
  createdAt: '2026-10-19T16:01:34.417Z',
  updatedAt: '2026-10-19T18:22:09.118Z',
  assignedWorkforceMember: null,
  deadlineAt: '2026-10-26T16:01:34.417Z',
  ...overrides,
});

describe('serviceOrderEngineRows — Origem e Criada em na worklist', () => {
  it('leva a origem PERSISTIDA da linha para a coluna, em vez de anular', () => {
    const [row] = serviceOrderEngineRows([summary()]);

    expect(row!['origin']).toBe('PROPOSAL');
    expect(row!['origin']).not.toBeNull();
  });

  it('leva o createdAt REAL para "Criada em" e não o updatedAt', () => {
    const [row] = serviceOrderEngineRows([summary()]);

    expect(row!['created_at']).toBe('2026-10-19T16:01:34.417Z');
    // A distinção importa: rotular updatedAt como criação mentiria sobre a idade do registro.
    expect(row!['created_at']).not.toBe(row!['updated_at']);
  });

  it('nomeia o cliente pelo snapshot, sem quebra de linha', () => {
    const [row] = serviceOrderEngineRows([summary()]);

    expect(row!['client_snapshot']).toBe('AMAGGI EXPORTACAO E IMPORTACAO LTDA');
    expect(String(row!['client_snapshot'])).not.toContain('\n');
  });

  it('prefere legalName a tradeName — o documento nomeia a razão social', () => {
    const [row] = serviceOrderEngineRows([
      summary({ clientSnapshot: { legalName: 'RAZAO SOCIAL LTDA', tradeName: 'FANTASIA' } }),
    ]);

    expect(row!['client_snapshot']).toBe('RAZAO SOCIAL LTDA');
  });

  it('ausência real continua vazia — não inventa rótulo', () => {
    const [row] = serviceOrderEngineRows([
      summary({ origin: '', clientSnapshot: null, createdAt: '' }),
    ]);

    expect(row!['origin']).toBe('');
    expect(row!['client_snapshot']).toBeNull();
    expect(row!['created_at']).toBe('');
  });
});
