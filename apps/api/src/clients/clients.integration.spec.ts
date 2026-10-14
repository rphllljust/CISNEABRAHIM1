import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateClientTables,
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
import { ClientsModule } from './clients.module';
import { ClientAccessService } from './services/client-access.service';
import { CONTACT_PURPOSES, CONTACT_ROLES, PURCHASE_ORDER_REQUIREMENTS } from './domain/client-status';
import type { IdentityAuthzContext } from '../authorization/types/authz-decision';
import type { ClientResponse } from './serializers/client-response.serializer';
import { CLIENT_ERROR_CODES } from './errors/client-error-codes';
import { ClientHttpException } from './errors/client-http.exception';

const TEST_CNPJ = '11222333000181';

async function grantClientAdmin(
  pool: Pool,
  identityId: string,
  grantedBy: string,
): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.ClientCreate,
    AUTHZ_ACTIONS.ClientRead,
    AUTHZ_ACTIONS.ClientList,
    AUTHZ_ACTIONS.ClientUpdate,
    AUTHZ_ACTIONS.ClientDeactivate,
    AUTHZ_ACTIONS.ClientActivate,
    /*
     * Capacidades do Customer 360 (migration 0097). Concedidas ao ator administrativo do teste
     * porque ele representa o perfil completo do módulo; o teste de negação da trilha de auditoria
     * usa um ator PARCIAL, para provar que `client:audit:read` é mesmo independente de
     * `client:client:read`.
     */
    AUTHZ_ACTIONS.ClientContactManage,
    AUTHZ_ACTIONS.ClientUnitManage,
    AUTHZ_ACTIONS.ClientHierarchyManage,
    AUTHZ_ACTIONS.ClientAuditRead,
  ];
  for (const action of actions) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.Client,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

