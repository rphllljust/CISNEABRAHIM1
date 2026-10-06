/**
 * CISNE — CISNESAVEDVIEW: CONTRATO
 *
 * ---------------------------------------------------------------------------------------------
 * O DEFEITO QUE ESTE MODULO ELIMINA
 * ---------------------------------------------------------------------------------------------
 *
 * Conforme a Pagina 11 do relatorio, Saved Views sao "personalizacao elevada a objeto de
 * produto". O gap medido: a configuracao da lista — filtro, ordenacao, colunas visiveis, largura,
 * agrupamento — vive hoje em `useState` da pagina. Consequencias reais:
 *
 *   - reload perde tudo, inclusive o filtro que o operador passou 20 minutos montando;
 *   - o operador que so quer "vencidas dos ultimos 7 dias" remonta esse recorte toda manha;
 *   - a mesma personagem em outra tela nao herda nada, porque nao ha contrato comum;
 *   - o servidor nunca sabe qual recorte o operador usa de verdade, entao nao ha como otimizar.
 *
 * Uma Saved View e um OBJETO PERSISTIDO, nao um estado de componente. Ela carrega exatamente o
 * que o relatorio exige: entity/view key, filtros, sort, colunas visiveis, ordem, sizing,
 * group-by opcional, page size, escopo de dono/perfil, flag de padrao e versao.
 *
 * ---------------------------------------------------------------------------------------------
 * DECISOES DE MODELO
 * ---------------------------------------------------------------------------------------------
 *
 * 1. `version` NAO e decoracao. A view e persistida no navegador (localStorage) e sobrevive a
 *    deploy. Sem versao, um deploy que remove uma coluna encontra views antigas apontando para a
 *    coluna que nao existe mais, e a lista quebra para quem ja tinha a view salva — o defeito
 *    aparece so para quem usou o sistema antes, que e o pior tipo de bug. A versao permite
 *    DESCARTAR ou MIGRAR em vez de quebrar.
 *
 * 2. `scope` separa PESSOAL de PERFIL. Uma view de perfil e publicada para todos que exercem
 *    aquele papel; uma pessoal pertence a identidade. Sem essa distincao, "padrao do time" teria
 *    de ser copiada a mao por cada operador.
 *
 * 3. A view guarda o ESTADO DA LISTA, nunca o RESULTADO. Nada aqui e dado de negocio: e recorte,
 *    ordem e apresentacao. A view nao pode se tornar fonte de verdade de titulo, valor ou status.
 */

/** Escopo de propriedade da view. */
export type SavedViewScope =
  /** Pertence a identidade e so ela ve. */
  | 'PERSONAL'
  /** Publicada para um perfil (papel). Visivel a todos que o exercem. */
  | 'ROLE';

/** Direcao de ordenacao. */
export type SavedViewSortDirection = 'asc' | 'desc';

export type SavedViewSort = {
  /** Campo REAL do read model (ex.: `dueDate`). */
  field: string;
  direction: SavedViewSortDirection;
};

/**
 * Filtro persistido.
 *
 * `values` e sempre lista de strings: um filtro de igualdade usa um item, um filtro `in` usa
 * varios. Guardar como lista evita ter dois formatos para o mesmo conceito e permite que a
 * serializacao sobreviva a mudanca de operador do filtro.
 */
export type SavedViewFilter = {
  field: string;
  operator: SavedViewFilterOperator;
  values: string[];
};

export type SavedViewFilterOperator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'contains'
  | 'gte'
  | 'lte'
  | 'isNull'
  | 'isNotNull';

/**
 * Coluna visivel.
 *
 * `width` e opcional e em pixels: a largura que o operador ajustou arrastando a borda. Sem
 * persistir isso, a coluna volta ao tamanho original a cada reload e o ajuste e trabalho perdido.
 * `pinned` marca a coluna que permanece visivel na rolagem horizontal — em lista financeira de 14
 * colunas, rolar ate o valor a cada linha e o que torna a grade inutilizavel.
 */
export type SavedViewColumn = {
  field: string;
  visible: boolean;
  width?: number;
  pinned?: boolean;
};

/** Agrupamento opcional. `null` = lista plana (o caso default). */
export type SavedViewGroupBy = {
  field: string;
  direction: SavedViewSortDirection;
};

/**
 * A view persistida.
 *
 * `key` e a chave estavel de entity+view: a MESMA view pode ser aplicada a superficies diferentes
 * da mesma entidade, e uma view de outra entidade nao deve poder ser aplicada em silencio.
 */
export type CisneSavedView = {
  /** Identificador estavel da view. UUID do cliente. */
  id: string;
  /** Nome dado pelo operador. */
  name: string;
  /**
   * Chave de entidade+view a que a view pertence. Ex.: `finance.payable#list`.
   *
   * Aplicar uma view em escopo diferente e RECUSADO (`canApplySavedView`), porque os campos
   * persistidos podem nao existir no outro read model — e um filtro sobre campo inexistente
   * devolve lista vazia, que o operador le como "nao ha titulo vencido".
   */
  viewKey: string;
  filters: SavedViewFilter[];
  sort: SavedViewSort[];
  columns: SavedViewColumn[];
  groupBy: SavedViewGroupBy | null;
  pageSize: number;
  scope: SavedViewScope;
  /** Identidade dona. Sempre preenchida, inclusive em view de PERFIL (autoria e auditavel). */
  ownerId: string;
  /** Perfil destinatario. Obrigatorio quando `scope = ROLE`; ignorado quando `PERSONAL`. */
  roleId?: string;
  /** A view que abre por default ao entrar na superficie. Uma por escopo de dono+viewKey. */
  isDefault: boolean;
  /** Versao do CONTRATO de view que produziu este registro. Ver nota 1 no topo do arquivo. */
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Estado de lista que a view captura e restaura. */
export type SavedViewState = {
  filters: SavedViewFilter[];
  sort: SavedViewSort[];
  columns: SavedViewColumn[];
  groupBy: SavedViewGroupBy | null;
  pageSize: number;
};

/**
 * VERSAO ATUAL do contrato de view.
 *
 * Incrementar SEMPRE que a forma dos campos persistidos mudar de modo incompativel (campo
 * removido, semantica de operador alterada, coluna deixando de ser identificada por `field`).
 * Views gravadas com versao diferente sao descartadas na leitura, em vez de quebrar a lista —
 * ver `isCompatibleSavedView`.
 */
export const SAVED_VIEW_CONTRACT_VERSION = 1;

/** Tamanhos de pagina aceitos. Fora desta lista o valor persistido e normalizado. */
export const SAVED_VIEW_PAGE_SIZES = [25, 50, 100, 200] as const;

export const DEFAULT_SAVED_VIEW_PAGE_SIZE = 50;

/** Limite de views por escopo de dono+viewKey. Evita crescimento sem controle no navegador. */
export const MAX_SAVED_VIEWS_PER_SCOPE = 50;

/** Limite de caracteres do nome. Nome longo nao cabe no seletor e vira ruido. */
export const MAX_SAVED_VIEW_NAME_LENGTH = 60;
