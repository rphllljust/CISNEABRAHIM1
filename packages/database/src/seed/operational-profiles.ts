import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { ensureOperationalLaborTypesBaseline } from '../catalog/operational-labor-types-baseline';
import { withTransaction } from '../transaction';
import { assertDevelopmentOnly } from './environment';
import { hashPassword } from './password-policy';

export const ABRAHIM_OWNER_LOGIN = 'abrahim@cisne-rondonia.invalid';
export const MONICA_OWNER_LOGIN = 'monica@cisne-rondonia.invalid';
/**
 * Desenvolvedor estatico com acesso GLOBAL de desenvolvimento (decisao registrada em
 * 2026-09-25, prompt-execution-log). NAO e o empregado operacional: um mesmo login nao pode
 * ser, ao mesmo tempo, "acesso global de desenvolvimento" e "somente ASSIGNED". O empregado
 * operacional tem login proprio (`EMPREGADO_LOGIN`). As credenciais, o papel e o conjunto
 * GLOBAL deste perfil sao aplicados por `scripts/repair-dev-login.mjs`, que enxerga o
 * catalogo de actions da API — `packages/database` nao depende de `apps/api`.
 */
export const RAFAEL_DEVELOPER_LOGIN = 'rafael@cisne-rondonia.invalid';
export const CONTROLE_LOGIN = ABRAHIM_OWNER_LOGIN;
export const CONTROLE_FINANCEIRO_LOGIN = MONICA_OWNER_LOGIN;
/** Empregado operacional: somente as ordens atribuidas a ele (escopo ASSIGNED). */
export const EMPREGADO_LOGIN = 'empregado@cisne-rondonia.invalid';
export const CONTROLE_ROLE_CODE = 'OWNER';
export const CONTROLE_FINANCEIRO_ROLE_CODE = 'OWNER';
export const EMPREGADO_ROLE_CODE = 'EMPREGADO';
export const EMPREGADO_MEMBER_CODE = 'EMP-DEV-001';
export const OPERATIONAL_UNIT_REF = 'UN-DEV-001';

type GrantSpec = {
  action: string;
  resourceType: string;
  scopeType?: 'GLOBAL' | 'ASSIGNED';
};

function grant(
  action: string,
  resourceType: string,
  scopeType: GrantSpec['scopeType'] = 'GLOBAL',
): GrantSpec {
  return { action, resourceType, scopeType };
}

