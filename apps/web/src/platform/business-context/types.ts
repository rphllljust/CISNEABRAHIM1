/**
 * CISNE — BUSINESS CONTEXT BUS: CONTRATO
 *
 * ---------------------------------------------------------------------------------------------
 * O DEFEITO QUE ESTE MODULO ELIMINA
 * ---------------------------------------------------------------------------------------------
 *
 * Conforme a Pagina 12 do relatorio, um contexto de negocio "pode ser publicado uma vez e
 * consumido por varios widgets ou aplicacoes, permitindo que selecao e drilldown atravessem
 * fronteiras de modulo".
 *
 * O gap medido: para responder "como esta o cliente X" o operador navega Cliente -> Propostas ->
 * OS -> Recebiveis -> Documentos. Sao 4 a 5 navegacoes de pagina inteira, e cada uma PERDE o
 * contexto anterior: a lista de recebiveis nao sabe qual cliente estava em foco, entao o operador
 * refaz o filtro a mao. O cliente e o MESMO objeto; a aplicacao e que esquece.
 *
 * O BUS resolve isso publicando UM contexto tipado — "qual objeto de negocio esta em foco" — que
 * qualquer modulo pode ler e reagir, sem conhecer os outros modulos.
 *
 * ---------------------------------------------------------------------------------------------
 * LIMITES DELIBERADOS
 * ---------------------------------------------------------------------------------------------
 *
 * 1. O CONTEXTO E DE APRESENTACAO, NAO DE AUTORIZACAO. Publicar "Client X em foco" NAO concede
 *    leitura de nada. Cada modulo, ao reagir, faz sua PROPRIA consulta e recebe do servidor a
 *    mesma negacao de sempre se nao tiver capability. O pior caso de um contexto indevido e uma
 *    tela que consulta e recebe 403 — nunca um dado exibido sem permissao.
 *
 * 2. O CONTEXTO GUARDA IDENTIDADE, NAO CONTEUDO. O tipo carrega `id` e `label` (para o cabecalho
 *    "Cliente: ACME"), nunca o registro completo. Guardar o objeto inteiro faria o bus virar um
 *    cache paralelo do dominio, com dado potencialmente velho alimentando telas que deveriam
 *    reconsultar.
 *
 * 3. NAO HA CONTEXTO IMPLICITO. Reagir a uma mudanca de foco e uma escolha DECLARADA do modulo
 *    consumidor (`useBusinessContextFocus`). Um bus que reescreve a tela de todo mundo ao clicar
 *    torna imprevisivel onde o operador esta.
 */

/**
 * As entidades que podem ocupar o foco.
 *
 * Lista FECHADA e deliberada: o bus e um contrato entre modulos, e um `string` livre permitiria a
 * um modulo publicar `entity: 'cliente'` que nenhum consumidor reconhece — falha silenciosa, sem
 * erro de tipo. Acrescentar entidade aqui e uma decisao de plataforma.
 */
export const BUSINESS_CONTEXT_ENTITIES = [
  'Client',
  'ServiceOrder',
  'Supplier',
  'TreasuryAccount',
  'AccountingPeriod',
] as const;

export type BusinessContextEntity = (typeof BUSINESS_CONTEXT_ENTITIES)[number];

/** Rotulo humano de cada entidade, para cabecalho e acessibilidade. */
export const BUSINESS_CONTEXT_LABELS: Record<BusinessContextEntity, string> = {
  Client: 'Cliente',
  ServiceOrder: 'Ordem de serviço',
  Supplier: 'Fornecedor',
  TreasuryAccount: 'Conta de tesouraria',
  AccountingPeriod: 'Período contábil',
};

/** Rota canonica de cada entidade — para onde "abrir o objeto" leva. */
export const BUSINESS_CONTEXT_ROUTES: Record<BusinessContextEntity, (id: string) => string> = {
  Client: (id) => `/app/clients/${encodeURIComponent(id)}`,
  ServiceOrder: (id) => `/app/service-orders/${encodeURIComponent(id)}`,
  Supplier: (id) => `/app/suppliers/${encodeURIComponent(id)}`,
  TreasuryAccount: (id) => `/app/finance/treasury/${encodeURIComponent(id)}`,
  AccountingPeriod: (id) => `/app/accounting/periods/${encodeURIComponent(id)}`,
};

