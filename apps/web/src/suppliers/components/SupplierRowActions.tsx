import { Link } from 'react-router-dom';
import { CommandActionButton } from '../../service-orders/components/CommandActionButton';
import { useSupplierAvailableActions } from '../hooks/useSupplierAvailableActions';
import {
  activateSupplier,
  archiveSupplier,
  deactivateSupplier,
} from '../api/suppliers-api';
import { BackofficeApiError } from '../../financial-ui/enterprise-api';
import { mapSupplierErrorToMessage } from '../api/supplier-error-messages';

export type SupplierRowActionsProps = {
  supplierId: string;
  /**
   * Status atual do registro, conforme a última leitura da lista.
   *
   * Gatilho de RECARGA apenas: quando o backend muda o status, os comandos válidos mudam
   * junto. O componente não interpreta o valor.
   */
  status: string;
  version: number;
  openPath: string;
  onChanged: () => void;
};

/**
 * Ações de uma linha da lista, dirigidas pelo BACKEND.
 *
 * Espelha `ServiceOrderRowActions` (B5): reusa o `CommandActionButton` daquele domínio, e a
 * única fonte de verdade é `GET /suppliers/:id/available-actions`. O componente NÃO conhece
 * o mapa de status — não há `if (status === ...)` aqui.
 *
 * Botão sem permissão fica VISÍVEL e DESABILITADO, com o motivo em tooltip: esconder
 * transformaria uma restrição de acesso em um mistério para o operador.
 */
export function SupplierRowActions({
  supplierId,
  status,
  version,
  openPath,
  onChanged,
}: SupplierRowActionsProps) {
  const commands = useSupplierAvailableActions(supplierId, true, status);

  async function runCommand(command: string): Promise<void> {
    try {
      if (command === 'activate') {
        await activateSupplier(supplierId, { version });
      } else if (command === 'deactivate') {
        await deactivateSupplier(supplierId, { version, reason: 'Inativação a partir da lista.' });
      } else if (command === 'archive') {
        await archiveSupplier(supplierId, { version, reason: 'Arquivamento a partir da lista.' });
      }
      onChanged();
    } catch (error) {
      // O erro é propagado ao usuário pelo estado da lista; aqui basta não engolir.
      if (error instanceof BackofficeApiError) {
        mapSupplierErrorToMessage(error.code, error.status);
      }
      onChanged();
    }
  }

  if (commands.status === 'loading' || commands.status === 'idle') {
    return <span className="text-[11px] text-gray-500">Carregando ações…</span>;
  }

  if (commands.status === 'error' || !commands.data) {
    return (
      <Link to={openPath} className="text-[11px] text-brand-700 underline">
        Abrir fornecedor
      </Link>
    );
  }

  if (commands.data.comandos_validos.length === 0) {
    return <span className="text-[11px] text-gray-500">Sem ação direta</span>;
  }

  return (
    <div className="flex flex-wrap justify-end gap-1" data-testid="supplier-row-actions">
      {commands.data.comandos_validos.map((action) => (
        <CommandActionButton
          key={action.comando}
          action={action}
          className="rounded border border-gray-300 px-2 py-0.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => void runCommand(action.comando)}
        />
      ))}
    </div>
  );
}
