import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateFinanceTables,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { COST_CENTER_STATUSES, isCostCenterStatus } from './domain/payable';
import { FINANCE_ERROR_CODES } from './errors/finance-error-codes';
import { FinanceHttpException } from './errors/finance-http.exception';
import { FinanceModule } from './finance.module';
import { CostCentersAccessService } from './services/cost-centers-access.service';

/**
 * CENTRO DE CUSTO — prova de que a referencia deixou de ser um UUID solto.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE SPEC IMPEDE DE VOLTAR
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * `fin.payables.cost_center_id` e `fin.expenses.cost_center_id` sao `uuid NOT NULL` sem
 * `REFERENCES`. Antes da migration 0118 nao existia tabela: o valor vinha de literal, e todas as
 * suites faziam `costCenterId: crypto.randomUUID()`.
 *
 * Este spec NAO usa `crypto.randomUUID()` para centro de custo. Ele cria o centro pelo caminho
 * real do produto e prova que:
 *
 *   - o identificador devolvido pela listagem e o MESMO que o titulo persiste;
 *   - `assertExists` RECUSA uuid arbitrario (a lacuna nao pode virar "gravou lixo");
 *   - sem concessao a listagem e negada, nunca uma lista vazia disfarcada;
 *   - status invalido e recusado em vez de virar filtro ignorado;
 *   - paginacao e busca nao divergem do total.
 */

