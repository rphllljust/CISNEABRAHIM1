/**
 * CREDENCIAL DAS JORNADAS DE ENGINE — um único lugar, e ele FALHA quando falta.
 *
 * Antes: cada spec repetia `process.env['CISNE_JOURNEY_LOGIN'] ?? '<login>'`. O default era um
 * login que NÃO EXISTE no banco local (`abrahim@cisne-rondonia.invalid`, ausente de
 * `identity.credentials`), e o helper de senha lançava enquanto o de login não — então a suíte
 * morria no primeiro `fill` em vez de dizer o que faltava.
 *
 * A regra agora é a mesma para os dois campos: o valor VEM DO AMBIENTE e, sem ele, a jornada
 * para com erro explícito. Não há login de fallback embutido, porque um default silencioso é
 * exatamente o que permitiu a suíte passar meses apontando para um usuário inexistente.
 *
 * `cisne_local_dev` tem hoje: rafael@…, controle-financeiro@…, controle@…, empregado@…
 * (verificado em `identity.credentials`). Nenhum deles é presumido aqui.
 */
export function requireJourneyLogin(): string {
  const value = process.env['CISNE_JOURNEY_LOGIN']?.trim();
  if (!value) {
    throw new Error(
      'CONFIGURATION_ERROR: CISNE_JOURNEY_LOGIN is required to run this journey.',
    );
  }
  return value;
}

export function requireJourneyPassword(): string {
  const value = process.env['CISNE_JOURNEY_PASSWORD']?.trim();
  if (!value) {
    throw new Error(
      'CONFIGURATION_ERROR: CISNE_JOURNEY_PASSWORD is required to run this journey.',
    );
  }
  return value;
}

export const LOGIN = requireJourneyLogin();
export const PASSWORD = requireJourneyPassword();
