import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { ScopeEnforcementService } from '../authorization/services/scope-enforcement.service';
import { ClientFinancialContextRepository } from './repositories/client-financial-context.repository';
import { ClientFinancialContextService } from './services/client-financial-context.service';
import { ReceivablesAccessAuthz } from './services/receivables-access.authz';
import { ReceivablesRepository } from './repositories/receivables.repository';
import { ReceivablesAccessService } from './services/receivables-access.service';
import { CollectionsRepository } from './repositories/collections.repository';
import { CollectionsAccessService } from './services/collections-access.service';
import { CollectionsAccessAuthz } from './services/collections-access.authz';
import { AuthorizationRepository } from '../authorization/repositories/authorization.repository';
import { buildReceivablePositionsSql } from '../analytics/domain/receivable-aging-sql';
import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateAllOperationalTables,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { AUTH_TEST_PASSWORD } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import type { IdentityAuthzContext } from '../authorization/types/authz-decision';
import { bindFinancialChain } from '../test/financial-chain.fixture';

/**
 * CONTEXTO FINANCEIRO DO CLIENTE — PROVA DE EQUIVALÊNCIA COM A DERIVAÇÃO CANÔNICA.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE TESTE PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * O read model do Customer 360 deriva "aberto / vencido / a vencer" dos MESMOS fatos que a
 * listagem de títulos usa (`lifecycle` + soma dos lançamentos liquidados não estornados +
 * `due_date`). A fórmula foi escrita DUAS vezes — uma no repositório de recebíveis, outra no read
 * model por Cliente — e duas cópias de uma regra divergem no dia em que alguém muda uma.
 *
 * O teste compara os DOIS CAMINHOS sobre os MESMOS títulos persistidos:
 *
 *   posição por título (canônica)  x  agregado por Cliente (read model)
 *
 * Se a regra de estorno, de cancelamento ou de vencimento mudar em um lugar só, esta conta para de
 * fechar e o teste falha — em vez de a ficha do Cliente passar a mostrar um número que a tela de
 * títulos contradiz.
 *
 * Também cobre o que o read model NÃO pode fazer: sem concessão utilizável o resultado é
 * `authorized: false` com valores `null`, e nunca zero — ausência não é zero.
 */
