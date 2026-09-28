import { useSearchParams } from 'react-router-dom';

/**
 * RELATION CONTRACT — escopo vindo da URL.
 *
 * Uma Smart Relation so vale se o destino ACEITAR o filtro. Um numero que clica e abre uma
 * lista NAO filtrada e pior que nenhum numero: ele afirma um recorte que nao existe.
 *
 * Este hook le o recorte da propria URL (ex.: `?clientId=<cliente>`) para que a lista de
 * destino consulte o servidor com o mesmo escopo que a relacao anunciou. O transporte do
 * recorte nao decide autorizacao: a consulta continua sendo autorizada no backend.
 *
 * Regras:
 * - Somente chaves declaradas sao lidas (nada de repassar a query inteira para a API).
 * - A URL permanece a fonte do recorte, entao recarregar/voltar/compartilhar preserva o filtro.
 */
export function useRelationScope<K extends string>(keys: readonly K[]): Partial<Record<K, string>> {
  const [searchParams] = useSearchParams();
  const scope: Partial<Record<K, string>> = {};

  for (const key of keys) {
    const value = searchParams.get(key);
    if (value !== null && value.trim().length > 0) {
      scope[key] = value;
    }
  }

  return scope;
}

/** Chaves de escopo aceitas pelas relacoes de objeto (alfabeto fechado). */
export const RELATION_SCOPE_KEYS = ['clientId'] as const;
