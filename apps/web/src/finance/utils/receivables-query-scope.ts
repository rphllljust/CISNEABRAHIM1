/** Filtro avançado também é recorte: zero resultados não significa carteira vazia. */
export function hasReceivablesActiveQuery(input: {
  search: string;
  dueFrom: string;
  dueTo: string;
  status: string;
  advancedActive: boolean;
}): boolean {
  return Boolean(
    input.search || input.dueFrom || input.dueTo || input.status || input.advancedActive,
  );
}
