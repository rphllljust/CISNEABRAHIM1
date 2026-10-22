import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const index = Number(args.get('--index'));
const count = Number(args.get('--count'));
if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || count < 1 || index > count) {
  throw new Error(`invalid shard: index=${index} count=${count}`);
}

const root = join(process.cwd(), 'apps', 'api');
const srcRoot = join(root, 'src');
const TIMINGS_PATH = join(process.cwd(), 'artifacts', 'ci', 'integration-timings.json');

/**
 * PESOS DO SCHEDULER — HISTORICO REAL, NAO TABELA CONGELADA.
 *
 * Antes esta funcao carregava um objeto `measuredMs` com 114 entradas medidas uma unica vez. Isso
 * foi util para PROVAR o algoritmo LPT, mas vira divida na arquitetura definitiva:
 *
 *   - um spec que fica mais lento nunca atualiza o proprio peso;
 *   - um spec novo entra sem peso para sempre;
 *   - a tabela precisa ser editada a mao a cada mudanca de performance.
 *
 * AGORA: o peso vem de `artifacts/ci/integration-timings.json`, produzido pelo reporter do Vitest
 * a cada run. A mediana das ultimas amostras e resistente a outlier e reage a regressao.
 *
 * SEED (bootstrap): na primeira execucao nao existe historico. Sem peso, o LPT cairia no mediano
 * global para TODOS os specs e o balanceamento seria aleatorio — melhor que nada, mas pior do que
 * aproveitar a medicao que ja temos. Por isso a tabela abaixo sobrevive como SEMENTE, consultada
 * apenas quando o spec nao tem amostra propria.
 *
 * REGRA INVIOLAVEL: spec sem peso NUNCA e descartado. Ele recebe o peso mediano conservador.
 */
