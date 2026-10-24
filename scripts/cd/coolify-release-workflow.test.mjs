import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { it, describe } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * CONTRATO DOS COMANDOS DO WORKFLOW DE RELEASE.
 *
 * DEFEITO REAL QUE ESTE TESTE IMPEDE DE VOLTAR
 *
 * O step do browser gate chamava `pnpm exec playwright install --with-deps chromium`.
 * O deploy foi concluido, o smoke passou, e o gate reprovou com:
 *
 *   line 2: pnpm: command not found
 *   ##[error]Process completed with exit code 127
 *
 * O `pnpm/action-setup` exporta o binario apenas no escopo do SEU step de `run`; o step
 * seguinte nao herda o PATH. Com `set -euo pipefail`, o comando ausente derrubou o step
 * e o gate nunca executou — reprovando um release com producao saudavel.
 *
 * A licao e estrutural: comando de shell dentro do workflow nao pode depender de um
 * binario que so existe no PATH de outro step. Os testes abaixo verificam isso lendo o
 * YAML REAL, nao uma copia.
 */
const WORKFLOW = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.github',
  'workflows',
  'coolify-release.yml',
);

function readWorkflow() {
  return readFileSync(WORKFLOW, 'utf8');
}

/** Extrai os blocos `run: |` do YAML, preservando o texto de cada comando. */
function runBlocks(source) {
  const blocks = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const inline = /^\s*(?:-\s+)?run:\s*(?!\|)(.+)$/.exec(line);
    if (inline) {
      blocks.push(inline[1].trim());
      continue;
    }
    if (/^\s*(?:-\s+)?run:\s*\|\s*$/.test(line)) {
      const body = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j];
        if (next.trim() === '') {
          body.push('');
          continue;
        }
        if (!/^\s{6,}/.test(next)) {
          break;
        }
        body.push(next.trim());
      }
      blocks.push(body.join('\n'));
    }
  }
  return blocks;
}

describe('coolify-release.yml — comandos de shell portaveis', () => {
  it('nao invoca `pnpm` dentro de step que nao configura o proprio PATH', () => {
    const offending = runBlocks(readWorkflow()).filter((block) =>
      /(^|\n)\s*pnpm\s/.test(block),
    );
    // Os steps que usam pnpm declaram `pnpm/action-setup` antes. Se um bloquear o outro,
    // este teste fica vermelho em vez de o release falhar em producao.
    for (const block of offending) {
      assert.ok(
        /corepack|pnpm\/action-setup|PNPM_HOME/.test(block),
        `bloco usa pnpm sem configurar o PATH:\n${block}`,
      );
    }
  });

  it('o browser gate instala o Chromium pelo CLI do proprio pacote', () => {
    const source = readWorkflow();
    assert.ok(
      source.includes('coolify-browser-gate.mjs'),
      'o step do browser gate sumiu do workflow',
    );
    assert.match(
      source,
      /node scripts\/cd\/install-playwright-chromium\.mjs/,
      'a instalacao do Chromium deve vir do script dedicado',
    );
    // Caminho fixo para `node_modules` e suposicao sobre o layout de instalacao: em pnpm
    // workspaces o pacote pode viver em `node_modules/.pnpm/...` e o caminho direto pelo
    // workspace nem sempre existe. Isso reprovou no CI com `Cannot find module`.
    assert.doesNotMatch(
      source,
      /node apps\/web\/node_modules\//,
      'o workflow nao pode depender de caminho fixo em node_modules',
    );
    assert.doesNotMatch(
      source,
      /^\s*pnpm exec playwright/m,
      'pnpm nao esta no PATH de todos os steps',
    );
  });

  it('a URL publica do Web e extraida da saida auditavel do smoke', () => {
    const source = readWorkflow();
    // A URL so existe dentro do step do smoke (vem do Coolify via secret). Se o contrato
    // de saida mudar sem atualizar a extracao, o gate recebe string vazia e o release cai.
    assert.ok(source.includes('web-url='), 'o smoke deve publicar a linha web-url=');
    assert.ok(
      source.includes('web_url=$WEB_URL'),
      'o step deve expor web_url como output para o gate',
    );
    assert.ok(
      source.includes('CISNE_PROD_WEB_URL: ${{ steps.prod-smoke.outputs.web_url }}'),
      'o gate deve consumir o output do smoke',
    );
  });

  it('as evidencias do browser gate sobem mesmo em falha', () => {
    const source = readWorkflow();
    const uploadIndex = source.indexOf('Upload browser gate evidence');
    assert.ok(uploadIndex > 0, 'falta o upload das evidencias');
    const uploadBlock = source.slice(uploadIndex, uploadIndex + 400);
    assert.match(
      uploadBlock,
      /if:\s*always\(\)/,
      'evidencia de falha e exatamente a que se precisa ver: o upload nao pode ser condicional ao sucesso',
    );
  });
});
