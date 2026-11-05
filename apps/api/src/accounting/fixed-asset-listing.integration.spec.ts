import {
  ensurePhysicalResourceTypesBaseline,
  ensureUnitsOfMeasureBaseline,
  hashPassword,
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateAccountingTables,
  truncateCatalogTables,
  truncateIdentityAndAuthorizationTables,
  truncatePhysicalAssetTables,
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
import { ResourcesModule } from '../resources/resources.module';
import { PhysicalAssetsAccessService } from '../resources/services/physical-assets-access.service';
import { PhysicalResourceTypesAccessService } from '../resources/services/physical-resource-types-access.service';
import { AccountingModule } from './accounting.module';
import { FIXED_ASSET_STATUSES, isFixedAssetStatus } from './domain/fixed-asset-accounting';
import { ACCOUNTING_ERROR_CODES } from './errors/accounting-error-codes';
import { AccountingHttpException } from './errors/accounting-http.exception';
import { FixedAssetAccountingAccessService } from './services/fixed-asset-accounting-access.service';

/**
 * LISTAGEM DO REGISTRO DE ATIVO IMOBILIZADO — prova de referencia humana.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE SPEC IMPEDE DE VOLTAR
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `GET accounting/fixed-assets` existia, mas era `getByOperationalAsset`: EXIGIA
 * `operationalAssetId`. Era consulta por um ativo, nunca lista. O operador de contabilidade nao
 * tinha como descobrir quais registros existem — nem como ligar um registro a um ativo sem ja
 * saber o UUID. Era o `PARK: HUMAN_LOOKUP_API_GAP` do imobilizado.
 *
 * Cada caso ataca uma forma concreta de a listagem mentir:
 *
 *   - lista vazia mascarando negacao (o gate precisa ser 403, nao `total: 0`);
 *   - `total` divergindo do conjunto paginado;
 *   - status desconhecido virando filtro silenciosamente ignorado;
 *   - registro de OUTRA unidade aparecendo no recorte.
 */

const UNIT_A = 'unit-faa-list-a';
const UNIT_B = 'unit-faa-list-b';

async function grantFixedAssetRead(pool: Pool, identityId: string): Promise<void> {
  /**
   * Cada grupo de acoes pertence a um `resourceType` DIFERENTE — o catalogo de tipos de recurso,
   * o ativo operacional e o livro contabil. Conceder tudo no mesmo tipo daria uma concessao que
   * o PDP nunca casa, e o teste falharia por seed, nao por comportamento.
   */
  for (const action of [
    AUTHZ_ACTIONS.ResourcesResourceTypeCreate,
    AUTHZ_ACTIONS.ResourcesResourceTypeRead,
    AUTHZ_ACTIONS.ResourcesResourceTypeList,
    AUTHZ_ACTIONS.ResourcesResourceTypeUpdate,
    AUTHZ_ACTIONS.ResourcesResourceTypeDeactivate,
    AUTHZ_ACTIONS.ResourcesResourceTypeActivate,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.ResourcesResourceType,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
  for (const action of [
    AUTHZ_ACTIONS.ResourcesAssetCreate,
    AUTHZ_ACTIONS.ResourcesAssetRead,
    AUTHZ_ACTIONS.ResourcesAssetList,
    AUTHZ_ACTIONS.ResourcesAssetUpdate,
    AUTHZ_ACTIONS.ResourcesAssetDeactivate,
    AUTHZ_ACTIONS.ResourcesAssetActivate,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.ResourcesAsset,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
  for (const action of [
    AUTHZ_ACTIONS.AccountingFixedAssetRegister,
    AUTHZ_ACTIONS.AccountingFixedAssetRead,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
}

describe('Fixed asset register listing (PostgreSQL)', () => {
  let pool: Pool;
  let fixedAssets: FixedAssetAccountingAccessService;
  let assets: PhysicalAssetsAccessService;
  let resourceTypes: PhysicalResourceTypesAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for accounting integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    pool = new Pool({ connectionString: testDatabaseUrl });
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);

    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, ResourcesModule, AccountingModule],
    }).compile();
    fixedAssets = module.get(FixedAssetAccountingAccessService);
    assets = module.get(PhysicalAssetsAccessService);
    resourceTypes = module.get(PhysicalResourceTypesAccessService);
  });

  beforeEach(async () => {
    await truncateAccountingTables(pool);
    await truncatePhysicalAssetTables(pool);
    await truncateCatalogTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    /**
     * A ancora de escopo e o que torna a unidade um alvo VALIDO de autorizacao. Sem ela o PDP
     * nao resolve o escopo e toda operacao sobre ativo responde negacao — o `beforeEach` do spec
     * irmao ja fazia isso, e a ausencia aqui produzia falha de SEED, nao de comportamento.
     */
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_B });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true): Promise<{ identityId: string; sessionId: string }> {
    const login = normalizeLoginIdentifier(`faa-list-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantFixedAssetRead(pool, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedAsset(
    actor: { identityId: string; sessionId: string },
    unitId = UNIT_A,
  ): Promise<string> {
    const listed = await resourceTypes.list(actor, { limit: 50, offset: 0 });
    const excavator = listed.items.find((item) => item.code === 'EXCAVATOR');
    if (!excavator) {
      throw new Error('EXCAVATOR resource type not found.');
    }
    const created = await assets.create(actor, {
      assetCode: `EXC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      resourceTypeId: excavator.id,
      name: 'Escavadeira operacional',
      unitId,
    });
    return created.id;
  }

  /** Registro criado pelo CAMINHO REAL do produto. */
  async function registerAsset(
    actor: { identityId: string; sessionId: string },
    unitId = UNIT_A,
  ): Promise<string> {
    const operationalAssetId = await seedAsset(actor, unitId);
    const register = await fixedAssets.register(actor, {
      unitId,
      operationalAssetId,
      currencyCode: 'BRL',
      usefulLifeMonths: 60,
      costCenterCode: `CC-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
    });
    return register.id;
  }

  const listQuery = (overrides: Record<string, unknown> = {}) => ({
    unitId: UNIT_A,
    limit: 20,
    offset: 0,
    ...overrides,
  });

  it('lista o registro que acabou de ser criado — a referencia humana passa a existir', async () => {
    const actor = await seedActor();
    const registerId = await registerAsset(actor);

    const page = await fixedAssets.list(actor, listQuery());

    expect(page.total).toBe(1);
    expect(page.totalPages).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(registerId);
    expect(page.items[0]?.status).toBe(FIXED_ASSET_STATUSES.Registered);
  });

  it('a listagem NAO carrega movimentos — sem consulta por linha', async () => {
    const actor = await seedActor();
    await registerAsset(actor);

    const page = await fixedAssets.list(actor, listQuery());

    // Uma consulta por registro (N+1) seria o custo escondido desta listagem. O historico vem
    // do detalhe (`getByOperationalAsset`), que e o unico consumidor dele.
    expect(page.items[0]?.movements).toEqual([]);
  });

  it('nega a listagem SEM concessao em vez de devolver lista vazia', async () => {
    const privileged = await seedActor();
    await registerAsset(privileged);

    const outsider = await seedActor(false);

    // `total: 0` mascararia negacao como ausencia de dado. Recusa explicita.
    await expect(fixedAssets.list(outsider, listQuery())).rejects.toMatchObject({
      code: ACCOUNTING_ERROR_CODES.DENIED,
    });
  });

  it('RECUSA status fora do enum em vez de ignorar o filtro', async () => {
    const actor = await seedActor();
    await registerAsset(actor);

    const error = await fixedAssets
      .list(actor, listQuery({ status: 'VENDIDO' }))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AccountingHttpException);
    expect((error as AccountingHttpException).code).toBe(
      ACCOUNTING_ERROR_CODES.FIXED_ASSET_STATUS_INVALID,
    );
  });

  it('filtra por status conhecido mantendo total coerente', async () => {
    const actor = await seedActor();
    await registerAsset(actor);
    await registerAsset(actor);

    const registered = await fixedAssets.list(
      actor,
      listQuery({ status: FIXED_ASSET_STATUSES.Registered }),
    );

    expect(registered.total).toBe(2);
    expect(
      registered.items.every((item) => item.status === FIXED_ASSET_STATUSES.Registered),
    ).toBe(true);

    const capitalized = await fixedAssets.list(
      actor,
      listQuery({ status: FIXED_ASSET_STATUSES.Capitalized }),
    );
    expect(capitalized.total).toBe(0);
    expect(capitalized.items).toEqual([]);
  });

  it('nao vaza registro de OUTRA unidade', async () => {
    const actor = await seedActor();
    await registerAsset(actor, UNIT_A);
    await registerAsset(actor, UNIT_B);

    const pageA = await fixedAssets.list(actor, listQuery({ unitId: UNIT_A }));
    const pageB = await fixedAssets.list(actor, listQuery({ unitId: UNIT_B }));

    // O escopo organizacional e o `unit_id` persistido: cada unidade ve apenas o seu.
    expect(pageA.total).toBe(1);
    expect(pageB.total).toBe(1);
    expect(pageA.items[0]?.unitId).toBe(UNIT_A);
    expect(pageB.items[0]?.unitId).toBe(UNIT_B);
    expect(pageA.items[0]?.id).not.toBe(pageB.items[0]?.id);
  });

  it('pagina com total estavel, sem repetir nem pular registro', async () => {
    const actor = await seedActor();
    const created: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      created.push(await registerAsset(actor));
    }

    const pages = await Promise.all([
      fixedAssets.list(actor, listQuery({ limit: 2, offset: 0 })),
      fixedAssets.list(actor, listQuery({ limit: 2, offset: 2 })),
      fixedAssets.list(actor, listQuery({ limit: 2, offset: 4 })),
    ]);

    for (const page of pages) {
      expect(page.total).toBe(5);
      expect(page.totalPages).toBe(3);
    }

    const collected = pages.flatMap((page) => page.items.map((item) => item.id));
    expect(collected).toHaveLength(5);
    expect(new Set(collected).size).toBe(5);
    expect(new Set(collected)).toEqual(new Set(created));
  });

  it('lista vazia real significa zero registros na unidade', async () => {
    const actor = await seedActor();

    const page = await fixedAssets.list(actor, listQuery());

    expect(page.total).toBe(0);
    expect(page.items).toEqual([]);
    expect(page.totalPages).toBe(0);
  });

  it('o conjunto de status do dominio e fechado e rejeita vizinhos parecidos', () => {
    expect(isFixedAssetStatus(FIXED_ASSET_STATUSES.Registered)).toBe(true);
    expect(isFixedAssetStatus(FIXED_ASSET_STATUSES.Capitalized)).toBe(true);
    expect(isFixedAssetStatus(FIXED_ASSET_STATUSES.Disposed)).toBe(true);
    expect(isFixedAssetStatus('registered')).toBe(false);
    expect(isFixedAssetStatus('REGISTERED ')).toBe(false);
    expect(isFixedAssetStatus('SOLD')).toBe(false);
  });
});
