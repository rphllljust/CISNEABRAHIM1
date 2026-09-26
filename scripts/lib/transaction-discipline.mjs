/**
 * Detector da disciplina transacional (gate E de `scripts/check-scripts.mjs`).
 *
 * DEFEITO MEDIDO — o mesmo que ja foi corrigido no helper provado de
 * `packages/database/src/transaction.ts` e, pontualmente, em
 * `apps/api/src/establishments/repositories/establishment-registry.repository.ts`:
 *
 *   catch (error) {
 *     await client.query('ROLLBACK');   // se falhar, MASCARA a causa primaria
 *     throw error;
 *   } finally {
 *     client.release();                 // devolve ao pool sessao de estado desconhecido
 *   }
 *
 * Duas consequencias, ambas observaveis:
 *   1. quando o ROLLBACK tambem falha (conexao caiu, timeout, servidor reiniciou), o
 *      erro do ROLLBACK substitui o erro de negocio — um 23505 chega ao chamador como
 *      erro generico de conexao, quebrando o mapeamento de erro e o status HTTP;
 *   2. `release()` sem argumento devolve a conexao ao pool mesmo sem o encerramento da
 *      transacao confirmado, deixando uma sessao possivelmente `idle in transaction`
 *      segurando locks para o proximo consumidor.
 *
 * POR QUE BASELINE E NAO CODEMOD
 *   Sao 86 sites em 37 arquivos. Reescrever todos de uma vez e exatamente o tipo de
 *   mudanca transversal que nao se faz sem prova por arquivo. O gate congela a
 *   contagem, proibe crescimento e proibe que arquivo NOVO entre com o padrao: a
 *   classe para de crescer e passa a ser divida medida, com caminho de saida unico
 *   (aplicar `rollbackKeepingPrimaryCause` + `release(evictWith)`).
 *
 * Escopo: `apps/api/src` e `packages/database/src`, apenas arquivos rastreados e
 * apenas codigo de producao. Nada de rede, banco ou install.
 */
import { existsSync, readFileSync } from 'node:fs';

/**
 * A ROLLBACK inside a `catch`, followed by any `throw` in the same block.
 *
 * The `\bthrow\b` is deliberately loose: a variant re-throws a TRANSFORMED error
 * (`throw this.mapDuplicateViolation(error)`) instead of `throw error`, and that form
 * was missed by a detector requiring `throw <identifier>;`. It is the same defect with
 * an extra consequence — the mapping never runs, so the caller receives the ROLLBACK
 * failure instead of the mapped domain error.
 */
const ROLLBACK_MASKING_CAUSE =
  /catch\s*\([^)]*\)\s*\{[^}]*await\s+\w+\.query\(\s*['"]ROLLBACK['"]\s*\)[^}]*\bthrow\b/gs;
const BARE_RELEASE = /\.release\(\s*\)/g;
const EVICTING_RELEASE = /\.release\(\s*[A-Za-z_$]/g;

export function readBaseline(baselinePath) {
  return JSON.parse(readFileSync(baselinePath, 'utf8'));
}

/** Files that declare their own transaction skeleton. */
export function transactionalFiles(listTrackedFiles, repoRoot) {
  return listTrackedFiles
    .filter((rel) => /\.ts$/.test(rel))
    .filter((rel) => !/\.(spec|test)\.ts$/.test(rel))
    .filter((rel) => existsSync(`${repoRoot}/${rel}`))
    .filter((rel) => /['"]BEGIN['"]/.test(readFileSync(`${repoRoot}/${rel}`, 'utf8')));
}

/** Pure measurement, so the detector itself can be shown to fire on known-bad input. */
export function measureSource(source) {
  return {
    maskedErrorSites: (source.match(ROLLBACK_MASKING_CAUSE) ?? []).length,
    bareReleaseCalls: (source.match(BARE_RELEASE) ?? []).length,
    evictingReleaseCalls: (source.match(EVICTING_RELEASE) ?? []).length,
  };
}

export function measureFile(repoRoot, rel) {
  return measureSource(readFileSync(`${repoRoot}/${rel}`, 'utf8'));
}

/**
 * Compare the measurement against the frozen baseline.
 * Returns the problems a caller should fail on. Never returns a "fixed" verdict as a
 * problem: a decreasing count is progress and only needs the baseline refreshed.
 */
export function compareToBaseline(files, repoRoot, baseline) {
  const allowlist = new Set(baseline.allowlist ?? []);
  const measured = files.map((rel) => ({ rel, ...measureFile(repoRoot, rel) }));

  const totalMasked = measured.reduce((sum, m) => sum + m.maskedErrorSites, 0);
  const totalBare = measured.reduce((sum, m) => sum + m.bareReleaseCalls, 0);
  const totalEvicting = measured.reduce((sum, m) => sum + m.evictingReleaseCalls, 0);
  const withMasked = measured.filter((m) => m.maskedErrorSites > 0);

  const problems = [];

  // New file introducing the pattern is never acceptable, regardless of totals.
  for (const m of withMasked) {
    if (!allowlist.has(m.rel)) {
      problems.push({
        file: m.rel,
        detail:
          `introduces ${m.maskedErrorSites} site(s) of "catch { ROLLBACK; throw }" and is not in the ` +
          'baseline allowlist. Preserve the primary error and evict the connection instead: see ' +
          'rollbackKeepingPrimaryCause in apps/api/src/establishments/repositories/' +
          'establishment-registry.repository.ts',
      });
    }
  }

  if (totalMasked > baseline.maskedErrorSites) {
    problems.push({
      file: '(repository)',
      detail: `masked-error sites grew from ${baseline.maskedErrorSites} to ${totalMasked}`,
    });
  }
  if (withMasked.length > baseline.filesWithMaskedErrorSites) {
    problems.push({
      file: '(repository)',
      detail: `files with masked-error sites grew from ${baseline.filesWithMaskedErrorSites} to ${withMasked.length}`,
    });
  }
  if (totalBare > baseline.bareReleaseCalls) {
    problems.push({
      file: '(repository)',
      detail: `release() without an eviction argument grew from ${baseline.bareReleaseCalls} to ${totalBare}`,
    });
  }
  if (totalEvicting < baseline.evictingReleaseCalls) {
    problems.push({
      file: '(repository)',
      detail: `release(err) eviction calls dropped from ${baseline.evictingReleaseCalls} to ${totalEvicting}`,
    });
  }

  return {
    problems,
    measured: { totalMasked, totalBare, totalEvicting, filesWithMasked: withMasked.length },
    improved:
      totalMasked < baseline.maskedErrorSites ||
      totalBare < baseline.bareReleaseCalls ||
      totalEvicting > baseline.evictingReleaseCalls,
  };
}
