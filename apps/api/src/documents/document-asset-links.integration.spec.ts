import {
  ensureOperationalLaborTypesBaseline,
  ensurePhysicalResourceTypesBaseline,
  ensureUnitsOfMeasureBaseline,
  hashPassword,
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateCatalogTables,
  truncateDocumentTables,
  truncateIdentityAndAuthorizationTables,
  truncatePhysicalAssetTables,
} from '@cisne/database';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { SecurityAuditService } from '../audit/services/security-audit.service';
import { SECURITY_AUDIT_ACTIONS } from '../audit/types/security-audit.types';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { DocumentsAccessService } from '../documents/services/documents-access.service';
import { DOCUMENT_CATEGORIES } from '../documents/domain/document-categories';
import { minimalPdfBuffer } from '../documents/domain/file-validation';
import { ResourcesModule } from '../resources/resources.module';
import { PhysicalAssetDocumentsService } from '../resources/services/physical-asset-documents.service';
import { PhysicalAssetsAccessService } from '../resources/services/physical-assets-access.service';
import { PhysicalResourceTypesAccessService } from '../resources/services/physical-resource-types-access.service';

const UNIT_A = 'ged-asset-unit-a';
const UNIT_B = 'ged-asset-unit-b';

describe('E05/E06 authoritative document ↔ asset PostgreSQL integration', () => {
  let pool: Pool;
  let storageRoot: string;
  let assets: PhysicalAssetsAccessService;
  let types: PhysicalResourceTypesAccessService;
  let documents: DocumentsAccessService;
  let links: PhysicalAssetDocumentsService;
  let audit: SecurityAuditService;

  beforeAll(async () => {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) throw new Error('TEST_DATABASE_URL is required');
    applyAuthTestEnv(url);
    storageRoot = await mkdtemp(join(tmpdir(), 'cisne-asset-doc-links-'));
    process.env['OBJECT_STORAGE_ROOT'] = storageRoot;
    process.env['OBJECT_STORAGE_PROVIDER'] = 'filesystem';
    const app = await Test.createTestingModule({ imports: [ResourcesModule] }).compile();
    assets = app.get(PhysicalAssetsAccessService);
    types = app.get(PhysicalResourceTypesAccessService);
    documents = app.get(DocumentsAccessService);
    links = app.get(PhysicalAssetDocumentsService);
    audit = app.get(SecurityAuditService);
    pool = new Pool({ connectionString: url });
  });

  beforeEach(async () => {
    await truncateDocumentTables(pool);
    await truncatePhysicalAssetTables(pool);
    await truncateCatalogTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_B });
  });

  afterAll(async () => {
    await pool.end();
    await rm(storageRoot, { recursive: true, force: true });
  });

  async function actor(options: { documentRead?: boolean } = {}) {
    const login = normalizeLoginIdentifier(`ged-asset-${crypto.randomUUID()}@cisne.invalid`);
    const { identityId } = await insertIdentity(pool, login, await hashPassword(AUTH_TEST_PASSWORD));
    const resourceTypeActions = [
      AUTHZ_ACTIONS.ResourcesResourceTypeList,
      AUTHZ_ACTIONS.ResourcesResourceTypeRead,
    ];
    const assetActions = [
      AUTHZ_ACTIONS.ResourcesAssetCreate,
      AUTHZ_ACTIONS.ResourcesAssetRead,
      AUTHZ_ACTIONS.ResourcesAssetList,
      AUTHZ_ACTIONS.ResourcesAssetUpdate,
    ];
    const docActions = [
      AUTHZ_ACTIONS.DocumentsDocumentCreate,
      AUTHZ_ACTIONS.DocumentsDocumentList,
      AUTHZ_ACTIONS.DocumentsDocumentUploadVersion,
      ...(options.documentRead === false ? [] : [AUTHZ_ACTIONS.DocumentsDocumentRead]),
    ];
    for (const action of resourceTypeActions) {
      await insertGrant(pool, {
        identityId, grantedByIdentityId: identityId, action,
        resourceType: AUTHZ_RESOURCE_TYPES.ResourcesResourceType, scopeType: 'GLOBAL',
      });
    }
    for (const action of assetActions) {
      await insertGrant(pool, {
        identityId, grantedByIdentityId: identityId, action,
        resourceType: AUTHZ_RESOURCE_TYPES.ResourcesAsset, scopeType: 'GLOBAL',
      });
    }
    for (const action of docActions) {
      await insertGrant(pool, {
        identityId, grantedByIdentityId: identityId, action,
        resourceType: AUTHZ_RESOURCE_TYPES.DocumentsDocument, scopeType: 'GLOBAL',
      });
    }
    return { identityId, sessionId: 'sid' };
  }

  async function assetIdFor(a: { identityId: string; sessionId: string }, unitId: string) {
    const type = (await types.list(a, { limit: 50, offset: 0 }))
      .items.find((item) => item.code === 'EXCAVATOR');
    if (!type) throw new Error('EXCAVATOR resource type missing');
    const created = await assets.create(a, {
      assetCode: `ASSET-${crypto.randomUUID()}`, resourceTypeId: type.id,
      name: 'Equipamento real teste isolado', unitId,
    });
    return created.id;
  }

  async function documentIdFor(a: { identityId: string; sessionId: string }, unitId: string) {
    const created = await documents.createWithUpload(
      a,
      {
        title: 'Documento físico de teste',
        categoryCode: DOCUMENT_CATEGORIES.General,
        classificationCode: 'INTERNAL',
        unitId,
      },
      { buffer: minimalPdfBuffer(), filename: 'asset.pdf', mimetype: 'application/pdf' },
    );
    return created.document.id;
  }

  it('persists one idempotent link while preserving the GED file/version master', async () => {
    const owner = await actor();
    const assetId = await assetIdFor(owner, UNIT_A);
    const documentId = await documentIdFor(owner, UNIT_A);
    const first = await links.attach(owner, assetId, documentId);
    const second = await links.attach(owner, assetId, documentId);
    expect(first.attached).toBe(true);
    expect(second.attached).toBe(false);
    const listed = await links.list(owner, assetId);
    expect(listed.items.map((d) => d.id)).toEqual([documentId]);
    const relation = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM doc.physical_asset_document_links WHERE physical_asset_id = $1',
      [assetId],
    );
    expect(relation.rows[0]?.count).toBe('1');
    const auditRows = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM audit.security_audit_events
        WHERE action = $1 AND resource_id = $2`,
      [SECURITY_AUDIT_ACTIONS.DocumentsDocumentLinkAsset, documentId],
    );
    expect(auditRows.rows[0]?.count).toBe('1');
    const versions = await documents.listVersions(owner, documentId);
    expect(versions).toHaveLength(1);
  });

  it('rolls back the GED link when mandatory critical audit persistence fails', async () => {
    const owner = await actor();
    const assetId = await assetIdFor(owner, UNIT_A);
    const documentId = await documentIdFor(owner, UNIT_A);
    const failure = vi.spyOn(audit, 'recordCritical').mockRejectedValueOnce(
      new Error('simulated audit write failure'),
    );
    try {
      await expect(links.attach(owner, assetId, documentId)).rejects.toThrow(
        'simulated audit write failure',
      );
    } finally {
      failure.mockRestore();
    }
    const rows = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM doc.physical_asset_document_links WHERE physical_asset_id = $1',
      [assetId],
    );
    expect(rows.rows[0]?.count).toBe('0');
  });

  it('rejects linking documents across units, even with global grants', async () => {
    const owner = await actor();
    const assetId = await assetIdFor(owner, UNIT_A);
    const otherUnitDocument = await documentIdFor(owner, UNIT_B);
    await expect(links.attach(owner, assetId, otherUnitDocument)).rejects.toMatchObject({
      status: 403,
    });
    expect((await links.list(owner, assetId)).items).toEqual([]);
  });

  it('does not return document metadata when GED READ is absent', async () => {
    const owner = await actor();
    const assetId = await assetIdFor(owner, UNIT_A);
    const documentId = await documentIdFor(owner, UNIT_A);
    await links.attach(owner, assetId, documentId);
    const viewer = await actor({ documentRead: false });
    const response = await links.list(viewer, assetId);
    expect(response.items).toEqual([]);
    expect(JSON.stringify(response)).not.toContain(documentId);
    expect(JSON.stringify(response)).not.toContain('Documento físico de teste');
  });
});
