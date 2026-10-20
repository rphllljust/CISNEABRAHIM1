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
import { FinanceModule } from './finance.module';
import { PAYABLE_AGING_BUCKETS, PAYABLE_ORIGIN_KINDS } from './domain/payable';
import { PayablesAccessService } from './services/payables-access.service';

/**
 * AGING SOBRE O DATASET COMPLETO — a prova que o defeito original não volta.
 *
 * O DEFEITO
 *
 * `PayablesAccessService.aging()` calculava o aging com
 *
 *     (await this.list(actor, { limit: AGING_SCAN_LIMIT, offset: 0 })).items
 *
 * ou seja, sobre a PRIMEIRA PÁGINA. Com mais títulos que o limite, o excedente simplesmente
 * não entrava na conta e o número publicado continuava com aparência de total. É o erro mais
 * caro do Financeiro: uma página se passando por carteira.
 *
 * A PROVA
 *
 * Este arquivo cria MAIS títulos do que o antigo `AGING_SCAN_LIMIT` (100) numa única faixa e
 * verifica que:
 *
 *   1. o aging conta TODOS eles — não apenas os que caberiam numa página;
 *   2. o total do aging fecha com o `total` da listagem;
 *   3. o filtro `agingBucket` devolve exatamente os títulos que compõem aquela faixa;
 *   4. a soma monetária da faixa bate com o aging publicado.
 *
 * Com o código antigo, o item 1 falharia por construção: o aging veria 100 títulos onde
 * existem mais.
 */

const UNIT = 'unit-aging';

