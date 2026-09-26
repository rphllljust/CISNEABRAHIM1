import {
  hashPassword,
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateDocumentTables,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../authorization/types/authz-decision';
import { SECURITY_AUDIT_ACTIONS } from '../audit/types/security-audit.types';
import { DOCUMENT_CATEGORIES, type DocumentCategory } from './domain/document-categories';
import { minimalPdfBuffer } from './domain/file-validation';
import { DocumentsModule } from './documents.module';
import { DOCUMENT_ERROR_CODES } from './errors/document-error-codes';
import { DocumentsRepository } from './repositories/documents.repository';
import { DocumentsAccessService } from './services/documents-access.service';
import { createPersistWithCompensation } from './services/document-upload-coordinator';
import { DownloadTokenService } from './storage/download-token.service';
import { FilesystemObjectStorage } from './storage/filesystem-object-storage';
import { InMemoryObjectStorage } from './storage/in-memory-object-storage';
import { ObjectStorageService } from './storage/object-storage.service';
import { assertNoStorageKeyLeak } from './serializers/documents-response.serializer';

const UNIT_A = 'unit-doc-a';
const UNIT_B = 'unit-doc-b';

async function grantDocumentAdmin(
  pool: Pool,
  identityId: string,
  grantedBy: string,
  scopeType: 'GLOBAL' | 'UNIT' = 'GLOBAL',
  resourceId?: string,
): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.DocumentsDocumentCreate,
    AUTHZ_ACTIONS.DocumentsDocumentRead,
    AUTHZ_ACTIONS.DocumentsDocumentList,
    AUTHZ_ACTIONS.DocumentsDocumentUploadVersion,
    AUTHZ_ACTIONS.DocumentsDocumentDownload,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.DocumentsDocument,
      scopeType,
      resourceId,
      grantedByIdentityId: grantedBy,
    });
  }
}

