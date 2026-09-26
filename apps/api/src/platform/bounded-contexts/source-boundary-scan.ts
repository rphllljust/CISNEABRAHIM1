import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  ALLOWED_BOUNDED_CONTEXT_DEPENDENCIES,
  detectBoundedContextCycles,
  isBoundedContextDependencyAllowed,
  MODULE_TO_BOUNDED_CONTEXT,
  resolveModuleFolder,
} from './module-boundary-rules';
import { BOUNDED_CONTEXT, type BoundedContext } from './bounded-context';
import { isPublishedReadSchema, schemaOwner } from './schema-ownership';

const SRC_ROOT = join(__dirname, '../..');

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'test',
  'uat',
  'master-business',
  'ops',
  'synthetic-seed',
  'performance',
  'performance-stress',
  'concurrency',
  'chaos-recovery',
  'idempotency-retry',
  'failure-injection',
  'vertical',
  'adversarial',
]);

const REPORTING_MODULE_FOLDERS = new Set([
  'analytics',
  'dashboard',
  'reports',
  'search',
  'observability',
  'alerts',
]);

const SKIP_FILE_SUFFIXES = [
  '.spec.ts',
  '.test.ts',
  '.e2e.spec.ts',
  '.integration.spec.ts',
  '.perf.spec.ts',
  '.perf-stress.spec.ts',
];

const IMPORT_RE = /from ['"](\.[^'"]+)['"]/g;
const SCHEMA_RE = /\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:"?([a-z][a-z0-9_]*)"?)\./gi;

/**
 * Leituras cruzadas que o PDP precisa para aplicar escopo ASSIGNED.
 * Não é permissão genérica entre contextos: só este arquivo e estes schemas.
 */
const ASSIGNED_SCOPE_SQL: Array<{ fileSuffix: string; schema: string }> = [
  { fileSuffix: 'authorization/services/scope-enforcement.service.ts', schema: 'res' },
  { fileSuffix: 'authorization/services/scope-enforcement.service.ts', schema: 'wrk' },
];

export type SourceFileScan = {
  relativePath: string;
  boundedContext: BoundedContext | null;
};

export type ImportViolation = {
  file: string;
  from: BoundedContext;
  to: BoundedContext;
  specifier: string;
};

export type TableAccessViolation = {
  file: string;
  fileContext: BoundedContext;
  schema: string;
  schemaContext: BoundedContext;
};

function shouldSkipFile(filePath: string): boolean {
  return SKIP_FILE_SUFFIXES.some((suffix) => filePath.endsWith(suffix));
}

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkTsFiles(full, acc);
      continue;
    }
    if (entry.endsWith('.ts') && !shouldSkipFile(full)) {
      acc.push(full);
    }
  }
  return acc;
}

export function listProductionSourceFiles(): string[] {
  return walkTsFiles(SRC_ROOT);
}

export function boundedContextForFile(absolutePath: string): BoundedContext | null {
  const rel = relative(SRC_ROOT, absolutePath).split(sep).join('/');
  const moduleFolder = resolveModuleFolder(rel);
  return MODULE_TO_BOUNDED_CONTEXT[moduleFolder] ?? null;
}

function resolveRelativeImport(
  fromFile: string,
  specifier: string,
): string | null {
  const base = join(fromFile, '..', specifier);
  const candidates = [`${base}.ts`, join(base, 'index.ts')];
  for (const candidate of candidates) {
    try {
      statSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export function scanBoundedContextImportViolations(): ImportViolation[] {
  const violations: ImportViolation[] = [];
  for (const file of listProductionSourceFiles()) {
    const fromContext = boundedContextForFile(file);
    if (!fromContext) {
      continue;
    }
    const source = readFileSync(file, 'utf8');
    IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IMPORT_RE.exec(source)) !== null) {
      const specifier = match[1]!;
      const resolved = resolveRelativeImport(file, specifier);
      if (!resolved) {
        continue;
      }
      const toContext = boundedContextForFile(resolved);
      if (!toContext || fromContext === toContext) {
        continue;
      }
      const fromFolder = resolveModuleFolder(relative(SRC_ROOT, file).split(sep).join('/'));
      const rootFolder = fromFolder.split('/')[0] ?? '';
      const downstreamRead =
        fromContext === BOUNDED_CONTEXT.Platform &&
        (REPORTING_MODULE_FOLDERS.has(rootFolder) || rootFolder === 'integrations') &&
        (toContext === BOUNDED_CONTEXT.Operations ||
          toContext === BOUNDED_CONTEXT.Commercial ||
          toContext === BOUNDED_CONTEXT.Documents);
      if (downstreamRead) {
        continue;
      }
      if (!isBoundedContextDependencyAllowed(fromContext, toContext)) {
        violations.push({
          file: relative(SRC_ROOT, file).split(sep).join('/'),
          from: fromContext,
          to: toContext,
          specifier,
        });
      }
    }
  }
  return violations;
}

export function scanCrossContextTableAccess(): TableAccessViolation[] {
  const violations: TableAccessViolation[] = [];
  for (const file of listProductionSourceFiles()) {
    const fileContext = boundedContextForFile(file);
    if (!fileContext) {
      continue;
    }
    const source = readFileSync(file, 'utf8');
    SCHEMA_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SCHEMA_RE.exec(source)) !== null) {
      const schema = match[1]!;
      if (isPublishedReadSchema(schema)) {
        continue;
      }
      const owner = schemaOwner(schema);
      if (!owner || owner === fileContext) {
        continue;
      }
      const rel = relative(SRC_ROOT, file).split(sep).join('/');
      if (ASSIGNED_SCOPE_SQL.some((entry) => rel.endsWith(entry.fileSuffix) && entry.schema === schema)) {
        continue;
      }
      const isOwnerApplicationContract =
        rel.includes('/application/') && owner === fileContext;
      if (isOwnerApplicationContract) {
        continue;
      }
      violations.push({
        file: rel,
        fileContext,
        schema,
        schemaContext: owner,
      });
    }
  }
  return violations;
}

export function assertEnterpriseNucleusGraph(): {
  circularDependencies: number;
  crossModuleTableAccess: number;
  importViolations: ImportViolation[];
  tableAccessViolations: TableAccessViolation[];
} {
  const graphCycle = detectBoundedContextCycles(ALLOWED_BOUNDED_CONTEXT_DEPENDENCIES);
  const importViolations = scanBoundedContextImportViolations();
  const tableAccessViolations = scanCrossContextTableAccess();
  return {
    circularDependencies: (graphCycle ? 1 : 0) + importViolations.length,
    crossModuleTableAccess: tableAccessViolations.length,
    importViolations,
    tableAccessViolations,
  };
}
