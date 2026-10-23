#!/usr/bin/env node
/**
 * DIAGNOSTICO E ALINHAMENTO DA SUPERFICIE DE MODULOS EM PRODUCAO.
 *
 * POR QUE ESTE SCRIPT EXISTE
 *
 * As duas familias de flags sao independentes por desenho:
 *   - `VITE_FEATURE_MODULE_*` e resolvida em BUILD  (import.meta.env -> bundle)
 *   - `FEATURE_MODULE_*`      e resolvida em RUNTIME (process.env -> guard da API)
 *
 * Nada as acopla automaticamente. Se a API estiver ON e o bundle OFF, o operador ve menu
 * sem produto; se o bundle estiver ON e a API OFF, o menu aparece e a API responde 403
 * FEATURE_DISABLED. Ambos foram medidos neste repositorio.
 *
 * Este script:
 *   1. LE o estado real do Coolify (envs de producao da API e do Web);
 *   2. COMPARA com o contrato de release declarado em `release-1-scope.ts`
 *      (BUILT_MODULES ligados, STUB_MODULES desligados);
 *   3. REPORTa divergencias de forma auditavel;
 *   4. Com `--fix`, ESCREVE o valor correto e redeploya a API.
 *
 * O contrato NAO e inventado aqui: vem do proprio repositorio. Modulo que nao esta em
 * BUILT_MODULES nunca e ligado — STUB permanece desligado por nao ter backend real.
 *
 * Variaveis:
 *   COOLIFY_BASE_URL, COOLIFY_TOKEN, COOLIFY_API_UUID, COOLIFY_WEB_UUID
 *
 * Uso:
 *   node scripts/ops/coolify-module-surface.mjs            # audita (fail-closed)
 *   node scripts/ops/coolify-module-surface.mjs --fix      # corrige + redeploy
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createCoolifyClient, DeployRefusedError } from '../cd/coolify-deploy.mjs';

/**
 * Contrato de release (fonte unica no repositorio).
 * Espelha `apps/web/src/release-scope/feature-flags.ts`:
 * BUILT_MODULES = produto real   |   STUB_MODULES = superficie sem backend.
 */
const BUILT_MODULES = [
  'FINANCE',
  'FISCAL',
  'ACCOUNTING',
  'INVENTORY',
  'PAYROLL',
  'PROCUREMENT',
  'SUPPLIERS',
  'CONTRACTS',
  'PEOPLE',
  'ALERTS',
  'REPORTS',
  'APPROVAL_MATRIX',
  'OPERATIONAL_PROFITABILITY',
];

const STUB_MODULES = ['RENTALS', 'TRANSPORT'];

function required(name, value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new DeployRefusedError(`${name} ausente`);
  return normalized;
}

/** Le o valor efetivo de uma env de producao (nao-preview). */
function productionEnvValue(envs, key) {
  const entries = (Array.isArray(envs) ? envs : []).filter(
    (entry) => entry?.key === key && entry?.is_preview !== true,
  );
  if (entries.length === 0) return { state: 'missing', value: null, count: 0 };
  if (entries.length > 1) return { state: 'ambiguous', value: null, count: entries.length };
  const entry = entries[0];
  const raw = entry?.real_value ?? entry?.value;
  if (typeof raw !== 'string') return { state: 'missing', value: null, count: 1 };
  return { state: 'ok', value: normalizeEnvValue(raw), count: 1, raw };
}

/**
 * Normaliza o valor de env lido do Coolify.
 *
 * O Coolify devolve `real_value` com ASPAS literais quando a variavel foi gravada como
 * literal: `real_value` vem `'true'`, nao `true`. Sem normalizar, o script compara
 * `'true'` com `true`, acusa divergencia e entra em --fix eterno.
 *
 * Escopo deliberadamente estreito: remove APENAS um par de aspas simples ou duplas que
 * envolve o valor inteiro. Nada mais e tolerado — `true ` (espaco), `" true"`,
 * `True`, `1` ou string vazia continuam divergentes, porque um valor invalido nao pode
 * ser mascarado como se fosse o correto.
 */
