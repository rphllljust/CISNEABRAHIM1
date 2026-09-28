import { listPhysicalAssets } from '../../assets/api/physical-assets-api';
import type { HumanLookupOption } from '../../financial-ui/HumanLookupField';

/**
 * Busca de ativos físicos para escolha humana no livro de imobilizado.
 *
 * Usa a listagem do cadastro de Recursos (`/api/v1/resources/physical-assets`) — a mesma
 * autoridade que conhece o ativo — em vez de exigir que o operador cole o identificador técnico
 * no formulário contábil. A busca é feita no servidor (termo livre + limite pequeno); nenhuma
 * página inteira de ativos é carregada no navegador.
 *
 * Se o ator não puder listar ativos físicos, a busca devolve vazio (sem inventar opções) e a
 * tela informa isso — não abre um campo de identificador como saída.
 */
export async function searchPhysicalAssetOptions(
  term: string,
  signal?: AbortSignal,
): Promise<HumanLookupOption[]> {
  const response = await listPhysicalAssets(
    { limit: 20, offset: 0, q: term.trim().length > 0 ? term.trim() : undefined },
    signal,
  );
  return response.items.map((asset) => ({
    id: asset.id,
    label: asset.name,
    // Código do ativo (e placa, quando houver) é o apoio legível — nunca o identificador técnico.
    support: asset.vehicle?.plate ? `${asset.assetCode} · ${asset.vehicle.plate}` : asset.assetCode,
  }));
}
