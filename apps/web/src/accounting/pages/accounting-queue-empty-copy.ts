/** Uma página vazia ou um filtro sem correspondências não comprovam ausência de pendências no ledger. */
export function accountingQueueEmptyCopy(filtered: boolean): { title: string; description: string } {
  return filtered
    ? {
        title: 'Nenhum caso neste filtro',
        description: 'Nenhum caso retornado corresponde ao estado selecionado. Limpe o filtro para consultar os demais casos.',
      }
    : {
        title: 'Nenhum caso nesta página',
        description: 'A página consultada não retornou casos. Isso não comprova ausência de pendências em outras páginas ou no total do servidor.',
      };
}
