import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { getTestDatabaseUrl, loadRepoEnv, syncDrizzleJournal } from './lib/database-test-env.mjs';

loadRepoEnv();

const testDatabaseUrl = getTestDatabaseUrl();
if (!testDatabaseUrl) {
  console.error('TEST_DATABASE_URL is required.');
  process.exit(1);
}

const require = createRequire(resolve(import.meta.dirname, '../packages/database/package.json'));
const { Pool } = require('pg');

const pool = new Pool({ connectionString: testDatabaseUrl });
try {
  const result = await syncDrizzleJournal(pool);
  console.log(JSON.stringify({ testDatabaseUrl: '[configured]', ...result }));

  // `repair` must be explicit and must not paper over a registry gap: a domain tag
  // without an artefact probe is left unrecorded on purpose (see
  // lib/database-test-env.mjs), so the repair command is the right place to fail
  // loudly instead of reporting a journal that only looks aligned.
  if (result.unprobed.length > 0) {
    console.error(
      `Unprobed domain migrations: ${result.unprobed.join(', ')}. ` +
        'Register an artefact probe in scripts/lib/database-test-env.mjs before repairing the journal.',
    );
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
