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

  // O worker roda o MESMO codigo da API, mas em outro processo.
  //
  // Duas formas validas, ambas fail-closed:
  //   a) imagem dedicada `cisne-worker` (recomendada): CMD proprio, entao o
  //      container sobe apenas o processo de fila;
  //   b) mesma imagem da API + WORKER_ENABLED=true: funciona (o binario sobe
  //      outbox/inbox/reports), mas tambem levanta o servidor HTTP num container
  //      que nao deve receber trafego.
  //
  // MOTIVO (medido no Coolify 4.4.7): com build_pack=dockerimage NENHUM campo da
  // API materializa `command:` no compose gerado -- start_command e
  // docker_compose_custom_start_command sao ignorados, custom_docker_run_options
  // gera apenas `entrypoint` (deixando Cmd=null) e docker_compose_raw e proibido
  // em applications. O processo e sempre o CMD da imagem.
  const workerIsApi = workerImage === apiImage;
  const workerIsDedicated = /cisne-worker/i.test(payload.images?.worker ?? '');
  if (!workerIsApi && !workerIsDedicated) {
    throw new DeployRefusedError(
      `worker deve usar a imagem da API ou a imagem dedicada cisne-worker: api=${apiImage} worker=${workerImage}`,
    );
  }

  for (const key of ['api', 'worker', 'web']) {
    if (!apps?.[key]) {
      throw new DeployRefusedError(`COOLIFY_${key.toUpperCase()}_UUID ausente`);
    }
  }

  // `start_command` e necessario porque as tres aplicacoes usam a MESMA imagem.
  // A API e o Web herdam o CMD do Dockerfile; o worker precisa de outro processo.
  // Sem isso, o worker subiria como uma segunda API e nunca consumiria a fila.
  //
  // O command do worker e OBRIGATORIO: ausente significa payload incompleto.
  const workerCommand = payload.runtime?.worker?.command;
  if (!Array.isArray(workerCommand) || workerCommand.length === 0) {
    throw new DeployRefusedError(
      'runtime.worker.command ausente no payload: sem ele o worker rodaria o CMD da API',
    );
  }

  // CONTRATO DE IMAGEM NO COOLIFY (medido em 4.4.7, nao suposto):
  //
  //   O Coolify NAO aceita `@sha256:...` nem `sha256:...` em
  //   `docker_registry_image_tag` (422 "field format is invalid"). Ele quer uma TAG.
  //
  //   O Coolify tambem prefixa com docker.io quando o NOME nao traz registry, o que
  //   produzia `pull access denied for rphllljust/cisne-api` -- o Docker ia para
  //   docker.io em vez de ghcr.io. Portanto o nome enviado precisa incluir o host.
  //
  // Imutabilidade preservada: a tag publicada pelo workflow E o source SHA, e o
  // digest autorizado continua sendo verificado ANTES do deploy
  // (`verifyPublishedDigest`: manifest da tag precisa resolver exatamente para
  // `expectedDigest`, e o worker herda o digest da API). A tag por SHA nunca e
  // reescrita com conteudo diferente porque cada SHA e um build distinto.
  const parseImage = (name, image) => {
    const at = image.lastIndexOf('@');
    const repository = image.slice(0, at);
    const digest = image.slice(at + 1);
    if (!repository.includes('/')) {
      throw new DeployRefusedError(`${name}: repository sem host de registry: ${repository}`);
    }
    return { repository, digest };
  };

  const apiParts = parseImage('images.api', apiImage);
  const webParts = parseImage('images.web', webImage);
  const workerParts = parseImage('images.worker', workerImage);

  return [
    {
      key: 'api',
      uuid: apps.api,
      repository: apiParts.repository,
      tag: sourceSha,
      expectedDigest: apiParts.digest,
      healthPath: payload.runtime?.api?.healthPath,
      // Variaveis que a aplicacao EXIGE para funcionar no browser. Sem elas o container
      // sobe saudavel e o usuario nao consegue logar -- foi exatamente o incidente.
      // `CORS_ORIGIN` vazio em producao = lista de origens permitidas VAZIA.
      requiredEnvironment: payload.runtime?.api?.requiredEnvironment ?? [],
      startCommand: null, // herda o CMD do Dockerfile runtime-only
    },
    {
      key: 'worker',
      uuid: apps.worker,
      repository: workerParts.repository,
      tag: sourceSha,
      expectedDigest: workerParts.digest,
      healthPath: null,
      // Com imagem dedicada o CMD ja e o do worker. O start_command nao e
      // materializado pelo Coolify nesse build_pack, entao nao dependemos dele.
      startCommand: null,
    },
    {
      key: 'web',
      uuid: apps.web,
      repository: webParts.repository,
      tag: sourceSha,
      expectedDigest: webParts.digest,
      healthPath: payload.runtime?.web?.healthPath,
      requiredEnvironment: payload.runtime?.web?.requiredEnvironment ?? [],
      startCommand: null, // nginx do Dockerfile
    },
  ].map((entry) => ({ ...entry, sourceSha }));
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
    pinImage: (uuid, { repository, tag }) => {
      if (!repository.includes('/')) {
        throw new DeployRefusedError(`repository sem host de registry: ${repository}`);
      }
      if (!SHA_RE.test(tag)) {
        throw new DeployRefusedError(`tag de deploy precisa ser o source SHA: ${tag}`);
      }
      return call(`/applications/${uuid}`, {
        method: 'PATCH',
        body: {
          docker_registry_image_name: repository,
          docker_registry_image_tag: tag,
        },
      });
    },
    /** Define o processo que a aplicacao executa (worker != CMD do Dockerfile). */
    setStartCommand: (uuid, startCommand) =>
      call(`/applications/${uuid}`, { method: 'PATCH', body: { start_command: startCommand } }),
    deploy: (uuid) => call(`/deploy?uuid=${uuid}`, { method: 'POST' }),
    deployment: (uuid) => call(`/deployments/${uuid}`),
    /**
     * Lista as variaveis de ambiente da aplicacao.
     *
     * `real_value` existe no Coolify 4.4.7 e e o valor que o container recebe; `value`
     * fica mascarado quando a variavel e secreta. Usamos `real_value` com fallback para
     * `value` porque o objetivo e provar que a variavel NAO esta vazia, e o valor mascarado
     * nao permite essa conclusao. O valor nunca e registrado em log.
     */
    listEnvironment: (uuid) => call(`/applications/${uuid}/envs`),
  };
}

