import { expect, test, type Page } from '@playwright/test';
import { requireJourneyLogin, requireJourneyPassword } from './journey-credentials';

/**
 * V3 · EXPORT CSV — prova no browser, sem mock e sem sleep.
 *
 * O botão exporta o conjunto FILTRADO que está na tela, com as colunas do metadado. A prova tem
 * duas partes, e as duas importam:
 *
 *   1. `URL.createObjectURL` é REALMENTE chamado — é o caminho de download, e um export que só
 *      monta a string sem baixar não serve ao operador;
 *   2. o CONTEÚDO tem mais de zero bytes e traz cabeçalho vindo do metadado.
 *
 * O espião em `URL.createObjectURL` é instalado ANTES da navegação e guarda o Blob, para que o
 * teste leia o arquivo de verdade em vez de confiar no rótulo do botão.
 */
const LOGIN = requireJourneyLogin();
const PASSWORD = requireJourneyPassword();

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

test('exportar CSV dispara o download com conteudo do conjunto exibido', async ({ page }) => {
  /*
   * O espião entra ANTES de qualquer navegação — `addInitScript` só vale para documentos
   * criados DEPOIS dele, e o login já navega. Instalado tarde, o teste mediria uma página que
   * não tem o espião e concluiria "não exportou".
   */
  await page.addInitScript(() => {
    const store = { calls: 0, text: '', bytes: [] as number[] };
    (window as unknown as { __csvSpy: typeof store }).__csvSpy = store;
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob): string => {
      store.calls += 1;
      /*
       * Lê os BYTES, não só o texto: `Blob.text()` decodifica como UTF-8 e REMOVE o BOM, então
       * uma asserção de BOM sobre o texto decodificado sempre falharia — não porque o BOM não
       * foi escrito, mas porque foi consumido na decodificação. O byte 0 é a única testemunha
       * de que o arquivo sai com marca de ordem.
       */
      void blob.arrayBuffer().then((buffer) => {
        const view = new Uint8Array(buffer);
        store.bytes = Array.from(view.slice(0, 3));
        store.text = new TextDecoder().decode(view);
      });
      return original(blob);
    };
  });

  await login(page);

  await page.goto('/app/service-orders');
  await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });

  const button = page.locator('[data-testid="dynamic-export-csv"]');
  await expect(button).toBeVisible({ timeout: 30_000 });
  await expect(button).toBeEnabled();

  // O botão declara quantas linhas e colunas vai exportar — é o mesmo conjunto que a lista mostra.
  const exportedRows = Number(await button.getAttribute('data-export-rows'));
  const exportedColumns = Number(await button.getAttribute('data-export-columns'));
  expect(exportedRows).toBeGreaterThan(0);
  expect(exportedColumns).toBeGreaterThan(0);

  const listCount = Number(
    await page.locator('[data-testid="dynamic-list"]').getAttribute('data-list-count'),
  );
  // O arquivo leva o recorte EXIBIDO, não a base inteira.
  expect(exportedRows).toBe(listCount);

  await button.click();

  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __csvSpy: { calls: number } }).__csvSpy.calls), {
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(1);

  const csvText = await page.evaluate(
    async () => (window as unknown as { __csvSpy: { text: string } }).__csvSpy.text,
  );
  const head = await page.evaluate(
    async () => (window as unknown as { __csvSpy: { bytes: number[] } }).__csvSpy.bytes,
  );

  // CONTEÚDO > 0: um arquivo vazio baixaria "com sucesso" e não serviria a ninguém.
  expect(csvText.length).toBeGreaterThan(0);

  // BOM UTF-8 nos BYTES (0xEF 0xBB 0xBF) — é o que o Excel em pt-BR usa para não quebrar acento.
  expect(head).toEqual([0xef, 0xbb, 0xbf]);

  // Separador `;` — é o que o Excel em pt-BR abre em colunas sem importação manual.
  const lines = csvText.replace(/^\uFEFF/, '').split('\r\n');
  expect(lines.length).toBeGreaterThanOrEqual(2);

  const header = lines[0] ?? '';
  expect(header.split(';').length).toBe(exportedColumns);
  // O cabeçalho vem do METADADO — "Número da OS" é `meta.fields.order_number.label`.
  expect(header).toMatch(/Número da OS/);
  expect(header).not.toMatch(/order_number/);
});
