/**
 * REGISTRO DO CATALOGO FINANCEIRO
 *
 * Importado UMA vez pelo modulo financeiro. O registro e idempotente (registrar a mesma definicao
 * duas vezes e no-op) e LANCA se duas telas declararem o mesmo id com significados diferentes —
 * que e exatamente a divergencia que o Command Registry existe para eliminar.
 *
 * NAO e chamado no topo de cada pagina: um efeito colateral de import dentro de um componente
 * roda de novo a cada remontagem e, em modo estrito do React, duas vezes por montagem.
 *
 * ---------------------------------------------------------------------------------------------
 * DEFEITO CORRIGIDO AQUI
 * ---------------------------------------------------------------------------------------------
 *
 * Esta funcao existia e NUNCA era chamada. O catalogo dos sete dominios financeiros acima estava
 * declarado, mas o registro global ficava vazio — entao `commandsForScope('finance.payable')`
 * devolvia `[]` e a Command Layer era, na pratica, decoracao: cada tela continuava decidindo as
 * acoes localmente, que e a divergencia que a frente inteira existe para eliminar.
 *
 * `registerFinanceCommands()` agora e chamado no ponto de ENTRADA do modulo (ver
 * `finance-commands.bootstrap.ts`), que roda antes de qualquer pagina financeira renderizar.
 */

import { registerCommands } from '../../platform/commands';
import { FINANCE_COMMANDS } from './finance-commands';

let registered = false;

/**
 * Registra o catalogo financeiro. Idempotente.
 *
 * Devolve quantos comandos o catalogo declara, para que a inicializacao possa afirmar o efeito em
 * vez de assumir — um registro que "rodou" sem registrar nada e indistinguivel de um registro que
 * nao rodou.
 */
export function registerFinanceCommands(): number {
  if (registered) {
    return FINANCE_COMMANDS.length;
  }
  registered = true;
  registerCommands(FINANCE_COMMANDS);
  return FINANCE_COMMANDS.length;
}

/** O catalogo financeiro ja foi registrado neste processo? */
export function isFinanceCommandsRegistered(): boolean {
  return registered;
}

/** Test-only: permite reavaliar o registro entre casos isolados. */
export function resetFinanceCommandRegistrationForTests(): void {
  registered = false;
}
