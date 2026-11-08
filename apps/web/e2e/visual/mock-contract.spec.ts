import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import type { ApiMockProfile } from '../fixtures/api-routes';
import { prepareAccountingSession } from '../fixtures/accounting-api-routes';
import { prepareAuthenticatedSession } from '../fixtures/visual-helpers';

/**
 * CONTRATO DE COBERTURA DO MOCK (ratchet).
 *
 * Mock ausente vira 404 e a tela cai em "Erro inesperado" so no Visual full. Este teste mede, na
 * primeira renderizacao de cada rota visual, quais `/api/v1/*` responderam 404 e FALHA quando
 * aparece um 404 que nao esta no baseline (`e2e/contracts/mock-404-baseline.json`). O baseline so
 * pode ENCOLHER: UPDATE_MOCK_CONTRACT=1 regrava a lista (use apenas para remover entradas).
 * Teria pego `/api/v1/dashboard/executive` na Contabilidade no PR.
 */

type Entry = { key: string; profile: ApiMockProfile | 'accounting'; path: string };
const ENTRIES: Entry[] = [
  { key: 'clients', profile: 'clients', path: '/app/clients' },
  { key: 'documents', profile: 'documents', path: '/app/documents' },
  { key: 'expenses', profile: 'finance', path: '/app/finance/expenses' },
  { key: 'reports', profile: 'dashboard', path: '/app/reports' },
  { key: 'alerts', profile: 'dashboard', path: '/app/alerts' },
  { key: 'billing', profile: 'billing-empty', path: '/app/billing' },
  { key: 'suppliers', profile: 'suppliers', path: '/app/suppliers' },
  { key: 'inventory', profile: 'inventory', path: '/app/inventory' },
  { key: 'proposals', profile: 'commercial', path: '/app/proposals' },
  { key: 'work-inbox', profile: 'dashboard', path: '/app/work-inbox' },
  // TODO(#284): adicionar { profile: 'accounting', path: '/app/accounting/journals' } e
  // '/app/accounting/closing' quando o mock de /dashboard/executive da Contabilidade estiver na main.
  // Sem ele o login da Contabilidade cai em "Erro inesperado" e `prepareAccountingSession` falha:
  // e exatamente o 404 que este teste existe para pegar.
];

const BASELINE_PATH = fileURLToPath(new URL('../contracts/mock-404-baseline.json', import.meta.url));
const normalize = (url: string): string =>
  new URL(url).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id');

async function collect404(page: Page, entry: Entry): Promise<string[]> {
  const missing = new Set<string>();
  page.on('response', (response) => {
    if (response.status() === 404 && response.url().includes('/api/v1/')) {
      missing.add(normalize(response.url()));
    }
  });
  if (entry.profile === 'accounting') {
    await prepareAccountingSession(page);
  } else {
    await prepareAuthenticatedSession(page, entry.profile);
  }
  await page.goto(entry.path);
  await page.waitForLoadState('networkidle');
  return [...missing].sort();
}

test.describe('contrato de cobertura do mock (ratchet de 404)', () => {
  for (const entry of ENTRIES) {
    test(`${entry.key}: nenhum 404 novo em /api/v1`, async ({ page }) => {
      const observed = await collect404(page, entry);
      const allowed: Record<string, string[]> = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
      if (process.env['UPDATE_MOCK_CONTRACT'] === '1') {
        // Cada teste regrava a SUA chave (workers reiniciam apos falha; nao ha estado compartilhado).
        allowed[entry.key] = observed;
        writeFileSync(BASELINE_PATH, JSON.stringify(allowed, null, 2) + '\n');
        return;
      }
      const novos = observed.filter((path) => !(allowed[entry.key] ?? []).includes(path));
      expect(novos, `${entry.key}: rota sem mock (404) — adicione o handler na fixture`).toEqual([]);
    });
  }
});
