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
import { ApprovalMatrixAccessService } from '../authorization/services/approval-matrix-access.service';
import { enableCriticalSodFor } from '../authorization/test/critical-sod-harness';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';

/**
 * Tipo de escopo aceito por `insertGrant`, derivado do proprio valor canonico em vez de
 * importar um alias interno nao exportado pelo pacote. `AUTHZ_SCOPES.Unit` e `'UNIT'`.
 */
type GrantScopeType = (typeof AUTHZ_SCOPES)[keyof typeof AUTHZ_SCOPES];
import { FinanceModule } from './finance.module';
import { PAYABLE_ORIGIN_KINDS } from './domain/payable';
import { PayablesAccessService } from './services/payables-access.service';
import { ReceivablesAccessService } from './services/receivables-access.service';

/**
 * PAGINACAO AUTORIZADA DE TITULOS — prova do caminho completo.
 *
 * A frente de escala nao se sustenta apenas no access service: o contrato exigido e
 *
 *   CONTROLLER -> ACCESS SERVICE -> REPOSITORY -> SQL
 *
 * com `WHERE` autorizado + filtros + `ORDER BY` deterministico + `LIMIT` + `OFFSET` no SQL.
 * Estes testes exercitam exatamente isso contra PostgreSQL real:
 *
 *  - pagina 1 e pagina 2 nao se sobrepoem e nao perdem linha (ordem TOTAL por due_date+id);
 *  - filtro real chega ao SQL e o `total` respeita o mesmo filtro;
 *  - escopo por unidade: ator da unidade A nao ve a unidade B — nem item, nem contagem;
 *  - authz negativa: sem concessao de lista o resultado e vazio, nao a carteira inteira;
 *  - simetria: receivables e payables respondem com o MESMO envelope.
 */

const UNIT_A = 'unit-page-a';
const UNIT_B = 'unit-page-b';

async function insertGrantScoped(
  pool: Pool,
  identityId: string,
  action: string,
  resourceType: string,
  scopeType: GrantScopeType,
  resourceId: string,
): Promise<void> {
  await insertGrant(pool, {
    identityId,
    action,
    resourceType,
    scopeType,
    resourceId,
    grantedByIdentityId: identityId,
  });
}