/**
 * Verifica que as variaveis de ambiente obrigatorias existem e NAO estao vazias no Coolify.
 *
 * POR QUE ESTA FUNCAO EXISTE
 * -----------------------------------------------------------------------------------------
 * `requiredEnvironment` era apenas DECLARATIVO no payload: nada no caminho de deploy lia o
 * campo. O incidente de producao provou o custo disso -- `CORS_ORIGIN` estava ausente,
 * `CISNE_PUBLIC_API_URL` apontava `https://` para uma API que so serve HTTP, os containers
 * subiram com `restarts=0`, `/health/ready` respondia `database=up` e a tela de login dizia
 * "Nao foi possivel conectar ao servidor". Configuracao manual no painel do Coolify virou
 * estado magico que o pipeline nao enxergava.
 *
 * Esta funcao transforma "precisa estar configurado" em contrato executavel: o deploy reprova
 * ANTES de tocar o runtime.
 *
 * Nunca registra o VALOR da variavel (pode ser segredo). Reporta apenas a chave.
 */
export async function verifyRequiredEnvironment(plan, client, { onStep = () => {} } = {}) {
  const problemas = [];

  for (const step of plan) {
    const required = Array.isArray(step.requiredEnvironment) ? step.requiredEnvironment : [];
    if (required.length === 0) continue;

    const envs = await client.listEnvironment(step.uuid);
    const byKey = new Map();
    for (const item of Array.isArray(envs) ? envs : []) {
      const key = item?.key;
      if (typeof key !== 'string') continue;
      // O Coolify guarda DUAS entradas por variavel: a de producao (`is_preview: false`) e
      // uma de preview (`is_preview: true`). Apenas a nao-preview e injetada no container de
      // producao. Contar as duas produziria "duplicata" em toda variavel -- falso positivo
      // medido contra a API real do Coolify 4.4.7. Filtrar por `is_preview` e o que separa
      // ambiguidade REAL (duas entradas de producao) de ruido estrutural do painel.
      if (item?.is_preview === true) continue;
      const atual = byKey.get(key) ?? [];
      atual.push(item);
      byKey.set(key, atual);
    }

    for (const key of required) {
      const entries = byKey.get(key) ?? [];
      if (entries.length === 0) {
        problemas.push(`${step.key}: variavel obrigatoria ausente: ${key}`);
        continue;
      }
      // A API v1 do Coolify nao tem PATCH: recriar uma variavel exige DELETE + POST. Se as
      // duas etapas rodarem sem conferir cardinalidade, sobram DUAS entradas com a mesma
      // chave e nao ha como saber qual valor o container recebe. Ambiguidade de runtime e
      // recusada, nunca tolerada.
      if (entries.length > 1) {
        problemas.push(`${step.key}: variavel duplicada (${entries.length}x) no Coolify: ${key}`);
        continue;
      }
      const valor = entries[0]?.real_value ?? entries[0]?.value;
      if (typeof valor !== 'string' || valor.trim() === '') {
        problemas.push(`${step.key}: variavel obrigatoria vazia: ${key}`);
      }
    }
  }

  if (problemas.length > 0) {
    throw new DeployRefusedError(
      `ambiente de runtime invalido, deploy recusado: ${problemas.join(' | ')}`,
    );
  }
  onStep('[coolify-deploy] variaveis obrigatorias presentes e nao vazias');
  return true;
}

