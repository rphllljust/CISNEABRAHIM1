/**
 * Versões de definição de serviço são números inteiros positivos e 1-based.
 * Deep links nunca podem transformar dados do operador em `NaN`, offset, expoente
 * ou número impreciso na rota HTTP do catálogo. O backend permanece autoritativo.
 */
export function parseCatalogVersionNumber(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