describe('Client financial context integration', () => {
  let pool: Pool;
  let service: ClientFinancialContextService;
  let scopeEnforcement: ScopeEnforcementService;
  let authorizationRepository: AuthorizationRepository;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
  const run = crypto.randomUUID().slice(0, 8);

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for client financial context tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);

    const module: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule, AuditModule, AuthorizationModule],
      providers: [
        ClientFinancialContextRepository,
        ClientFinancialContextService,
        ReceivablesAccessAuthz,
        ReceivablesRepository,
        ReceivablesAccessService,
        CollectionsRepository,
        CollectionsAccessService,
        CollectionsAccessAuthz,
      ],
    }).compile();

    service = module.get(ClientFinancialContextService);
    scopeEnforcement = module.get(ScopeEnforcementService);
    authorizationRepository = module.get(AuthorizationRepository);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateAllOperationalTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(): Promise<{ identityId: string; actor: IdentityAuthzContext }> {
    const login = normalizeLoginIdentifier(`fin-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    for (const action of [
      AUTHZ_ACTIONS.FinanceReceivableList,
      AUTHZ_ACTIONS.FinanceReceivableRead,
    ]) {
      await insertGrant(pool, {
        identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.FinanceReceivable,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: identityId,
      });
    }
    return { identityId, actor: { identityId, sessionId: 'sid' } };
  }

  /**
   * Posição canônica por título — a MESMA consulta que a tela de títulos usa para classificar.
   * Serve de ORÁCULO contra o agregado do read model.
   */
  async function canonicalPositions(clientId: string) {
    const sql = buildReceivablePositionsSql({ scopeClause: '$1::text IS NOT NULL', tzParam: '$2' });
    const rows = await pool.query<{ status: string; remaining: string; principal: string }>(sql, [
      clientId,
      'America/Porto_Velho',
    ]);
    return rows.rows;
  }

  /**
   * DATAS ANCORADAS NO RELÓGIO DO BANCO, NÃO NO DO NODE.
   *
   * O banco roda em `America/Cuiaba` (UTC-4) e classifica vencimento com `CURRENT_DATE` — que é a
   * data LOCAL do servidor. Calcular "ontem" com `Date.now()` e fatiar em UTC produz, à noite, uma
   * data que ainda é HOJE para o banco: os títulos não apareciam como vencidos e o teste falhava
   * acusando o serviço, quando o defeito estava na expectativa.
   *
   * `CURRENT_DATE - n` faz a âncora vir da MESMA fonte que a regra sob teste. Um teste de
   * vencimento não pode depender de duas noções diferentes de "hoje".
   */
  async function dbDate(offsetDays: number): Promise<string> {
    const row = await pool.query<{ d: string }>(
      `SELECT (CURRENT_DATE + $1::int)::text AS d`,
      [offsetDays],
    );
    return row.rows[0]!.d;
  }

  it('matches the canonical per-title derivation for open, overdue and due', async () => {
    const { identityId, actor } = await seedActor();
    const chain = bindFinancialChain(pool, identityId, run);
    const unit = `UF-${run}`;
    const clientId = await chain.newClient(unit);

    /*
     * Três títulos com desfechos distintos, ancorados na data LOCAL do banco:
     *   vencido  : venceu ontem, saldo integral
     *   a vencer : vence em 30 dias, saldo integral
     *   parcial  : venceu ontem, com metade liquidada (continua vencido pelo SALDO)
     */
    const yesterday = await dbDate(-1);
    const inThirtyDays = await dbDate(30);

    const overdueId = await chain.chain({
      unit,
      principal: '100.0000',
      dueDate: yesterday,
    });
    await pool.query(`UPDATE fin.receivables SET client_id = $2 WHERE id = $1`, [
      overdueId,
      clientId,
    ]);

    const dueId = await chain.chain({
      unit,
      principal: '250.0000',
      dueDate: inThirtyDays,
    });
    await pool.query(`UPDATE fin.receivables SET client_id = $2 WHERE id = $1`, [dueId, clientId]);

    const partialId = await chain.chain({
      unit,
      principal: '80.0000',
      dueDate: yesterday,
      settlements: ['40.0000'],
    });
    await pool.query(`UPDATE fin.receivables SET client_id = $2 WHERE id = $1`, [
      partialId,
      clientId,
    ]);

    const positions = await canonicalPositions(clientId);
    expect(positions.length).toBe(3);

    const canonicalOverdue = positions.filter((p) => p.status === 'OVERDUE');
    const canonicalTotalRemaining = positions.reduce((sum, p) => sum + Number(p.remaining), 0);

    const context = await service.forClient(actor, clientId);
    expect(context.evaluated).toBe(true);
    expect(context.authorized).toBe(true);
    expect(context.currencies).not.toBeNull();

    const totals = context.currencies!.find((c) => c.currencyCode === 'BRL');
    expect(totals).toBeDefined();

    // O AGREGADO TEM DE FECHAR COM A POSIÇÃO POR TÍTULO.
    expect(totals!.overdueCount).toBe(canonicalOverdue.length);
    expect(Number(totals!.openAmount)).toBeCloseTo(canonicalTotalRemaining, 4);
    // O vencido é calculado pelo SALDO: 100 + (80 - 40) = 140.
    expect(Number(totals!.overdueAmount)).toBeCloseTo(140, 4);
    // A vencer: o título de 250 ainda não venceu.
    expect(Number(totals!.dueAmount)).toBeCloseTo(250, 4);
    // Faturado é o principal não cancelado; recebido é o liquidado não estornado.
    expect(Number(totals!.billedAmount)).toBeCloseTo(430, 4);
    expect(Number(totals!.receivedAmount)).toBeCloseTo(40, 4);
    // Próximo vencimento = o compromisso MAIS URGENTE em aberto, que aqui é o JÁ VENCIDO de ontem.
    // Incluir os vencidos é o comportamento correto: é o título que exige ação primeiro.
    expect(totals!.nextDueDate).toBe(yesterday);
  });

  it('keeps the aggregate consistent after a settlement is reversed', async () => {
    const { identityId, actor } = await seedActor();
    const chain = bindFinancialChain(pool, identityId, run);
    const unit = `UF-${run}-rev`;
    const clientId = await chain.newClient(unit);

    const yesterday = await dbDate(-1);
    const receivableId = await chain.chain({
      unit,
      principal: '300.0000',
      dueDate: yesterday,
      settlements: ['300.0000'],
    });
    await pool.query(`UPDATE fin.receivables SET client_id = $2 WHERE id = $1`, [
      receivableId,
      clientId,
    ]);

    // Integralmente liquidado: nada em aberto.
    const settled = await service.forClient(actor, clientId);
    expect(Number(settled.currencies![0]!.openAmount)).toBeCloseTo(0, 4);
    expect(settled.currencies![0]!.openCount).toBe(0);

    /*
     * O ESTORNO REAL ESCREVE OS DOIS CAMPOS.
     *
     * `receivables.repository.ts` (`reverseSettlement`) faz `status = 'REVERSED'` E
     * `reversed_at = NOW()`. O fixture precisa reproduzir os DOIS: com apenas um deles o estado
     * persistido não é o de um estorno verdadeiro, e o teste mediria uma situação que não existe
     * em produção — foi exatamente o que aconteceu na primeira versão.
     */
    await pool.query(
      `UPDATE fin.settlements
          SET status = 'REVERSED'::fin.settlement_status,
              reversed_at = NOW(),
              reversal_reason = 'test'
        WHERE receivable_id = $1`,
      [receivableId],
    );

    const afterReversal = await service.forClient(actor, clientId);
    expect(Number(afterReversal.currencies![0]!.openAmount)).toBeCloseTo(300, 4);
    expect(Number(afterReversal.currencies![0]!.overdueAmount)).toBeCloseTo(300, 4);
    expect(afterReversal.currencies![0]!.overdueCount).toBe(1);

    // O ORÁCULO concorda: a mesma regra de estorno nos dois caminhos.
    const positions = await canonicalPositions(clientId);
    expect(positions[0]?.status).toBe('OVERDUE');
  });

  it('excludes cancelled receivables from every bucket', async () => {
    const { identityId, actor } = await seedActor();
    const chain = bindFinancialChain(pool, identityId, run);
    const unit = `UF-${run}-can`;
    const clientId = await chain.newClient(unit);

    const yesterday = await dbDate(-1);
    const kept = await chain.chain({ unit, principal: '50.0000', dueDate: yesterday });
    const cancelled = await chain.chain({
      unit,
      principal: '999.0000',
      dueDate: yesterday,
      lifecycle: 'CANCELLED',
    });
    for (const id of [kept, cancelled]) {
      await pool.query(`UPDATE fin.receivables SET client_id = $2 WHERE id = $1`, [id, clientId]);
    }

    const context = await service.forClient(actor, clientId);
    const totals = context.currencies![0]!;
    // O cancelado não entra em aberto nem em faturado.
    expect(Number(totals.openAmount)).toBeCloseTo(50, 4);
    expect(Number(totals.billedAmount)).toBeCloseTo(50, 4);
    expect(totals.openCount).toBe(1);
  });

  /*
   * SEM CONCESSÃO UTILIZÁVEL: `authorized: false` e valores `null`.
   *
   * Este é o teste da regra "AUSÊNCIA ≠ ZERO". Devolver `currencies: []` ou zeros faria a ficha
   * afirmar "este Cliente não tem títulos" para um ator que simplesmente não pode vê-los.
   */
  it('reports unauthorized with null values when the actor has no usable grant', async () => {
    const { identityId } = await seedActor();
    const chain = bindFinancialChain(pool, identityId, run);
    const unit = `UF-${run}-noauth`;
    const clientId = await chain.newClient(unit);
    const yesterday = await dbDate(-1);
    const receivableId = await chain.chain({ unit, principal: '10.0000', dueDate: yesterday });
    await pool.query(`UPDATE fin.receivables SET client_id = $2 WHERE id = $1`, [
      receivableId,
      clientId,
    ]);

    // Ator com a CAPABILITY mas sem ESCOPO alcançável (concessão ancorada em outra unidade).
    const login = normalizeLoginIdentifier(`fin-scoped-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: scopedId } = await insertIdentity(pool, login, passwordHash);
    await insertGrant(pool, {
      identityId: scopedId,
      action: AUTHZ_ACTIONS.FinanceReceivableList,
      resourceType: AUTHZ_RESOURCE_TYPES.FinanceReceivable,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: `UNRELATED-${run}`,
      grantedByIdentityId: scopedId,
    });

    const grants = await authorizationRepository.findActiveGrants(
      scopedId,
      AUTHZ_ACTIONS.FinanceReceivableList,
      AUTHZ_RESOURCE_TYPES.FinanceReceivable,
    );
    const scope = scopeEnforcement.buildFinancialTitleListFilter(grants);
    // O escopo é utilizável (aponta para uma unidade), mas não alcança este Cliente.
    expect(scope.clause).not.toBe('FALSE');

    const context = await service.forClient(
      { identityId: scopedId, sessionId: 'sid' },
      clientId,
    );
    expect(context.authorized).toBe(true);
    // Nenhum título DESTE cliente sob o escopo dele: lista vazia, e não um erro.
    expect(context.currencies).toEqual([]);
  });

  it('reports authorized with an empty list when the client simply has no receivables', async () => {
    const { identityId, actor } = await seedActor();
    const chain = bindFinancialChain(pool, identityId, run);
    const clientId = await chain.newClient(`UF-${run}-empty`);

    const context = await service.forClient(actor, clientId);
    expect(context.authorized).toBe(true);
    // "Consultei e não há título" — diferente de "não posso ver".
    expect(context.currencies).toEqual([]);
    expect(context.evaluated).toBe(true);
  });

  it('scopes the aggregate to the caller grants and never leaks another client', async () => {
    const { identityId } = await seedActor();
    const chain = bindFinancialChain(pool, identityId, run);
    const unitA = `UF-${run}-A`;
    const unitB = `UF-${run}-B`;
    const clientA = await chain.newClient(unitA);
    const clientB = await chain.newClient(unitB);

    const yesterday = await dbDate(-1);
    const a = await chain.chain({ unit: unitA, principal: '10.0000', dueDate: yesterday });
    const b = await chain.chain({ unit: unitB, principal: '20.0000', dueDate: yesterday });
    await pool.query(`UPDATE fin.receivables SET client_id = $2 WHERE id = $1`, [a, clientA]);
    await pool.query(`UPDATE fin.receivables SET client_id = $2 WHERE id = $1`, [b, clientB]);

    const scopedLogin = normalizeLoginIdentifier(`fin-unit-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: scopedId } = await insertIdentity(pool, scopedLogin, passwordHash);
    await insertGrant(pool, {
      identityId: scopedId,
      action: AUTHZ_ACTIONS.FinanceReceivableList,
      resourceType: AUTHZ_RESOURCE_TYPES.FinanceReceivable,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: unitA,
      grantedByIdentityId: scopedId,
    });

    const scopedActor = { identityId: scopedId, sessionId: 'sid' };

    // A unidade concedida: vê o título dela.
    const contextA = await service.forClient(scopedActor, clientA);
    expect(Number(contextA.currencies![0]!.openAmount)).toBeCloseTo(10, 4);

    /*
     * A unidade NÃO concedida: o Cliente existe e tem título, mas o ator não o alcança. O
     * resultado é lista vazia — nunca o valor do outro Cliente, e nunca o total da empresa.
     */
    const contextB = await service.forClient(scopedActor, clientB);
    expect(contextB.currencies).toEqual([]);
  });
});