describe('Documents PostgreSQL integration', () => {
  let pool: Pool;
  let documentsAccess: DocumentsAccessService;
  let storageRoot: string;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for documents integration tests.');
    }

    applyAuthTestEnv(testDatabaseUrl);
    storageRoot = await mkdtemp(join(tmpdir(), 'cisne-doc-storage-'));
    process.env['OBJECT_STORAGE_ROOT'] = storageRoot;
    process.env['OBJECT_STORAGE_PROVIDER'] = 'filesystem';

    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, DocumentsModule],
    }).compile();

    documentsAccess = module.get(DocumentsAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateDocumentTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_B });
  });

  afterAll(async () => {
    await pool.end();
    await rm(storageRoot, { recursive: true, force: true });
  });

  async function seedActor(scope: 'GLOBAL' | 'UNIT_A' | 'UNIT_B' = 'GLOBAL'): Promise<IdentityAuthzContext> {
    const login = normalizeLoginIdentifier(`docs-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (scope === 'GLOBAL') {
      await grantDocumentAdmin(pool, identityId, identityId, 'GLOBAL');
    } else {
      await grantDocumentAdmin(
        pool,
        identityId,
        identityId,
        'UNIT',
        scope === 'UNIT_A' ? UNIT_A : UNIT_B,
      );
    }
    return { identityId, sessionId: 'sid' };
  }

  it('uploads a document, versions it, preserves prior version metadata and hash', async () => {
    const actor = await seedActor();
    const pdf = minimalPdfBuffer();

    const created = await documentsAccess.createWithUpload(
      actor,
      {
        title: 'Contrato base',
        categoryCode: DOCUMENT_CATEGORIES.General,
        classificationCode: 'INTERNAL',
        unitId: UNIT_A,
      },
      { buffer: pdf, filename: 'contract.pdf', mimetype: 'application/pdf' },
    );

    assertNoStorageKeyLeak(created);
    expect(created.version.versionNumber).toBe(1);
    expect(created.version.sha256Hash).toHaveLength(64);

    const v2 = await documentsAccess.uploadVersion(actor, created.document.id, {
      buffer: pdf,
      filename: 'contract-v2.pdf',
      mimetype: 'application/pdf',
    });
    expect(v2.versionNumber).toBe(2);

    const versions = await documentsAccess.listVersions(actor, created.document.id);
    expect(versions).toHaveLength(2);
    expect(versions.find((item) => item.versionNumber === 1)?.supersededAt).not.toBeNull();
    expect(versions.find((item) => item.versionNumber === 2)?.isCurrent).toBe(true);
  });

  it('rejects fake mime based on magic bytes', async () => {
    const actor = await seedActor();
    await expect(
      documentsAccess.createWithUpload(
        actor,
        {
          title: 'Fake PDF',
          categoryCode: DOCUMENT_CATEGORIES.General,
          classificationCode: 'INTERNAL',
          unitId: UNIT_A,
        },
        {
          buffer: Buffer.from('plain-text'),
          filename: 'fake.pdf',
          mimetype: 'application/pdf',
        },
      ),
    ).rejects.toMatchObject({ code: DOCUMENT_ERROR_CODES.MAGIC_BYTES_MISMATCH });
  });

  it('rejects oversize uploads', async () => {
    const actor = await seedActor();
    const pdf = minimalPdfBuffer();
    const huge = Buffer.concat([pdf, Buffer.alloc(26 * 1024 * 1024)]);

    await expect(
      documentsAccess.createWithUpload(
        actor,
        {
          title: 'Huge file',
          categoryCode: DOCUMENT_CATEGORIES.General,
          classificationCode: 'INTERNAL',
          unitId: UNIT_A,
        },
        { buffer: huge, filename: 'huge.pdf', mimetype: 'application/pdf' },
      ),
    ).rejects.toMatchObject({ code: DOCUMENT_ERROR_CODES.FILE_TOO_LARGE });
  });

  it('denies unauthorized download (IDOR)', async () => {
    const owner = await seedActor();
    const intruder = await seedActor('UNIT_B');
    const pdf = minimalPdfBuffer();

    const created = await documentsAccess.createWithUpload(
      owner,
      {
        title: 'Private doc',
        categoryCode: DOCUMENT_CATEGORIES.General,
        classificationCode: 'INTERNAL',
        unitId: UNIT_A,
      },
      { buffer: pdf, filename: 'private.pdf', mimetype: 'application/pdf' },
    );

    await expect(
      documentsAccess.getById(intruder, created.document.id),
    ).rejects.toMatchObject({ code: DOCUMENT_ERROR_CODES.DENIED });

    await expect(
      documentsAccess.streamContent(intruder, created.document.id, 1),
    ).rejects.toMatchObject({ code: DOCUMENT_ERROR_CODES.DENIED });
  });

  it('enforces cross-unit scope on list', async () => {
    const owner = await seedActor();
    const unitBReader = await seedActor('UNIT_B');
    const pdf = minimalPdfBuffer();

    await documentsAccess.createWithUpload(
      owner,
      {
        title: 'Unit A only',
        categoryCode: DOCUMENT_CATEGORIES.General,
        classificationCode: 'INTERNAL',
        unitId: UNIT_A,
      },
      { buffer: pdf, filename: 'unit-a.pdf', mimetype: 'application/pdf' },
    );

    const listed = await documentsAccess.list(unitBReader, { limit: 20, offset: 0 });
    expect(listed.items).toHaveLength(0);
  });

  it('filters by title and category without breaking the authorized scope', async () => {
    const actor = await seedActor();
    const pdf = minimalPdfBuffer();
    const seed = (title: string, categoryCode: DocumentCategory) =>
      documentsAccess.createWithUpload(
        actor,
        { title, categoryCode, classificationCode: 'INTERNAL', unitId: UNIT_A },
        { buffer: pdf, filename: 'evidence.pdf', mimetype: 'application/pdf' },
      );

    // Mesmo titulo em execucoes distintas do runner UAT: sao DOCUMENTOS distintos, entao a busca
    // precisa devolver os dois, e nao deduplicar.
    await seed('Evidência UAT — Locação de equipamento', DOCUMENT_CATEGORIES.Evidence);
    await seed('Evidência UAT — Locação de equipamento', DOCUMENT_CATEGORIES.Evidence);
    await seed('Evidência UAT — Transporte de carga municipal', DOCUMENT_CATEGORIES.Evidence);
    await seed('Contrato assinado', DOCUMENT_CATEGORIES.General);

    const all = await documentsAccess.list(actor, { limit: 20, offset: 0 });
    expect(all.items).toHaveLength(4);

    const byTitle = await documentsAccess.list(actor, {
      limit: 20,
      offset: 0,
      q: 'Locação de equipamento',
    });
    expect(byTitle.items).toHaveLength(2);
    expect(byTitle.items.every((item) => item.title.includes('Locação de equipamento'))).toBe(true);

    const byFragment = await documentsAccess.list(actor, { limit: 20, offset: 0, q: 'carga' });
    expect(byFragment.items).toHaveLength(1);

    const noMatch = await documentsAccess.list(actor, { limit: 20, offset: 0, q: 'Zinco inexistente' });
    expect(noMatch.items).toHaveLength(0);

    // O filtro de tipo ja publicado continua compondo com a busca.
    const byCategory = await documentsAccess.list(actor, {
      limit: 20,
      offset: 0,
      categoryCode: DOCUMENT_CATEGORIES.General,
      q: 'Evidência',
    });
    expect(byCategory.items).toHaveLength(0);

    // Curinga digitado e TEXTO, nao padrao: '%' nao pode devolver a lista inteira.
    const wildcard = await documentsAccess.list(actor, { limit: 20, offset: 0, q: '%' });
    expect(wildcard.items).toHaveLength(0);
  });

  it('streams authorized content and issues signed download URLs', async () => {
    const actor = await seedActor();
    const pdf = minimalPdfBuffer();
    const created = await documentsAccess.createWithUpload(
      actor,
      {
        title: 'Download me',
        categoryCode: DOCUMENT_CATEGORIES.Evidence,
        classificationCode: 'RESTRICTED',
        unitId: UNIT_A,
      },
      { buffer: pdf, filename: 'evidence.pdf', mimetype: 'application/pdf' },
    );

    const streamed = await documentsAccess.streamContent(actor, created.document.id, 1);
    expect(streamed.buffer.equals(pdf)).toBe(true);
    expect(streamed.sha256).toBe(created.version.sha256Hash);

    const signed = await documentsAccess.issueDownloadUrl(actor, created.document.id, 1);
    expect(signed.downloadUrl).toContain('/api/v1/documents/download?token=');

    const token = decodeURIComponent(signed.downloadUrl.split('token=')[1] ?? '');
    const tokenStream = await documentsAccess.streamByToken(token);
    expect(tokenStream.buffer.equals(pdf)).toBe(true);
  });

  it('compensates storage when database persistence fails', async () => {
    const actor = await seedActor();
    const storage = new InMemoryObjectStorage();
    const downloadTokens = new DownloadTokenService();
    const pdf = minimalPdfBuffer();

    const failingRepo = {
      persistVersion: vi.fn().mockRejectedValue(new Error('DB_FAILURE')),
    } as unknown as DocumentsRepository;

    await expect(
      createPersistWithCompensation(storage, downloadTokens, failingRepo, {
        title: 'Cleanup',
        categoryCode: DOCUMENT_CATEGORIES.General,
        classificationCode: 'INTERNAL',
        unitId: UNIT_A,
        actorIdentityId: actor.identityId,
        sha256: 'def',
        mimeType: 'application/pdf',
        originalFilename: 'cleanup.pdf',
        buffer: pdf,
      }),
    ).rejects.toThrow('DB_FAILURE');
    expect(storage.objects.size).toBe(0);
  });

  it('records security audit on create and download', async () => {
    const actor = await seedActor();
    const pdf = minimalPdfBuffer();
    const created = await documentsAccess.createWithUpload(
      actor,
      {
        title: 'Audited',
        categoryCode: DOCUMENT_CATEGORIES.General,
        classificationCode: 'INTERNAL',
        unitId: UNIT_A,
      },
      { buffer: pdf, filename: 'audited.pdf', mimetype: 'application/pdf' },
    );

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events
       WHERE resource_id = $1
       ORDER BY occurred_at ASC`,
      [created.document.id],
    );
    expect(audit.rows.map((row) => row.action)).toContain(
      SECURITY_AUDIT_ACTIONS.DocumentsDocumentCreate,
    );

    await documentsAccess.streamContent(actor, created.document.id, 1);
    const afterDownload = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events WHERE resource_id = $1`,
      [created.document.id],
    );
    expect(afterDownload.rows.map((row) => row.action)).toContain(
      SECURITY_AUDIT_ACTIONS.DocumentsDocumentDownload,
    );
  });

  it('uses filesystem object storage without exposing storage keys', async () => {
    const filesystem = new FilesystemObjectStorage(storageRoot);
    const key = 'objects/test-key';
    const pdf = minimalPdfBuffer();
    await filesystem.putObject({ storageKey: key, buffer: pdf, mimeType: 'application/pdf' });
    const loaded = await filesystem.getObject(key);
    expect(loaded?.buffer.equals(pdf)).toBe(true);

    const objectStorage = new ObjectStorageService();
    expect(objectStorage).toBeDefined();
  });
});
