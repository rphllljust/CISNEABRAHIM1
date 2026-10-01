import { Link } from 'react-router-dom';
import { useAvailableActions } from '../hooks/useAvailableActions';
import { CommandActionButton } from './CommandActionButton';
import type { AvailableAction } from '../types/service-order-meta.types';

export type ServiceOrderRowActionsProps = {
  serviceOrderId: string;
  orderNumber: string;
  /**
   * Status atual do registro, conforme a última leitura da lista.
   *
   * Usado APENAS como gatilho de recarga: quando o backend muda o status (após prepare,
   * release, cancel ou reopen), os comandos válidos mudam junto. Sem este gatilho a linha
   * continuaria oferecendo as ações do estado anterior.
   */
  status: string;
  /** Superfície a abrir ao acionar um comando que pertence a uma etapa. */
  openPath: string;
  busy: boolean;
  onCancel: () => void;
  onReopen: () => void;
  /**
   * Executa um comando de ciclo de vida oferecido pelo backend (`prepare`, `release`).
   *
   * O componente não sabe quais comandos existem — isso vem de `available-actions` — e
   * também não sabe executá-los: a lista é quem chama a API e trata o erro. Aqui só se
   * encaminha o comando que o BACKEND declarou válido.
   */
  onCommand: (command: string) => void;
  primaryClassName: string;
  secondaryClassName: string;
};

/**
 * Ações de uma linha da lista, dirigidas pelo BACKEND.
 *
 * Antes desta sessão, a lista decidia sozinha qual ação oferecer a partir de um mapa
 * status→comando mantido no front (`resolveServiceOrderNextAction`) mais dois `Set` de
 * status ("cancelável", "reabrível"). Isso duplicava a state machine: qualquer transição
 * nova no backend exigia alteração em dois lugares, e a lista podia oferecer um comando
 * que o backend rejeitaria.
 *
 * Agora a única fonte é `/service-orders/:id/available-actions`. Os rótulos vêm do
 * backend; `usuario_tem_permissao` também. O componente não conhece status algum.
 */
export function ServiceOrderRowActions({
  serviceOrderId,
  orderNumber,
  status,
  openPath,
  busy,
  onCancel,
  onReopen,
  onCommand,
  primaryClassName,
  secondaryClassName,
}: ServiceOrderRowActionsProps) {
  const commands = useAvailableActions(serviceOrderId, true, status);

  if (commands.status === 'loading' || commands.status === 'idle') {
    return <span className="text-xs text-gray-500">Carregando ações…</span>;
  }

  if (commands.status === 'error' || !commands.data) {
    return (
      <Link to={openPath} className={secondaryClassName}>
        Abrir OS
      </Link>
    );
  }

  const valid = commands.data.comandos_validos;

  // A ação primária é o primeiro comando da lista do backend. O backend ordena os
  // comandos na ordem da state machine, então "prepare" vem antes de "cancel", e
  // "start" antes de "complete" — a prioridade é do backend, não deste componente.
  const primary = valid.find((entry) => entry.comando !== 'cancel' && entry.comando !== 'reopen');
  const cancel = valid.find((entry) => entry.comando === 'cancel');
  const reopen = valid.find((entry) => entry.comando === 'reopen');

  const runCommand = (action: AvailableAction): void => {
    // O componente NÃO executa comandos: ele decide a qual superfície da página cada
    // comando pertence. O executor (que chama a API e trata erro) vive na lista.
    if (action.comando === 'cancel') {
      onCancel();
      return;
    }
    if (action.comando === 'reopen') {
      onReopen();
      return;
    }
    onCommand(action.comando);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      {primary ? (
        <CommandActionButton
          action={primary}
          variant="primary"
          disabled={busy}
          className={primaryClassName}
          onClick={() => runCommand(primary)}
        />
      ) : (
        <span className="text-xs text-gray-500">Sem ação direta</span>
      )}
      <div className="flex gap-2">
        <Link to={openPath} className={secondaryClassName}>
          Abrir OS
        </Link>
        {cancel ? (
          <CommandActionButton
            action={cancel}
            disabled={busy}
            className={secondaryClassName}
            onClick={() => runCommand(cancel)}
          />
        ) : null}
        {reopen ? (
          <CommandActionButton
            action={reopen}
            disabled={busy}
            className={secondaryClassName}
            onClick={() => runCommand(reopen)}
          />
        ) : null}
      </div>
      <span className="sr-only">{orderNumber}</span>
    </div>
  );
}
