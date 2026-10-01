import { Test, TestingModule } from '@nestjs/testing';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditModule } from './audit.module';
import { AuditService } from './audit.service';
import { AUDIT_ACTIONS, AuditPersistenceError } from './audit-trail.types';

/**
 * Integração do canal AUDIT_TRAIL (audit.audit_logs).
 *
 * Cobre o contrato do serviço e o comportamento transacional que sustenta os
 * critérios de aceite: rollback não deixa rastro, redaction é aplicada e os
 * identificadores são propagados como recebidos.
 */
describe('Audit trail PostgreSQL integration', () => {
  let pool: Pool;
  let auditService: AuditService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
  const tabela = 'service_orders';

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for audit trail integration tests.');
    }

    const module: TestingModule = await Test.createTestingModule({
      imports: [AuditModule],
    }).compile();

    auditService = module.get(AuditService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE audit.audit_logs');
  });

  afterAll(async () => {
    await pool.end();
  });

  async function inTransaction<T>(work: (tx: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function countRows(): Promise<number> {
    const rows = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM audit.audit_logs',
    );
    return Number(rows.rows[0]?.count ?? '0');
  }

  it('grava CREATE com dados_antigos nulo', async () => {
    const registroId = crypto.randomUUID();
    const usuarioId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();

    await inTransaction((tx) =>
      auditService.registrar(
        {
          tabela,
          registroId,
          acao: AUDIT_ACTIONS.Create,
          dadosAntigos: null,
          dadosNovos: { status: 'DRAFT', row_version: 1 },
          usuarioId,
          correlationId,
        },
        tx,
      ),
    );

    const rows = await pool.query<{
      acao: string;
      dados_antigos: Record<string, unknown> | null;
      dados_novos: Record<string, unknown>;
      registro_id: string;
    }>('SELECT acao, dados_antigos, dados_novos, registro_id FROM audit.audit_logs');

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.acao).toBe(AUDIT_ACTIONS.Create);
    expect(rows.rows[0]?.dados_antigos).toBeNull();
    expect(rows.rows[0]?.dados_novos).toMatchObject({ status: 'DRAFT', row_version: 1 });
    expect(rows.rows[0]?.registro_id).toBe(registroId);
  });

  it('grava TRANSITION com status anterior diferente do novo', async () => {
    const registroId = crypto.randomUUID();

    await inTransaction((tx) =>
      auditService.registrar(
        {
          tabela,
          registroId,
          acao: AUDIT_ACTIONS.Transition,
          dadosAntigos: { status: 'DRAFT', row_version: 1 },
          dadosNovos: { status: 'PREPARED', row_version: 2 },
          usuarioId: crypto.randomUUID(),
          correlationId: crypto.randomUUID(),
        },
        tx,
      ),
    );

    const rows = await pool.query<{
      acao: string;
      dados_antigos: { status: string };
      dados_novos: { status: string };
    }>('SELECT acao, dados_antigos, dados_novos FROM audit.audit_logs');

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.acao).toBe(AUDIT_ACTIONS.Transition);
    expect(rows.rows[0]?.dados_antigos.status).not.toBe(rows.rows[0]?.dados_novos.status);
  });

  it('nao deixa rastro quando a transacao do chamador faz rollback', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await auditService.registrar(
        {
          tabela,
          registroId: crypto.randomUUID(),
          acao: AUDIT_ACTIONS.Transition,
          dadosAntigos: { status: 'DRAFT' },
          dadosNovos: { status: 'PREPARED' },
          usuarioId: crypto.randomUUID(),
          correlationId: crypto.randomUUID(),
        },
        client,
      );
      // Simula a rejeicao da operacao de negocio: a auditoria ja foi inserida
      // na mesma transacao e deve desaparecer junto.
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    expect(await countRows()).toBe(0);
  });

  it('propaga correlation_id exatamente como recebido do chamador', async () => {
    const correlationId = crypto.randomUUID();

    await inTransaction((tx) =>
      auditService.registrar(
        {
          tabela,
          registroId: crypto.randomUUID(),
          acao: AUDIT_ACTIONS.Create,
          dadosAntigos: null,
          dadosNovos: { status: 'DRAFT' },
          usuarioId: crypto.randomUUID(),
          correlationId,
        },
        tx,
      ),
    );

    const rows = await pool.query<{ correlation_id: string }>(
      'SELECT correlation_id FROM audit.audit_logs',
    );

    expect(rows.rows[0]?.correlation_id).toBe(correlationId);
  });

  it('propaga usuario_id do ator autenticado', async () => {
    const usuarioId = crypto.randomUUID();

    await inTransaction((tx) =>
      auditService.registrar(
        {
          tabela,
          registroId: crypto.randomUUID(),
          acao: AUDIT_ACTIONS.Create,
          dadosAntigos: null,
          dadosNovos: { status: 'DRAFT' },
          usuarioId,
          correlationId: crypto.randomUUID(),
        },
        tx,
      ),
    );

    const rows = await pool.query<{ usuario_id: string }>(
      'SELECT usuario_id FROM audit.audit_logs',
    );

    expect(rows.rows[0]?.usuario_id).toBe(usuarioId);
  });

  it('aplica redaction e nao persiste chaves proibidas', async () => {
    await inTransaction((tx) =>
      auditService.registrar(
        {
          tabela,
          registroId: crypto.randomUUID(),
          acao: AUDIT_ACTIONS.Update,
          dadosAntigos: { status: 'DRAFT', password: 'segredo', access_token: 'abc' },
          dadosNovos: { status: 'PREPARED', secret: 'xyz' },
          usuarioId: crypto.randomUUID(),
          correlationId: crypto.randomUUID(),
        },
        tx,
      ),
    );

    const rows = await pool.query<{
      dados_antigos: Record<string, unknown>;
      dados_novos: Record<string, unknown>;
    }>('SELECT dados_antigos, dados_novos FROM audit.audit_logs');

    expect(rows.rows[0]?.dados_antigos).toEqual({ status: 'DRAFT' });
    expect(rows.rows[0]?.dados_novos).toEqual({ status: 'PREPARED' });
  });

  it('rejeita tabela vazia sem persistir', async () => {
    await expect(
      inTransaction((tx) =>
        auditService.registrar(
          {
            tabela: '   ',
            registroId: crypto.randomUUID(),
            acao: AUDIT_ACTIONS.Create,
            dadosAntigos: null,
            dadosNovos: { status: 'DRAFT' },
            usuarioId: crypto.randomUUID(),
            correlationId: crypto.randomUUID(),
          },
          tx,
        ),
      ),
    ).rejects.toBeInstanceOf(AuditPersistenceError);

    expect(await countRows()).toBe(0);
  });
});