const CONTROLE_GRANTS: GrantSpec[] = [
  grant('client:client:create', 'client:client'),
  grant('client:client:read', 'client:client'),
  grant('client:client:list', 'client:client'),
  grant('client:client:update', 'client:client'),
  grant('catalog:service:create', 'catalog:service'),
  grant('catalog:service:read', 'catalog:service'),
  grant('catalog:service:list', 'catalog:service'),
  grant('catalog:service:update', 'catalog:service'),
  grant('catalog:service:publish', 'catalog:service'),
  grant('requests:service-request:create', 'requests:service-request'),
  grant('requests:service-request:read', 'requests:service-request'),
  grant('requests:service-request:list', 'requests:service-request'),
  grant('requests:service-request:update', 'requests:service-request'),
  grant('requests:service-request:submit', 'requests:service-request'),
  grant('requests:service-request:review', 'requests:service-request'),
  grant('requests:service-request:approve', 'requests:service-request'),
  grant('requests:service-request:reject', 'requests:service-request'),
  grant('requests:service-request:convert', 'requests:service-request'),
  // Propostas e PO do cliente: IN_RELEASE_1 (docs/01-foundation/release-1-closed-scope.md).
  // Sem estes grants o modulo comercial fica invisivel na navegacao (accessCheck por
  // capability) e o fluxo proposta -> PO -> solicitacao nao e executavel pela UI.
  // Alinhado ao perfil autoritativo control_admin (apps/api/src/uat/uat-profiles.ts).
  grant('commercial:proposal:create', 'commercial:proposal'),
  grant('commercial:proposal:read', 'commercial:proposal'),
  grant('commercial:proposal:list', 'commercial:proposal'),
  grant('commercial:proposal:update', 'commercial:proposal'),
  grant('commercial:proposal:issue', 'commercial:proposal'),
  grant('commercial:proposal:accept', 'commercial:proposal'),
  grant('commercial:proposal:reject', 'commercial:proposal'),
  grant('commercial:proposal:expire', 'commercial:proposal'),
  grant('commercial:proposal:cancel', 'commercial:proposal'),
  grant('commercial:purchase-order:create', 'commercial:purchase-order'),
  grant('commercial:purchase-order:read', 'commercial:purchase-order'),
  grant('commercial:purchase-order:list', 'commercial:purchase-order'),
  grant('commercial:purchase-order:update', 'commercial:purchase-order'),
  grant('commercial:purchase-order:register', 'commercial:purchase-order'),
  grant('commercial:purchase-order:cancel', 'commercial:purchase-order'),
  grant('commercial:purchase-order:authorize-overrun', 'commercial:purchase-order'),
  grant('service-orders:service-order:create', 'service-orders:service-order'),
  grant('service-orders:service-order:read', 'service-orders:service-order'),
  grant('service-orders:service-order:list', 'service-orders:service-order'),
  grant('service-orders:service-order:update', 'service-orders:service-order'),
  grant('service-orders:service-order:prepare', 'service-orders:service-order'),
  grant('service-orders:service-order:release', 'service-orders:service-order'),
  grant('service-orders:planned-resource:plan', 'service-orders:service-order'),
  grant('service-orders:planned-resource:read', 'service-orders:service-order'),
  grant('service-orders:planned-resource:update', 'service-orders:service-order'),
  grant('service-orders:planned-resource:remove', 'service-orders:service-order'),
  grant('service-orders:resource-allocation:allocate', 'service-orders:service-order'),
  grant('service-orders:resource-allocation:read', 'service-orders:service-order'),
  grant('service-orders:resource-allocation:remove', 'service-orders:service-order'),
  grant('service-orders:execution:read', 'service-orders:service-order'),
  // Contabilidade: conjunto alinhado ao perfil autoritativo de operador empresarial
  // (apps/api/src/enterprise-integrity/enterprise-integrity-harness.ts, ENTERPRISE_GRANTS)
  // e completado com as acoes das superficies de contabilidade existentes (periodos,
  // reversao, regras de contabilizacao e ativo imobilizado).
  grant('accounting:chart:manage', 'accounting:ledger'),
  grant('accounting:period:open', 'accounting:ledger'),
  grant('accounting:period:close', 'accounting:ledger'),
  grant('accounting:period:reopen', 'accounting:ledger'),
  grant('accounting:journal:draft', 'accounting:ledger'),
  grant('accounting:journal:post', 'accounting:ledger'),
  grant('accounting:journal:reverse', 'accounting:ledger'),
  grant('accounting:journal:read', 'accounting:ledger'),
  grant('accounting:journal:list', 'accounting:ledger'),
  grant('accounting:posting-rule:manage', 'accounting:ledger'),
  grant('accounting:posting-rule:publish', 'accounting:ledger'),
  grant('accounting:posting-request:create', 'accounting:ledger'),
  grant('accounting:fixed-asset:register', 'accounting:ledger'),
  grant('accounting:fixed-asset:acquire', 'accounting:ledger'),
  grant('accounting:fixed-asset:dispose', 'accounting:ledger'),
  grant('accounting:fixed-asset:transfer', 'accounting:ledger'),
  grant('accounting:fixed-asset:reverse', 'accounting:ledger'),
  grant('accounting:fixed-asset:read', 'accounting:ledger'),
  // Fiscal: documento fiscal, motor tributario, apuracao e fechamento fiscal. Nao habilita
  // transmissao real (o credenciamento permanece fail-closed em SRC-006/BR-043..BR-045).
  grant('fiscal:document:draft', 'fiscal:document'),
  grant('fiscal:document:submit', 'fiscal:document'),
  grant('fiscal:document:cancel', 'fiscal:document'),
  grant('fiscal:document:read', 'fiscal:document'),
  grant('fiscal:document:list', 'fiscal:document'),
  grant('fiscal:tax:read', 'fiscal:tax-engine'),
  grant('fiscal:tax:calculate', 'fiscal:tax-engine'),
  grant('fiscal:tax-rule:manage', 'fiscal:tax-engine'),
  grant('fiscal:tax-assessment:read', 'fiscal:tax-engine'),
  grant('fiscal:tax-assessment:create', 'fiscal:tax-engine'),
  grant('fiscal:tax-assessment:finalize', 'fiscal:tax-engine'),
  grant('fiscal:tax-assessment:adjust', 'fiscal:tax-engine'),
  grant('fiscal:tax-assessment:cancel', 'fiscal:tax-engine'),
  grant('fiscal:period:open', 'fiscal:period'),
  grant('fiscal:period:read', 'fiscal:period'),
  grant('fiscal:period:close', 'fiscal:period'),
  grant('fiscal:period:reopen', 'fiscal:period'),
  grant('people:person:read', 'people:person'),
  grant('people:person:list', 'people:person'),
  // Recursos fisicos: sem isto o passo "planejar -> alocar ativo" do fluxo operacional
  // nao e executavel pela UI (a lista de ativos compativeis responde 403). Alinhado ao
  // perfil autoritativo control_admin (apps/api/src/uat/uat-profiles.ts).
  grant('resources:asset:create', 'resources:asset'),
  grant('resources:asset:read', 'resources:asset'),
  grant('resources:asset:list', 'resources:asset'),
  grant('resources:asset:update', 'resources:asset'),
  grant('resources:asset:deactivate', 'resources:asset'),
  grant('resources:resource-type:read', 'resources:resource-type'),
  grant('resources:resource-type:list', 'resources:resource-type'),
  grant('measurements:measurement:create', 'service-orders:service-order'),
  grant('measurements:measurement:read', 'service-orders:service-order'),
  grant('measurements:measurement:update', 'service-orders:service-order'),
  grant('measurements:measurement:submit', 'service-orders:service-order'),
  grant('measurements:measurement:review', 'service-orders:service-order'),
  grant('measurements:measurement:approve', 'service-orders:service-order'),
  grant('measurements:measurement:reject', 'service-orders:service-order'),
  grant('billing:billing-record:prepare', 'service-orders:service-order'),
  grant('billing:billing-record:read', 'service-orders:service-order'),
  grant('billing:billing-document:issue', 'service-orders:service-order'),
  grant('billing:billing-document:read', 'service-orders:service-order'),
  grant('billing:billing-document:cancel', 'service-orders:service-order'),
  grant('finance:receivable:read', 'finance:receivable'),
  grant('finance:receivable:list', 'finance:receivable'),
  grant('finance:receivable:settle', 'finance:receivable'),
  grant('documents:document:create', 'documents:document'),
  grant('documents:document:read', 'documents:document'),
  grant('documents:document:list', 'documents:document'),
  grant('documents:document:upload-version', 'documents:document'),
  grant('documents:document:download', 'documents:document'),
];