export function normalizeEnvValue(raw) {
  const trimmed = String(raw ?? '').trim();
  const quoted = /^(['"])(.*)\1$/s.exec(trimmed);
  return (quoted ? quoted[2] : trimmed).trim();
}

/**
 * Monta o diff entre estado real e contrato.
 * Puro: nenhuma rede, facil de testar.
 */
export function buildSurfacePlan(envs) {
  const mismatches = [];
  const current = {};

  for (const moduleId of [...BUILT_MODULES, ...STUB_MODULES]) {
    const key = `FEATURE_MODULE_${moduleId}`;
    const desired = BUILT_MODULES.includes(moduleId) ? 'true' : 'false';
    const actual = productionEnvValue(envs, key);
    current[key] = actual.state === 'ok' ? actual.value : actual.state;

    const isMatch = actual.state === 'ok' && actual.value === desired;
    if (!isMatch) {
      mismatches.push({
        key,
        moduleId,
        desired,
        actual: actual.state === 'ok' ? actual.value : actual.state,
        action: actual.state === 'ok' ? 'update' : 'create',
      });
    }
  }

  return { current, mismatches };
}

/** Substitui a env de producao (DELETE + POST: medido no Coolify 4.4.7). */
async function replaceProductionEnv(client, uuid, key, value) {
  const envs = await client.listEnvironment(uuid);
  const existing = (Array.isArray(envs) ? envs : []).filter(
    (entry) => entry?.key === key && entry?.is_preview !== true,
  );
  for (const entry of existing) {
    const envUuid = String(entry?.uuid ?? '').trim();
    if (!envUuid) throw new DeployRefusedError(`${key}: UUID da variavel ausente`);
    await client.call(`/applications/${uuid}/envs/${envUuid}`, { method: 'DELETE' });
  }
  return client.call(`/applications/${uuid}/envs`, {
    method: 'POST',
    body: {
      key,
      value,
      is_preview: false,
      is_literal: true,
      is_multiline: false,
      is_shown_once: false,
    },
  });
}

async function main() {
  const fix = process.argv.includes('--fix');
  const client = createCoolifyClient({
    baseUrl: process.env.COOLIFY_BASE_URL,
    token: process.env.COOLIFY_TOKEN,
  });
  const apiUuid = required('COOLIFY_API_UUID', process.env.COOLIFY_API_UUID);

  const envs = await client.listEnvironment(apiUuid);
  const plan = buildSurfacePlan(envs);

  console.log(`[module-surface] estado atual (API de producao):`);
  for (const [key, value] of Object.entries(plan.current)) {
    console.log(`  ${key.padEnd(46)} = ${value}`);
  }

  if (plan.mismatches.length === 0) {
    console.log('[module-surface] PASS: superficie da API ja coincide com o contrato de release');
    return;
  }

  console.log(`[module-surface] ${plan.mismatches.length} divergencia(s) contra o contrato:`);
  for (const mismatch of plan.mismatches) {
    console.log(
      `  ${mismatch.key.padEnd(46)} atual=${mismatch.actual} desejado=${mismatch.desired} (${mismatch.action})`,
    );
  }

  if (!fix) {
    throw new DeployRefusedError(
      `${plan.mismatches.length} modulo(s) divergentes do contrato de release. ` +
        'Rode com --fix para alinhar e redeployar.',
    );
  }

  for (const mismatch of plan.mismatches) {
    await replaceProductionEnv(client, apiUuid, mismatch.key, mismatch.desired);
    console.log(`[module-surface] ${mismatch.key} := ${mismatch.desired}`);
  }

  // Env de runtime so entra em vigor quando o container sobe de novo.
  const started = await client.deploy(apiUuid);
  const deploymentUuid = started?.deployments?.[0]?.deployment_uuid ?? started?.deployment_uuid;
  if (!deploymentUuid) {
    throw new DeployRefusedError('Coolify nao devolveu deployment_uuid apos corrigir a superficie');
  }
  console.log(`[module-surface] redeploy da API disparado: ${deploymentUuid}`);

  // Confirmacao pos-redeploy: rele o estado efetivo.
  const deadline = Date.now() + 600_000;
  let verified = null;
  for (;;) {
    const deployment = await client.deployment(deploymentUuid);
    const status = String(deployment?.status ?? '').toLowerCase();
    if (status === 'finished') {
      const after = await client.listEnvironment(apiUuid);
      verified = buildSurfacePlan(after);
      break;
    }
    if (['failed', 'cancelled', 'error'].includes(status)) {
      throw new DeployRefusedError(`redeploy terminou em ${status}`);
    }
    if (Date.now() >= deadline) {
      throw new DeployRefusedError(`redeploy nao terminou em 600000ms (status=${status})`);
    }
    await new Promise((done) => setTimeout(done, 5_000));
  }

  if (verified.mismatches.length > 0) {
    throw new DeployRefusedError(
      `apos --fix ainda restam ${verified.mismatches.length} divergencia(s): ` +
        verified.mismatches.map((m) => m.key).join(', '),
    );
  }
  console.log('[module-surface] PASS: superficie da API alinhada ao contrato de release');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(
      `[module-surface] FALHA: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
