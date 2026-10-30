import 'reflect-metadata';
import { config } from 'dotenv';
import { appendFileSync } from 'node:fs';
import { Pool } from 'pg';
import { assertHmlIsolation } from '../hml-config';

/** Read-only HML evidence locator; it never creates or alters economic facts. */
async function main() {
  config({ path: '.env.hml' });
  assertHmlIsolation(process.env);
  const url = process.env['DATABASE_URL'];
  const envFile = process.env['GITHUB_ENV'];
  if (!url || !envFile) throw new Error('HML_BROWSER_ORIGINS_ENV_REQUIRED');

  const pool = new Pool({ connectionString: url });
  try {
    const lines: string[] = [];
    for (const [label, scenario] of [['ALFA', 'locacao-full'], ['BETA', 'transporte-full']] as const) {
      const result = await pool.query<{
        client_id: string; contract_id: string; service_order_id: string; unit_id: string;
      }>(
        `SELECT cl.id::text AS client_id, co.id::text AS contract_id,
                so.id::text AS service_order_id, so.unit_id::text AS unit_id
           FROM pty.clients cl
           JOIN so.service_orders so ON so.client_id = cl.id AND so.status = 'COMPLETED'
           JOIN com.contracts co ON co.id = so.contract_id AND co.client_id = cl.id
             AND co.status = 'ACTIVE'
          WHERE cl.external_erp_id = $1`,
        [`cisne-synthetic-dev-v1:${scenario}`],
      );
      if (result.rows.length !== 1) {
        throw new Error(`HML_BROWSER_CONTRACT_ORIGIN_MISSING:${scenario}:found=${result.rows.length}`);
      }
      const origin = result.rows[0]!;
      const finance = await pool.query<{ receivable_id: string; settlement_id: string }>(
        `SELECT r.id::text AS receivable_id, s.id::text AS settlement_id
           FROM fin.receivables r
           JOIN fin.settlements s ON s.receivable_id = r.id AND s.status = 'POSTED'
          WHERE r.origin_service_order_id = $1`,
        [origin.service_order_id],
      );
      if (finance.rows.length !== 1) {
        throw new Error(`HML_BROWSER_FINANCE_ORIGIN_MISSING:${scenario}:found=${finance.rows.length}`);
      }
      const monetary = finance.rows[0]!;
      lines.push(`HML_${label}_RECEIVABLE_ID=${monetary.receivable_id}`);
      lines.push(`HML_${label}_SETTLEMENT_ID=${monetary.settlement_id}`);
      lines.push(`HML_${label}_CLIENT_ID=${origin.client_id}`);
      lines.push(`HML_${label}_CONTRACT_ID=${origin.contract_id}`);
      lines.push(`HML_${label}_SERVICE_ORDER_ID=${origin.service_order_id}`);
      lines.push(`HML_${label}_UNIT_ID=${origin.unit_id}`);
      process.stdout.write(`HML_BROWSER_ORIGIN:${scenario}:contract=${origin.contract_id}:os=${origin.service_order_id}\n`);
    }
    appendFileSync(envFile, `${lines.join('\n')}\n`, 'utf8');
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
