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
  it('todo `pnpm` do workflow tem `pnpm/action-setup` no mesmo job', () => {
    /**
     * A regra é do JOB, não do bloco: `pnpm/action-setup` exporta o binário para os
     * steps SEGUINTES do mesmo job. O defeito real (release 40104324422) foi exatamente
     * um job do release SEM setup nenhum chamando `pnpm` — `command not found`, exit 127.
     *
     * Verificar bloco a bloco daria falso negativo quando o pnpm está instalado por um
     * step anterior do mesmo job, e falso positivo quando o setup existe em outro job.
     */
    const source = readWorkflow();
    const usesPnpm = runBlocks(source).some((block) => /(^|\n)\s*pnpm\s/.test(block));
    if (!usesPnpm) {
      return;
    }
    assert.match(
      source,
      /pnpm\/action-setup@v\d+/,
      'o workflow usa pnpm e precisa declarar pnpm/action-setup (senao o binario nao existe no PATH)',
    );
  });

  it('o job que roda o browser gate instala as dependencias antes', () => {
    const source = readWorkflow();
    /**
     * DEFEITO REAL: o job do release baixa o artifact imutavel e NAO instala
     * dependencias de workspace. O gate reprovou com
     * `Cannot find module '@playwright/test'` — a ferramenta de validacao simplesmente
     * nao existia ali. Setup do pnpm e do Node sao obrigatorios: sem eles o binario
     * `pnpm` nao esta no PATH (defeito do release 40104324422).
     */
    assert.match(source, /pnpm\/action-setup@v\d+/, 'falta o setup do pnpm');
    assert.match(source, /actions\/setup-node@v\d+/, 'falta o setup do Node.js');
    assert.match(
      source,
      /pnpm install --frozen-lockfile[^\n]*--filter @cisne\/web/,
      'o gate depende de @playwright/test: as dependencias do workspace precisam ser instaladas',
    );

    // A instalacao precisa vir ANTES do gate, senao o modulo continua ausente.
    const installIndex = source.indexOf('Install validation dependencies');
    const gateIndex = source.indexOf('Browser gate against production');
    assert.ok(installIndex > 0 && gateIndex > 0, 'steps do gate ausentes');
    assert.ok(
      installIndex < gateIndex,
      'as dependencias devem ser instaladas ANTES de executar o gate',
    );
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

  it('separa release técnica de ausência empresarial sem aprovar business', () => {
    const source = readWorkflow();
    const gateIndex = source.indexOf('Browser gate against production');
    const uploadIndex = source.indexOf('Upload browser gate evidence');
    const gateBlock = source.slice(gateIndex, uploadIndex);
    assert.match(gateBlock, /CISNE_RELEASE_PREREQUISITES_VERIFIED: 'true'/);
    assert.match(gateBlock, /productionRuntimeValidated=true/);
    assert.match(gateBlock, /businessEvidenceAvailable=false/);
    assert.match(gateBlock, /businessVerified=false/);
    assert.match(gateBlock, /productionBusinessValidated=NOT_APPLICABLE/);
    assert.match(gateBlock, /productionValidated=CONDITIONAL/);
    assert.match(gateBlock, /businessEvidenceAvailable=true/);
    assert.match(gateBlock, /productionValidated=true/);
    assert.doesNotMatch(gateBlock, /echo "PRODUCTION_VALIDATED=true"/);
  });

  it('cria o diretório de evidências antes de abrir o tee do Chromium', () => {
    const source = readWorkflow();
    const gateIndex = source.indexOf('Browser gate against production');
    const uploadIndex = source.indexOf('Upload browser gate evidence');
    const gateBlock = source.slice(gateIndex, uploadIndex);
    assert.match(
      gateBlock,
      /mkdir -p artifacts\/browser-gate[\s\S]*tee artifacts\/browser-gate\/verdict\.log/,
    );
  });
});
