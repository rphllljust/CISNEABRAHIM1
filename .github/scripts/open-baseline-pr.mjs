#!/usr/bin/env node
/**
 * Abre o PR DRAFT de revisao do baseline visual usando SOMENTE Node.
 *
 * POR QUE ESTE SCRIPT EXISTE
 *
 * O container `mcr.microsoft.com/playwright:v1.62.1-noble` NAO tem `gh` (exit 127) e,
 * medido no run 43621298884, tambem nao tem `curl`/`jq` no caminho do `run` — o step
 * "Abrir PR draft com os PNGs" morria com exit 127 DEPOIS de ja ter empurrado o branch.
 * Resultado: os PNGs ficavam em `bot/visual-baseline-*` sem nenhuma superficie de revisao,
 * quebrando a politica declarada em `visual-baseline.yml` ("O PNG so existe depois de
 * revisao humana do PR").
 *
 * `node` e garantido no container (o proprio job executa `node --test` e
 * `visual-runtime-verify.mjs`), e o Node 18+ tem `fetch` nativo. Sem dependencia nova.
 *
 * Contrato: cria o PR como DRAFT. Nunca marca ready. Nunca aprova nada.
 */
import { readFileSync } from 'node:fs';

const {
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  GITHUB_API_URL = 'https://api.github.com',
  GITHUB_SERVER_URL = 'https://github.com',
  GITHUB_RUN_ID,
  BASELINE_REF,
  SPECS,
  BASE_BRANCH = 'main',
} = process.env;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

for (const [name, value] of Object.entries({
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  GITHUB_RUN_ID,
  BASELINE_REF,
  SPECS,
})) {
  if (!value) fail(`variavel de ambiente ausente: ${name}`);
}

const head = `bot/visual-baseline-${GITHUB_RUN_ID}`;
const runUrl = `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;

const title = `test(visual): baseline (${SPECS}) - DRAFT, revisar tela a tela`;
const body = [
  `Baseline gerado por \`workflow_dispatch\` no container pinado a partir de \`${BASELINE_REF}\`.`,
  '',
  '**Este PR e DRAFT de proposito.** Os PNGs abaixo so devem ser aceitos depois de revisao',
  'visual tela a tela. Nenhuma aprovacao foi registrada automaticamente.',
  '',
  `Run: ${runUrl}`,
].join('\n');

const response = await fetch(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/pulls`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ title, head, base: BASE_BRANCH, draft: true, body }),
});

const text = await response.text();

if (response.status !== 201) {
  fail(`falha ao abrir PR draft (HTTP ${response.status}): ${text}`);
}

const pr = JSON.parse(text);
if (!pr?.number || !pr?.html_url) {
  fail(`resposta sem number/html_url: ${text}`);
}

console.log(`PR draft aberto: #${pr.number} ${pr.html_url}`);
