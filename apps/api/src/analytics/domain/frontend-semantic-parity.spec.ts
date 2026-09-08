import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEMANTIC_METRIC_CATALOG } from './semantic-metric-catalog';

/**
 * CISNE BI QUALITY GATE — SEMANTIC UI PARITY (automatico).
 * Todo metricId/metricVersion declarado no frontend (semantic-dashboard.ts) deve
 * existir e estar CONFIRMED no SMC-001 backend. BLOCKED/CANDIDATE nunca podem ser
 * referenciados como card de metrica utilizavel.
 *
 * O frontend pode definir SOMENTE composicao visual (metricId/version/visualization/
 * filters/drill/layout) - jamais formula/source/engine/nullPolicy/timezone/authz.
 */

// vitest de @cisne/api roda com cwd = apps/api; raiz do repo = ../..
const repoRoot = resolve(process.cwd(), '../..');
const frontendFile = resolve(repoRoot, 'apps/web/src/dashboard/semantic-dashboard.ts');

function frontendMetricRefs(): Array<{ id: string; version: string }> {
  if (!existsSync(frontendFile)) {
    throw new Error(`frontend semantic file not found: ${frontendFile}`);
  }
  const source = readFileSync(frontendFile, 'utf8');
  const ids = Array.from(source.matchAll(/metricId:\s*'([^']+)'/g), (match) => match[1]!);
  const versions = Array.from(source.matchAll(/metricVersion:\s*'([^']+)'/g), (match) => match[1]!);
  if (ids.length !== versions.length) {
    throw new Error('frontend semantic refs malformed: metricId/metricVersion count mismatch');
  }
  return ids.map((id, index) => ({ id, version: versions[index]! }));
}

describe('CISNE BI QUALITY GATE — SEMANTIC UI PARITY (SMC-001 x frontend)', () => {
  it('todo metricId@version usado no frontend existe e esta CONFIRMED no SMC-001 (SEMANTIC UI DRIFT = 0)', () => {
    const confirmed = new Set(
      SEMANTIC_METRIC_CATALOG.filter((metric) => metric.status === 'CONFIRMED').map(
        (metric) => `${metric.id}@${metric.version}`,
      ),
    );
    const refs = frontendMetricRefs();
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(confirmed.has(`${ref.id}@${ref.version}`), `drift em ${ref.id}@${ref.version}`).toBe(true);
    }
  });

  it('frontend nao referencia BLOCKED/CANDIDATE nem duplica semantica (sem formula/source/engine)', () => {
    const source = readFileSync(frontendFile, 'utf8');
    expect(source).not.toContain('receivables.overdue_count_by_finalized_billing_documents');
    // o espelho declara apenas composicao: nunca numerador/denominador/nullPolicy/engine
    for (const forbidden of ['nullPolicy', 'denominator', 'timezonePolicy', 'engine:']) {
      expect(source, `frontend nao pode duplicar ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('front SMC-001 mirror possui 15 CONFIRMED (mesma cardinalidade do catalogo)', () => {
    const mirrorCount = (readFileSync(frontendFile, 'utf8').match(/id:\s*'/g) ?? []).length;
    expect(mirrorCount).toBe(SEMANTIC_METRIC_CATALOG.filter((metric) => metric.status === 'CONFIRMED').length);
  });
});
