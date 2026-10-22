#!/usr/bin/env node
/**
 * Seletor de run de CI que autoriza a publicacao de imagens.
 *
 * Problema que este modulo resolve: o gatilho e `workflow_run` e
 * `github.event.workflow_run.id` aponta para o run de CI que disparou AQUELE
 * evento. Quando dois pushes chegam proximos, o `concurrency` do CI cancela o
 * run anterior -- e o evento `completed` do run cancelado autoriza uma execucao
 * que entao le `Release ready=cancelled|failure`, reprovando um SHA que tem CI
 * verde. O mesmo defeito existia no cd.yml.
 *
 * Contrato (fail-closed): para o SHA esperado, aceita SOMENTE um run cujo
 *   workflow === "CI"
 *   head_branch === "main"
 *   head_sha === expectedSha
 *   status === "completed"
 *   conclusion === "success"
 * e, portanto, cujo job `Release ready` concluiu `success`.
 * Se houver varios `success`, vale o de maior id. Qualquer outro conjunto recusa.
 */
import { readFileSync } from 'node:fs';

export const WORKFLOW_NAME = 'CI';
export const RELEASE_JOB_NAME = 'Release ready';

export class AuthorizationRefusedError extends Error {}

function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Escolhe o run de CI que autoriza a publicacao.
 * Puro: recebe a lista do GitHub e o SHA esperado, devolve o run ou lanca.
 */
export function selectAuthorizingRun(runs, expectedSha) {
  if (typeof expectedSha !== 'string' || !/^[0-9a-f]{40}$/i.test(expectedSha.trim())) {
    throw new AuthorizationRefusedError(`expectedSha invalido: ${String(expectedSha)}`);
  }
  const sha = normalize(expectedSha);

  const sameShaCiRuns = (Array.isArray(runs) ? runs : []).filter(
    (run) => run?.name === WORKFLOW_NAME && normalize(run.head_sha) === sha,
  );

  if (sameShaCiRuns.length === 0) {
    throw new AuthorizationRefusedError(`nenhum run de ${WORKFLOW_NAME} para o sha ${sha}`);
  }

  const green = sameShaCiRuns
    .filter((run) => run.status === 'completed' && run.conclusion === 'success')
    .sort((a, b) => Number(b.id) - Number(a.id));

  if (green.length === 0) {
    const seen = sameShaCiRuns
      .map((run) => `${run.id}:${run.status}/${run.conclusion ?? '-'}`)
      .join(', ');
    throw new AuthorizationRefusedError(
      `nenhum ${WORKFLOW_NAME} concluido com sucesso para o sha ${sha} (vistos: ${seen})`,
    );
  }

  const run = green[0];
  if (run.head_branch !== 'main') {
    throw new AuthorizationRefusedError(
      `run ${run.id} esta em '${run.head_branch}' (esperado main)`,
    );
  }

  return run;
}

/**
 * Exige que o run escolhido contenha o job `Release ready` com `success`.
 * Puro: recebe a lista de jobs daquele run.
 */
export function assertReleaseReadyPassed(jobs) {
  const job = (Array.isArray(jobs) ? jobs : []).find(
    (entry) => entry?.name === RELEASE_JOB_NAME,
  );
  const verdict = job?.conclusion ?? job?.status ?? 'MISSING';
  if (verdict !== 'success') {
    throw new AuthorizationRefusedError(
      `${RELEASE_JOB_NAME} concluiu '${verdict}' (esperado success)`,
    );
  }
  return job;
}

/**
 * Autorizacao completa: escolhe o run e exige `Release ready=success`.
 * `jobsForRun(runId)` permite injetar o fetch no teste.
 */
export async function authorizePublication(runs, expectedSha, jobsForRun) {
  const run = selectAuthorizingRun(runs, expectedSha);
  let jobs;
  try {
    jobs = await jobsForRun(run.id);
  } catch (error) {
    throw new AuthorizationRefusedError(
      `nao foi possivel listar jobs do run ${run.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assertReleaseReadyPassed(jobs);
  return { runId: run.id, sourceSha: normalize(expectedSha) };
}

function runCli() {
  const expectedSha = process.env.EXPECTED_SHA;
  const runsPath = process.env.EXPECTED_RUNS_FILE;
  if (!runsPath) {
    throw new AuthorizationRefusedError('EXPECTED_RUNS_FILE nao definido');
  }
  const runs = JSON.parse(readFileSync(runsPath, 'utf8')).workflow_runs ?? [];
  const run = selectAuthorizingRun(runs, expectedSha);
  process.stdout.write(String(run.id));
}

if (process.argv[1] && process.argv[1].endsWith('select-authorizing-run.mjs')) {
  try {
    runCli();
  } catch (error) {
    console.error(`[release-authority] ${error.message}`);
    process.exitCode = 1;
  }
}