/**
 * Empregado operacional: somente as ordens atribuidas a ele (escopo ASSIGNED) e o minimo
 * para executar o servico (evidencia/documento e leitura de ativo/insumo). Nunca
 * financeiro, contabil, fiscal, comercial ou administrativo — e nunca GLOBAL sobre OS.
 * Alinhado ao perfil autoritativo `executor` (apps/api/src/uat/uat-profiles.ts).
 */
const EMPREGADO_GRANTS: GrantSpec[] = [
  grant('service-orders:service-order:read', 'service-orders:service-order', 'ASSIGNED'),
  grant('service-orders:service-order:list', 'service-orders:service-order', 'ASSIGNED'),
  grant('service-orders:execution:read', 'service-orders:service-order', 'ASSIGNED'),
  grant('service-orders:execution:start', 'service-orders:service-order', 'ASSIGNED'),
  grant('service-orders:execution:complete', 'service-orders:service-order', 'ASSIGNED'),
  grant('service-orders:execution:record', 'service-orders:service-order', 'ASSIGNED'),
  grant('service-orders:resource-allocation:read', 'service-orders:service-order', 'ASSIGNED'),
  grant('documents:document:create', 'documents:document'),
  grant('documents:document:read', 'documents:document'),
  grant('resources:asset:read', 'resources:asset'),
  grant('resources:resource-type:list', 'resources:resource-type'),
];

