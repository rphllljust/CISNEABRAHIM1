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
import { EXPENSE_CATEGORY_STATUSES, isExpenseCategoryStatus } from './domain/payable';
import { FINANCE_ERROR_CODES } from './errors/finance-error-codes';
import { FinanceHttpException } from './errors/finance-http.exception';
import { FinanceModule } from './finance.module';
import { PayablesAccessService } from './services/payables-access.service';

/**
 * LISTAGEM DE CATEGORIAS DE DESPESA — prova de referencia humana.
 *
 * O QUE ESTE SPEC PROVA (e por que ele existe)
 *
 * `POST finance/expense-categories` existia e `GET` NAO existia. Todo consumidor que precisa
 * ESCOLHER uma categoria — despesa, conferencia de nota, validacao de fornecedor — era forcado
 * a digitar o UUID. A `CISNE_FINISH_MATRIX` registrava isso como `PARK: HUMAN_LOOKUP_API_GAP`.
 *
 * Cada caso abaixo ataca uma forma concreta de a listagem mentir:
 *
 *   - lista vazia mascarando negacao de acesso (o gate precisa ser 403, nao `total: 0`);
 *   - `status` desconhecido virando filtro silenciosamente ignorado;
 *   - `total` divergindo do conjunto paginado;
 *   - busca que nao casa nem por codigo nem por nome;
 *   - paginacao que repete ou pula registro.
 *
 * Nenhuma assercao e afrouxada. Nenhum dado e inventado: toda categoria vem do proprio servico.
 */

const UNIT_A = 'unit-fin-cat-a';

