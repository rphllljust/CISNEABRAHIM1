import { useCallback, useMemo, useState } from 'react';

/**
 * BULK SELECTION — selecao multipla de registros JA VISIVEIS na lista.
 *
 * LIMITE DE SEGURANCA (obrigatorio):
 * - A selecao opera exclusivamente sobre as linhas que o servidor ja devolveu e o
 *   usuario ja pode ver. Nao ha endpoint de listagem nova, nao ha query por lote.
 * - Selecionar NAO concede permissao. Toda acao em lote reenvia cada registro ao
 *   MESMO caminho de dominio/autorizacao do acao individual — nunca ha transicao
 *   em massa paralela. Se o dominio exige aprovacao, SoD ou idempotencia, NAO ha
 *   bulk: ver `bulk/BulkActionBar.tsx`.
 */

export type UseSelectionResult<Row> = {
  selectedIds: ReadonlySet<string>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectAll: (rows: Row[]) => void;
  clear: () => void;
  selectedRows: (rows: Row[]) => Row[];
  count: number;
  allVisibleSelected: (rows: Row[]) => boolean;
  someVisibleSelected: (rows: Row[]) => boolean;
};

export type UseSelectionOptions<Row> = {
  getId: (row: Row) => string;
  /** Teto duro de selecionados: evita confundir "selecionei tudo" com "operei tudo". */
  maxSelection?: number;
};

export function useSelection<Row>({
  getId,
  maxSelection = 500,
}: UseSelectionOptions<Row>): UseSelectionResult<Row> {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set<string>());

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const toggle = useCallback(
    (id: string) => {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else if (next.size < maxSelection) {
          next.add(id);
        }
        return next;
      });
    },
    [maxSelection],
  );

  const selectAll = useCallback(
    (rows: Row[]) => {
      setSelectedIds(new Set(rows.slice(0, maxSelection).map(getId)));
    },
    [getId, maxSelection],
  );

  const clear = useCallback(() => setSelectedIds(new Set<string>()), []);

  const selectedRows = useCallback(
    (rows: Row[]) => rows.filter((row) => selectedIds.has(getId(row))),
    [getId, selectedIds],
  );

  const allVisibleSelected = useCallback(
    (rows: Row[]) => rows.length > 0 && rows.every((row) => selectedIds.has(getId(row))),
    [getId, selectedIds],
  );

  const someVisibleSelected = useCallback(
    (rows: Row[]) =>
      rows.some((row) => selectedIds.has(getId(row))) && !allVisibleSelected(rows),
    [allVisibleSelected, getId, selectedIds],
  );

  return useMemo(
    () => ({
      selectedIds,
      isSelected,
      toggle,
      selectAll,
      clear,
      selectedRows,
      count: selectedIds.size,
      allVisibleSelected,
      someVisibleSelected,
    }),
    [
      selectedIds,
      isSelected,
      toggle,
      selectAll,
      clear,
      selectedRows,
      allVisibleSelected,
      someVisibleSelected,
    ],
  );
}