export type OperationalProfilesInput = {
  controlePassword: string;
  controleFinanceiroPassword?: string;
  empregadoPassword: string;
};

export type OperationalProfilesResult = {
  controleLogin: string;
  controleFinanceiroLogin: string;
  empregadoLogin: string;
  controleIdentityId: string;
  controleFinanceiroIdentityId: string;
  empregadoIdentityId: string;
  workforceMemberId: string;
  controleGrants: number;
  controleFinanceiroGrants: number;
  empregadoGrants: number;
};

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

async function ensureIdentity(
  pool: Pool,
  login: string,
  password: string,
): Promise<{ identityId: string; created: boolean }> {
  const normalized = normalizeLogin(login);
  const existing = await pool.query<{ identity_id: string }>(
    `SELECT identity_id
     FROM identity.credentials
     WHERE login_identifier_normalized = $1
       AND revoked_at IS NULL`,
    [normalized],
  );
  const found = existing.rows[0]?.identity_id;
  if (found) {
    const passwordHash = await hashPassword(password);
    await pool.query(
      `UPDATE identity.credentials
       SET password_hash = $2
       WHERE identity_id = $1
         AND revoked_at IS NULL`,
      [found, passwordHash],
    );
    return { identityId: found, created: false };
  }

  const identityId = randomUUID();
  const passwordHash = await hashPassword(password);
  await pool.query(`INSERT INTO identity.identities (id, status) VALUES ($1, 'active')`, [
    identityId,
  ]);
  await pool.query(
    `INSERT INTO identity.credentials (id, identity_id, login_identifier_normalized, password_hash)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), identityId, normalized, passwordHash],
  );
  return { identityId, created: true };
}

async function ensureRole(
  pool: Pool,
  code: string,
  label: string,
  description: string,
  createdBy: string,
  capabilities: string[],
): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM "authorization".access_roles WHERE code = $1`,
    [code],
  );
  let roleId = existing.rows[0]?.id;
  if (!roleId) {
    roleId = randomUUID();
    await pool.query(
      `INSERT INTO "authorization".access_roles
         (id, code, label, description, status, created_by_identity_id)
       VALUES ($1, $2, $3, $4, 'ACTIVE', $5)`,
      [roleId, code, label, description, createdBy],
    );
  }
  for (const capability of capabilities) {
    await pool.query(
      `INSERT INTO "authorization".access_role_capabilities
         (id, role_id, capability, added_by_identity_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (role_id, capability) DO NOTHING`,
      [randomUUID(), roleId, capability, createdBy],
    );
  }
  return roleId;
}

async function ensureAssignment(
  pool: Pool,
  roleId: string,
  identityId: string,
  assignedBy: string,
): Promise<void> {
  const existing = await pool.query(
    `SELECT 1
     FROM "authorization".access_role_assignments
     WHERE identity_id = $1
       AND role_id = $2
       AND scope_type = 'GLOBAL'
       AND revoked_at IS NULL`,
    [identityId, roleId],
  );
  if (existing.rowCount && existing.rowCount > 0) {
    return;
  }
  await pool.query(
    `INSERT INTO "authorization".access_role_assignments
       (id, role_id, identity_id, scope_type, assigned_by_identity_id)
     VALUES ($1, $2, $3, 'GLOBAL', $4)`,
    [randomUUID(), roleId, identityId, assignedBy],
  );
}

