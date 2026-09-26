import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Anti-recurrence gate for the journal reconciliation performed by
 * `ensure-migrations.ts`, the vitest `globalSetup` of the integration, e2e and
 * performance suites.
 *
 * Proven defect this guards (isolated PostgreSQL, incremental path 0071 → head):
 * `syncDrizzleJournal` recorded the hash of EVERY journal entry, including the two
 * tags that file had no coverage block for (0072, 0073). The journal read 79/79 while
 * `pty.legal_entities` and `bil.recurring_billing_schedules` did not exist, and the
 * drizzle migrator then found zero pending migrations — so the schema stayed behind
 * its journal permanently. Same class as the 0077/0078 defect, in a second runner.
 *
 * The guard is deliberately structural rather than a hash list: reconciliation may
 * only claim a migration applied if this file proves its effect, and the only proof
 * is the per-tag coverage block. So every journal tag must be covered, and a new
 * migration without a block fails here — in the unit suite, before any database runs.
 */

const repoRoot = resolve(__dirname, '../../../../');
const journalPath = join(repoRoot, 'packages/database/migrations/meta/_journal.json');
const ensureMigrationsPath = join(__dirname, 'ensure-migrations.ts');

const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
  entries: Array<{ idx: number; tag: string }>;
};

const source = readFileSync(ensureMigrationsPath, 'utf8');

describe('ensure-migrations journal coverage', () => {
  it('has at least one journal entry to check', () => {
    expect(journal.entries.length).toBeGreaterThan(0);
  });

  it('covers every journal tag with a per-migration coverage block', () => {
    const uncovered = journal.entries
      .filter((entry) => !source.includes(`${entry.tag}.sql`))
      .map((entry) => entry.tag);

    expect(
      uncovered,
      `journal tags without a coverage block in ensure-migrations.ts: ${uncovered.join(', ')}. ` +
        'Add the block, otherwise syncDrizzleJournal records them as applied without any ' +
        'proof that their effect exists and the migrator will skip them forever.',
    ).toEqual([]);
  });

  it('reconciles the journal only after the coverage checks, never before', () => {
    // A hash written before the coverage checks is a claim nothing has verified.
    const syncIndex = source.indexOf('await syncDrizzleJournal(pool)');
    const firstCoverageCheck = source.indexOf('const hasInfrastructureBaseline');

    expect(syncIndex, 'syncDrizzleJournal is never called').toBeGreaterThan(-1);
    expect(firstCoverageCheck).toBeGreaterThan(-1);
    expect(syncIndex).toBeGreaterThan(firstCoverageCheck);
  });

  it('treats a missing drizzle journal table as nothing to reconcile', () => {
    // A database that has never been migrated has no journal; throwing there would
    // make the fresh-database path fail instead of building the schema.
    expect(source).toContain("=== '42P01'");
  });
});
