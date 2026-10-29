import 'reflect-metadata';
import { config } from 'dotenv';
import { Pool } from 'pg';

config({ path: process.env['CISNE_ENV'] === 'hml' ? '.env.hml' : '.env' });

const namespace = 'cisne-synthetic-dev-v1';
const flows = [
  { key: 'locacao-full', company: 'TESTE — ALFA LOGÍSTICA TESTE LTDA' },
  { key: 'transporte-full', company: 'TESTE — BETA SERVIÇOS INDUSTRIAIS TESTE LTDA' },
] as const;

async function main(): Promise<void> {
  if (process.env['CISNE_ENV'] !== 'hml' || process.env['HML_INTEGRATIONS_SANDBOX'] !== 'true') {
    throw new Error('HML business verification requires CISNE_ENV=hml and HML_INTEGRATIONS_SANDBOX=true');
  }
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const evidence: Array<Record<string, unknown>> = [];
    for (const flow of flows) {
      const client = await pool.query<{ id: string; legal_name: string }>(
        'SELECT id, legal_name FROM pty.clients WHERE external_erp_id = $1 LIMIT 1',
        [`${namespace}:${flow.key}`],
      );
      const clientRow = client.rows[0];
      if (!clientRow || !clientRow.legal_name.toUpperCase().includes(flow.company.split(' ')[1]!.toUpperCase())) {
        throw new Error(`business verification failed: ${flow.key} client identity missing or inconsistent`);
      }
      const order = await pool.query<{ id: string; status: string }>(
        'SELECT id, status FROM so.service_orders WHERE client_id = $1::uuid ORDER BY created_at DESC LIMIT 1',
        [clientRow.id],
      );
      const orderRow = order.rows[0];
      if (!orderRow || orderRow.status !== 'COMPLETED') {
        throw new Error(`business verification failed: ${flow.key} service order is not COMPLETED`);
      }
      const measurement = await pool.query<{ id: string; status: string }>(
        "SELECT id, status FROM msr.measurements WHERE service_order_id = $1::uuid AND status = 'APPROVED' ORDER BY created_at DESC LIMIT 1",
        [orderRow.id],
      );
      if (!measurement.rows[0]) throw new Error(`business verification failed: ${flow.key} has no approved measurement`);\n      const lines = await pool.query<{ unit_code: string }>(\n        `SELECT unit_code FROM msr.measurement_items WHERE measurement_id = $1::uuid`,\n        [measurement.rows[0].id],\n      );\n      if (!lines.rows.length || lines.rows.some((line) => ['HOUR', 'KM'].includes(line.unit_code.toUpperCase()))) {\n        throw new Error(`business verification failed: ${flow.key} has no valid commercial measurement lines`);\n      }
      const billing = await pool.query<{ record_id: string; document_id: string }>(
        'SELECT br.id AS record_id, bd.id AS document_id FROM bil.billing_records br INNER JOIN bil.billing_documents bd ON bd.billing_record_id = br.id WHERE br.service_order_id = $1::uuid LIMIT 1',
        [orderRow.id],
      );
      if (!billing.rows[0]) throw new Error(`business verification failed: ${flow.key} has no billing record/document`);
      evidence.push({ company: flow.company, scenario: flow.key, clientId: clientRow.id, serviceOrderId: orderRow.id, serviceOrderStatus: orderRow.status, measurementId: measurement.rows[0].id, measurementStatus: measurement.rows[0].status, commercialUnits: lines.rows.map((line) => line.unit_code), billingRecordId: billing.rows[0].record_id, billingDocumentId: billing.rows[0].document_id });
    }
    const verdict = {
      namespace, companiesVerified: `${evidence.length}/2`, businessFlowsVerified: `${evidence.length}/2`,
      businessProvisioningReady: evidence.length === 2, runtimeVerified: true,
      businessVerified: evidence.length === 2, HML_VALIDATED: evidence.length === 2,
      productionValidated: false, evidence,
    };
    process.stdout.write(`${JSON.stringify(verdict)}\n`);
    if (!verdict.HML_VALIDATED) process.exitCode = 1;
  } finally { await pool.end(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
