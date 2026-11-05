import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../auth/storage/token-store';
import {
  DirectoryLookupError,
  TREASURY_ORIGIN_LOOKUP_KINDS,
  searchAccountingPeriodOptions,
  searchCostCenterOptions,
  searchExpenseCategoryOptions,
  searchTreasuryOriginOptions,
} from './finance-directory-lookup';

/**
 * DIRETORIOS DE REFERENCIA DO FINANCEIRO — prova da fronteira.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * O QUE ESTES CASOS PROTEGEM
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Os tres lookups substituem campos onde o operador digitava UUID. Se qualquer um deles
 * inventar opcao, mascarar recusa como lista vazia ou consultar sem escopo, a tela volta a
 * mentir — e o defeito que esta rodada corrige reaparece disfarcado de "nao ha registro".
 *
 * Cada caso abaixo ataca uma forma concreta de o diretorio mentir:
 *
 *   - falha de rede virando lista vazia (o campo diria "nada encontrado" quando a busca caiu);
 *   - periodo consultado SEM unidade (traz periodo de outra unidade para o orcamento);
 *   - registro inativo sumindo e deixando o detalhe apenas com o identificador tecnico;
 *   - rotulo de competencia inventado quando o servidor nao publicou data.
 *
 * Nenhum dado e inventado: toda resposta e um payload que o servidor realmente publica.
 * A sessao e estabelecida pelo `tokenStore` REAL, o mesmo caminho que o login usa.
 */

