#!/usr/bin/env node
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

// Ratchet baseline captured from RC2. These are not target sizes; they are
// ceilings that prevent already-large runtime files from growing further.
// Refactors should reduce the limits in the same commit that shrinks a file.
//
// REBASE (integration/enterprise-prod-rc): os limites foram capturados na
// arvore INTEGRADA, nao na linha isolada do hardening.
//
// RECAPTURE 2026-10-12: somente dois hotspots avançaram desde essa captura.
// O compare cee1336..6f53e8d mostra +65/-0 linhas no repository de OS e
// +82/-31 em App.tsx ao longo de 318 commits integrados. Os tetos abaixo foram
// movidos EXATAMENTE para o tamanho corrente, sem folga adicional. O ratchet
// volta a impedir qualquer crescimento a partir desta arvore integrada.
//
// RECAPTURE 2026-10-13 — `ProcurementPages.tsx`: o teto continuava medido ANTES dos filtros
// server-side independentes de status (`acbb122a`, +82/-8 no proprio arquivo, 49912 -> 54301
// bytes). O teto nao foi movido junto com a mudanca que o estourou, e a partir dai o gate
// `pnpm lint` falhava em main, em toda branch e em todo push — bloqueando o pipeline inteiro.
// O teto abaixo e o tamanho CORRENTE, sem folga: o ratchet volta a impedir crescimento daqui
// em diante, e reduzir o arquivo deve baixar o numero no mesmo commit.
//
// AJUSTE 2026-10-19 — o campo de fornecedor de emitir-pedido e registrar-nota ganhou
// `emptyAction` (orientacao + link ao cadastro existente). Substitui a mensagem longa por um
// link curto; saldo liquido +10 bytes (54301 -> 54311). O teto move junto, sem folga adicional.
//
// AJUSTE 2026-10-24 — `accounting-access.service.ts`: o guard de idempotencia do posting
// passou a documentar por que o ESTORNO usa `eventKind` proprio (`SETTLEMENT_REVERSED` /
// `PAYMENT_REVERSED`) em vez de reutilizar o do fato original. O comentario registra a causa
// raiz de um defeito real (o guard devolvia "ja postado" e a compensacao contabil nunca era
// criada), nao e decoracao: sem ele o proximo autor reintroduz o bug. 42040 -> 42637 bytes,
// medido, sem folga. O ratchet volta a impedir crescimento daqui em diante.
const BUDGETS = new Map([
  ['apps/api/src/accounting/repositories/accounting.repository.ts', 56312],
  ['apps/api/src/accounting/services/accounting-access.service.ts', 42637],
  ['apps/api/src/service-orders/repositories/resource-planning.repository.ts', 36561],
  ['apps/api/src/service-orders/repositories/service-orders.repository.ts', 34743],
  ['apps/api/src/finance/repositories/treasury.repository.ts', 31768],
  ['apps/web/src/procurement/pages/ProcurementPages.tsx', 54311],
  ['apps/web/src/App.tsx', 39745],
]);

const violations = [];

for (const [relativePath, maxBytes] of BUDGETS) {
  const bytes = statSync(resolve(ROOT, relativePath)).size;
  if (bytes > maxBytes) {
    violations.push(`${relativePath}: ${bytes} bytes > budget ${maxBytes}`);
  }
}

if (violations.length > 0) {
  console.error('Source-size ratchet failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  console.error(
    'Split responsibilities or intentionally lower/adjust the reviewed budget; do not silently grow hotspots.',
  );
  process.exit(1);
}

console.log(`source-size ratchet: PASS (${BUDGETS.size} runtime hotspots cannot grow)`);