const SEED_MS = {
  "src/accounting/accounting-posting.integration.spec.ts": 8888,
  "src/accounting/accounting-read.integration.spec.ts": 5636,
  "src/accounting/accounting-reporting.integration.spec.ts": 8200,
  "src/accounting/accounting.integration.spec.ts": 5059,
  "src/accounting/closing-readiness.integration.spec.ts": 3364,
  "src/accounting/fixed-asset-accounting.integration.spec.ts": 7340,
  "src/accounting/period-close.integration.spec.ts": 3319,
  "src/alerts/business-alerts.integration.spec.ts": 967,
  "src/analytics/aging.integration.spec.ts": 1757,
  "src/analytics/compliance.integration.spec.ts": 5089,
  "src/analytics/oltp-bi-isolation.integration.spec.ts": 2576,
  "src/analytics/operational-profitability.integration.spec.ts": 3604,
  "src/analytics/productivity.integration.spec.ts": 2079,
  "src/audit/audit-trail.integration.spec.ts": 122,
  "src/audit/security-audit.integration.spec.ts": 2459,
  "src/auth/auth.adversarial.integration.spec.ts": 2997,
  "src/auth/auth.integration.spec.ts": 5228,
  "src/authorization/access-admin-console.integration.spec.ts": 4441,
  "src/authorization/access-admin.integration.spec.ts": 3031,
  "src/authorization/approval-matrix.integration.spec.ts": 5295,
  "src/authorization/authorization.integration.spec.ts": 2751,
  "src/authorization/contextual-scope.integration.spec.ts": 3042,
  "src/authorization/sod-enforcement.integration.spec.ts": 2710,
  "src/billing/billing-document.integration.spec.ts": 9360,
  "src/billing/billing.integration.spec.ts": 35255,
  "src/catalog/service-catalog.integration.spec.ts": 17508,
  "src/catalog/units-of-measure.integration.spec.ts": 1608,
  "src/chaos-recovery/chaos-recovery.integration.spec.ts": 12391,
  "src/clients/clients.audit-closure.integration.spec.ts": 2802,
  "src/clients/clients.integration.spec.ts": 32457,
  "src/commercial/commercial.integration.spec.ts": 1803,
  "src/commercial/contracts.integration.spec.ts": 7019,
  "src/commercial/proposal-cost-authorization.integration.spec.ts": 6125,
  "src/commercial/proposal-workbench.integration.spec.ts": 10041,
  "src/commercial/proposals.integration.spec.ts": 7161,
  "src/commercial/purchase-order-ledger-chain.integration.spec.ts": 2136,
  "src/commercial/purchase-order-linked-chain.integration.spec.ts": 4211,
  "src/commercial/purchase-orders.integration.spec.ts": 8127,
  "src/concurrency/concurrency-torture.integration.spec.ts": 48557,
  "src/dashboard/executive-dashboard.integration.spec.ts": 4008,
  "src/dashboard/operational-dashboard.integration.spec.ts": 1526,
  "src/documents/documents.integration.spec.ts": 8679,
  "src/enterprise-integrity/enterprise-integrity.integration.spec.ts": 9236,
  "src/establishments/establishment-registry.integration.spec.ts": 712,
  "src/events/domain-events.integration.spec.ts": 2017,
  "src/failure-injection/failure-injection.integration.spec.ts": 27607,
  "src/finance/bank-import.integration.spec.ts": 4638,
  "src/finance/bank-reconciliation.integration.spec.ts": 2973,
  "src/finance/bank-statements-list.integration.spec.ts": 2453,
  "src/finance/budget.integration.spec.ts": 6198,
  "src/finance/cash-flow-forecast.integration.spec.ts": 3338,
  "src/finance/client-financial-context.integration.spec.ts": 7879,
  "src/finance/expense-management.integration.spec.ts": 7716,
  "src/finance/finance-payable-aging-dataset.integration.spec.ts": 2000,
  "src/finance/finance-title-pagination.integration.spec.ts": 5563,
  "src/finance/financial-aging-consistency.integration.spec.ts": 1464,
  "src/finance/financial-aging-correction.integration.spec.ts": 494,
  "src/finance/financial-aging-reconciliation.integration.spec.ts": 1733,
  "src/finance/financial-chain-fixture.integration.spec.ts": 991,
  "src/finance/payables.integration.spec.ts": 8400,
  "src/finance/receivable-collections.integration.spec.ts": 5570,
  "src/finance/receivables.integration.spec.ts": 9214,
  "src/finance/reconciliation/financial-reconciliation.integration.spec.ts": 8551,
  "src/finance/treasury.integration.spec.ts": 5400,
  "src/fiscal/fiscal-accounting.integration.spec.ts": 6909,
  "src/fiscal/fiscal-period-close.integration.spec.ts": 8156,
  "src/fiscal/fiscal.integration.spec.ts": 9165,
  "src/fiscal/tax-engine.integration.spec.ts": 6792,
  "src/fiscal/tax-obligation-payable.integration.spec.ts": 6248,
  "src/idempotency-retry/idempotency-retry.integration.spec.ts": 19008,
  "src/infrastructure/database/database.integration.spec.ts": 63,
  "src/integrations/inbox/integration-inbox.integration.spec.ts": 197,
  "src/inventory/inventory-costing.integration.spec.ts": 3228,
  "src/inventory/inventory.integration.spec.ts": 5312,
  "src/master-business/master-business.integration.spec.ts": 17237,
  "src/measurements/measurements.integration.spec.ts": 26355,
  "src/notifications/notification-delivery.integration.spec.ts": 326,
  "src/observability/observability-b3.integration.spec.ts": 4531,
  "src/observability/services/business-metrics-collector.integration.spec.ts": 491,
  "src/observability/services/platform-metrics-collector.integration.spec.ts": 245,
  "src/payroll/payroll-accounting.integration.spec.ts": 7286,
  "src/payroll/payroll.integration.spec.ts": 3451,
  "src/people/people.integration.spec.ts": 3322,
  "src/performance/big-wave-06-baseline.integration.spec.ts": 1236,
  "src/platform/background-jobs/background-worker.integration.spec.ts": 1164,
  "src/platform/outbox/transactional-outbox.integration.spec.ts": 229,
  "src/procurement/procurement.integration.spec.ts": 6333,
  "src/procurement/supplier-invoice.integration.spec.ts": 4405,
  "src/procurement/three-way-match.integration.spec.ts": 6004,
  "src/reports/financial-aging-report-source.integration.spec.ts": 1628,
  "src/reports/report-generation.worker.integration.spec.ts": 4185,
  "src/reports/reports.integration.spec.ts": 4284,
  "src/reports/snapshot-preview-export.integration.spec.ts": 1226,
  "src/requests/service-request-workbench.integration.spec.ts": 8934,
  "src/requests/service-requests.integration.spec.ts": 17863,
  "src/resources/operational-labor-types.integration.spec.ts": 2273,
  "src/resources/physical-assets.integration.spec.ts": 12641,
  "src/resources/physical-resource-types.integration.spec.ts": 2296,
  "src/search/search.integration.spec.ts": 2152,
  "src/service-orders/deadline-semantics.integration.spec.ts": 2050,
  "src/service-orders/drill-equality.integration.spec.ts": 1520,
  "src/service-orders/rental-service-order.integration.spec.ts": 8572,
  "src/service-orders/service-order-audit.integration.spec.ts": 6906,
  "src/service-orders/service-order-execution.integration.spec.ts": 29770,
  "src/service-orders/service-order-metadata.integration.spec.ts": 17796,
  "src/service-orders/service-order-operational-costs.integration.spec.ts": 5710,
  "src/service-orders/service-order-planning.integration.spec.ts": 36567,
  "src/service-orders/service-orders.integration.spec.ts": 39231,
  "src/service-orders/transport-service-order.integration.spec.ts": 6886,
  "src/suppliers/suppliers.integration.spec.ts": 4848,
  "src/synthetic-seed/fullstack-data-reconciliation.integration.spec.ts": 223,
  "src/synthetic-seed/synthetic-business-seed.integration.spec.ts": 752,
  "src/uat/uat-business.integration.spec.ts": 8304,
  "src/vertical/first-vertical-quality-gate.integration.spec.ts": 2668,
};

