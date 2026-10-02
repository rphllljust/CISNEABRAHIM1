import { expect, type Page } from '@playwright/test';

/**
 * APOIO DAS JORNADAS V4 — mutação do metadata store e prova visual.
 *
 * A prova central desta track é: **mudar o layout via SQL muda a view no DOM, sem deploy**.
 * Isso exige (a) escrever no metadata store como um administrador escreveria — pelo Postgres,
 * não por um atalho HTTP que não existe — e (b) ler o DOM renderizado.
 *
 * `tsc exit 0` NÃO é prova de nada aqui: um componente que não aparece na tela compila
 * perfeitamente. Por isso cada jornada termina contando nós no DOM real.
 *
 * A escrita usa `docker exec ... psql`, o MESMO caminho já usado pelas jornadas de engine
 * existentes. Não se adiciona `pg` como dependência do app web só para um teste — e o
 * container é o Postgres real, não um mock.
 */

const DB_CONTAINER = process.env['CISNE_METADATA_DB_CONTAINER'] ?? 'cisne_local_postgres';
const DB_NAME = process.env['CISNE_METADATA_DB_NAME'] ?? 'cisne_local_dev';
const DB_USER = process.env['CISNE_METADATA_DB_USER'] ?? 'cisne_local_dev';

/**
 * Executa SQL no Postgres real e devolve o stdout.
 *
 * `-t -A` produz saída sem cabeçalho e sem alinhamento, para os SELECTs abaixo serem
 * parseáveis linha a linha.
 */
export async function queryMetadata(sql: string): Promise<string> {
  const { execFileSync } = await import('node:child_process');
  return execFileSync(
    'docker',
    ['exec', DB_CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql],
    { stdio: 'pipe', encoding: 'utf8' },
  ).trim();
}

/**
 * TIPOS DE VIEW QUE O BANCO ACEITA HOJE.
 *
 * `meta.views` tem `CONSTRAINT meta_views_type_chk CHECK (view_type IN
 * ('form','list','kanban','calendar'))` — verificado em `pg_constraint` contra o banco real.
 *
 * Isto é um GAP DE BANCO, não de engine: `pivot`, `tree` e `graph` NÃO PODEM ser declarados no
 * metadata store enquanto o CHECK não for ampliado. Ampliá-lo exige migration em
 * `packages/database/`, que esta track NÃO PODE escrever. O gap é declarado no relatório, não
 * contornado com um `ALTER TABLE` de teste que mascararia a ausência do canal.
 */
export const STORE_VIEW_TYPES = ['form', 'list', 'kanban', 'calendar'] as const;

/**
 * Tipos que a engine RENDERIZA mas o store ainda não pode declarar.
 *
 * Existem como capacidade de engine (componentes, contrato e provas de unidade) e são
 * alcançáveis assim que o CHECK do banco for ampliado — nenhuma linha de TypeScript mudará.
 */
export const ENGINE_ONLY_VIEW_TYPES = ['pivot', 'tree', 'graph'] as const;

/**
 * Substitui o `layout` de uma view pelo objeto dado.
 *
 * Devolve o layout ANTERIOR para que a jornada possa restaurá-lo — uma jornada que deixa o
 * store mutado contamina a próxima execução, e o defeito aparece longe da causa.
 */
export async function setViewLayout(
  entity: string,
  viewType: string,
  layout: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const previous = await queryMetadata(
    `SELECT v.layout FROM meta.views v JOIN meta.entities e ON e.id = v.entity_id
      WHERE e.name = '${entity}' AND v.view_type = '${viewType}'`,
  );

  const json = JSON.stringify(layout).replace(/'/g, "''");
  const updated = await queryMetadata(
    `UPDATE meta.views v SET layout = '${json}'::jsonb
       FROM meta.entities e
      WHERE v.entity_id = e.id AND e.name = '${entity}' AND v.view_type = '${viewType}'
      RETURNING v.view_type`,
  );

  if (updated === '') {
    throw new Error(
      `METADATA_SETUP_FAILED: nao existe view '${viewType}' para a entidade '${entity}'.`,
    );
  }
  return previous === '' ? null : (JSON.parse(previous) as Record<string, unknown>);
}

/** Cria a view se ela não existir — usado quando a jornada precisa de um tipo novo. */
export async function ensureView(
  entity: string,
  viewType: string,
  label: string,
  layout: Record<string, unknown>,
): Promise<void> {
  const json = JSON.stringify(layout).replace(/'/g, "''");
  const safeLabel = label.replace(/'/g, "''");
  await queryMetadata(
    `INSERT INTO meta.views (entity_id, view_type, label, layout, is_default)
     SELECT id, '${viewType}', '${safeLabel}', '${json}'::jsonb, false
       FROM meta.entities WHERE name = '${entity}'
     ON CONFLICT (entity_id, view_type)
     DO UPDATE SET layout = EXCLUDED.layout, label = EXCLUDED.label`,
  );
}

/** Remove uma view criada pela jornada. */
export async function dropView(entity: string, viewType: string): Promise<void> {
  await queryMetadata(
    `DELETE FROM meta.views v USING meta.entities e
      WHERE v.entity_id = e.id AND e.name = '${entity}' AND v.view_type = '${viewType}'`,
  );
}

/** Conta nós que casam com um seletor e exige o mínimo. Devolve a contagem real. */
export async function expectAtLeast(
  page: Page,
  selector: string,
  minimum: number,
  what: string,
): Promise<number> {
  const locator = page.locator(selector);
  await expect
    .poll(async () => locator.count(), {
      message: `Esperava ao menos ${minimum} de ${what} (${selector}) no DOM.`,
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(minimum);
  return locator.count();
}

/** Recarrega a página e espera um seletor — o gesto que prova "sem deploy". */
export async function reloadUntil(page: Page, selector: string): Promise<void> {
  await page.reload();
  await expect(page.locator(selector).first()).toBeVisible({ timeout: 30_000 });
}
