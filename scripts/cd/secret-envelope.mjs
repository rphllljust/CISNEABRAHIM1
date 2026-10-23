/**
 * LEITURA DE SECRET VINDO DE AMBIENTE — NORMALIZACAO DO ENVELOPE DE TRANSPORTE.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * DEFEITO MEDIDO
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Run 39883399921, `Release Ready` em c4bc535f, job
 * "Railway HML / migrations / readiness / authenticated smoke":
 *
 *   TypeError: Cannot convert argument to a ByteString because the character at
 *   index 7 has a value of 65279 which is greater than 255.
 *
 * Indice 7 = primeiro caractere apos `Bearer ` no header `authorization`.
 * 65279 = U+FEFF (BOM UTF-8). O `fetch` do Node rejeita code point > 255 em valor de
 * header, entao o CD morria ANTES de tocar a rede — e a mensagem nao dizia QUAL
 * variavel estava suja.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE NORMALIZAR AQUI, E NAO "CONSERTAR O SECRET"
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * BOM, CRLF, NBSP e zero-width space nao sao valor de configuracao: sao resíduo de
 * transito (copy-paste de painel, terminal, planilha, arquivo salvo no Windows). O
 * secret correto e o valor SEM eles. Tratar o resíduo na leitura resolve a clase inteira
 * de uma vez, em vez de depender de alguem reconfigurar cada secret sem errar.
 *
 * O QUE ESTE MODULO NAO FAZ (garantia que os testes travam):
 *   - nao transforma ausente em presente  (undefined continua undefined)
 *   - nao inventa valor padrao            (quem chama decide o default)
 *   - nao altera o miolo do valor         (so o envelope: bordas e invisiveis)
 *   - nao engole erro de configuracao     (a validacao de "obrigatorio" segue no chamador)
 */

/**
 * Caracteres invisiveis que aparecem em copy-paste de credencial.
 * U+FEFF BOM, U+200B zero-width space, U+00A0 no-break space.
 */
const INVISIVEL = /[\uFEFF\u200B\u00A0]/g;

/**
 * Le uma variavel de ambiente normalizando o envelope de transporte.
 *
 * @param {string} name nome da variavel
 * @param {NodeJS.ProcessEnv} [source] origem (default: process.env) — injetavel para teste
 * @returns {string | undefined} valor limpo, ou undefined se a variavel nao existe
 */
export function env(name, source = process.env) {
  const raw = source[name];
  if (raw === undefined) return undefined;
  return raw.replace(INVISIVEL, '').trim();
}