/** Mediana — resistente a outlier; um run lento isolado nao desloca o peso. */
function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
}

/** Carrega o historico por spec. Ausencia de arquivo nao e erro: e o primeiro run. */
function loadHistory() {
  if (!existsSync(TIMINGS_PATH)) return {};
  try {
    // `JSON.parse` rejeita BOM (`\uFEFF`) no inicio. O arquivo e escrito pelo proprio CI em UTF-8
    // puro, mas um editor ou script de operador pode introduzir BOM — e nesse caso o historico
    // seria descartado em SILENCIO, degradando o balanceamento sem nenhum sinal visivel.
    const raw = readFileSync(TIMINGS_PATH, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return parsed?.specs ?? {};
  } catch {
    // Historico corrompido nao pode derrubar o planejamento: caimos no SEED, que e deterministico.
    return {};
  }
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.integration.spec.ts')) out.push(full);
  }
  return out;
}

const files = walk(srcRoot)
  .map((full) => relative(root, full).split(sep).join('/'))
  .sort();

if (files.length === 0) throw new Error('no integration specs discovered');

const history = loadHistory();

/** Peso de um spec: mediana do historico; senao SEED; senao mediano global. */
const knownWeights = Object.values(SEED_MS).sort((a, b) => a - b);
const medianWeight = knownWeights[Math.floor(knownWeights.length / 2)] ?? 5000;

const weightOf = (file) => {
  const samples = history[file]?.samples;
  if (Array.isArray(samples) && samples.length > 0) {
    const m = median(samples);
    if (m != null && m > 0) return m;
  }
  return SEED_MS[file] ?? medianWeight;
};

const bins = Array.from({ length: count }, (_, i) => ({ index: i + 1, total: 0, files: [] }));

for (const file of [...files].sort((a, b) => {
  const wa = weightOf(a);
  const wb = weightOf(b);
  return wb - wa || a.localeCompare(b);
})) {
  // LPT: aloca sempre no bin de menor carga acumulada. Desempate pelo indice garante que a mesma
  // entrada produza a mesma particao — determinismo e requisito, nao conveniencia.
  bins.sort((a, b) => a.total - b.total || a.index - b.index);
  const target = bins[0];
  const weight = weightOf(file);
  target.files.push(file);
  target.total += weight;
}

bins.sort((a, b) => a.index - b.index);

const assigned = bins.flatMap((bin) => bin.files);
if (assigned.length !== files.length || new Set(assigned).size !== files.length) {
  throw new Error('integration shard plan is not a complete disjoint partition');
}

if (process.env['INTEGRATION_SHARD_DEBUG'] === '1') {
  const fromHistory = files.filter((f) => Array.isArray(history[f]?.samples) && history[f].samples.length > 0);
  for (const bin of bins) {
    process.stderr.write(
      `shard ${bin.index}/${count}: files=${bin.files.length} predicted_ms=${bin.total}\n`,
    );
  }
  process.stderr.write(
    `weights: history=${fromHistory.length} seed=${files.length - fromHistory.length} ` +
      `median_fallback_ms=${medianWeight}\n`,
  );
}

const selected = bins[index - 1];
process.stdout.write(selected.files.join(' '));