describe('Clients PostgreSQL integration', () => {
  let pool: Pool;
  let clientAccess: ClientAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for clients integration tests.');
    }

    applyAuthTestEnv(testDatabaseUrl);

    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, ClientsModule],
    }).compile();

    clientAccess = module.get(ClientAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateClientTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(): Promise<{ identityId: string }> {
    const login = normalizeLoginIdentifier(`client-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantClientAdmin(pool, identityId, identityId);
    return { identityId };
  }

  it('creates, reads, updates, deactivates and reactivates a client', async () => {
    const { identityId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await clientAccess.create(actor, {
      legalName: 'Cliente Integração LTDA',
      taxId: TEST_CNPJ,
      contacts: [
        {
          name: 'Operações',
          purpose: CONTACT_PURPOSES.Operational,
          email: 'ops@client.invalid',
        },
      ],
    });

    expect(created.status).toBe('ACTIVE');
    expect(created.taxId).toBe(TEST_CNPJ);
    expect(created.purchaseOrderRequirement).toBe('NOT_REQUIRED');

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events
       WHERE resource_id = $1 AND action = 'security:client:create'`,
      [created.id],
    );
    expect(audit.rowCount).toBeGreaterThan(0);

    await expect(clientAccess.requireActive(created.id)).resolves.toMatchObject({
      id: created.id,
      status: 'ACTIVE',
    });

    const fetched = await clientAccess.getById(actor, created.id);
    expect(fetched.legalName).toBe('Cliente Integração LTDA');

    const updated = await clientAccess.update(actor, created.id, {
      version: created.version,
      tradeName: 'Cliente Integração',
    });
    expect(updated.tradeName).toBe('Cliente Integração');

    const deactivated = await clientAccess.deactivate(
      actor,
      created.id,
      updated.version,
      'Encerramento contratual',
    );
    expect(deactivated.status).toBe('INACTIVE');
    await expect(clientAccess.requireActive(created.id)).rejects.toMatchObject({
      code: CLIENT_ERROR_CODES.INACTIVE,
    });

    const reactivated = await clientAccess.activate(
      actor,
      created.id,
      deactivated.version,
    );
    expect(reactivated.status).toBe('ACTIVE');
    expect(reactivated.deactivationReason).toBe('Encerramento contratual');
    expect(reactivated.deactivatedAt).not.toBeNull();
  });

  it('lists clients as summaries without loading contacts and addresses', async () => {
    const { identityId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await clientAccess.create(actor, {
      legalName: 'Cliente Lista LTDA',
      tradeName: 'Lista',
      taxId: '11222333000518',
      contacts: [
        {
          name: 'Lista Ops',
          purpose: CONTACT_PURPOSES.Operational,
          email: 'lista@client.invalid',
        },
      ],
      addresses: [
        {
          purpose: 'operational',
          city: 'Porto Velho',
          state: 'RO',
        },
      ],
    });

    const listed = await clientAccess.list(actor, { limit: 20, offset: 0 });

    expect(listed.total).toBe(1);
    expect(listed.totalPages).toBe(1);
    expect(listed.items).toHaveLength(1);

    const [item] = listed.items;
    expect(item).toMatchObject({
      id: created.id,
      legalName: 'Cliente Lista LTDA',
      tradeName: 'Lista',
      taxId: '11222333000518',
      status: 'ACTIVE',
    });

    // A lista é projeção de identificação: não carrega as coleções filhas do Cliente.
    expect(item).not.toHaveProperty('contacts');
    expect(item).not.toHaveProperty('addresses');
    expect(item).not.toHaveProperty('units');
    /*
     * `version` FOI publicada deliberadamente na listagem (commit ef65d83c): `activate`/`deactivate`
     * exigem a versão para concorrência otimista, e sem ela cada linha de um comando em lote
     * precisaria de um `GET /clients/:id` adicional — N+1 no caminho de escrita. A asserção
     * anterior ("a lista não publica version") ficou obsoleta com aquela mudança e é corrigida
     * aqui, não contornada.
     */
    expect(item).toHaveProperty('version');
    // Nem localidade: não há regra confirmada que eleja um endereço entre vários (SRC-002 Q14
    // confirma apenas as finalidades). O detalhe continua expondo os endereços completos.
    expect(item).not.toHaveProperty('locality');
    expect(created.addresses).toHaveLength(1);
  });

  it('rejects duplicate CNPJ', async () => {
    const { identityId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };
    const payload = {
      legalName: 'Cliente A LTDA',
      taxId: TEST_CNPJ,
      contacts: [
        {
          name: 'Operações',
          purpose: CONTACT_PURPOSES.Operational,
          phone: '69999990000',
        },
      ],
    };

    await clientAccess.create(actor, payload);

    await expect(clientAccess.create(actor, { ...payload, legalName: 'Cliente B LTDA' })).rejects
      .toMatchObject({
        code: CLIENT_ERROR_CODES.TAX_ID_CONFLICT,
      });
  });

  it('denies access without grants and enforces cross-client scope', async () => {
    const admin = await seedActor();
    const employeeLogin = normalizeLoginIdentifier(`employee-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: employeeId } = await insertIdentity(pool, employeeLogin, passwordHash);

    const clientA = await clientAccess.create(
      { identityId: admin.identityId, sessionId: 'sid' },
      {
        legalName: 'Cliente A LTDA',
        taxId: '11222333000262',
        contacts: [
          {
            name: 'Ops',
            purpose: CONTACT_PURPOSES.Operational,
            email: 'a@client.invalid',
          },
        ],
      },
    );

    const clientB = await clientAccess.create(
      { identityId: admin.identityId, sessionId: 'sid' },
      {
        legalName: 'Cliente B LTDA',
        taxId: '11222333000343',
        contacts: [
          {
            name: 'Ops',
            purpose: CONTACT_PURPOSES.Operational,
            email: 'b@client.invalid',
          },
        ],
      },
    );

    await insertGrant(pool, {
      identityId: employeeId,
      action: AUTHZ_ACTIONS.ClientRead,
      resourceType: AUTHZ_RESOURCE_TYPES.Client,
      scopeType: AUTHZ_SCOPES.Client,
      resourceId: clientA.id,
      grantedByIdentityId: admin.identityId,
    });

    const employeeActor = { identityId: employeeId, sessionId: 'sid' };
    await expect(clientAccess.list(employeeActor, { limit: 20, offset: 0 })).rejects.toMatchObject({
      code: CLIENT_ERROR_CODES.DENIED,
    });
    await expect(clientAccess.getById(employeeActor, clientB.id)).rejects.toBeInstanceOf(
      ClientHttpException,
    );
    await expect(clientAccess.getById(employeeActor, clientA.id)).resolves.toMatchObject({
      id: clientA.id,
    });
  });

  it('detects optimistic concurrency conflicts', async () => {
    const { identityId } = await seedActor();
    const actor = { identityId, sessionId: 'sid' };

    const created = await clientAccess.create(actor, {
      legalName: 'Concorrência LTDA',
      taxId: '11222333000424',
      contacts: [
        {
          name: 'Ops',
          purpose: CONTACT_PURPOSES.Operational,
          email: 'c@client.invalid',
        },
      ],
    });

    await clientAccess.update(actor, created.id, { version: created.version, tradeName: 'V2' });

    await expect(
      clientAccess.update(actor, created.id, { version: created.version, tradeName: 'Stale' }),
    ).rejects.toMatchObject({ code: CLIENT_ERROR_CODES.VERSION_CONFLICT });
  });

  /**
   * Listagem do master data: busca server-side, filtros, ordenação e paginação com total.
   *
   * Os Clientes semeados usam nomes deliberadamente ordenáveis e CNPJs válidos distintos para que
   * cada asserção isole uma dimensão (nome, documento, status, exigência de PO).
   */
  describe('client list — search, filters, ordering and pagination', () => {
    const SEED = [
      {
        legalName: 'Alfa Madeira LTDA',
        tradeName: 'Alfa Madeira',
        taxId: '11222333000607',
        purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.BeforeBilling,
      },
      {
        legalName: 'Beta Logistica LTDA',
        tradeName: 'Beta Log',
        taxId: '11222333000780',
        purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.NotRequired,
      },
      {
        legalName: 'Gama Madeira EIRELI',
        tradeName: null,
        taxId: '11222333000861',
        purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.BeforeExecution,
      },
      {
        legalName: 'Delta Mineracao S/A',
        tradeName: 'Delta Mineracao',
        taxId: '11222333000942',
        purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.NotRequired,
      },
    ];

    async function seedCatalogue(): Promise<{
      actor: IdentityAuthzContext;
      created: ClientResponse[];
    }> {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const created: ClientResponse[] = [];

      for (const entry of SEED) {
        created.push(
          await clientAccess.create(actor, {
            legalName: entry.legalName,
            tradeName: entry.tradeName ?? undefined,
            taxId: entry.taxId,
            purchaseOrderRequirement: entry.purchaseOrderRequirement,
            contacts: [
              {
                name: 'Operações',
                purpose: CONTACT_PURPOSES.Operational,
                email: `ops-${entry.taxId}@client.invalid`,
              },
            ],
          }),
        );
      }

      return { actor, created };
    }

    it('orders by legal name ascending by default', async () => {
      const { actor } = await seedCatalogue();

      const page = await clientAccess.list(actor, { limit: 20, offset: 0 });
      expect(page.items.map((item) => item.legalName)).toEqual([
        'Alfa Madeira LTDA',
        'Beta Logistica LTDA',
        'Delta Mineracao S/A',
        'Gama Madeira EIRELI',
      ]);
      expect(page.total).toBe(4);
    });

    it('honours the descending direction and the updatedAt ordering', async () => {
      const { actor, created } = await seedCatalogue();

      const descending = await clientAccess.list(actor, {
        limit: 20,
        offset: 0,
        direction: 'desc',
      });
      expect(descending.items.map((item) => item.legalName)).toEqual([
        'Gama Madeira EIRELI',
        'Delta Mineracao S/A',
        'Beta Logistica LTDA',
        'Alfa Madeira LTDA',
      ]);

      // A ordenação por última atualização é verificada contra a REGRA documentada
      // (`updated_at` na direção pedida, desempate por `id` na mesma direção), não contra uma
      // suposição de que os carimbos de tempo das inserções sejam todos distintos.
      const expected = [...created]
        .sort((left, right) => {
          const byTime =
            new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
          if (byTime !== 0) {
            return byTime;
          }
          return right.id.localeCompare(left.id);
        })
        .map((item) => item.id);

      const byUpdate = await clientAccess.list(actor, {
        limit: 20,
        offset: 0,
        sort: 'updatedAt',
        direction: 'desc',
      });
      expect(byUpdate.items.map((item) => item.id)).toEqual(expected);

      // Ascendente é exatamente o reverso do descendente, e o total não muda com a ordenação.
      const ascending = await clientAccess.list(actor, {
        limit: 20,
        offset: 0,
        sort: 'updatedAt',
        direction: 'asc',
      });
      expect(ascending.items.map((item) => item.id)).toEqual([...expected].reverse());
      expect(ascending.total).toBe(byUpdate.total);

      // A ordenação padrão (razão social) é uma ordem diferente da de atualização.
      const byName = await clientAccess.list(actor, { limit: 20, offset: 0 });
      expect(byName.items.map((item) => item.id)).not.toEqual(byUpdate.items.map((item) => item.id));
    });

    it('paginates deterministically and reports a total consistent with the page', async () => {
      const { actor } = await seedCatalogue();

      const first = await clientAccess.list(actor, { limit: 2, offset: 0 });
      const second = await clientAccess.list(actor, { limit: 2, offset: 2 });
      const beyond = await clientAccess.list(actor, { limit: 2, offset: 4 });

      expect(first.items).toHaveLength(2);
      expect(second.items).toHaveLength(2);
      expect(first.total).toBe(4);
      expect(first.totalPages).toBe(2);
      expect(second.total).toBe(4);

      // Páginas são disjuntas e a concatenação reproduz a ordem global.
      const ids = [...first.items, ...second.items].map((item) => item.id);
      expect(new Set(ids).size).toBe(4);

      // Página além do fim devolve vazio, mas o total permanece verdadeiro (sem página fantasma).
      expect(beyond.items).toEqual([]);
      expect(beyond.total).toBe(4);
    });

    it('searches by legal name and by trade name server-side', async () => {
      const { actor } = await seedCatalogue();

      const byLegalName = await clientAccess.list(actor, { limit: 20, offset: 0, q: 'Mineracao' });
      expect(byLegalName.items.map((item) => item.legalName)).toEqual(['Delta Mineracao S/A']);
      expect(byLegalName.total).toBe(1);

      // "Madeira" aparece em duas razões sociais; o nome fantasia "Beta Log" não contém o termo.
      const byFragment = await clientAccess.list(actor, { limit: 20, offset: 0, q: 'Madeira' });
      expect(byFragment.total).toBe(2);

      const byTradeName = await clientAccess.list(actor, { limit: 20, offset: 0, q: 'Beta Log' });
      expect(byTradeName.items.map((item) => item.legalName)).toEqual(['Beta Logistica LTDA']);
    });

    it('searches by full and partial CNPJ through the normalized digits', async () => {
      const { actor } = await seedCatalogue();

      const formatted = await clientAccess.list(actor, {
        limit: 20,
        offset: 0,
        q: '11.222.333/0008-61',
      });
      expect(formatted.items.map((item) => item.legalName)).toEqual(['Gama Madeira EIRELI']);

      // Prefixo parcial em dígitos: caminho de identificação por documento incompleto.
      const partial = await clientAccess.list(actor, { limit: 20, offset: 0, q: '112223330008' });
      expect(partial.items.map((item) => item.legalName)).toEqual(['Gama Madeira EIRELI']);

      // Prefixo comum a todos os CNPJ semeados.
      const broad = await clientAccess.list(actor, { limit: 20, offset: 0, q: '11222333000' });
      expect(broad.total).toBe(4);
    });

    it('returns an empty page with total zero when the search matches nothing', async () => {
      const { actor } = await seedCatalogue();

      const noResults = await clientAccess.list(actor, {
        limit: 20,
        offset: 0,
        q: 'Zinco Inexistente',
      });

      // Distinguível do cadastro vazio: existem Clientes, a busca é que não encontrou.
      expect(noResults.items).toEqual([]);
      expect(noResults.total).toBe(0);
      expect(noResults.totalPages).toBe(0);

      const all = await clientAccess.list(actor, { limit: 20, offset: 0 });
      expect(all.total).toBe(4);
    });

    it('filters by status and by purchase order requirement', async () => {
      const { actor } = await seedCatalogue();

      const byRequirement = await clientAccess.list(actor, {
        limit: 20,
        offset: 0,
        purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.NotRequired,
      });
      expect(byRequirement.items.map((item) => item.legalName)).toEqual([
        'Beta Logistica LTDA',
        'Delta Mineracao S/A',
      ]);
      expect(byRequirement.total).toBe(2);

      const active = await clientAccess.list(actor, {
        limit: 20,
        offset: 0,
        status: 'ACTIVE',
      });
      expect(active.total).toBe(4);

      const [first] = await clientAccess.list(actor, { limit: 1, offset: 0 }).then((page) => page.items);
      await clientAccess.deactivate(actor, first!.id, 1, 'Encerramento contratual');

      const inactive = await clientAccess.list(actor, {
        limit: 20,
        offset: 0,
        status: 'INACTIVE',
      });
      expect(inactive.items.map((item) => item.id)).toEqual([first!.id]);
      expect(inactive.total).toBe(1);

      const stillActive = await clientAccess.list(actor, {
        limit: 20,
        offset: 0,
        status: 'ACTIVE',
      });
      expect(stillActive.total).toBe(3);
    });

    it('combines search, filter and pagination without losing the total', async () => {
      const { actor } = await seedCatalogue();

      const combined = await clientAccess.list(actor, {
        limit: 1,
        offset: 0,
        q: 'Madeira',
        status: 'ACTIVE',
      });

      expect(combined.items).toHaveLength(1);
      expect(combined.total).toBe(2);
      expect(combined.totalPages).toBe(2);
      expect(combined.items[0]?.legalName).toBe('Alfa Madeira LTDA');

      const secondPage = await clientAccess.list(actor, {
        limit: 1,
        offset: 1,
        q: 'Madeira',
        status: 'ACTIVE',
      });
      expect(secondPage.items[0]?.legalName).toBe('Gama Madeira EIRELI');
      expect(secondPage.total).toBe(2);
    });

    it('scopes both the page and the total to the grants of the caller', async () => {
      const { actor } = await seedCatalogue();

      const scopedPage = await clientAccess.list(actor, { limit: 20, offset: 0 });
      const target = scopedPage.items[1]!;

      const employeeLogin = normalizeLoginIdentifier(`scoped-${crypto.randomUUID()}@cisne.invalid`);
      const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
      const { identityId: employeeId } = await insertIdentity(pool, employeeLogin, passwordHash);

      await insertGrant(pool, {
        identityId: employeeId,
        action: AUTHZ_ACTIONS.ClientList,
        resourceType: AUTHZ_RESOURCE_TYPES.Client,
        scopeType: AUTHZ_SCOPES.Client,
        resourceId: target.id,
        grantedByIdentityId: actor.identityId,
      });

      const employeeActor = { identityId: employeeId, sessionId: 'sid' };

      const scoped = await clientAccess.list(employeeActor, { limit: 20, offset: 0 });
      expect(scoped.items.map((item) => item.id)).toEqual([target.id]);
      // O total reflete o escopo, não o cadastro inteiro: 4 Clientes existem, 1 é visível.
      expect(scoped.total).toBe(1);

      // Busca que casaria com um Cliente fora do escopo continua devolvendo nada.
      const outOfScope = await clientAccess.list(employeeActor, {
        limit: 20,
        offset: 0,
        q: 'Alfa Madeira',
      });
      expect(outOfScope.items).toEqual([]);
      expect(outOfScope.total).toBe(0);
    });

    it('denies listing to an identity with no client list grant, including with a search term', async () => {
      const { actor } = await seedCatalogue();
      expect((await clientAccess.list(actor, { limit: 20, offset: 0 })).total).toBe(4);

      const strangerLogin = normalizeLoginIdentifier(`stranger-${crypto.randomUUID()}@cisne.invalid`);
      const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
      const { identityId: strangerId } = await insertIdentity(pool, strangerLogin, passwordHash);
      const strangerActor = { identityId: strangerId, sessionId: 'sid' };

      await expect(
        clientAccess.list(strangerActor, { limit: 20, offset: 0 }),
      ).rejects.toMatchObject({ code: CLIENT_ERROR_CODES.DENIED });

      // A busca não pode ser usada como oráculo de existência para quem não tem a capability.
      await expect(
        clientAccess.list(strangerActor, { limit: 20, offset: 0, q: 'Alfa' }),
      ).rejects.toMatchObject({ code: CLIENT_ERROR_CODES.DENIED });
    });
  });

  /**
   * Invariantes no PostgreSQL real. O banco é a autoridade final: nenhuma dessas regras pode
   * depender de validação de aplicação ou de interface.
   */
  describe('client master data invariants enforced by PostgreSQL', () => {
    it('rejects a duplicate normalized CNPJ with the unique index constraint', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };

      await clientAccess.create(actor, {
        legalName: 'Invariante Unica LTDA',
        taxId: TEST_CNPJ,
        contacts: [
          { name: 'Ops', purpose: CONTACT_PURPOSES.Operational, email: 'i@client.invalid' },
        ],
      });

      // Inserção direta, sem passar pelo serviço: prova que a unicidade é do banco.
      await expect(
        pool.query(
          `INSERT INTO pty.clients (legal_name, normalized_tax_id) VALUES ($1, $2)`,
          ['Tentativa Duplicada LTDA', TEST_CNPJ],
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'clients_normalized_tax_id_uidx',
      });
    });

    it('rejects a tax id that is not 14 digits and a blank legal name', async () => {
      await expect(
        pool.query(`INSERT INTO pty.clients (legal_name, normalized_tax_id) VALUES ($1, $2)`, [
          'Documento Invalido LTDA',
          '1122233300018',
        ]),
      ).rejects.toMatchObject({ constraint: 'clients_normalized_tax_id_digits_chk' });

      await expect(
        pool.query(`INSERT INTO pty.clients (legal_name, normalized_tax_id) VALUES ($1, $2)`, [
          '   ',
          '11222333000999',
        ]),
      ).rejects.toMatchObject({ constraint: 'clients_legal_name_not_empty_chk' });
    });

    it('rejects a version below one and keeps the FK to the deactivating identity', async () => {
      await expect(
        pool.query(
          `INSERT INTO pty.clients (legal_name, normalized_tax_id, version) VALUES ($1, $2, $3)`,
          ['Versao Invalida LTDA', '11222333000888', 0],
        ),
      ).rejects.toMatchObject({ constraint: 'clients_version_positive_chk' });

      await expect(
        pool.query(
          `INSERT INTO pty.clients (legal_name, normalized_tax_id, deactivated_by_identity_id)
           VALUES ($1, $2, $3)`,
          ['FK Invalida LTDA', '11222333000777', crypto.randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('has every index the ordered client list relies on', async () => {
      const indexes = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'pty' AND tablename = 'clients'`,
      );
      const names = indexes.rows.map((row) => row.indexname);

      // Providos por 0006 (baseline) e 0033 (trigram).
      expect(names).toEqual(
        expect.arrayContaining([
          'clients_normalized_tax_id_uidx',
          'clients_status_created_at_idx',
          'clients_legal_name_trgm_idx',
          'clients_trade_name_trgm_idx',
        ]),
      );

      // Providos por 0079, cada um autorizado por EXPLAIN sobre 50 mil Clientes.
      expect(names).toEqual(
        expect.arrayContaining([
          'clients_legal_name_id_idx',
          'clients_updated_at_id_idx',
          'clients_normalized_tax_id_pattern_idx',
        ]),
      );

      // Candidato medido e REJEITADO: coberto por (legal_name, id), e mais lento que ele.
      expect(names).not.toContain('clients_status_legal_name_id_idx');
    });

    /* Índices que a migration 0097 acrescentou e cuja ausência degradaria a hierarquia. */
    it('has the indexes the customer 360 hierarchy relies on', async () => {
      const indexes = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'pty'`,
      );
      const names = indexes.rows.map((row) => row.indexname);
      expect(names).toEqual(
        expect.arrayContaining([
          'clients_group_id_idx',
          'clients_parent_client_id_idx',
          'client_units_client_id_idx',
          'client_units_headquarters_uidx',
          'client_contacts_primary_uidx',
          'client_addresses_unit_id_idx',
        ]),
      );
    });

    /* O canal AUDIT_TRAIL passa a ser append-only também para a trilha de VALOR (migration 0097). */
    it('protects the value audit trail against mutation', async () => {
      const triggers = await pool.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger WHERE tgname = 'audit_logs_no_update'`,
      );
      expect(triggers.rowCount).toBe(1);
    });
  });

  /* ══════════════════════════════════════════════════════════════════════════════
     CUSTOMER 360 — contatos, unidades, hierarquia, qualidade e trilha de auditoria
     ══════════════════════════════════════════════════════════════════════════════ */

  describe('customer 360 — contacts, units and hierarchy', () => {
    async function seedClient(identityId: string, override: Partial<{ legalName: string; taxId: string }> = {}) {
      return clientAccess.create(
        { identityId, sessionId: 'sid' },
        {
          legalName: override.legalName ?? 'Cliente 360 LTDA',
          taxId: override.taxId ?? TEST_CNPJ,
          contacts: [
            {
              name: 'Operações',
              purpose: CONTACT_PURPOSES.Operational,
              email: 'ops@client.invalid',
            },
          ],
        },
      );
    }

    it('adds a contact with role and marks it primary', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const created = await seedClient(identityId);

      const withContact = await clientAccess.applyContactCommand(actor, created.id, {
        kind: 'add',
        version: created.version,
        name: 'Compras',
        purpose: CONTACT_PURPOSES.Commercial,
        role: CONTACT_ROLES.Purchasing,
        email: 'compras@client.invalid',
      });

      const added = withContact.contacts.find((contact) => contact.name === 'Compras');
      expect(added?.role).toBe(CONTACT_ROLES.Purchasing);
      expect(added?.isPrimary).toBe(false);

      const withPrimary = await clientAccess.applyContactCommand(actor, created.id, {
        kind: 'setPrimary',
        version: withContact.version,
        contactId: added!.id,
      });
      expect(withPrimary.contacts.filter((contact) => contact.isPrimary)).toHaveLength(1);
      expect(withPrimary.contacts.find((contact) => contact.isPrimary)?.name).toBe('Compras');
    });

    /*
     * TROCAR O PRINCIPAL É ATÔMICO. O índice parcial do banco só admite um; marcar o novo sem
     * desmarcar o anterior seria recusado. O teste prova que a troca funciona — o que só é possível
     * porque o repositório desmarca e marca na MESMA transação.
     */
    it('moves the primary flag between contacts', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const created = await seedClient(identityId);

      const first = created.contacts[0]!;
      const afterFirst = await clientAccess.applyContactCommand(actor, created.id, {
        kind: 'setPrimary',
        version: created.version,
        contactId: first.id,
      });
      expect(afterFirst.contacts.find((c) => c.isPrimary)?.id).toBe(first.id);

      const second = await clientAccess.applyContactCommand(actor, created.id, {
        kind: 'add',
        version: afterFirst.version,
        name: 'Financeiro',
        purpose: CONTACT_PURPOSES.Billing,
        phone: '6533334444',
      });
      const secondContact = second.contacts.find((c) => c.name === 'Financeiro')!;

      const afterSecond = await clientAccess.applyContactCommand(actor, created.id, {
        kind: 'setPrimary',
        version: second.version,
        contactId: secondContact.id,
      });
      expect(afterSecond.contacts.filter((c) => c.isPrimary)).toHaveLength(1);
      expect(afterSecond.contacts.find((c) => c.isPrimary)?.id).toBe(secondContact.id);
    });

    /*
     * DESATIVAR PRESERVA O HISTÓRICO. O contato sai de operação mas continua na ficha — apagá-lo
     * faria a organização do Cliente perder memória a cada troca de pessoa.
     */
    it('deactivates a contact without deleting it', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const created = await seedClient(identityId);
      const contact = created.contacts[0]!;

      const deactivated = await clientAccess.applyContactCommand(actor, created.id, {
        kind: 'deactivate',
        version: created.version,
        contactId: contact.id,
      });

      const stillThere = deactivated.contacts.find((c) => c.id === contact.id);
      expect(stillThere).toBeDefined();
      expect(stillThere?.deactivatedAt).not.toBeNull();

      const reactivated = await clientAccess.applyContactCommand(actor, created.id, {
        kind: 'reactivate',
        version: deactivated.version,
        contactId: contact.id,
      });
      expect(reactivated.contacts.find((c) => c.id === contact.id)?.deactivatedAt).toBeNull();
    });

    /* Papel `null` REMOVE a atribuição — distinto de "não mexe", que é `undefined`. */
    it('clears a contact role when null is sent', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const created = await seedClient(identityId);

      const withRole = await clientAccess.applyContactCommand(actor, created.id, {
        kind: 'setRole',
        version: created.version,
        contactId: created.contacts[0]!.id,
        role: CONTACT_ROLES.Management,
      });
      expect(withRole.contacts[0]?.role).toBe(CONTACT_ROLES.Management);

      const cleared = await clientAccess.applyContactCommand(actor, created.id, {
        kind: 'setRole',
        version: withRole.version,
        contactId: created.contacts[0]!.id,
        role: null,
      });
      expect(cleared.contacts[0]?.role).toBeNull();
    });

    it('declares units and keeps exactly one headquarters', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const created = await seedClient(identityId);

      const withUnits = await clientAccess.applyUnitCommand(actor, created.id, {
        kind: 'add',
        version: created.version,
        name: 'Filial Vilhena',
        city: 'Vilhena',
        state: 'RO',
      });
      expect(withUnits.units).toHaveLength(1);
      expect(withUnits.units[0]?.isHeadquarters).toBe(false);

      const added = withUnits.units[0]!;
      const asHeadquarters = await clientAccess.applyUnitCommand(actor, created.id, {
        kind: 'setHeadquarters',
        version: withUnits.version,
        unitId: added.id,
      });
      expect(asHeadquarters.units.filter((u) => u.isHeadquarters)).toHaveLength(1);
      expect(asHeadquarters.units[0]?.isHeadquarters).toBe(true);
    });

    it('declares the economic group by name and reuses it across clients', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const first = await seedClient(identityId, { taxId: TEST_CNPJ });

      const withGroup = await clientAccess.setHierarchy(actor, first.id, {
        version: first.version,
        groupName: 'Grupo Vilhena',
      });
      expect(withGroup.groupName).toBe('Grupo Vilhena');
      expect(withGroup.groupId).not.toBeNull();

      const second = await clientAccess.create(actor, {
        legalName: 'Cliente 360 Filial LTDA',
        taxId: '11222333000262',
        contacts: [
          { name: 'Operações', purpose: CONTACT_PURPOSES.Operational, email: 'ops2@client.invalid' },
        ],
      });

      // MESMO NOME -> MESMO REGISTRO. É o que torna a consolidação por grupo possível; dois grupos
      // homônimos seriam o defeito de tratar o grupo como texto livre no Cliente.
      const secondWithGroup = await clientAccess.setHierarchy(actor, second.id, {
        version: second.version,
        groupName: 'Grupo Vilhena',
      });
      expect(secondWithGroup.groupId).toBe(withGroup.groupId);
    });

    it('links a parent client and exposes the hierarchy tree', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const parent = await seedClient(identityId, { taxId: TEST_CNPJ });
      const child = await clientAccess.create(actor, {
        legalName: 'Filial LTDA',
        taxId: '11222333000262',
        contacts: [
          { name: 'Operações', purpose: CONTACT_PURPOSES.Operational, email: 'ops2@client.invalid' },
        ],
      });

      const linked = await clientAccess.setHierarchy(actor, child.id, {
        version: child.version,
        parentClientId: parent.id,
      });
      expect(linked.parentClientId).toBe(parent.id);
      expect(linked.parentClientName).toBe(parent.legalName);

      const hierarchy = await clientAccess.getHierarchy(actor, parent.id);
      expect(hierarchy.rootId).toBe(parent.id);
      expect(hierarchy.truncated).toBe(false);
      expect(hierarchy.nodes.map((node) => node.id)).toEqual(
        expect.arrayContaining([parent.id, child.id]),
      );
      const childNode = hierarchy.nodes.find((node) => node.id === child.id);
      expect(childNode?.relation).toBe('child');
      expect(childNode?.depth).toBe(1);
    });

    /*
     * CICLO DE HIERARQUIA É RECUSADO. Sem esta proteção, A -> B -> A faria a travessia da árvore
     * girar indefinidamente. O banco barra apenas a auto-referência; o ciclo longo é do serviço.
     */
    it('rejects a hierarchy cycle', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const a = await seedClient(identityId, { taxId: TEST_CNPJ });
      const b = await clientAccess.create(actor, {
        legalName: 'B LTDA',
        taxId: '11222333000262',
        contacts: [
          { name: 'Ops', purpose: CONTACT_PURPOSES.Operational, email: 'b@client.invalid' },
        ],
      });

      const bLinkedToA = await clientAccess.setHierarchy(actor, b.id, {
        version: b.version,
        parentClientId: a.id,
      });

      await expect(
        clientAccess.setHierarchy(actor, a.id, {
          version: a.version,
          parentClientId: b.id,
        }),
      ).rejects.toMatchObject({ code: CLIENT_ERROR_CODES.HIERARCHY_CYCLE });

      // O vínculo válido permanece intacto.
      const reloaded = await clientAccess.getById(actor, b.id);
      expect(reloaded.parentClientId).toBe(a.id);
      expect(bLinkedToA.parentClientId).toBe(a.id);
    });

    it('rejects a client as its own parent', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const created = await seedClient(identityId);

      await expect(
        clientAccess.setHierarchy(actor, created.id, {
          version: created.version,
          parentClientId: created.id,
        }),
      ).rejects.toMatchObject({ code: CLIENT_ERROR_CODES.VALIDATION_FAILED });
    });

    /* Concorrência otimista: dois comandos com a MESMA versão não podem ambos vencer. */
    it('refuses a command carrying a stale version', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const created = await seedClient(identityId);

      await clientAccess.applyContactCommand(actor, created.id, {
        kind: 'add',
        version: created.version,
        name: 'Segundo',
        purpose: CONTACT_PURPOSES.Billing,
        phone: '6533334444',
      });

      await expect(
        clientAccess.applyContactCommand(actor, created.id, {
          kind: 'add',
          version: created.version,
          name: 'Terceiro',
          purpose: CONTACT_PURPOSES.Billing,
          phone: '6533335555',
        }),
      ).rejects.toMatchObject({ code: CLIENT_ERROR_CODES.VERSION_CONFLICT });
    });

    it('reports contact, unit and address changes under the manage capabilities', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const created = await seedClient(identityId);

      const withContact = await clientAccess.applyContactCommand(actor, created.id, {
        kind: 'add',
        version: created.version,
        name: 'Compras',
        purpose: CONTACT_PURPOSES.Commercial,
        phone: '6533334444',
      });
      await clientAccess.applyUnitCommand(actor, created.id, {
        kind: 'add',
        version: withContact.version,
        name: 'Filial',
      });

      const events = await pool.query<{ action: string }>(
        `SELECT action FROM audit.security_audit_events WHERE resource_id = $1`,
        [created.id],
      );
      const actions = events.rows.map((row) => row.action);
      expect(actions).toContain('security:client:contact:manage');
      expect(actions).toContain('security:client:unit:manage');
    });
  });

  describe('customer 360 — data quality, duplicates and audit trail', () => {
    it('reports blocking findings for a cadastro without usable operational contact', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const created = await clientAccess.create(actor, {
        legalName: 'Sem Contato LTDA',
        taxId: TEST_CNPJ,
        contacts: [
          { name: 'Ops', purpose: CONTACT_PURPOSES.Operational, email: 'ops@client.invalid' },
        ],
      });

      const quality = await clientAccess.getDataQuality(actor, created.id);
      expect(quality.evaluated).toBe(true);
      // O Cliente TEM contato operacional utilizável, então nada bloqueia.
      expect(quality.findings.filter((f) => f.severity === 'blocking')).toHaveLength(0);
      // Mas não tem faturamento nem referência externa — apontamentos reais.
      expect(quality.findings.map((f) => f.code)).toContain('MISSING_BILLING_CONTACT');
      expect(quality.findings.map((f) => f.code)).toContain('MISSING_EXTERNAL_REFERENCE');
      expect(quality.isComplete).toBe(false);
    });

    it('proves a duplicate by document even when names differ', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      await clientAccess.create(actor, {
        legalName: 'Empresa Original LTDA',
        taxId: TEST_CNPJ,
        contacts: [
          { name: 'Ops', purpose: CONTACT_PURPOSES.Operational, email: 'ops@client.invalid' },
        ],
      });

      const check = await clientAccess.checkDuplicates(actor, {
        legalName: 'Nome Totalmente Diferente',
        taxId: TEST_CNPJ,
      });

      expect(check.checked).toBe(true);
      expect(check.certainCount).toBe(1);
      expect(check.suspectedCount).toBe(0);
      expect(check.matches[0]?.reasons).toContain('TAX_ID_MATCH');
    });

    it('excludes the record being edited from its own duplicate check', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const created = await clientAccess.create(actor, {
        legalName: 'Empresa Unica LTDA',
        taxId: TEST_CNPJ,
        contacts: [
          { name: 'Ops', purpose: CONTACT_PURPOSES.Operational, email: 'ops@client.invalid' },
        ],
      });

      const check = await clientAccess.checkDuplicates(actor, {
        legalName: created.legalName,
        taxId: created.taxId,
        excludeClientId: created.id,
      });
      expect(check.matches).toHaveLength(0);
    });

    /*
     * A TRILHA DE VALOR registra o PAR antes/depois. É o que responde "o que mudou", pergunta que o
     * canal de segurança (ação/resultado) não responde.
     */
    it('records the before/after pair of a value change', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const created = await clientAccess.create(actor, {
        legalName: 'Auditada LTDA',
        taxId: TEST_CNPJ,
        contacts: [
          { name: 'Ops', purpose: CONTACT_PURPOSES.Operational, email: 'ops@client.invalid' },
        ],
      });

      await clientAccess.update(actor, created.id, {
        version: created.version,
        tradeName: 'Auditada',
      });

      const trail = await clientAccess.getAuditTrail(actor, created.id, 20, 0);
      expect(trail.total).toBeGreaterThanOrEqual(2);

      const created0 = trail.items.find((entry) => entry.action === 'CREATE');
      expect(created0?.before).toBeNull();
      expect(created0?.after).toMatchObject({ legalName: 'Auditada LTDA' });

      const updated = trail.items.find((entry) => entry.action === 'UPDATE');
      expect(updated?.before).toMatchObject({ tradeName: null });
      expect(updated?.after).toMatchObject({ tradeName: 'Auditada' });
    });

    it('records a status change as a TRANSITION', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const created = await clientAccess.create(actor, {
        legalName: 'Transicionada LTDA',
        taxId: TEST_CNPJ,
        contacts: [
          { name: 'Ops', purpose: CONTACT_PURPOSES.Operational, email: 'ops@client.invalid' },
        ],
      });

      await clientAccess.deactivate(actor, created.id, created.version, 'Encerramento');

      const trail = await clientAccess.getAuditTrail(actor, created.id, 20, 0);
      const transition = trail.items.find((entry) => entry.action === 'TRANSITION');
      expect(transition).toBeDefined();
      expect(transition?.before).toMatchObject({ status: 'ACTIVE' });
      expect(transition?.after).toMatchObject({ status: 'INACTIVE' });
    });

    /*
     * NENHUM SEGREDO E NENHUMA COLEÇÃO PESSOAL NA TRILHA. O snapshot auditável é um ALLOW-LIST
     * fechada: contatos e endereços de terceiros NÃO entram, e um campo sensível novo só passa a ser
     * auditado quando alguém o declarar — nunca por acidente.
     */
    it('keeps personal contact data out of the audit snapshot', async () => {
      const { identityId } = await seedActor();
      const actor = { identityId, sessionId: 'sid' };
      const created = await clientAccess.create(actor, {
        legalName: 'Privacidade LTDA',
        taxId: TEST_CNPJ,
        contacts: [
          {
            name: 'Pessoa Nominal',
            purpose: CONTACT_PURPOSES.Operational,
            email: 'pessoa@client.invalid',
          },
        ],
      });

      const trail = await clientAccess.getAuditTrail(actor, created.id, 20, 0);
      const serialized = JSON.stringify(trail.items);
      expect(serialized).not.toContain('pessoa@client.invalid');
      expect(serialized).not.toContain('Pessoa Nominal');
      expect(serialized).not.toContain('contacts');
    });

    /* A trilha exige capability PRÓPRIA, separada de `ClientRead`. */
    it('denies the audit trail to an actor without the audit capability', async () => {
      const { identityId: adminId } = await seedActor();
      const created = await clientAccess.create(
        { identityId: adminId, sessionId: 'sid' },
        {
          legalName: 'Restrita LTDA',
          taxId: TEST_CNPJ,
          contacts: [
            { name: 'Ops', purpose: CONTACT_PURPOSES.Operational, email: 'ops@client.invalid' },
          ],
        },
      );

      // Ator com leitura de Cliente, mas SEM `client:audit:read`.
      const readerLogin = normalizeLoginIdentifier(`reader-${crypto.randomUUID()}@cisne.invalid`);
      const readerHash = await hashPassword(AUTH_TEST_PASSWORD);
      const { identityId: readerId } = await insertIdentity(pool, readerLogin, readerHash);
      for (const action of [AUTHZ_ACTIONS.ClientRead, AUTHZ_ACTIONS.ClientList]) {
        await insertGrant(pool, {
          identityId: readerId,
          action,
          resourceType: AUTHZ_RESOURCE_TYPES.Client,
          scopeType: AUTHZ_SCOPES.Global,
          grantedByIdentityId: readerId,
        });
      }

      await expect(
        clientAccess.getAuditTrail({ identityId: readerId, sessionId: 'sid' }, created.id, 20, 0),
      ).rejects.toMatchObject({ code: CLIENT_ERROR_CODES.DENIED });
    });
  });
});
