/**
 * EXTRATOR DE STRINGS NÃO RASTREADAS — varre `apps/web/src/**\/*.tsx` e lista o texto
 * literal em português que NÃO está em nenhum catálogo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTE SCRIPT NÃO CORRIGE NADA. Ele só reporta.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A pergunta que ele responde: "quanto texto de interface ainda está escrito direto no
 * JSX, fora do i18n?". A resposta é um número e uma amostra — o suficiente para planejar a
 * migração, sem reescrever arquivo nenhum por conta própria.
 *
 * Como roda (Node, sem build, sem dependência):
 *
 *   node --experimental-strip-types apps/web/src/i18n/extract.ts
 *   pnpm --filter @cisne/web exec tsx src/i18n/extract.ts   (se `tsx` estiver disponível)
 *
 * Saída:
 *   - `apps/web/src/i18n/untracked-strings.txt` — contagem + exemplos com arquivo:linha;
 *   - o mesmo resumo no stdout, para quem roda no terminal.
 *
 * ── O QUE CONTA COMO STRING DE INTERFACE ──────────────────────────────────────
 *
 * Um literal é reportado quando TODAS estas condições valem:
 *
 *   1. tem 2+ caracteres e contém uma LETRA;
 *   2. tem marca de português — acento, cedilha, ou palavra funcional pt-BR (não, sim,
 *      sem, com, para, de, da, do, os, as, um, uma, na, no, por, que, não…);
 *   3. aparece em posição de TEXTO: filho de JSX, `label`/`title`/`placeholder`/
 *      `aria-label`/`message`/`description`, ou `{...}` dentro do JSX.
 *
 * Ficam de fora, de propósito, porque reportá-los seria ruído que esconde o sinal:
 *
 *   - `data-testid`, `data-*`, `className`, `id`, `href`, `to`, `route`, `path` — não são
 *     texto de interface;
 *   - chaves de tradução (`t('...')`, `i18n`) e texto já traduzido;
 *   - `console.*`, `throw new Error(...)`, `*ApiError` — mensagem de desenvolvedor, não de
 *     operador (e são o que o catálogo `error.*` existe para cobrir na borda da tela);
 *   - comentários de qualquer tipo — a documentação deste repositório é em português e
 *     comentário não vira pixel.
 *
 * ── LIMITE DECLARADO (honestidade, não perfeição) ─────────────────────────────
 *
 * O extrator é LÉXICO, não um parser TypeScript completo: ele remove comentários e então
 * casa literais por expressão regular. Consequências conhecidas e aceitas:
 *
 *   - um literal que já está no catálogo AINDA é reportado se o código o escreve à mão em
 *     vez de chamar `t()`. Isso é intencional: o problema não é a string existir, é a tela
 *     não passar pelo i18n;
 *   - texto montado por concatenação só é visto no primeiro literal;
 *   - markdown/template longo não é avaliado por conteúdo.
 *
 * Um extrator que erra para MAIS é mais útil que um que esconde: o falso positivo custa uma
 * linha de leitura, o falso negativo custa uma tela em português num sistema em inglês.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `apps/web` — dois níveis acima de `src/i18n/`. */
const WEB_ROOT = resolve(HERE, '..', '..');
const SRC_ROOT = join(WEB_ROOT, 'src');
const OUTPUT_FILE = join(HERE, 'untracked-strings.txt');
const REPORT_LIMIT = 200;

/** Atributos cujo valor É texto de interface. */
const UI_ATTRIBUTES = new Set([
  'label',
  'title',
  'placeholder',
  'aria-label',
  'aria-description',
  'alt',
  'message',
  'description',
  'emptyMessage',
  'errorMessage',
  'header',
  'tooltip',
]);

/** Atributos que NUNCA são texto de interface, mesmo contendo letras. */
const NON_UI_ATTRIBUTES = new Set([
  'data-testid',
  'className',
  'class',
  'id',
  'href',
  'to',
  'src',
  'key',
  'role',
  'type',
  'name',
  'value',
  'htmlFor',
  'form',
  'target',
  'rel',
  'style',
  'onClick',
  'onChange',
  'onSubmit',
  'onClose',
  'onSelect',
  'slot',
  'variant',
  'size',
  'tone',
  'theme',
  'view',
  'path',
  'route',
  'field',
  'entity',
]);

/**
 * Palavras funcionais do português.
 *
 * Uma string de interface pt-BR quase sempre contém uma delas. Exigir a palavra (ou um
 * acento) evita reportar `"asc"`, `"row"`, `"GET"` — que são literais técnicos, não texto.
 */