async function ensureGrants(
  pool: Pool,
  identityId: string,
  grantedBy: string,
  grants: GrantSpec[],
): Promise<number> {
  let inserted = 0;
  for (const grant of grants) {
    const scopeType = grant.scopeType ?? 'GLOBAL';
    const existing = await pool.query(
      `SELECT 1
       FROM "authorization".grants
       WHERE identity_id = $1
         AND action = $2
         AND resource_type = $3
         AND scope_type = $4::"authorization".authz_scope_type
         AND resource_id IS NULL
         AND revoked_at IS NULL`,
      [identityId, grant.action, grant.resourceType, scopeType],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      continue;
    }
    await pool.query(
      `INSERT INTO "authorization".grants
         (id, identity_id, action, resource_type, scope_type, granted_by_identity_id)
       VALUES ($1, $2, $3, $4, $5::"authorization".authz_scope_type, $6)`,
      [randomUUID(), identityId, grant.action, grant.resourceType, scopeType, grantedBy],
    );
    inserted += 1;
  }
  return inserted;
}

async function ensureDevPaymentMatrix(pool: Pool, actorIdentityId: string): Promise<void> {
  const publishedRule = await pool.query(
    `SELECT 1
       FROM "authorization".approval_matrix_rules rule
       JOIN "authorization".approval_matrix_versions version ON version.id = rule.version_id
      WHERE version.status = 'PUBLISHED'
        AND rule.operation = 'PAYMENT'
        AND rule.capability = 'payment.approve'
      LIMIT 1`,
  );
  if (publishedRule.rowCount) {
    return;
  }

  // Idempotencia ancorada nas constraints do banco (nao numa leitura previa): a matriz e
  // obtida pelo natural key `code`, a versao por `(matrix_id, version)` e a regra por
  // `(version_id, line_number)`.
  //
  // Defeito real corrigido: a guarda acima olha a REGRA publicada, mas a unicidade da matriz e
  // do `code`. Uma matriz orfa — versoes e regras removidas em cascata por um truncate de
  // `identity.identities` (FK created_by/published_by), que nao alcanca
  // `authorization.approval_matrices` por ela nao ter FK para identidades — fazia a guarda passar
  // e o INSERT estourar "duplicate key value violates unique constraint
  // approval_matrices_code_uidx". O seed deixa de convergir e o gate de integracao fica vermelho.
  //
  // Atomicidade: matriz -> versao -> regra -> atualizacao da matriz e UMA operacao logica
  // (matriz publicada com a regra de aprovacao de pagamento). Sem transacao, uma falha no meio
  // deixava estado parcial commitado — versao PUBLISHED sem regra nenhuma e `published_version`
  // ainda NULL —, ou seja, uma matriz exibida como publicada no console de aprovacoes que nao
  // aprova nada, porque o PDP resolve regras por `approval_matrix_rules` publicadas.
  const MATRIX_CODE = 'DEV-PAYMENT-MATRIX';
  await withTransaction(pool, async (client) => {
    const insertedMatrix = await client.query<{ id: string }>(
      `INSERT INTO "authorization".approval_matrices (code, currency_code)
         VALUES ($1, 'BRL')
       ON CONFLICT (code) DO NOTHING
       RETURNING id`,
      [MATRIX_CODE],
    );
    let matrixId = insertedMatrix.rows[0]?.id;
    if (!matrixId) {
      const found = await client.query<{ id: string }>(
        `SELECT id FROM "authorization".approval_matrices WHERE code = $1`,
        [MATRIX_CODE],
      );
      matrixId = found.rows[0]?.id;
    }
    if (!matrixId) {
      throw new Error('DEV_PAYMENT_MATRIX_INSERT_FAILED');
    }

    // Versao publicada: reutiliza a existente quando houver. Nunca publica uma segunda versao da
    // mesma matriz (approval_matrix_versions_one_published_uidx).
    const publishedVersion = await client.query<{ id: string }>(
      `SELECT id
         FROM "authorization".approval_matrix_versions
        WHERE matrix_id = $1 AND status = 'PUBLISHED'
        ORDER BY version
        LIMIT 1`,
      [matrixId],
    );
    let versionId = publishedVersion.rows[0]?.id;
    if (!versionId) {
      const anyVersion = await client.query<{ id: string }>(
        `SELECT id
           FROM "authorization".approval_matrix_versions
          WHERE matrix_id = $1
          ORDER BY version
          LIMIT 1`,
        [matrixId],
      );
      versionId = anyVersion.rows[0]?.id;
      if (versionId) {
        await client.query(
          `UPDATE "authorization".approval_matrix_versions
              SET status = 'PUBLISHED'::"authorization".approval_matrix_status,
                  published_at = COALESCE(published_at, NOW()),
                  published_by_identity_id = COALESCE(published_by_identity_id, $2)
            WHERE id = $1`,
          [versionId, actorIdentityId],
        );
      } else {
        const version = await client.query<{ id: string }>(
          `INSERT INTO "authorization".approval_matrix_versions
               (matrix_id, version, status, created_by_identity_id, published_by_identity_id, published_at)
             VALUES ($1, 1, 'PUBLISHED', $2, $2, NOW())
             RETURNING id`,
          [matrixId, actorIdentityId],
        );
        versionId = version.rows[0]?.id;
      }
    }
    if (!versionId) {
      throw new Error('DEV_PAYMENT_MATRIX_VERSION_FAILED');
    }

    await client.query(
      `INSERT INTO "authorization".approval_matrix_rules
           (version_id, operation, role_code, capability, scope_type, scope_anchor, amount_limit, line_number)
         VALUES ($1, 'PAYMENT'::"authorization".approval_operation, 'FINANCIAL_CONTROLLER', 'payment.approve', 'GLOBAL'::"authorization".authz_scope_type, NULL, '999999999.0000', 1)
       ON CONFLICT (version_id, line_number) DO NOTHING`,
      [versionId],
    );
    await client.query(
      `UPDATE "authorization".approval_matrices
           SET published_version = 1, draft_version = 1, updated_at = NOW()
         WHERE id = $1`,
      [matrixId],
    );
  });
}

