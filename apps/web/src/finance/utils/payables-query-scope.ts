/** A recorte com filtro avançado não é uma carteira vazia de contas a pagar. */
export function hasPayablesActiveQuery(input: {
  search: string;
  dueFrom: string;
  dueTo: string;
  status: string;
  agingBucket: string;
  advancedActive: boolean;
}): boolean {
  return Boolean(
    input.search || input.dueFrom || input.dueTo || input.status ||
    input.agingBucket || input.advancedActive,
  );
}