async function grantCostCenterActions(
  pool: Pool,
  identityId: string,
  grantedBy: string,
): Promise<void> {
  for (const action of [AUTHZ_ACTIONS.FinanceCostCenterCreate, AUTHZ_ACTIONS.FinanceCostCenterList]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

describe('Finance cost center reference (PostgreSQL)', () => {
  let pool: Pool;
  let costCenters: CostCentersAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for finance integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FinanceModule],
    }).compile();
    costCenters = module.get(CostCentersAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateFinanceTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true): Promise<{ identityId: string; sessionId: string }> {
    const login = normalizeLoginIdentifier(`cost-center-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantCostCenterActions(pool, identityId, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  const listQuery = (overrides: Record<string, unknown> = {}) => ({
    limit: 20,
    offset: 0,
    ...overrides,
  });

  it('cria e devolve o centro de custo — a referencia humana passa a existir', async () => {
    const actor = await seedActor();

    const created = await costCenters.create(actor, {
      code: 'CC-ADM',
      name: 'Administrativo',
    });

    expect(created.code).toBe('CC-ADM');
    expect(created.name).toBe('Administrativo');
    expect(created.status).toBe(COST_CENTER_STATUSES.Active);

    const page = await costCenters.list(actor, listQuery());
    expect(page.total).toBe(1);
    expect(page.items[0]?.id).toBe(created.id);
  });

  it('RECUSA uuid arbitrario — a lacuna nao vira "gravou lixo"', async () => {
    // `assertExists` e a guarda de REFERENCIA usada pelo dominio Financeiro antes de gravar um
    // titulo. Ela nao recebe ator de proposito: nao e endpoint e nao expoe "existe ou nao" na
    // borda HTTP, onde qualquer ator teria um oraculo de existencia.
    // O uuid abaixo e exatamente o que as suites antigas usavam: aleatorio, sem registro.
    const invented = '00000000-0000-4000-8000-000000000000';

    const error = await costCenters.assertExists(invented).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(FinanceHttpException);
    expect((error as FinanceHttpException).code).toBe(FINANCE_ERROR_CODES.COST_CENTER_NOT_FOUND);
  });

  it('ACEITA o identificador que a propria listagem devolveu', async () => {
    const actor = await seedActor();
    const created = await costCenters.create(actor, { code: 'CC-OPE', name: 'Operações' });

    const page = await costCenters.list(actor, listQuery({ q: 'CC-OPE' }));
    const listed = page.items[0];
    expect(listed).toBeDefined();

    // O caminho completo do produto: listar, escolher, validar, persistir.
    await expect(costCenters.assertExists(listed!.id)).resolves.toBeUndefined();
    expect(listed!.id).toBe(created.id);
  });

  it('nega a listagem SEM concessao em vez de devolver lista vazia', async () => {
    const privileged = await seedActor();
    await costCenters.create(privileged, { code: 'CC-SEC', name: 'Confidencial' });

    const outsider = await seedActor(false);

    await expect(costCenters.list(outsider, listQuery())).rejects.toMatchObject({
      code: FINANCE_ERROR_CODES.DENIED,
    });
  });

  it('recusa status fora do conjunto fechado', async () => {
    const actor = await seedActor();
    await costCenters.create(actor, { code: 'CC-A', name: 'Ativo um' });

    const error = await costCenters
      .list(actor, listQuery({ status: 'ARQUIVADO' }))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(FinanceHttpException);
    expect((error as FinanceHttpException).code).toBe(
      FINANCE_ERROR_CODES.COST_CENTER_STATUS_INVALID,
    );
  });

  it('busca casa por codigo E por nome, com total coerente', async () => {
    const actor = await seedActor();
    await costCenters.create(actor, { code: 'CC-FROTA', name: 'Frota e transporte' });
    await costCenters.create(actor, { code: 'CC-TI', name: 'Tecnologia' });

    const byCode = await costCenters.list(actor, listQuery({ q: 'FROTA' }));
    expect(byCode.total).toBe(1);
    expect(byCode.items[0]?.code).toBe('CC-FROTA');

    const byName = await costCenters.list(actor, listQuery({ q: 'Tecnologia' }));
    expect(byName.total).toBe(1);
    expect(byName.items[0]?.code).toBe('CC-TI');
  });

  it('pagina com total estavel, sem repetir nem pular registro', async () => {
    const actor = await seedActor();
    const codes = ['CC-01', 'CC-02', 'CC-03', 'CC-04', 'CC-05'];
    for (const code of codes) {
      await costCenters.create(actor, { code, name: `Centro ${code}` });
    }

    const pages = await Promise.all([
      costCenters.list(actor, listQuery({ limit: 2, offset: 0 })),
      costCenters.list(actor, listQuery({ limit: 2, offset: 2 })),
      costCenters.list(actor, listQuery({ limit: 2, offset: 4 })),
    ]);

    for (const page of pages) {
      expect(page.total).toBe(5);
      expect(page.totalPages).toBe(3);
    }

    const collected = pages.flatMap((page) => page.items.map((item) => item.code));
    expect(collected).toEqual(codes);
    expect(new Set(collected).size).toBe(codes.length);
  });

  it('lista vazia real significa zero centros cadastrados', async () => {
    const actor = await seedActor();

    const page = await costCenters.list(actor, listQuery());

    expect(page.total).toBe(0);
    expect(page.items).toEqual([]);
    expect(page.totalPages).toBe(0);
  });

  it('o conjunto de status do dominio e fechado', () => {
    expect(isCostCenterStatus(COST_CENTER_STATUSES.Active)).toBe(true);
    expect(isCostCenterStatus(COST_CENTER_STATUSES.Inactive)).toBe(true);
    expect(isCostCenterStatus('active')).toBe(false);
    expect(isCostCenterStatus('DELETED')).toBe(false);
    expect(isCostCenterStatus('')).toBe(false);
  });

  it('a tabela de referencia existe no banco real com as colunas do contrato', async () => {
    // Prova de que a migration 0118 aplicou de fato — nao apenas que o TypeScript compila.
    const columns = await pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'fin' AND table_name = 'cost_centers'
        ORDER BY ordinal_position`,
    );

    const names = columns.rows.map((row) => row.column_name);
    expect(names).toEqual([
      'id',
      'code',
      'name',
      'status',
      'created_at',
      'updated_at',
      'created_by_identity_id',
      'updated_by_identity_id',
    ]);
    // Nenhuma coluna obrigatoria pode ser nullable: um centro de custo sem codigo nao e
    // referencia de nada.
    const nullableRequired = columns.rows.filter(
      (row) => row.is_nullable === 'YES' && row.column_name !== 'status',
    );
    expect(nullableRequired).toEqual([]);
  });
});
