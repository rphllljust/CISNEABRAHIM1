import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyChangeScope } from './change-scope.mjs';

const required = (paths) => classifyChangeScope(paths).integrationRequired;

describe('change-scope classifier', () => {
  it('scripts/cd-only => Integration NOT_APPLICABLE com razão explícita', () => {
    const result = classifyChangeScope([
      'scripts/cd/coolify-browser-gate.mjs',
      'scripts/cd/coolify-browser-gate.test.mjs',
    ]);
    assert.equal(result.integrationRequired, false);
    assert.equal(result.integrationReason, 'CD_ONLY_CHANGE');
    assert.deepEqual(result.changedPaths, [
      'scripts/cd/coolify-browser-gate.mjs',
      'scripts/cd/coolify-browser-gate.test.mjs',
    ]);
  });

  it('scripts/cd + backend => Integration real obrigatório', () => {
    assert.equal(required([
      'scripts/cd/coolify-browser-gate.mjs',
      'apps/api/src/measurements/application/measurement-workbench.reader.ts',
    ]), true);
  });

  it('database => Integration real obrigatório', () => {
    assert.equal(required(['packages/database/migrations/0107_example.sql']), true);
  });

  it('workflow e scripts/ci => Integration real obrigatório', () => {
    assert.equal(required(['.github/workflows/ci.yml']), true);
    assert.equal(required(['scripts/ci/change-scope.mjs']), true);
  });

  it('shared/config/package/lockfile/tsconfig/Dockerfile => Integration real obrigatório', () => {
    for (const path of [
      'packages/shared/src/index.ts',
      'package.json',
      'pnpm-lock.yaml',
      'tsconfig.json',
      'apps/api/tsconfig.json',
      'Dockerfile',
      'apps/api/Dockerfile',
    ]) {
      assert.equal(required([path]), true, path);
    }
  });

  it('path desconhecido => Integration real obrigatório', () => {
    assert.equal(required(['new-domain/file.ts']), true);
  });

  it('diff indeterminado ou vazio => Integration real obrigatório e visual fail-closed', () => {
    assert.deepEqual(classifyChangeScope([], { unknown: true }), {
      visualRisk: true,
      integrationRequired: true,
      integrationReason: 'DIFF_INDETERMINATE',
      changedFiles: 'unknown',
      changedPaths: ['<unknown>'],
    });
    assert.deepEqual(classifyChangeScope([]), {
      visualRisk: true,
      integrationRequired: true,
      integrationReason: 'EMPTY_DIFF',
      changedFiles: '0',
      changedPaths: [],
    });
  });

  it('mutation: path desconhecido adicionado a CD-only restaura Integration obrigatório', () => {
    const baseline = [
      'scripts/cd/coolify-browser-gate.mjs',
      'scripts/cd/coolify-browser-gate.structure.test.mjs',
    ];
    assert.equal(required(baseline), false);
    assert.equal(required([...baseline, 'unexpected/new-surface.xyz']), true);
  });

  it('mantém classificação visual existente', () => {
    assert.equal(
      classifyChangeScope(['apps/web/src/service-orders/pages/MeasurementWorkbenchPage.tsx'])
        .visualRisk,
      true,
    );
    assert.equal(classifyChangeScope(['scripts/cd/coolify-browser-gate.mjs']).visualRisk, false);
  });
});