/**
 * O objeto EM FOCO.
 *
 * `label` e a referencia HUMANA ja resolvida pelo publicador (ex.: "ACME Serviços", "OS-2026-0142").
 * Existe para que o cabecalho do contexto nao precise reconsultar o objeto so para escrever o nome
 * do que esta em foco — mas e um ROTULO, nunca a fonte do dado de negocio.
 */
export type BusinessContextFocus = {
  entity: BusinessContextEntity;
  id: string;
  label: string;
  /** Escopo organizacional do objeto, quando conhecido. Sem isto, modulos multi-unidade nao sabem
   *  se o foco pertence a unidade que estao exibindo. */
  unitId?: string;
  /** Contexto adicional tipado por entidade (ex.: `status` da OS). Dado curto e ja resolvido. */
  attributes?: Record<string, string>;
};

/**
 * Um consumidor REAGIU ao foco:
 *
 *   `matched`   — o modulo tem conteudo real para este foco;
 *   `empty`     — o modulo respondeu e nao ha nada (fato de negocio legitimo);
 *   `denied`    — o modulo NAO tem permissao sobre este foco (nao e "vazio"!);
 *   `loading`   — ainda consultando;
 *   `idle`      — o modulo nao acompanha este foco.
 *
 * A DISTINCAO `empty` vs `denied` E O PONTO CENTRAL. Relatorio que mostra "0 recebíveis" quando o
 * operador nao pode LER recebíveis afirma um fato financeiro falso. O bus propaga essa distincao
 * para que a visao 360 nunca confunda "nao ha" com "nao posso ver".
 */
export type BusinessContextConsumerState =
  | 'idle'
  | 'loading'
  | 'matched'
  | 'empty'
  | 'denied';

/** Registro de um modulo que acompanha o foco. */
export type BusinessContextConsumer = {
  id: string;
  /** Rotulo do modulo (ex.: "Recebíveis"). */
  label: string;
  /**
   * Entidades que este consumidor acompanha. Vazio/ausente = acompanha TODAS.
   * Declarar as entidades evita que o modulo de recebiveis entre em `loading` para um foco de
   * periodo contabil, que ele nao sabe interpretar.
   */
  entities?: BusinessContextEntity[];
};

/** Estado publicado por um consumidor, para o cabecalho do contexto. */
export type BusinessContextConsumerReport = {
  consumerId: string;
  label: string;
  state: BusinessContextConsumerState;
  /** Contagem real, quando o modulo tem uma. `null` = nao se aplica (nunca "0" por engano). */
  count?: number | null;
  /** Motivo real quando `denied` ou `empty`. */
  hint?: string;
  /** Rota de drilldown real para o modulo já recortado por este foco. */
  to?: string;
};

/** Valor publicado no bus. */
export type BusinessContextValue = {
  /** Foco atual. `null` = nenhum objeto em foco (estado inicial legitimo). */
  focus: BusinessContextFocus | null;
  /** Identidade que publicou — auditoria de quem definiu o foco. */
  publishedBy: string | null;
  /** Momento da publicacao (ISO). */
  publishedAt: string | null;
  /** Quantos saltos de navegacao o contexto evitou. Ver `navigateWithContext`. */
  history: BusinessContextFocus[];
};

/** Chave estavel do foco, para comparacao e para dependencias de efeito. */
export function focusKey(focus: BusinessContextFocus | null): string {
  if (!focus) {
    return '\u0000none';
  }
  return `${focus.entity}:${focus.id}`;
}

export function isBusinessContextEntity(value: unknown): value is BusinessContextEntity {
  return (
    typeof value === 'string' &&
    (BUSINESS_CONTEXT_ENTITIES as readonly string[]).includes(value)
  );
}

/**
 * Rotulo humano do foco para cabecalho: "Cliente: ACME Serviços".
 *
 * Cai para o id quando nao ha rotulo, porque um cabecalho sem identificacao e pior que um
 * cabecalho com id tecnico — o operador precisa saber sobre o que a tela esta falando.
 */
export function describeFocus(focus: BusinessContextFocus): string {
  const label = BUSINESS_CONTEXT_LABELS[focus.entity];
  const name = focus.label.trim().length > 0 ? focus.label : focus.id;
  return `${label}: ${name}`;
}
