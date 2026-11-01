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
      const companyToken = flow.key === 'locacao-full' ? 'ALFA' : 'BETA';
      if (!clientRow || !clientRow.legal_name.toUpperCase().includes(companyToken)) {
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
      const measurementRow = measurement.rows[0];
      if (!measurementRow) {
        throw new Error(`business verification failed: ${flow.key} has no approved measurement`);
      }

      const lines = await pool.query<{ unit_code: string }>(
        'SELECT unit_code FROM msr.measurement_items WHERE measurement_id = $1::uuid',
        [measurementRow.id],
      );
      if (
        !lines.rows.length ||
        lines.rows.some((line) => ['HOUR', 'KM'].includes(line.unit_code.toUpperCase()))
      ) {
        throw new Error(`business verification failed: ${flow.key} has no valid commercial measurement lines`);
      }

      const billing = await pool.query<{
        record_id: string; document_id: string; principal: string; currency_code: string;
      }>(
        `SELECT br.id AS record_id, bd.id AS document_id,
                bd.total_amount::text AS principal, bd.currency_code
           FROM bil.billing_records br
           INNER JOIN bil.billing_documents bd ON bd.billing_record_id = br.id
          WHERE br.service_order_id = $1::uuid AND bd.status = 'FINALIZED'
          LIMIT 1`,
        [orderRow.id],
      );
      const billingRow = billing.rows[0];
      if (!billingRow) {
        throw new Error(`business verification failed: ${flow.key} has no billing record/document`);
      }

      const receivables = await pool.query<{
        id: string; principal: string; currency_code: string;
        origin_service_order_id: string; origin_measurement_id: string;
        origin_billing_record_id: string; client_id: string;
      }>(
        `SELECT id, principal::text AS principal, currency_code,
                origin_service_order_id, origin_measurement_id,
                origin_billing_record_id, client_id
           FROM fin.receivables
          WHERE origin_billing_document_id = $1::uuid`,
        [billingRow.document_id],
      );
      const receivable = receivables.rows[0];
      if (receivables.rows.length !== 1 || !receivable ||
          receivable.origin_service_order_id !== orderRow.id ||
          receivable.origin_measurement_id !== measurementRow.id ||
          receivable.origin_billing_record_id !== billingRow.record_id ||
          receivable.client_id !== clientRow.id ||
          receivable.currency_code !== billingRow.currency_code ||
          receivable.principal !== billingRow.principal) {
        throw new Error(`business verification failed: ${flow.key} receivable origin or amount is inconsistent`);
      }

      evidence.push({
        company: flow.company,
        scenario: flow.key,
        clientId: clientRow.id,
        serviceOrderId: orderRow.id,
        serviceOrderStatus: orderRow.status,
        measurementId: measurementRow.id,
        measurementStatus: measurementRow.status,
        commercialUnits: lines.rows.map((line) => line.unit_code),
        billingRecordId: billingRow.record_id,
        billingDocumentId: billingRow.document_id,
        receivableId: receivable.id,
        receivablePrincipal: receivable.principal,
        currencyCode: receivable.currency_code,
      });
    }

    const businessVerified = evidence.length === flows.length;
    const verdict = {
      namespace,
      companiesVerified: `${evidence.length}/${flows.length}`,
      businessFlowsVerified: `${evidence.length}/${flows.length}`,
      businessProvisioningReady: businessVerified,
      runtimeVerified: true,
      businessVerified,
      HML_VALIDATED: businessVerified,
      productionValidated: false,
      evidence,
    };

    process.stdout.write(`${JSON.stringify(verdict)}\\n`);
    if (!verdict.HML_VALIDATED) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