describe('Payable aging over the full dataset (PostgreSQL integration)', () => {
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

  /** Ator sob teste: só as capabilities de LEITURA, ancoradas na unidade. */
  async function seedReader(): Promise<{ identityId: string; sessionId: string }> {
    const login = normalizeLoginIdentifier(`aging-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    for (const action of [AUTHZ_ACTIONS.FinancePayableRead, AUTHZ_ACTIONS.FinancePayableList]) {
      await insertGrant(pool, {
        identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
        scopeType: AUTHZ_SCOPES.Unit,
        resourceId: UNIT,
        grantedByIdentityId: identityId,
      });
    }
    return { identityId, sessionId: 'test-session' };
  }

  /** Ator de SETUP: cria o master data (categoria) e os títulos. */
  async function seedFixture(): Promise<{ identityId: string; sessionId: string }> {
    const login = normalizeLoginIdentifier(`aging-fix-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    for (const action of [
      AUTHZ_ACTIONS.FinanceExpenseCategoryCreate,
      AUTHZ_ACTIONS.FinancePayableOpen,
    ]) {
      await insertGrant(pool, {
        identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: identityId,
      });
    }
    return { identityId, sessionId: 'fixture' };
  }

  async function openPayables(
    creatorIdentityId: string,
    specs: Array<{ dueDate: string; principal: string; reference: string }>,
  ): Promise<void> {
    const actor = { identityId: creatorIdentityId, sessionId: 'seed' };
    const category = await payablesAccess.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Servicos',
    });
    for (const spec of specs) {
      await payablesAccess.open(actor, {
        unitId: UNIT,
        counterpartyId: crypto.randomUUID(),
        originKind: PAYABLE_ORIGIN_KINDS.ManualAuthorizedExpense,
        originId: crypto.randomUUID(),
        originReference: spec.reference,
        expenseCategoryId: category.id,
        costCenterId: crypto.randomUUID(),
        costCenterCode: 'CC-1',
        principal: spec.principal,
        currencyCode: 'BRL',
        dueDate: spec.dueDate,
        paymentTerms: '30 DDL',
        externalReference: spec.reference,
      });
    }
  }

  /** Data de vencimento deslocada `days` dias de hoje (negativo = atrasado). */
  function dueDateFromToday(days: number): string {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  it('conta TODOS os títulos da faixa, mesmo acima do antigo limite de varredura', async () => {
    const reader = await seedReader();
    const fixture = await seedFixture();

    /*
     * 120 títulos vencidos há 45 dias — dentro da faixa 31-60 e ACIMA do antigo
     * `AGING_SCAN_LIMIT = 100`. É exatamente o caso que o cálculo sobre a página perdia.
     */
    const TOTAL = 120;
    const overdue45 = dueDateFromToday(-45);
    await openPayables(
      fixture.identityId,
      Array.from({ length: TOTAL }, (_, index) => ({
        dueDate: overdue45,
        principal: '100.0000',
        reference: `AG-${String(index).padStart(3, '0')}`,
      })),
    );

    const aging = await payablesAccess.aging(reader);

    // A faixa 31-60 tem de refletir o DATASET, não uma página dele.
    expect(aging.buckets[PAYABLE_AGING_BUCKETS.Days31To60].count).toBe(TOTAL);
    // 120 x 100.0000
    expect(Number(aging.buckets[PAYABLE_AGING_BUCKETS.Days31To60].remaining)).toBe(12_000);

    // A resposta veio do dataset completo, e diz isso.
    expect(aging.complete).toBe(true);
    expect(aging.unavailableReason).toBeNull();

    // Coerência com a listagem: o `total` do recorte é o mesmo número.
    const list = await payablesAccess.list(reader, { limit: 20, offset: 0 });
    expect(list.total).toBe(TOTAL);
    const agingTotal = Object.values(aging.buckets).reduce((sum, b) => sum + b.count, 0);
    expect(agingTotal).toBe(list.total);
  }, 180_000);

  it('agingBucket filtra o MESMO conjunto que o aging soma', async () => {
    const reader = await seedReader();
    const fixture = await seedFixture();

    // Distribuição espalhada por três faixas, com contagens distintas para o erro ser visível.
    await openPayables(fixture.identityId, [
      // 5 vencidos há 10 dias -> 1_30
      ...Array.from({ length: 5 }, (_, i) => ({
        dueDate: dueDateFromToday(-10),
        principal: '50.0000',
        reference: `B1-${i}`,
      })),
      // 3 vencidos há 45 dias -> 31_60
      ...Array.from({ length: 3 }, (_, i) => ({
        dueDate: dueDateFromToday(-45),
        principal: '200.0000',
        reference: `B2-${i}`,
      })),
      // 2 vencidos há 120 dias -> 90_PLUS
      ...Array.from({ length: 2 }, (_, i) => ({
        dueDate: dueDateFromToday(-120),
        principal: '1000.0000',
        reference: `B3-${i}`,
      })),
    ]);

    const aging = await payablesAccess.aging(reader);
    expect(aging.buckets[PAYABLE_AGING_BUCKETS.Days1To30].count).toBe(5);
    expect(aging.buckets[PAYABLE_AGING_BUCKETS.Days31To60].count).toBe(3);
    expect(aging.buckets[PAYABLE_AGING_BUCKETS.Days90Plus].count).toBe(2);

    // O drilldown de uma faixa devolve EXATAMENTE os títulos que ela somou.
    const drill31to60 = await payablesAccess.list(reader, {
      limit: 20,
      offset: 0,
      agingBucket: PAYABLE_AGING_BUCKETS.Days31To60,
    });
    expect(drill31to60.total).toBe(3);
    expect(drill31to60.items).toHaveLength(3);
    for (const item of drill31to60.items) {
      expect(item.agingBucket).toBe(PAYABLE_AGING_BUCKETS.Days31To60);
    }
    const drillSum = drill31to60.items.reduce((sum, item) => sum + Number(item.remainingBalance), 0);
    expect(drillSum).toBe(Number(aging.buckets[PAYABLE_AGING_BUCKETS.Days31To60].remaining));

    // Faixa sem títulos devolve vazio de verdade — não a carteira inteira.
    const drillCurrent = await payablesAccess.list(reader, {
      limit: 20,
      offset: 0,
      agingBucket: PAYABLE_AGING_BUCKETS.Current,
    });
    expect(drillCurrent.total).toBe(0);
    expect(drillCurrent.items).toHaveLength(0);
  }, 180_000);

  it('sem NENHUMA concessão o aging é INDISPONÍVEL, nunca uma carteira zerada', async () => {
    const fixture = await seedFixture();
    await openPayables(fixture.identityId, [
      { dueDate: dueDateFromToday(-10), principal: '500.0000', reference: 'N1' },
    ]);

    /*
     * Dois casos distintos, e a diferença entre eles é justamente a do P0:
     *
     *   (a) grant de LISTA ancorado em OUTRA unidade -> escopo legítimo, carteira vazia
     *       PORQUE NÃO HÁ TÍTULO NAQUELE ESCOPO. Aqui zero é um fato, e `complete: true`.
     *   (b) grant de LISTA sem âncora utilizável -> o escopo vira `FALSE` (fail-closed) e
     *       não existe base para medir. Aqui zero seria mentira, e `complete: false`.
     *
     * O caso (b) é o que o código antigo não sabia distinguir: devolvia faixas zeradas e a
     * tela pintava uma carteira em dia para quem simplesmente não podia lê-la.
     */
    const loginOther = normalizeLoginIdentifier(`other-${crypto.randomUUID()}@cisne.invalid`);
    const hashOther = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: otherUnitActor } = await insertIdentity(pool, loginOther, hashOther);
    await insertGrant(pool, {
      identityId: otherUnitActor,
      action: AUTHZ_ACTIONS.FinancePayableList,
      resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: 'some-other-unit',
      grantedByIdentityId: otherUnitActor,
    });

    const otherUnitAging = await payablesAccess.aging({
      identityId: otherUnitActor,
      sessionId: 'test-session',
    });
    // Carteira legitimamente vazia neste escopo: apurada, e por isso `complete`.
    expect(otherUnitAging.complete).toBe(true);
    expect(otherUnitAging.buckets[PAYABLE_AGING_BUCKETS.Days1To30].count).toBe(0);

    /*
     * (b) Recorte financeiro verdadeiramente VAZIO.
     *
     * `buildFinancialTitleListFilter` isola `r.unit_id` de grants UNIT e `r.client_id` de
     * grants CLIENT. Um grant ancorado em CLIENTE não produz cláusula de unidade alguma para
     * um PAYABLE — que não tem `client_id` —, então o escopo resultante é `FALSE`: o banco
     * não é lido.
     *
     * (O banco também recusa grant ancorado sem referência, via
     * `grants_anchored_scope_requires_ref_chk` — restrição correta, e o teste a respeita em
     * vez de contorná-la.)
     */
    const loginNoScope = normalizeLoginIdentifier(`noscope-${crypto.randomUUID()}@cisne.invalid`);
    const hashNoScope = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: noScopeActor } = await insertIdentity(pool, loginNoScope, hashNoScope);
    await insertGrant(pool, {
      identityId: noScopeActor,
      action: AUTHZ_ACTIONS.FinancePayableList,
      resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
      scopeType: AUTHZ_SCOPES.Client,
      resourceId: crypto.randomUUID(),
      grantedByIdentityId: noScopeActor,
    });

    const noScopeAging = await payablesAccess.aging({
      identityId: noScopeActor,
      sessionId: 'test-session',
    });

    // A distinção que a tela precisa: "não apurado" != "nada a pagar".
    expect(noScopeAging.complete).toBe(false);
    expect(noScopeAging.unavailableReason).toBe('NO_SCOPE_GRANT');
    // E o motivo acompanha o dado para a tela poder dizer por quê.
    expect(noScopeAging.buckets[PAYABLE_AGING_BUCKETS.Days1To30].count).toBe(0);
  }, 180_000);
});
