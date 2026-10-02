import type { MetaEntitySchema, MetaField } from './types';
import { toDisplayText } from './FieldRenderer';

/**
 * EXPORT CSV — do conjunto FILTRADO que está na tela.
 *
 * As colunas são as MESMAS da lista, na mesma ordem, resolvidas do metadado — nenhum cabeçalho
 * é escrito à mão aqui. Exportar colunas diferentes das exibidas seria vender um arquivo que
 * não corresponde ao que o operador vê.
 *
 * Exporta o recorte ATUAL (`rows` já filtrado e ordenado pela tela), não a base inteira: quem
 * filtra espera levar o que filtrou.
 */

export type DynamicExportCsvProps = {
  schema: MetaEntitySchema | null;
  /** Linhas EFETIVAMENTE exibidas — já filtradas e ordenadas. */
  rows: Array<Record<string, unknown> & { id: string }>;
  /** Nome-base do arquivo, sem extensão. */
  fileName: string;
  /**
   * Colunas a exportar. Ausente = as colunas da view `list`.
   *
   * A tela passa esta lista quando quer alinhar o arquivo com o que ela mesma desenha (por
   * exemplo, quando injeta células calculadas por `renderCell`).
   */
  columns?: MetaField[];
  disabled?: boolean;
};

export function DynamicExportCsv({
  schema,
  rows,
  fileName,
  columns,
  disabled = false,
}: DynamicExportCsvProps): React.ReactElement {
  const exportable = columns ?? listColumns(schema);

  return (
    <button
      type="button"
      data-testid="dynamic-export-csv"
      data-export-rows={String(rows.length)}
      data-export-columns={String(exportable.length)}
      disabled={disabled || rows.length === 0 || exportable.length === 0}
      className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
      onClick={() => {
        const csv = buildCsv(exportable, rows);
        downloadCsv(fileName, csv);
      }}
    >
      Exportar CSV
    </button>
  );
}

/**
 * Monta o CSV a partir das colunas do metadado.
 *
 * Separador `;` e BOM UTF-8: é o que o Excel em pt-BR abre sem pedir importação manual. Com
 * vírgula e sem BOM, o arquivo abre com acento quebrado e tudo numa coluna só — um export que
 * "funciona" e é inútil na prática.
 */
export function buildCsv(
  columns: readonly MetaField[],
  rows: ReadonlyArray<Record<string, unknown>>,
): string {
  const header = columns.map((column) => escapeCsv(column.label)).join(';');
  const body = rows.map((row) =>
    columns.map((column) => escapeCsv(toDisplayText(row[column.name]))).join(';'),
  );
  return `\uFEFF${[header, ...body].join('\r\n')}`;
}

/**
 * Escapa um campo.
 *
 * Aspas duplicadas dentro do valor, e o campo inteiro entre aspas quando contém separador,
 * quebra de linha ou aspas — sem isso, um texto com `;` desloca todas as colunas seguintes.
 */
function escapeCsv(value: string): string {
  const needsQuotes = /[";\r\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/** Colunas da view `list`, respeitando `in_list` e o nível de permissão do ator. */
export function listColumns(schema: MetaEntitySchema | null): MetaField[] {
  if (!schema) {
    return [];
  }
  const listView = schema.views.find((view) => view.viewType === 'list');
  const declared = listView?.layout.columns ?? [];
  const byName = new Map(schema.fields.map((field) => [field.name, field]));
  const allowed = (field: MetaField): boolean =>
    field.inList && schema.allowedPermLevels.includes(field.permLevel);

  if (declared.length > 0) {
    return declared
      .map((name) => byName.get(name))
      .filter((field): field is MetaField => field !== undefined && allowed(field));
  }
  return schema.fields
    .filter(allowed)
    .slice()
    .sort((left, right) => left.listOrder - right.listOrder);
}

/**
 * Dispara o download via Blob.
 *
 * `URL.createObjectURL` é chamado aqui e revogado em seguida: sem o `revoke`, cada export
 * segura o conteúdo na memória até a página ser fechada.
 */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${fileName}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
