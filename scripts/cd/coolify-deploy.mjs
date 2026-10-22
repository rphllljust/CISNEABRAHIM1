#!/usr/bin/env node
/**
 * Executor de deploy Coolify — o "ultimo metro" do release.
 *
 * Consome o `deploy-payload.json` fail-closed emitido por
 * `coolify-deploy-payload.mjs` e materializa o deploy pela API OFICIAL do Coolify:
 *
 *   GHCR (imagem@sha256:digest) -> Coolify -> cisne-api / cisne-worker / cisne-web
 *     -> deployment -> estado terminal -> health check
 *
 * Regras que este modulo garante:
 * - Nunca aceita tag mutavel: a imagem precisa casar `...@sha256:<64 hex>`.
 * - Worker usa EXATAMENTE a mesma imagem/digest da API.
 * - Nao escreve em tabela interna, nao faz docker pull, nao faz compose manual,
 *   nao roda build no VPS. Coolify continua dono do runtime.
 * - Falha alto e cedo: qualquer divergencia de provenance reprova o deploy.
 *
 * Variaveis de ambiente:
 *   COOLIFY_BASE_URL      ex. http://127.0.0.1:8000/api/v1
 *   COOLIFY_TOKEN         token da API (nunca logado)
 *   COOLIFY_API_UUID      uuid da aplicacao cisne-api
 *   COOLIFY_WORKER_UUID   uuid da aplicacao cisne-worker
 *   COOLIFY_WEB_UUID      uuid da aplicacao cisne-web
 *   COOLIFY_DEPLOY_PAYLOAD caminho do payload (default artifacts/coolify/deploy-payload.json)
 *   COOLIFY_DEPLOY_TIMEOUT_MS  orcamento de espera do estado terminal (default 600000)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const IMAGE_BY_DIGEST_RE = /^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/i;
const SHA_RE = /^[0-9a-f]{40}$/i;

// Vocabulario de status observado no Coolify 4.4.7: `queued` -> `in_progress` ->
// `finished` | `failed` | `cancelled`. `finished` e o unico sucesso aceito; qualquer
// outro estado terminal reprova o deploy.
const TERMINAL_OK = new Set(['finished']);
const TERMINAL_FAIL = new Set(['failed', 'cancelled', 'error']);

export class DeployRefusedError extends Error {}

function requireMatch(name, value, regex) {
  if (typeof value !== 'string' || !regex.test(value.trim())) {
    throw new DeployRefusedError(`${name} nao e imutavel: ${String(value)}`);
  }
  return value.trim().toLowerCase();
}

/**
 * Valida o payload e devolve o plano de deploy por aplicacao.
 * Puro: nenhuma chamada de rede, facil de testar.
 */
export function buildDeployPlan(payload, apps) {
  if (!payload || typeof payload !== 'object') {
    throw new DeployRefusedError('payload ausente');
  }
  const sourceSha = requireMatch('sourceSha', payload.sourceSha, SHA_RE);
  const apiImage = requireMatch('images.api', payload.images?.api, IMAGE_BY_DIGEST_RE);
  const webImage = requireMatch('images.web', payload.images?.web, IMAGE_BY_DIGEST_RE);
  const workerImage = requireMatch('images.worker', payload.images?.worker, IMAGE_BY_DIGEST_RE);

  // Worker e o MESMO binario da API; divergencia reprova antes de qualquer efeito.
  if (workerImage !== apiImage) {
    throw new DeployRefusedError(
      `worker deve usar a imagem da API: api=${apiImage} worker=${workerImage}`,
    );
  }

  for (const key of ['api', 'worker', 'web']) {
    if (!apps?.[key]) {
      throw new DeployRefusedError(`COOLIFY_${key.toUpperCase()}_UUID ausente`);
    }
  }

  return [
    { key: 'api', uuid: apps.api, image: apiImage, healthPath: payload.runtime?.api?.healthPath },
    { key: 'worker', uuid: apps.worker, image: workerImage, healthPath: null },
    { key: 'web', uuid: apps.web, image: webImage, healthPath: payload.runtime?.web?.healthPath },
  ].map((entry) => ({ ...entry, sourceSha }));
}

function splitImage(image) {
  const at = image.lastIndexOf('@');
  return { repository: image.slice(0, at), digest: image.slice(at + 1) };
}

