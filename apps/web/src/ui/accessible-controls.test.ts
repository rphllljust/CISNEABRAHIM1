import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * P0 — NENHUM CONTROLE INTERATIVO SEM NOME ACESSIVEL.
 *
 * A auditoria visual achou "botao vazio": controle renderizado sem texto, sem `aria-label`
 * e sem `title`, que o leitor de tela anuncia como "botao" e o operador ve como um quadrado
 * sem funcao. Isso nao se corrige tela a tela: corrige-se na origem e se impede a reincidencia.
 *
 * Este teste varre o codigo fonte (nao o DOM de uma tela especifica) porque o defeito pode
 * nascer em QUALQUER tela nova. Ele falha apontando arquivo e linha.
 */

const SOURCE_ROOT = join(__dirname, '..');

/** Elementos clicaveis que exigem nome acessivel proprio. */
const CONTROL_TAGS = ['Button', 'button', 'IconButton'] as const;

function listTsxFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry.startsWith('.')) {
      continue;
    }
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...listTsxFiles(full));
      continue;
    }
    if (full.endsWith('.tsx') && !full.endsWith('.test.tsx')) {
      found.push(full);
    }
  }
  return found;
}

type Violation = { file: string; line: number; snippet: string };

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/**
 * Varre tags MULTILINHA tambem (um `<Button\n variant="x"\n />` vazio escaparia de uma
 * varredura linha a linha). Cada tag e lida ate o SEU proprio `>`, senao a varredura
 * cruzaria elementos e acusaria falso positivo em `<Button>texto</Button>`.
 */
function findEmptyControls(source: string, file: string): Violation[] {
  const violations: Violation[] = [];
  const tagAlternation = CONTROL_TAGS.join('|');

  // `[^>]*` atravessa quebras de linha das props, mas para no fim da propria tag.
  const tagPattern = new RegExp(`<(${tagAlternation})\\b([^>]*?)(\\/?)>`, 'g');

  for (const match of source.matchAll(tagPattern)) {
    const tag = match[1];
    const attributes = match[2] ?? '';
    const isSelfClosing = match[3] === '/';
    const hasAccessibleName = /aria-label=|title=|aria-labelledby=/.test(attributes);

    if (isSelfClosing) {
      if (!hasAccessibleName) {
        violations.push({
          file,
          line: lineOf(source, match.index ?? 0),
          snippet: `<${tag} … /> sem nome acessível`,
        });
      }
      continue;
    }

    // Tag de abertura: e vazio apenas se fechar imediatamente, sem conteudo.
    const afterOpenTag = source.slice((match.index ?? 0) + match[0].length);
    const closesImmediately = new RegExp(`^\\s*</${tag}>`).test(afterOpenTag);
    if (closesImmediately && !hasAccessibleName) {
      violations.push({
        file,
        line: lineOf(source, match.index ?? 0),
        snippet: `<${tag}></${tag}> vazio sem nome acessível`,
      });
    }
  }

  return violations;
}

describe('P0 — nome acessível em todo controle interativo', () => {
  it('nenhum Button/button/IconButton vazio e sem aria-label no código-fonte', () => {
    const files = listTsxFiles(SOURCE_ROOT);
    const violations = files.flatMap((file) =>
      findEmptyControls(readFileSync(file, 'utf8'), relative(SOURCE_ROOT, file)),
    );

    expect(
      violations,
      `Controles interativos sem nome acessível:\n${violations
        .map((violation) => `  ${violation.file}:${violation.line} → ${violation.snippet}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});