const PT_WORDS = [
  'não',
  'nao',
  'sim',
  'sem',
  'com',
  'para',
  'por',
  'que',
  'uma',
  'um',
  'dos',
  'das',
  'do',
  'da',
  'dos',
  'os',
  'as',
  'de',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'ao',
  'aos',
  'se',
  'ou',
  'erro',
  'total',
  'novo',
  'nova',
  'todos',
  'todas',
  'nenhum',
  'nenhuma',
  'cliente',
  'ordem',
  'serviço',
  'servico',
  'valor',
  'data',
  'situação',
  'situacao',
  'unidade',
  'conta',
  'prazo',
  'ações',
  'acoes',
];

/** Marcas de português: acentuação e cedilha que o inglês não usa. */
const PT_ACCENTS = /[áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ]/;

/** `true` quando o texto parece português o bastante para ser interface. */
function looksPortuguese(text: string): boolean {
  if (text.length < 2) {
    return false;
  }
  if (!/[A-Za-zÀ-ÿ]/.test(text)) {
    return false;
  }
  if (PT_ACCENTS.test(text)) {
    return true;
  }
  const lower = text.toLowerCase();
  return PT_WORDS.some((word) => new RegExp(`(^|[^a-zà-ÿ])${word}([^a-zà-ÿ]|$)`, 'i').test(lower));
}

/**
 * Remove comentários preservando as posições de linha.
 *
 * Cada comentário vira espaços do MESMO comprimento, então as linhas continuam batendo com
 * o arquivo original — o relatório aponta `arquivo:linha` e o número tem de ser verdadeiro.
 */
function stripComments(source: string): string {
  let result = '';
  let index = 0;
  let mode: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (mode === 'code') {
      if (char === '/' && next === '/') {
        mode = 'line';
        result += '  ';
        index += 2;
        continue;
      }
      if (char === '/' && next === '*') {
        mode = 'block';
        result += '  ';
        index += 2;
        continue;
      }
      if (char === "'") mode = 'single';
      else if (char === '"') mode = 'double';
      else if (char === '`') mode = 'template';
      result += char;
      index += 1;
      continue;
    }

    if (mode === 'line') {
      if (char === '\n') {
        mode = 'code';
        result += char;
      } else {
        result += ' ';
      }
      index += 1;
      continue;
    }

    if (mode === 'block') {
      if (char === '*' && next === '/') {
        mode = 'code';
        result += '  ';
        index += 2;
        continue;
      }
      result += char === '\n' ? '\n' : ' ';
      index += 1;
      continue;
    }

    // Dentro de um literal: copia cru, respeitando escape.
    if (char === '\\') {
      result += char + (next ?? '');
      index += 2;
      continue;
    }
    if (
      (mode === 'single' && char === "'") ||
      (mode === 'double' && char === '"') ||
      (mode === 'template' && char === '`')
    ) {
      mode = 'code';
    }
    result += char;
    index += 1;
  }

  return result;
}

export type Finding = {
  file: string;
  line: number;
  column: number;
  text: string;
  /** Onde o literal apareceu: filho de JSX ou um atributo nomeado. */
  context: string;
};

