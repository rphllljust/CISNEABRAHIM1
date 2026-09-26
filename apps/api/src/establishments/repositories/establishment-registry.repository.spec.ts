import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import type { DatabaseService } from '../../infrastructure/database/database.service';
import { EstablishmentRegistryRepository } from './establishment-registry.repository';
import type {
  CreateLegalEntityPersistenceInput,
  SetStatusPersistenceInput,
} from './establishment-registry.repository.types';

/**
 * Contrato do caminho de erro transacional do repositorio.
 *
 * Defeito comprovado por leitura e reproduzido aqui sem PostgreSQL: o `catch` de cada
 * bloco fazia `await client.query('ROLLBACK')` e `finally { client.release() }`.
 *
 *   1. se o ROLLBACK falhava (conexao caiu, statement timeout, servidor reiniciou), o
 *      erro do ROLLBACK substituia a causa primaria — um 23505 de negocio chegava ao
 *      chamador como erro generico de conexao, quebrando o mapeamento de erro e a
 *      observabilidade;
 *   2. `release()` sem argumento devolvia a conexao ao pool mesmo com o encerramento da
 *      transacao nao confirmado, deixando uma sessao possivelmente `idle in transaction`
 *      segurando locks para o proximo consumidor do pool.
 *
 * O contrato correto e o mesmo do helper ja provado em
 * `packages/database/src/transaction.ts`: causa primaria preservada e conexao com
 * encerramento incerto descartada via `release(err)`.
 */

type ReleaseCall = { error: unknown };

function fakePool(options: { rollbackFails?: boolean; row?: unknown } = {}) {
  const releases: ReleaseCall[] = [];
  const statements: string[] = [];

  const rollbackFailure = Object.assign(new Error('ROLLBACK failed: connection terminated'), {
    code: '08006',
  });
  const primaryFailure = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint: 'legal_entities_legal_name_uidx',
  });

  const client = {
    query: async (sql: string) => {
      statements.push(sql.trim().split('\n')[0]!.trim());
      const head = sql.trim().toUpperCase();
      if (head === 'BEGIN') return { rows: [], rowCount: 0 };
      if (head === 'ROLLBACK') {
        if (options.rollbackFails) throw rollbackFailure;
        return { rows: [], rowCount: 0 };
      }
      if (head === 'COMMIT') return { rows: [], rowCount: 0 };
      if (head.startsWith('SELECT')) {
        return { rows: options.row === undefined ? [] : [options.row], rowCount: 1 };
      }
      throw primaryFailure;
    },
    release: (error?: unknown) => {
      releases.push({ error });
    },
  };

  const pool = {
    connect: async () => client as unknown as PoolClient,
  };

  const databaseService = { getConnection: () => ({ pool }) } as unknown as DatabaseService;
  return {
    repository: new EstablishmentRegistryRepository(databaseService),
    releases,
    statements,
    primaryFailure,
    rollbackFailure,
  };
}

const ACTOR = '00000000-0000-0000-0000-000000000001';

const CREATE_INPUT: CreateLegalEntityPersistenceInput = {
  legalName: 'CISNE Teste',
  tradeName: null,
  actorIdentityId: ACTOR,
};

describe('EstablishmentRegistryRepository transaction error path', () => {
  it('preserves the primary error and reuses the connection when ROLLBACK succeeds', async () => {
    const harness = fakePool();

    await expect(
      harness.repository.createLegalEntity(CREATE_INPUT),
    ).rejects.toBe(harness.primaryFailure);

    expect(harness.statements).toContain('BEGIN');
    expect(harness.statements).toContain('ROLLBACK');
    expect(harness.releases).toHaveLength(1);
    // No error argument: the session is known-good and may return to the pool.
    expect(harness.releases[0]!.error).toBeUndefined();
  });

  it('preserves the primary error when ROLLBACK also fails', async () => {
    const harness = fakePool({ rollbackFails: true });

    const caught = await harness.repository.createLegalEntity(CREATE_INPUT).then(
      () => null,
      (error: unknown) => error as Error & { code?: string; constraint?: string },
    );

    // A causa primaria sobrevive com a propria identidade, para o mapeamento de erro.
    expect(caught).toBe(harness.primaryFailure);
    expect(caught?.code).toBe('23505');
    expect(caught?.constraint).toBe('legal_entities_legal_name_uidx');
    expect((caught as { rollbackFailure?: unknown }).rollbackFailure).toBeUndefined();
  });

  it('evicts the connection from the pool when ROLLBACK fails', async () => {
    const harness = fakePool({ rollbackFails: true });

    await expect(
      harness.repository.createLegalEntity(CREATE_INPUT),
    ).rejects.toBeTruthy();

    expect(harness.releases).toHaveLength(1);
    // release(err) is how pg-pool is told to remove the connection instead of reusing it.
    expect(harness.releases[0]!.error).toBe(harness.rollbackFailure);
  });

  it('issues ROLLBACK exactly once when a status transition is rejected', async () => {
    const harness = fakePool({
      row: { status: 'ACTIVE', version: 1 },
    });

    const rejected: SetStatusPersistenceInput = {
      id: '00000000-0000-0000-0000-000000000002',
      status: 'ACTIVE',
      expectedVersion: 1,
      actorIdentityId: ACTOR,
      reason: null,
    };

    await expect(
      harness.repository.setLegalEntityStatus(rejected),
    ).rejects.toThrowError('LEGAL_ESTABLISHMENT_SAME_STATUS');

    const rollbacks = harness.statements.filter((statement) => statement === 'ROLLBACK');
    expect(rollbacks).toHaveLength(1);
    expect(harness.releases).toHaveLength(1);
    expect(harness.releases[0]!.error).toBeUndefined();
  });

  it('commits and releases cleanly on the success path', async () => {
    const releases: unknown[] = [];
    const statements: string[] = [];
    const row = {
      id: '00000000-0000-0000-0000-000000000003',
      legal_name: 'CISNE Teste',
      trade_name: null,
      status: 'ACTIVE',
      version: 1,
    };
    const client = {
      query: async (sql: string) => {
        statements.push(sql.trim().split('\n')[0]!.trim());
        if (sql.includes('INSERT INTO pty.legal_entities')) return { rows: [row], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      release: (error?: unknown) => releases.push(error),
    };
    const repository = new EstablishmentRegistryRepository({
      getConnection: () => ({ pool: { connect: async () => client } }),
    } as unknown as DatabaseService);

    await repository.createLegalEntity(CREATE_INPUT);

    expect(statements).toContain('BEGIN');
    expect(statements).toContain('COMMIT');
    expect(statements).not.toContain('ROLLBACK');
    expect(releases).toEqual([undefined]);
  });
});
