import { listClients } from '../clients/api/clients-api';
import { formatCnpjDisplay } from '../clients/utils/format-cnpj';
import type { HumanLookupOption } from './HumanLookupField';

/**
 * Busca de Clientes para escolha humana em filtros e formulários.
 *
 * Usa a listagem do cadastro de Clientes — a mesma autoridade que valida o vínculo — em vez de
 * exigir que o operador cole um identificador técnico. Se o ator não puder listar Clientes, a
 * busca devolve vazio (sem inventar opções) e a tela continua funcionando pelo termo livre.
 */
export async function searchClientOptions(
  term: string,
  signal?: AbortSignal,
): Promise<HumanLookupOption[]> {
  const response = await listClients(
    { limit: 20, offset: 0, q: term.trim().length > 0 ? term.trim() : undefined },
    signal,
  );
  return response.items.map((client) => ({
    id: client.id,
    label: client.tradeName ?? client.legalName,
    support: formatCnpjDisplay(client.taxId),
  }));
}