/** `true` quando a linha parece território de desenvolvedor, não de operador. */
function isDeveloperNoise(lineText: string): boolean {
  return (
    /console\.(log|warn|error|info|debug)/.test(lineText) ||
    /new\s+\w*(Error|Exception)\s*\(/.test(lineText) ||
    /^\s*(\/\/|\*|\/\*)/.test(lineText) ||
    /\bimport\b/.test(lineText) ||
    /\bexport\s+type\b/.test(lineText)
  );
}

/** Analisa um arquivo e devolve os literais de interface não rastreados. */
export function extractFromSource(source: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const stripped = stripComments(source);
  const lines = stripped.split(/\r?\n/);
  const rawLines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const rawLine = rawLines[index] ?? '';

    if (isDeveloperNoise(rawLine)) {
      return;
    }

    // (a) ATRIBUTO de texto: `label="Carregando…"` / `placeholder={'Buscar'}`.
    const attributePattern = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(?:\{)?\s*(['"])(.*?)\2/g;
    let attributeMatch: RegExpExecArray | null;
    while ((attributeMatch = attributePattern.exec(line)) !== null) {
      const attribute = attributeMatch[1] ?? '';
      const value = attributeMatch[3] ?? '';
      if (NON_UI_ATTRIBUTES.has(attribute) || !UI_ATTRIBUTES.has(attribute)) {
        continue;
      }
      if (looksPortuguese(value)) {
        findings.push({
          file: filePath,
          line: lineNumber,
          column: attributeMatch.index + 1,
          text: value,
          context: `atributo ${attribute}`,
        });
      }
    }

    /*
     * (b) FILHO DE JSX: `>Texto<` ou `>` numa linha e o texto na seguinte.
     *
     * O `>...<` pega o caso comum. O texto na linha seguinte é pego pela varredura de
     * literais de string abaixo quando o filho é `{'...'}`.
     */
    const jsxChildPattern = />\s*([^<>{}\n]{2,}?)</g;
    let childMatch: RegExpExecArray | null;
    while ((childMatch = jsxChildPattern.exec(line)) !== null) {
      const value = (childMatch[1] ?? '').trim();
      if (looksPortuguese(value)) {
        findings.push({
          file: filePath,
          line: lineNumber,
          column: childMatch.index + 1,
          text: value,
          context: 'filho de JSX',
        });
      }
    }

    // (c) `{'Texto'}` / `{"Texto"}` — literal em posição de conteúdo.
    const expressionPattern = /\{\s*(['"])(.*?)\1\s*\}/g;
    let expressionMatch: RegExpExecArray | null;
    while ((expressionMatch = expressionPattern.exec(line)) !== null) {
      const value = expressionMatch[2] ?? '';
      if (looksPortuguese(value)) {
        findings.push({
          file: filePath,
          line: lineNumber,
          column: expressionMatch.index + 1,
          text: value,
          context: 'expressão JSX',
        });
      }
    }
  });

  return findings;
}

/** Percorre `dir` e devolve todo `*.tsx`, ignorando diretórios de build. */
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Executa a varredura e grava o relatório. Devolve o resumo. */
export function runExtraction(): { total: number; files: number; findings: Finding[] } {
  const files = walk(SRC_ROOT).sort();
  const findings: Finding[] = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const relativePath = relative(WEB_ROOT, file).split('\\').join('/');
    findings.push(...extractFromSource(source, relativePath));
  }

  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    const bucket = byFile.get(finding.file) ?? [];
    bucket.push(finding);
    byFile.set(finding.file, bucket);
  }

  const header = [
    'CISNE — STRINGS DE INTERFACE NÃO RASTREADAS (extração automática)',
    '',
    'Gerado por: apps/web/src/i18n/extract.ts',
    `Catálogo de referência: apps/web/src/i18n/pt-BR.json`,
    '',
    `Arquivos .tsx varridos : ${files.length}`,
    `Strings hardcoded      : ${findings.length}`,
    `Arquivos com achados   : ${byFile.size}`,
    '',
    'ESTE RELATÓRIO NÃO CORRIGE NADA. Ele só reporta.',
    '',
    '─'.repeat(78),
    '',
  ];

  const body: string[] = [];
  const orderedFiles = [...byFile.keys()].sort();
  for (const file of orderedFiles) {
    const bucket = byFile.get(file) ?? [];
    body.push(`${file}  (${bucket.length})`);
    for (const finding of bucket.slice(0, REPORT_LIMIT)) {
      const text = finding.text.replace(/\s+/g, ' ').trim();
      body.push(`  ${String(finding.line).padStart(4)}:${String(finding.column).padStart(3)}  [${finding.context}] ${text}`);
    }
    if (bucket.length > REPORT_LIMIT) {
      body.push(`  … e mais ${bucket.length - REPORT_LIMIT} nesta arquivo (truncado)`);
    }
    body.push('');
  }

  const footer = [
    '─'.repeat(78),
    '',
    'TOTAL: ' + findings.length + ' strings hardcoded em apps/web/src',
    '',
  ];

  writeFileSync(OUTPUT_FILE, [...header, ...body, ...footer].join('\n'), 'utf8');

  return { total: findings.length, files: files.length, findings };
}

/*
 * Execução direta.
 *
 * `import.meta.url` é comparado com o caminho do processo para que o arquivo possa ser
 * IMPORTADO por um teste sem disparar o relatório como efeito colateral.
 */
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).replace(/\.(ts|js)$/, '') === fileURLToPath(import.meta.url).replace(/\.(ts|js)$/, '');

if (invokedDirectly) {
  const summary = runExtraction();
  console.log('CISNE — extração de strings hardcoded');
  console.log(`  arquivos .tsx varridos : ${summary.files}`);
  console.log(`  strings hardcoded      : ${summary.total}`);
  console.log(`  relatório              : ${relative(process.cwd(), OUTPUT_FILE).split('\\').join('/')}`);
  const top = new Map<string, number>();
  for (const finding of summary.findings) {
    top.set(finding.file, (top.get(finding.file) ?? 0) + 1);
  }
  const ranked = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (ranked.length > 0) {
    console.log('  top arquivos:');
    for (const [file, count] of ranked) {
      console.log(`    ${String(count).padStart(4)}  ${file}`);
    }
  }
}
