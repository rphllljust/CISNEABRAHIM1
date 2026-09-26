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
import { CONTACT_PURPOSES, PURCHASE_ORDER_REQUIREMENTS } from './domain/client-status';
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
    expect(item).not.toHaveProperty('version');
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
  });
});