async function grantCategoryActions(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.FinanceExpenseCategoryCreate,
    AUTHZ_ACTIONS.FinanceExpenseCategoryList,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

describe('Finance expense category lookup (PostgreSQL)', () => {
  let pool: Pool;
  let payablesAccess: PayablesAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for finance integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FinanceModule],
    }).compile();
    payablesAccess = module.get(PayablesAccessService);
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
    const login = normalizeLoginIdentifier(`exp-cat-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantCategoryActions(pool, identityId, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  /** Cria a categoria pelo CAMINHO REAL do produto — nao por INSERT direto no pool. */
  async function createCategory(
    actor: { identityId: string; sessionId: string },
    code: string,
    name: string,
  ): Promise<string> {
    const created = await payablesAccess.createExpenseCategory(actor, { code, name });
    return created.id;
  }

  const listQuery = (overrides: Record<string, unknown> = {}) => ({
    limit: 20,
    offset: 0,
    ...overrides,
  });

  it('devolve a categoria criada, provando que a referencia humana existe', async () => {
    const actor = await seedActor();
    const categoryId = await createCategory(actor, 'ADM-001', 'Despesas administrativas');

    const page = await payablesAccess.listExpenseCategories(actor, listQuery());

    expect(page.total).toBe(1);
    expect(page.totalPages).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: categoryId,
      code: 'ADM-001',
      name: 'Despesas administrativas',
      status: EXPENSE_CATEGORY_STATUSES.Active,
    });
  });

  it('recusa a listagem SEM concessao em vez de devolver lista vazia', async () => {
    const privileged = await seedActor();
    await createCategory(privileged, 'OCULTA-01', 'Categoria que o ator sem grant nao pode ver');

    const outsider = await seedActor(false);

    // O ponto do teste: `total: 0` mascararia a negacao como ausencia de dado. Recusa explicita.
    await expect(
      payablesAccess.listExpenseCategories(outsider, listQuery()),
    ).rejects.toMatchObject({ code: FINANCE_ERROR_CODES.DENIED });
  });

  it('recusa status fora do enum em vez de ignorar o filtro', async () => {
    const actor = await seedActor();
    await createCategory(actor, 'MAT-001', 'Material de consumo');

    const error = await payablesAccess
      .listExpenseCategories(actor, listQuery({ status: 'ARQUIVADA' }))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(FinanceHttpException);
    expect((error as FinanceHttpException).code).toBe(
      FINANCE_ERROR_CODES.EXPENSE_CATEGORY_STATUS_INVALID,
    );
  });

  it('filtra por status conhecido e mantem total coerente com o conjunto', async () => {
    const actor = await seedActor();
    await createCategory(actor, 'ATIV-01', 'Ativa um');
    await createCategory(actor, 'ATIV-02', 'Ativa dois');

    const active = await payablesAccess.listExpenseCategories(
      actor,
      listQuery({ status: EXPENSE_CATEGORY_STATUSES.Active }),
    );

    expect(active.total).toBe(2);
    expect(active.items).toHaveLength(2);
    expect(active.items.every((item) => item.status === EXPENSE_CATEGORY_STATUSES.Active)).toBe(true);
  });

  it('busca casa por CODIGO e por NOME', async () => {
    const actor = await seedActor();
    await createCategory(actor, 'FRETE-01', 'Logistica e transporte');
    await createCategory(actor, 'TI-001', 'Tecnologia da informacao');

    const byCode = await payablesAccess.listExpenseCategories(actor, listQuery({ q: 'FRETE' }));
    expect(byCode.total).toBe(1);
    expect(byCode.items[0]?.code).toBe('FRETE-01');

    const byName = await payablesAccess.listExpenseCategories(
      actor,
      listQuery({ q: 'Tecnologia' }),
    );
    expect(byName.total).toBe(1);
    expect(byName.items[0]?.code).toBe('TI-001');
  });

  it('pagina com total estavel e sem repetir nem pular registro', async () => {
    const actor = await seedActor();
    const codes = ['A-01', 'A-02', 'A-03', 'A-04', 'A-05'];
    for (const code of codes) {
      await createCategory(actor, code, `Categoria ${code}`);
    }

    const first = await payablesAccess.listExpenseCategories(actor, listQuery({ limit: 2, offset: 0 }));
    const second = await payablesAccess.listExpenseCategories(actor, listQuery({ limit: 2, offset: 2 }));
    const third = await payablesAccess.listExpenseCategories(actor, listQuery({ limit: 2, offset: 4 }));

    // `total` descreve o CONJUNTO, nao a pagina.
    expect(first.total).toBe(5);
    expect(second.total).toBe(5);
    expect(third.total).toBe(5);
    expect(first.totalPages).toBe(3);

    const collected = [...first.items, ...second.items, ...third.items].map((item) => item.code);
    expect(collected).toEqual(codes);
    expect(new Set(collected).size).toBe(codes.length);
  });

  it('lista vazia real significa zero categorias cadastradas, nao negacao disfarcada', async () => {
    const actor = await seedActor();

    const page = await payablesAccess.listExpenseCategories(actor, listQuery());

    expect(page.total).toBe(0);
    expect(page.items).toEqual([]);
    expect(page.totalPages).toBe(0);
  });

  it('o conjunto de status do dominio e fechado e rejeita vizinhos parecidos', () => {
    expect(isExpenseCategoryStatus(EXPENSE_CATEGORY_STATUSES.Active)).toBe(true);
    expect(isExpenseCategoryStatus(EXPENSE_CATEGORY_STATUSES.Inactive)).toBe(true);
    // Valores parecidos NAO passam: sem esta rigidez o filtro cairia em comparacao que nunca casa.
    expect(isExpenseCategoryStatus('ACTIVE ')).toBe(false);
    expect(isExpenseCategoryStatus('active')).toBe(false);
    expect(isExpenseCategoryStatus('DELETED')).toBe(false);
  });

  it('a listagem respeita paginacao do DTO canonico do modulo', async () => {
    const actor = await seedActor();
    await createCategory(actor, 'LIM-01', 'Categoria limite');
    void UNIT_A;

    // `limit` e `offset` vem do `FinanceListQuery` ja validado pela borda HTTP; aqui provamos que
    // o servico os aplica literalmente e nao reescreve o recorte.
    const page = await payablesAccess.listExpenseCategories(actor, listQuery({ limit: 1, offset: 0 }));
    expect(page.limit).toBe(1);
    expect(page.offset).toBe(0);
    expect(page.items).toHaveLength(1);
  });
});
