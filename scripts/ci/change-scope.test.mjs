import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyChangeScope } from './change-scope.mjs';

describe('change-scope classifier', () => {
  it('scripts/cd puro justifica Integration N/A', () => {
    assert.deepEqual(
      classifyChangeScope([
        'scripts/cd/coolify-browser-gate.mjs',
        'scripts/cd/coolify-browser-gate.test.mjs',
      ]),
      {
        visualRisk: false,
        integrationRequired: false,
        changedFiles: '2',
      },
    );
  });

  it('mistura scripts/cd com backend exige Integration', () => {
    assert.equal(
      classifyChangeScope([
        'scripts/cd/coolify-browser-gate.mjs',
        'apps/api/src/measurements/application/measurement-workbench.reader.ts',
      ]).integrationRequired,
      true,
    );
  });

  it('mudança de banco exige Integration', () => {
    assert.equal(
      classifyChangeScope(['packages/database/migrations/0107_example.sql'])
        .integrationRequired,
      true,
    );
  });

  it('mudança no próprio CI exige Integration por fail-closed', () => {
    assert.equal(
      classifyChangeScope(['.github/workflows/ci.yml']).integrationRequired,
      true,
    );
    assert.equal(
      classifyChangeScope(['scripts/ci/change-scope.mjs']).integrationRequired,
      true,
    );
  });

  it('path desconhecido exige Integration', () => {
    assert.equal(classifyChangeScope(['new-domain/file.ts']).integrationRequired, true);
  });

  it('diff desconhecido ou vazio exige Integration e visual full', () => {
    assert.deepEqual(classifyChangeScope([], { unknown: true }), {
      visualRisk: true,
      integrationRequired: true,
      changedFiles: 'unknown',
    });
    assert.deepEqual(classifyChangeScope([]), {
      visualRisk: true,
      integrationRequired: true,
      changedFiles: '0',
    });
  });

  it('mantém a classificação visual existente', () => {
    assert.equal(
      classifyChangeScope(['apps/web/src/service-orders/pages/MeasurementWorkbenchPage.tsx'])
        .visualRisk,
      true,
    );
    assert.equal(
      classifyChangeScope(['scripts/cd/coolify-browser-gate.mjs']).visualRisk,
      false,
    );
  });
});