/** Cliente minimo da API oficial v1 do Coolify. */
export function createCoolifyClient({ baseUrl, token, fetchImpl = fetch }) {
  if (!baseUrl || !token) {
    throw new DeployRefusedError('COOLIFY_BASE_URL e COOLIFY_TOKEN sao obrigatorios');
  }
  const root = baseUrl.replace(/\/$/, '');

  async function call(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${root}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      // Nunca ecoa o token; apenas status e o corpo devolvido pelo Coolify.
      throw new DeployRefusedError(`Coolify ${method} ${path} -> ${response.status} ${text.slice(0, 300)}`);
    }
    return text.trim() ? JSON.parse(text) : null;
  }

  return {
    call,
    getApplication: (uuid) => call(`/applications/${uuid}`),
    /**
     * Aponta a aplicacao para uma imagem imutavel.
     * O Coolify separa nome do repositorio e tag; o digest vai como tag `@sha256:...`.
     */
    pinImage: (uuid, image) => {
      const { repository, digest } = splitImage(image);
      return call(`/applications/${uuid}`, {
        method: 'PATCH',
        body: {
          docker_registry_image_name: repository.replace(/^ghcr\.io\//, ''),
          docker_registry_image_tag: `@${digest}`,
        },
      });
    },
    deploy: (uuid) => call(`/deploy?uuid=${uuid}`, { method: 'POST' }),
    deployment: (uuid) => call(`/deployments/${uuid}`),
  };
}

/** Aguarda o deployment atingir estado terminal, com orcamento explicito. */
export async function waitForDeployment(client, deploymentUuid, { timeoutMs, intervalMs = 5000, sleep = defaultSleep } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const detail = await client.deployment(deploymentUuid);
    const status = String(detail?.status ?? '').toLowerCase();
    if (TERMINAL_FAIL.has(status)) {
      throw new DeployRefusedError(`deployment ${deploymentUuid} terminou em '${status}'`);
    }
    if (TERMINAL_OK.has(status)) {
      return detail;
    }
    if (Date.now() >= deadline) {
      throw new DeployRefusedError(
        `deployment ${deploymentUuid} nao terminou em ${timeoutMs}ms (ultimo status '${status}')`,
      );
    }
    await sleep(intervalMs);
  }
}

function defaultSleep(ms) {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

/**
 * Executa o plano: fixa imagem, dispara deploy, espera estado terminal.
 * `onStep` permite narrar progresso sem acoplar ao console.
 */
export async function runDeployPlan(plan, client, options = {}) {
  const { timeoutMs, intervalMs, sleep, onStep = () => {} } = options;
  const results = [];
  for (const step of plan) {
    onStep(`[coolify-deploy] ${step.key}: fixando imagem ${step.image}`);
    await client.pinImage(step.uuid, step.image);

    onStep(`[coolify-deploy] ${step.key}: disparando deployment`);
    const started = await client.deploy(step.uuid);
    const deploymentUuid = started?.deployments?.[0]?.deployment_uuid ?? started?.deployment_uuid;
    if (!deploymentUuid) {
      throw new DeployRefusedError(`Coolify nao devolveu deployment_uuid para ${step.key}`);
    }

    onStep(`[coolify-deploy] ${step.key}: aguardando ${deploymentUuid}`);
    const finished = await waitForDeployment(client, deploymentUuid, {
      timeoutMs,
      intervalMs,
      sleep,
    });
    results.push({ key: step.key, deploymentUuid, status: finished?.status ?? 'unknown' });
    onStep(`[coolify-deploy] ${step.key}: ${finished?.status} confirmado`);
  }
  return results;
}

function readPayload(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return parsed;
}

async function runCli() {
  const payloadPath = resolve(
    process.env.COOLIFY_DEPLOY_PAYLOAD || 'artifacts/coolify/deploy-payload.json',
  );
  const plan = buildDeployPlan(readPayload(payloadPath), {
    api: process.env.COOLIFY_API_UUID,
    worker: process.env.COOLIFY_WORKER_UUID,
    web: process.env.COOLIFY_WEB_UUID,
  });

  const client = createCoolifyClient({
    baseUrl: process.env.COOLIFY_BASE_URL,
    token: process.env.COOLIFY_TOKEN,
  });

  const results = await runDeployPlan(plan, client, {
    timeoutMs: Number(process.env.COOLIFY_DEPLOY_TIMEOUT_MS ?? 600_000),
    onStep: (message) => console.log(message),
  });

  console.log(`[coolify-deploy] concluido ${JSON.stringify(results)}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCli().catch((error) => {
    console.error(`[coolify-deploy] FALHA: ${error.message}`);
    process.exitCode = 1;
  });
}