const COST_CENTER_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const CATEGORY_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const PERIOD_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  // Sessao autenticada pelo caminho real: sem token o lookup recusa com 401, e o teste
  // estaria medindo a ausencia de sessao em vez do comportamento do diretorio.
  tokenStore.setTokens('session-access-token', 'session-refresh-token');
});

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('finance directory lookup', () => {
  it('devolve o centro de custo com codigo de apoio e id do servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          items: [
            { id: COST_CENTER_ID, code: 'CC-ADM', name: 'Administrativo', status: 'ACTIVE' },
          ],
          limit: 20,
          offset: 0,
          total: 1,
          totalPages: 1,
        }),
      ),
    );

    const options = await searchCostCenterOptions('ADM');

    expect(options).toEqual([
      { id: COST_CENTER_ID, label: 'Administrativo', support: 'CC-ADM' },
    ]);
  });

  it('mantem registro INATIVO visivel e rotulado, para o detalhe nao ficar so com o id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          items: [{ id: COST_CENTER_ID, code: 'CC-OLD', name: 'Legado', status: 'INACTIVE' }],
          limit: 20,
          offset: 0,
          total: 1,
          totalPages: 1,
        }),
      ),
    );

    const options = await searchCostCenterOptions('Legado');

    // Esconder o inativo faria o detalhe exibir apenas o identificador tecnico — o defeito
    // que esta rodada elimina.
    expect(options[0]?.label).toBe('Legado (inativo)');
    expect(options[0]?.support).toBe('CC-OLD');
  });

  it('envia o termo como parametro de busca, sem carregar o cadastro inteiro', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ items: [], limit: 20, offset: 0, total: 0, totalPages: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await searchExpenseCategoryOptions('TI');

    const calledUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(calledUrl).toContain('/api/v1/finance/expense-categories');
    expect(calledUrl).toContain('q=TI');
    // Teto explicito: escolha humana, nao exportacao de cadastro.
    expect(calledUrl).toContain('limit=20');
    expect(calledUrl).toContain('offset=0');
    expect(CATEGORY_ID).toMatch(/^[0-9a-f-]+$/);
  });

  it('PROIBE consulta de periodo sem unidade — nao vaza escopo', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const options = await searchAccountingPeriodOptions('2026', null);

    // O ponto do teste: consultar sem `unitId` traria periodo de OUTRA unidade para o
    // orcamento. Devolver vazio mantem a fronteira — e nem chega a chamar o servidor.
    expect(options).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('consulta o periodo COM a unidade informada e rotula pela competencia real', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        items: [
          { id: PERIOD_ID, periodKey: '2026-03', status: 'OPEN' },
          { id: 'period-closed', periodKey: '2026-02', status: 'CLOSED' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const options = await searchAccountingPeriodOptions('2026', 'unit-1');

    const calledUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(calledUrl).toContain('/api/v1/accounting/periods');
    expect(calledUrl).toContain('unitId=unit-1');
    expect(options.map((option) => option.label)).toEqual(['2026-03', '2026-02']);
    expect(options[0]?.support).toBe('OPEN');
  });

  it('propaga falha de rede como ERRO, jamais como lista vazia', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const error = await searchCostCenterOptions('qualquer').catch((thrown: unknown) => thrown);

    // Lista vazia significaria "nada cadastrado". A busca CAIU, e o campo precisa dizer isso.
    expect(error).toBeInstanceOf(DirectoryLookupError);
    expect((error as DirectoryLookupError).code).toBe('NETWORK');
  });

  it('propaga recusa de autorizacao com status real', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { code: 'FINANCE_DENIED' } }, 403)),
    );

    const error = await searchExpenseCategoryOptions('ADM').catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(DirectoryLookupError);
    expect((error as DirectoryLookupError).status).toBe(403);
    expect((error as DirectoryLookupError).code).toBe('FINANCE_DENIED');
  });

  it('recusa a busca quando nao ha sessao, sem inventar opcao', async () => {
    tokenStore.clear();
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await searchCostCenterOptions('ADM').catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(DirectoryLookupError);
    expect((error as DirectoryLookupError).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('periodo sem competencia declarada nao inventa rotulo de data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [{ id: PERIOD_ID, status: 'OPEN' }] })),
    );

    const options = await searchAccountingPeriodOptions('', 'unit-1');

    // Sem `periodKey`/ano/mes o servidor nao publicou competencia. Rotular "2026-01" seria
    // inventar dado; a posicao e o dado real disponivel.
    expect(options[0]?.label).toBe('Período 1');
    expect(options[0]?.id).toBe(PERIOD_ID);
  });

  it('PROIBE busca de origem sem tipo — nao oferece titulo de natureza errada', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const options = await searchTreasuryOriginOptions('PAG', null);

    // Sem `originKind` nao ha listagem a consultar. Oferecer tudo de uma vez permitiria pagar
    // uma conta a receber como se fosse a pagar, invertendo a direcao economica do lancamento.
    expect(options).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('busca a origem na listagem do TIPO escolhido', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: 'payable-1',
            reference: 'PAG-0001',
            counterpartyName: 'Fornecedor Alfa',
            status: 'OPEN',
          },
        ],
        limit: 20,
        offset: 0,
        total: 1,
        totalPages: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const options = await searchTreasuryOriginOptions(
      'PAG',
      TREASURY_ORIGIN_LOOKUP_KINDS.PayablePayment,
    );

    const calledUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(calledUrl).toContain('/api/v1/finance/payables');
    expect(calledUrl).not.toContain('/receivables');
    expect(options[0]).toMatchObject({
      id: 'payable-1',
      label: 'PAG-0001 — Fornecedor Alfa',
    });
    expect(options[0]?.support).toContain('Conta a pagar');
  });

  it('origem a receber consulta a listagem de recebiveis, nao a de pagaveis', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ items: [], limit: 20, offset: 0, total: 0, totalPages: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await searchTreasuryOriginOptions('REC', TREASURY_ORIGIN_LOOKUP_KINDS.ReceivableSettlement);

    const calledUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(calledUrl).toContain('/api/v1/finance/receivables');
    expect(calledUrl).not.toContain('/payables');
  });

  it('origem sem referencia declarada exibe o identificador real, sem rotulo inventado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          items: [{ id: 'payable-sem-referencia', status: 'OPEN', currencyCode: 'BRL' }],
          limit: 20,
          offset: 0,
          total: 1,
          totalPages: 1,
        }),
      ),
    );

    const options = await searchTreasuryOriginOptions(
      '',
      TREASURY_ORIGIN_LOOKUP_KINDS.PayablePayment,
    );

    // Sem referencia o servidor nao publicou numero de titulo. Exibir o id mantem a ausencia
    // VISIVEL em vez de esconder atras de um rotulo fabricado.
    expect(options[0]?.label).toBe('payable-sem-referencia');
  });
});