describe('Finance title pagination and authorized scope (PostgreSQL integration)', () => {
  let pool: Pool;
  let receivablesAccess: ReceivablesAccessService;
  let payablesAccess: PayablesAccessService;
  let matrices: ApprovalMatrixAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for finance integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FinanceModule],
    }).compile();
    receivablesAccess = module.get(ReceivablesAccessService);
    payablesAccess = module.get(PayablesAccessService);
    matrices = module.get(ApprovalMatrixAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateFinanceTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  /**
   * Ator com concessao de LISTA ancorada numa UNIDADE.
   *
   * ESTE E O TESTE DE REGRESSAO CENTRAL da frente de escala. Ate aqui um ator com grant de
   * escopo `UNIT` era NEGADO (403) na listagem de titulos, porque `assertReceivableList`
   * chamava `assertPolicyAndGrantScope` sem `resourceContext` e `grantMatchesResourceContext`
   * exige `context.unitId` para grants UNIT. Efeito pratico: grants UNIT eram INUTEIS para
   * listagem financeira, embora o `ScopeEnforcementService` ja soubesse montar o predicado
   * SQL por unidade. O teste abaixo falha se esse contrato regredir.
   */
  async function seedUnitActor(
    unitId: string,
    actions: { receivable?: boolean; payable?: boolean } = { receivable: true, payable: true },
  ): Promise<{ identityId: string; sessionId: string }> {
    const login = normalizeLoginIdentifier(`page-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (actions.receivable) {
      for (const action of [AUTHZ_ACTIONS.FinanceReceivableRead, AUTHZ_ACTIONS.FinanceReceivableList]) {
        await insertGrantScoped(
          pool,
          identityId,
          action,
          AUTHZ_RESOURCE_TYPES.FinanceReceivable,
          AUTHZ_SCOPES.Unit,
          unitId,
        );
      }
    }
    if (actions.payable) {
      // APENAS as capabilities do COMPORTAMENTO sob teste. Criar categoria de despesa e
      // privilegio de SETUP e vive no ator de fixture — nao aqui.
      for (const action of [AUTHZ_ACTIONS.FinancePayableRead, AUTHZ_ACTIONS.FinancePayableList]) {
        await insertGrantScoped(
          pool,
          identityId,
          action,
          AUTHZ_RESOURCE_TYPES.FinancePayable,
          AUTHZ_SCOPES.Unit,
          unitId,
        );
      }
    }
    return { identityId, sessionId: 'test-session' };
  }

  /**
   * Ator com concessao GLOBAL sem ancora: le todo o escopo permitido.
   * Serve de contraponto ao ator UNIT — o contraste entre os dois e a prova do escopo.
   */
  async function seedGlobalActor(): Promise<{ identityId: string; sessionId: string }> {
    return seedUnitActor('', { receivable: true, payable: true });
  }

  /**
   * ATOR DE FIXTURE (setup) — identidade PRIVILEGIADA, separada do ator sob teste.
   *
   * Existe para criar MASTER DATA e pre-requisitos (categoria de despesa, titulos das unidades
   * A e B) sem contaminar o ator cujo comportamento de authz esta sendo medido. Sem esta
   * separacao o teste de autorizacao passaria a provar apenas que "um ator com todas as
   * permissoes consegue ler" — que nao e o que se quer medir.
   */
  async function seedFixtureActor(): Promise<{ identityId: string; sessionId: string }> {
    const login = normalizeLoginIdentifier(`fixture-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    // Privilegios de SETUP: abrir conta a pagar, criar categoria, abrir titulo a receber.
    for (const [action, resourceType, scope, anchor] of [
      [AUTHZ_ACTIONS.FinanceExpenseCategoryCreate, AUTHZ_RESOURCE_TYPES.FinancePayable, AUTHZ_SCOPES.Global, null],
      [AUTHZ_ACTIONS.FinancePayableOpen, AUTHZ_RESOURCE_TYPES.FinancePayable, AUTHZ_SCOPES.Global, null],
      [AUTHZ_ACTIONS.FinanceReceivableList, AUTHZ_RESOURCE_TYPES.FinanceReceivable, AUTHZ_SCOPES.Global, null],
    ] as const) {
      await insertGrant(pool, {
        identityId,
        action,
        resourceType,
        scopeType: scope,
        ...(anchor ? { resourceId: anchor } : {}),
        grantedByIdentityId: identityId,
      });
    }
    return { identityId, sessionId: 'fixture' };
  }

  /**
   * Ator UNIT A com o MESMO conjunto de concessoes do ator UNIT B.
   *
   * Usado na prova de isolamento: os dois enxergam a MESMA capacidade, e o que os separa e
   * exclusivamente o escopo ancorado na unidade.
   */
  async function seedUnitActorBoth(
    unitId: string,
  ): Promise<{ identityId: string; sessionId: string }> {
    return seedUnitActor(unitId);
  }

  /** Ator sem NENHUMA concessao de titulos — usado na prova de authz negativa. */
  async function seedUngrantedActor(): Promise<{ identityId: string; sessionId: string }> {
    const login = normalizeLoginIdentifier(`none-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    return { identityId, sessionId: 'test-session' };
  }

  /**
   * Semeia titulos usando uma IDENTIDADE REAL como criadora.
   *
   * `fin.receivables.created_by_identity_id` tem FK para `identity.identities`: um UUID
   * aleatorio violaria a constraint. O ator semeado serve de criador para os titulos das
   * duas unidades — a criacao nao e o que este spec mede, a PAGINACAO e o ESCOPO sao.
   */
  async function openReceivable(
    creatorIdentityId: string,
    unitId: string,
    dueDate: string,
    externalReference: string,
  ): Promise<string> {
    const opened = await receivablesAccess.openFromBilling({
      billingRecordId: crypto.randomUUID(),
      billingDocumentId: crypto.randomUUID(),
      serviceOrderId: crypto.randomUUID(),
      measurementId: crypto.randomUUID(),
      unitId,
      clientId: crypto.randomUUID(),
      principal: '100.0000',
      currencyCode: 'BRL',
      dueDate,
      paymentTerms: '30 DDL',
      externalReference,
      actorIdentityId: creatorIdentityId,
    });
    return opened.receivableId;
  }

  async function openPayable(
    creatorIdentityId: string,
    unitId: string,
    dueDate: string,
    externalReference: string,
  ): Promise<string> {
    const actor = { identityId: creatorIdentityId, sessionId: 'seed' };
    // A categoria de despesa tem de existir antes: `expenseCategoryId` e FK real.
    const category = await payablesAccess.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Servicos',
    });
    const opened = await payablesAccess.open(actor, {
      unitId,
      counterpartyId: crypto.randomUUID(),
      originKind: PAYABLE_ORIGIN_KINDS.ManualAuthorizedExpense,
      originId: crypto.randomUUID(),
      originReference: externalReference,
      expenseCategoryId: category.id,
      costCenterId: crypto.randomUUID(),
      costCenterCode: 'CC-1',
      principal: '100.0000',
      currencyCode: 'BRL',
      dueDate,
      paymentTerms: '30 DDL',
      externalReference,
    });
    return opened.id;
  }

  it('paginates receivables without overlap or loss across pages (deterministic order)', async () => {
    const actor = await seedUnitActor(UNIT_A);
    const fixture = await seedFixtureActor();
    // 5 titulos com a MESMA due_date: sem desempate por id, a ordem seria instavel e uma
    // linha poderia repetir na pagina 2 enquanto outra sumisse.
    for (let index = 0; index < 5; index += 1) {
      await openReceivable(fixture.identityId, UNIT_A, '2099-01-15', `REF-${index}`);
    }

    const first = await receivablesAccess.list(actor, {
      limit: 2,
      offset: 0,
      sortBy: 'due_date',
      sortDir: 'asc',
    });
    const second = await receivablesAccess.list(actor, {
      limit: 2,
      offset: 2,
      sortBy: 'due_date',
      sortDir: 'asc',
    });

    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(first.totalPages).toBe(3);

    const firstIds = first.items.map((item) => item.id);
    const secondIds = second.items.map((item) => item.id);
    // Sem sobreposicao entre paginas.
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);

    // Ordem total: repetir a consulta devolve exatamente a mesma sequencia.
    const firstAgain = await receivablesAccess.list(actor, {
      limit: 2,
      offset: 0,
      sortBy: 'due_date',
      sortDir: 'asc',
    });
    expect(firstAgain.items.map((item) => item.id)).toEqual(firstIds);
  });

  it('applies a real status filter in SQL and counts under the same filter', async () => {
    const actor = await seedUnitActor(UNIT_A);
    const fixture = await seedFixtureActor();
    await openReceivable(fixture.identityId, UNIT_A, '2020-01-01', 'OLD-1'); // vencido
    await openReceivable(fixture.identityId, UNIT_A, '2099-12-31', 'FUTURE-1'); // em aberto

    const overdue = await receivablesAccess.list(actor, {
      limit: 50,
      offset: 0,
      status: 'OVERDUE',
    });
    expect(overdue.items).toHaveLength(1);
    expect(overdue.items[0]!.status).toBe('OVERDUE');
    // `total` respeita o MESMO filtro: nao e a contagem da carteira inteira.
    expect(overdue.total).toBe(1);

    const open = await receivablesAccess.list(actor, { limit: 50, offset: 0, status: 'OPEN' });
    expect(open.items).toHaveLength(1);
    expect(open.total).toBe(1);
  });

  it('never exposes another unit, neither rows nor count (cross-unit scope)', async () => {
    // Dois atores com a MESMA capacidade; muda apenas a unidade ancorada.
    const actorA = await seedUnitActorBoth(UNIT_A);
    const actorB = await seedUnitActorBoth(UNIT_B);
    const fixture = await seedFixtureActor();

    // Cada um cria um titulo na SUA unidade.
    await openReceivable(fixture.identityId, UNIT_A, '2099-01-01', 'MINE');
    await openReceivable(fixture.identityId, UNIT_B, '2099-01-01', 'THEIRS');

    const pageA = await receivablesAccess.list(actorA, { limit: 50, offset: 0 });
    const pageB = await receivablesAccess.list(actorB, { limit: 50, offset: 0 });

    // Nenhum ve a unidade do outro — nem o item, nem o identificador da unidade.
    expect(pageA.items.every((item) => item.unitId === UNIT_A)).toBe(true);
    expect(pageB.items.every((item) => item.unitId === UNIT_B)).toBe(true);

    // E a CONTAGEM e a do proprio escopo: nao existe "count global com lista filtrada".
    expect(pageA.total).toBe(1);
    expect(pageB.total).toBe(1);
  });

  it('fails closed for an actor without list grant (negative authz)', async () => {
    const ungranted = await seedUngrantedActor();
    const fixture = await seedFixtureActor();
    await openReceivable(fixture.identityId, UNIT_A, '2099-01-01', 'HIDDEN');

    // Sem NENHUMA concessao de lista a carteira nao e lida: 403 explicito, nunca lista vazia
    // apresentada como "sem titulos". `[]` mascararia negacao como ausencia de dado.
    await expect(receivablesAccess.list(ungranted, { limit: 50, offset: 0 })).rejects.toMatchObject({
      status: 403,
    });
    await expect(payablesAccess.list(ungranted, { limit: 50, offset: 0 })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('honours limit and offset bounds, rejecting invalid pagination', async () => {
    const actor = await seedUnitActor(UNIT_A);
    const fixture = await seedFixtureActor();
    await openReceivable(fixture.identityId, UNIT_A, '2099-01-01', 'ONE');

    const beyondEnd = await receivablesAccess.list(actor, { limit: 50, offset: 500 });
    expect(beyondEnd.items).toHaveLength(0);
    // O total continua sendo o do escopo, mesmo fora da pagina.
    expect(beyondEnd.total).toBe(1);
  });

  it('keeps receivables and payables symmetric in envelope, scope and filters', async () => {
    const actor = await seedUnitActor(UNIT_A);
    const fixture = await seedFixtureActor();

    // SETUP pelo ator de fixture; o ator sob teste nao recebe privilegio de seed.
    await openReceivable(fixture.identityId, UNIT_A, '2099-01-01', 'AR-1');
    await openPayable(fixture.identityId, UNIT_A, '2099-01-01', 'AP-1');

    const receivables = await receivablesAccess.list(actor, { limit: 10, offset: 0 });
    const payables = await payablesAccess.list(actor, { limit: 10, offset: 0 });

    // MESMO envelope dos dois lados do razao.
    expect(Object.keys(receivables).sort()).toEqual(Object.keys(payables).sort());
    expect(receivables.limit).toBe(payables.limit);
    expect(receivables.offset).toBe(payables.offset);
    expect(receivables.totalPages).toBe(payables.totalPages);
    expect(receivables.items).toHaveLength(1);
    expect(payables.items).toHaveLength(1);
    // Mesmo escopo aplicado: ambos veem exatamente a unidade concedida.
    expect(receivables.items[0]!.unitId).toBe(UNIT_A);
    expect(payables.items[0]!.unitId).toBe(UNIT_A);
  });
});