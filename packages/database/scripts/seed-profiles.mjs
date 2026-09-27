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
 * Senhas dos logins estaticos de desenvolvimento.
 *
 * O requisito permanece: estes logins precisam funcionar sempre com exatamente estes
 * valores. O que muda e ONDE o valor vive — uma credencial de homologacao em texto plano
 * no repositorio vaza em qualquer clone, entao o valor passa a vir do ambiente local
 * (`.env`, gitignored; ver `.env.example`).
 *
 * NAO existe default silencioso: sem a variavel o script falha alto e explica o que
 * falta. Assim um login diferente do esperado nunca e semeado em silencio — que era a
 * preocupacao registrada na decisao anterior.
 *
 * Os identificadores vem do modulo canonico (`./dist/seed/operational-profiles.js`).
 *
 * `rafael@` NAO esta nesta lista: ele e o desenvolvedor com acesso GLOBAL (decisao de
 * 2026-09-25) e e semeado por `scripts/repair-dev-login.mjs`, que enxerga o catalogo de
 * actions da API. O empregado operacional tem login proprio (`empregado@`).
 */
function requireDevPassword(variableName) {
  const value = process.env[variableName]?.trim();
  if (!value) {
    console.error(
      `CONFIGURATION_ERROR: ${variableName} is required to seed the static development ` +
        'profiles. Set it in the local .env (gitignored); see .env.example.',
    );
    process.exit(1);
  }
  return value;
}

const controlePassword = requireDevPassword('DEV_PROFILE_OWNER_PASSWORD');
const controleFinanceiroPassword = requireDevPassword('DEV_PROFILE_FINANCE_PASSWORD');
const empregadoPassword = requireDevPassword('DEV_PROFILE_EMPLOYEE_PASSWORD');

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
    empregado: EMPREGADO_LOGIN,
  };
  const expectedLogins = {
    abrahim: result.controleLogin,
    monica: result.controleFinanceiroLogin,
    empregado: result.empregadoLogin,
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
