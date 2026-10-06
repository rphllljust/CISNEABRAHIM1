/**
 * REGISTRO DO CATALOGO FINANCEIRO
 *
 * Importado UMA vez pelo modulo financeiro. O registro e idempotente (registrar a mesma definicao
 * duas vezes e no-op) e LANCA se duas telas declararem o mesmo id com significados diferentes —
 * que e exatamente a divergencia que o Command Registry existe para eliminar.
 *
 * NAO e chamado no topo de cada pagina: um efeito colateral de import dentro de um componente
 * roda de novo a cada remontagem e, em modo estrito do React, duas vezes por montagem.
 */

import { registerCommands } from '../../platform/commands';
import { FINANCE_COMMANDS } from './finance-commands';

let registered = false;

/** Registra o catalogo financeiro. Idempotente. */
export function registerFinanceCommands(): void {
  if (registered) {
    return;
  }
  registered = true;
  registerCommands(FINANCE_COMMANDS);
}

/** Test-only: permite reavaliar o registro entre casos isolados. */
export function resetFinanceCommandRegistrationForTests(): void {
  registered = false;
}