/**
 * Provenance ANTES do deploy: o manifest da tag `<repository>:<sourceSha>` precisa
 * resolver exatamente para `expectedDigest`.
 *
 * Existe porque o Coolify so aceita tag (nao digest). Assim a imutabilidade nao e
 * abandonada: ela e verificada no registry antes de o runtime ser tocado. Se a tag
 * apontar para outro digest, o deploy e reprovado sem efeito.
 */
export async function verifyPublishedDigest(plan, resolveManifestDigest) {
  const checked = new Map();
  for (const step of plan) {
    const key = `${step.repository}:${step.tag}`;
    let digest = checked.get(key);
    if (digest === undefined) {
      digest = await resolveManifestDigest(step.repository, step.tag);
      if (!digest) {
        throw new DeployRefusedError(`manifest ausente para ${key}`);
      }
      digest = String(digest).trim().toLowerCase();
      checked.set(key, digest);
    }
    if (digest !== step.expectedDigest) {
      throw new DeployRefusedError(
        `${key} resolve para ${digest}, mas o payload autoriza ${step.expectedDigest}`,
      );
    }
  }
  return plan;
}

/** Resolve o digest real da tag no GHCR usando apenas manifest anonimo. */
export function createGhcrDigestResolver({ fetchImpl = fetch } = {}) {
  return async function resolveManifestDigest(repository, tag) {
    const [host, ...rest] = repository.split('/');
    const path = rest.join('/');
    const tokenResponse = await fetchImpl(
      `https://${host}/token?scope=repository:${path}:pull&service=${host}`,
    );
    if (!tokenResponse.ok) {
      throw new DeployRefusedError(`token GHCR negado para ${repository}`);
    }
    const { token } = await tokenResponse.json();
    const manifestResponse = await fetchImpl(`https://${host}/v2/${path}/manifests/${tag}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:
          'application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json',
      },
    });
    if (!manifestResponse.ok) {
      return null;
    }
    // O digest da tag e o cabecalho Docker-Content-Digest (o corpo e o manifest).
    return manifestResponse.headers.get('docker-content-digest');
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
  const { timeoutMs, intervalMs, sleep, onStep = () => {}, resolveManifestDigest } = options;

  // Provenance ANTES de tocar o runtime: tag -> digest precisa bater com o payload.
  if (resolveManifestDigest) {
    onStep('[coolify-deploy] verificando digests publicados no GHCR');
    await verifyPublishedDigest(plan, resolveManifestDigest);
    onStep('[coolify-deploy] digests conferem com o payload autorizado');
  }

  // Configuracao de runtime ANTES de tocar o runtime. Uma imagem correta com ambiente
  // incompleto produz um container saudavel que nao serve o usuario (incidente CORS).
  onStep('[coolify-deploy] verificando variaveis de ambiente obrigatorias');
  await verifyRequiredEnvironment(plan, client, { onStep });

  const results = [];
  for (const step of plan) {
    onStep(`[coolify-deploy] ${step.key}: fixando ${step.repository}:${step.tag}`);
    await client.pinImage(step.uuid, { repository: step.repository, tag: step.tag });

    if (step.startCommand) {
      onStep(`[coolify-deploy] ${step.key}: start_command = ${step.startCommand}`);
      await client.setStartCommand(step.uuid, step.startCommand);
    }

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
    results.push({
      key: step.key,
      deploymentUuid,
      status: finished?.status ?? 'unknown',
      repository: step.repository,
      tag: step.tag,
      digest: step.expectedDigest,
    });
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
    // Provenance: confirma que cada tag resolve para o digest autorizado antes
    // de qualquer efeito no runtime.
    resolveManifestDigest: createGhcrDigestResolver(),
  });

  console.log(`[coolify-deploy] concluido ${JSON.stringify(results)}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCli().catch((error) => {
    console.error(`[coolify-deploy] FALHA: ${error.message}`);
    process.exitCode = 1;
  });
}