async function ensureWorkforceMember(pool: Pool, identityId: string): Promise<string> {
  await ensureOperationalLaborTypesBaseline(pool);
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM wrk.workforce_members WHERE member_code = $1`,
    [EMPREGADO_MEMBER_CODE],
  );
  const found = existing.rows[0]?.id;
  if (found) {
    // O membro operacional segue SEMPRE o identity do login atual: um relink de login
    // anterior (ex.: empregado@ -> rafael@) nao pode deixar o vinculo apontando para uma
    // identidade orfa. Idempotente (repetir aplica o mesmo valor).
    await pool.query(
      `UPDATE wrk.workforce_members
       SET identity_id = $2, updated_at = NOW()
       WHERE id = $1`,
      [found, identityId],
    );
    return found;
  }
  const id = randomUUID();
  await pool.query(
    `INSERT INTO wrk.workforce_members
       (id, member_code, legal_name, preferred_name, default_labor_type_code, identity_id, status)
     VALUES ($1, $2, $3, $4, 'OPERATOR', $5, 'ACTIVE')`,
    [id, EMPREGADO_MEMBER_CODE, 'Empregado operacional', 'Empregado', identityId],
  );
  return id;
}

/**
 * Perfis minimos de desenvolvimento: CONTROLE, CONTROLE_FINANCEIRO e EMPREGADO.
 * Grants GLOBAL sao o que os servicos de OS/financeiro consultam alem do PDP.
 * Nao atribui OS a ninguem.
 *
 * O desenvolvedor com acesso global (`RAFAEL_DEVELOPER_LOGIN`) NAO entra aqui: ele recebe
 * todas as actions do catalogo, que este pacote nao enxerga (ver `repair-dev-login.mjs`).
 */
export async function runOperationalProfilesSeed(
  pool: Pool,
  input: OperationalProfilesInput,
): Promise<OperationalProfilesResult> {
  assertDevelopmentOnly('OPERATIONAL_PROFILES_SEED');

  const controle = await ensureIdentity(pool, CONTROLE_LOGIN, input.controlePassword);
  const controleFinanceiro = await ensureIdentity(
    pool,
    CONTROLE_FINANCEIRO_LOGIN,
    input.controleFinanceiroPassword ?? input.controlePassword,
  );
  const empregado = await ensureIdentity(pool, EMPREGADO_LOGIN, input.empregadoPassword);

  const controleRole = await ensureRole(
    pool,
    CONTROLE_ROLE_CODE,
    'Dono',
    'Perfil estático de dono com acesso global de desenvolvimento.',
    controle.identityId,
    CONTROLE_GRANTS.map((grant) => grant.action),
  );
  const empregadoRole = await ensureRole(
    pool,
    EMPREGADO_ROLE_CODE,
    'Empregado',
    'Perfil estático do empregado operacional: somente as ordens atribuídas (ASSIGNED), sem financeiro, contábil ou fiscal.',
    controle.identityId,
    EMPREGADO_GRANTS.map((grant) => grant.action),
  );
  const controleFinanceiroRole = await ensureRole(
    pool,
    CONTROLE_FINANCEIRO_ROLE_CODE,
    'Dono',
    'Perfil estático de dono com acesso global de desenvolvimento.',
    controle.identityId,
    CONTROLE_GRANTS.map((grant) => grant.action),
  );

  await ensureAssignment(pool, controleRole, controle.identityId, controle.identityId);
  await ensureAssignment(
    pool,
    controleFinanceiroRole,
    controleFinanceiro.identityId,
    controle.identityId,
  );
  await ensureAssignment(pool, empregadoRole, empregado.identityId, controle.identityId);

  const controleGrants = await ensureGrants(
    pool,
    controle.identityId,
    controle.identityId,
    CONTROLE_GRANTS,
  );
  const controleFinanceiroGrants = await ensureGrants(
    pool,
    controleFinanceiro.identityId,
    controle.identityId,
    CONTROLE_GRANTS,
  );
  const empregadoGrants = await ensureGrants(
    pool,
    empregado.identityId,
    controle.identityId,
    EMPREGADO_GRANTS,
  );
  const workforceMemberId = await ensureWorkforceMember(pool, empregado.identityId);
  await pool.query(
    `INSERT INTO "authorization".scope_refs (scope_type, ref_id)
     VALUES ('UNIT', $1)
     ON CONFLICT DO NOTHING`,
    [OPERATIONAL_UNIT_REF],
  );
  await pool.query(
    `INSERT INTO "authorization".approval_role_assignments
       (identity_id, role_code, scope_type, scope_anchor)
     VALUES ($1, 'FINANCIAL_CONTROLLER', 'UNIT', $2)
     ON CONFLICT DO NOTHING`,
    [controleFinanceiro.identityId, OPERATIONAL_UNIT_REF],
  );
  await ensureDevPaymentMatrix(pool, controle.identityId);

  return {
    controleLogin: CONTROLE_LOGIN,
    controleFinanceiroLogin: CONTROLE_FINANCEIRO_LOGIN,
    empregadoLogin: EMPREGADO_LOGIN,
    controleIdentityId: controle.identityId,
    controleFinanceiroIdentityId: controleFinanceiro.identityId,
    empregadoIdentityId: empregado.identityId,
    workforceMemberId,
    controleGrants,
    controleFinanceiroGrants,
    empregadoGrants,
  };
}
