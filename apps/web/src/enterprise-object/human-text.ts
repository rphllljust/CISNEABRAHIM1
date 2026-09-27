/**
 * CISNE — ENTERPRISE INTERACTION CONTRACT (guardas de honestidade da interface)
 *
 * A interface representa o NEGOCIO, nunca o banco de dados. Estas guardas tornam
 * isso um comportamento testavel, em vez de uma recomendacao de estilo:
 *
 * - Identificador tecnico (UUID) NUNCA aparece. Nem truncado, nem deslocado.
 * - Nome de capability (`dominio:recurso:acao`) NUNCA aparece para o operador.
 * - Valor vazio nao gera preenchimento artificial ("—", "N/D", "nao informado").
 *
 * Sem excecao de tela: a guarda roda em todo texto humano dos primitivos.
 */

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const CAPABILITY_PATTERN = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*){1,3}$/;

/** Verdadeiro quando o texto carrega um identificador tecnico em qualquer posicao. */
export function containsTechnicalIdentifier(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Verdadeiro quando o texto e um nome de capability, nao um rotulo de negocio. */
export function isCapabilityName(value: string): boolean {
  return CAPABILITY_PATTERN.test(value.trim());
}

/**
 * Converte um valor tecnico em texto humano.
 *
 * Retorna `null` quando o valor NAO pode ser mostrado (uuid, capability, vazio).
 * `null` significa "omita", nunca "mostre um placeholder".
 */
export function toHumanText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (containsTechnicalIdentifier(trimmed) || isCapabilityName(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Referencia humana do objeto (ex.: `COM-2026-0042`).
 *
 * Codigos de negocio sao aceitos; qualquer coisa com cara de id tecnico e omitida.
 */
export function toHumanReference(value: unknown): string | null {
  return toHumanText(value);
}
