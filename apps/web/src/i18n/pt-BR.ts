/**
 * Catálogo pt-BR da engine.
 *
 * As chaves dos LABELS DE METADADO seguem o formato `<entidade>.<campo>` e
 * `<entidade>.<campo>.<valor>` para opções de `select`. Quando não há tradução, a engine cai
 * no `label` que veio do metadata store — nunca no nome cru do campo.
 *
 * Isto é o mínimo viável: um catálogo, um `t()`, uma resolução com fallback. Não há
 * pluralização, interpolação nomeada nem carregamento assíncrono de locale — nenhum deles tem
 * uso hoje, e um i18n sem uso é peso sem prova.
 */
export const PT_BR_CATALOG: Record<string, string> = {
  'common.loading': 'Carregando…',
  'common.empty': 'Nenhum registro encontrado.',
  'common.actions': 'Ações',
  'common.retry': 'Tentar novamente',
  'common.denied': 'Você não tem permissão para executar esta ação.',
  'common.error': 'Não foi possível concluir a operação.',

  'timeline.title': 'Histórico',
  'timeline.empty': 'Sem eventos registrados para este registro.',
  'timeline.total': 'eventos',
  'timeline.actor': 'por',
  'timeline.system': 'sistema',

  'filters.title': 'Filtros',
  'filters.clear': 'Limpar filtros',
  'filters.apply': 'Aplicar',
  'filters.all': 'Todos',
  'filters.remove': 'Remover filtro',

  'views.title': 'Visões',
  'views.save': 'Salvar visão',
  'views.saved': 'Visões salvas',
  'views.namePlaceholder': 'Nome da visão',
  'views.delete': 'Excluir visão',
  'views.empty': 'Nenhuma visão salva.',

  'bulk.selected': 'selecionados',
  'bulk.clear': 'Limpar seleção',
  'bulk.apply': 'Aplicar em lote',
  'bulk.none': 'Nenhuma ação em lote disponível.',

  'create.title': 'Novo registro',
  'create.submit': 'Criar',
  'create.cancel': 'Cancelar',

  'list.owner': 'Responsável',
  'list.unassigned': 'Sem responsável',
  'list.total': 'Total',
  'list.count': 'Registros',
  'list.avgAging': 'Aging médio',
  'list.selectRow': 'Selecionar linha',

  'aging.today': 'hoje',
  'aging.days': 'dias',

  'palette.placeholder': 'Buscar telas e ações…',
  'palette.navigate': 'Ir para',
  'palette.actions': 'Ações',
  'palette.empty': 'Nada encontrado.',
  'palette.hint': 'Ctrl+K',

  'permission.denied': 'Sem permissão para ver este bloco.',
};

/**
 * Traduz uma chave, caindo no `fallback` quando não há entrada.
 *
 * O fallback NUNCA é a chave crua: um metadado sem tradução deve mostrar o rótulo que o
 * administrador escreveu, não um identificador técnico.
 */
export function t(key: string, fallback?: string): string {
  const direct = PT_BR_CATALOG[key];
  if (direct !== undefined) {
    return direct;
  }
  if (fallback !== undefined && fallback.trim() !== '') {
    return fallback;
  }
  return key;
}

/** Chave de tradução de um rótulo de campo. */
export function fieldLabelKey(entity: string, field: string): string {
  return `${entity}.${field}`;
}

/** Chave de tradução de uma opção de campo `select`. */
export function fieldOptionKey(entity: string, field: string, value: string): string {
  return `${entity}.${field}.${value}`;
}
