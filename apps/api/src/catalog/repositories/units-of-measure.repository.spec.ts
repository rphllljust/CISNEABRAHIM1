import { describe, expect, it, vi } from 'vitest';
import { UnitsOfMeasureRepository } from './units-of-measure.repository';

/**
 * `validateUnitReferences` — a unidade PADRÃO não é uma unidade EXTRA.
 *
 * DEFEITO QUE ESTE TESTE TRAVA (medido em produção, 2026-10-19):
 *
 * A função montava `const codes = [...new Set(unitCodes)]` e DEPOIS fazia
 * `codes.push(defaultUnitCode)`. Quando a unidade padrão já estava entre as permitidas — que é o
 * caso normal, porque o domínio exige que a padrão seja uma das permitidas — o array virava
 * `['DAY','DAY']`, o banco devolvia UMA linha para `code = ANY(...)`, a comparação
 * `rowCount !== codes.length` falhava e a resposta era `CATALOG_INVALID_UNIT`.
 *
 * Efeito observado: TODA definição de serviço com `defaultUnitCode` era recusada com
 * "One or more unit codes are not registered in the catalog", apontando para a unidade — que
 * estava registrada e ACTIVE. A mesma definição sem `defaultUnitCode` era aceita (201).
 */
function repositoryWith(rows: Array<{ code: string; status: string }>) {
  const query = vi.fn(
    async (_sql: string, _params: unknown[]) => ({ rows, rowCount: rows.length }),
  );
  const pool = { query };
  const databaseService = {
    getConnection: () => ({ pool }),
  };
  const repo = new UnitsOfMeasureRepository(databaseService as never);
  return { repo, query };
}

describe('UnitsOfMeasureRepository.validateUnitReferences', () => {
  it('aceita quando a unidade padrão já está entre as permitidas', async () => {
    // O caso que falhava: 'DAY' permitida E padrão. Banco devolve uma única linha.
    const { repo, query } = repositoryWith([{ code: 'DAY', status: 'ACTIVE' }]);

    const result = await repo.validateUnitReferences(['DAY'], 'DAY', true);

    expect(result).toBe('OK');
    // A consulta precisa receber o conjunto DEDUPLICADO — um 'DAY', não dois.
    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params[0]).toEqual(['DAY']);
  });

  it('inclui a unidade padrão quando ela não está entre as permitidas', async () => {
    const { repo, query } = repositoryWith([
      { code: 'DAY', status: 'ACTIVE' },
      { code: 'MONTH', status: 'ACTIVE' },
    ]);

    const result = await repo.validateUnitReferences(['DAY'], 'MONTH', true);

    expect(result).toBe('OK');
    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params[0]).toEqual(['DAY', 'MONTH']);
  });

  it('recusa quando alguma unidade referenciada não existe no catálogo', async () => {
    const { repo } = repositoryWith([{ code: 'DAY', status: 'ACTIVE' }]);

    const result = await repo.validateUnitReferences(['DAY', 'INEXISTENTE'], null, true);

    expect(result).toBe('INVALID_UNIT');
  });

  it('recusa quando uma unidade referenciada está inativa', async () => {
    const { repo } = repositoryWith([{ code: 'DAY', status: 'INACTIVE' }]);

    const result = await repo.validateUnitReferences(['DAY'], 'DAY', true);

    expect(result).toBe('INACTIVE_UNIT');
  });

  it('recusa lista vazia sem unidade padrão', async () => {
    const { repo } = repositoryWith([]);

    const result = await repo.validateUnitReferences([], null, true);

    expect(result).toBe('INVALID_UNIT');
  });
});
