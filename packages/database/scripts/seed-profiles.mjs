import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageRoot, '../..');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(resolve(repoRoot, '.env'));
if (!process.env['NODE_ENV']) {
  process.env['NODE_ENV'] = 'development';
}

/**
 * Logins estaticos de desenvolvimento.
 *
 * As senhas sao estaticas por requisito do responsavel: os tres logins abaixo precisam
 * funcionar sempre com exatamente estes valores. Nao ha override por variavel de ambiente —
 * um `CISNE_*_PASSWORD` exportado no shell mudaria o login silenciosamente e quebraria o
 * requisito. Os identificadores vem do modulo canonico (`./dist/seed/operational-profiles.js`).
 */
const controlePassword = 'Cisne-Abrahim-2026!';
const controleFinanceiroPassword = 'Cisne-Monica-2026!';
const empregadoPassword = 'Cisne-Rafael-Dev-2026!';

const requireFromDatabase = createRequire(resolve(packageRoot, 'package.json'));
const { Pool } = requireFromDatabase('pg');
const {
  ABRAHIM_OWNER_LOGIN,
  CONTROLE_FINANCEIRO_LOGIN,
  EMPREGADO_LOGIN,
  runOperationalProfilesSeed,
} = requireFromDatabase('./dist/seed/operational-profiles.js');

const databaseUrl = process.env['DATABASE_URL']?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
try {
  const result = await runOperationalProfilesSeed(pool, {
    controlePassword,
    controleFinanceiroPassword,
    empregadoPassword,
  });

  // O identificador canonico e o que foi semeado: se divergirem, o seed mudou de alvo.
  const seededLogins = {
    abrahim: ABRAHIM_OWNER_LOGIN,
    monica: CONTROLE_FINANCEIRO_LOGIN,
    rafael: EMPREGADO_LOGIN,
  };
  const expectedLogins = {
    abrahim: result.controleLogin,
    monica: result.controleFinanceiroLogin,
    rafael: result.empregadoLogin,
  };
  for (const [profile, expected] of Object.entries(expectedLogins)) {
    if (seededLogins[profile] !== expected) {
      throw new Error(`STATIC_LOGIN_DRIFT_${profile}: ${seededLogins[profile]} != ${expected}`);
    }
  }

  process.stdout.write(
    `${JSON.stringify({ ...result, passwordSource: 'static-development-profiles' })}\n`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
