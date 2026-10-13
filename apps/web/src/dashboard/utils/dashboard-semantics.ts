import type { ExecutiveAttentionItem, ExecutiveDashboardSnapshot } from '../types/dashboard.types';
import type { WorkDomain } from '../../work-inbox/api/work-inbox-api';

/**
 * SEMANTICA DE APRESENTACAO DO PAINEL EXECUTIVO.
 *
 * Esta camada NAO calcula metrica, NAO deriva regra e NAO reclassifica dado do
 * servidor: ela apenas responde "onde clicar" e "como nomear o numero que o
 * servidor ja entregou". Todo valor exibido vem do snapshot composto unico
 * (`GET /dashboard/executive`); nada aqui le outra fonte.
 *
 * Regras de honestidade aplicadas:
 *  - destino so existe quando a LISTA de destino realmente interpreta o recorte;
 *  - ausencia de destino nao vira link generico de modulo: vira `null` e a
 *    excecao continua sendo exibida sem prometer navegacao;
 *  - nada e multiplicado, somado ou projetado entre metricas distintas.
 *
 * Confirmado no codigo da lista de destino (`finance/pages/ReceivablesListPage.tsx`): o
 * parametro lido da URL e `status`. Os destinos de recebiveis NOMEIAM esse parametro — antes
 * ele era omitido e o link abria a carteira inteira: um drill que nao entrega o proprio
 * recorte e um numero que mente.
 */

export type SeverityTone = 'critical' | 'warning' | 'info';

export const DASHBOARD_SEVERITY_TONE: Record<ExecutiveAttentionItem['severity'], SeverityTone> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
};

const SEVERITY_RANK: Record<ExecutiveAttentionItem['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** Excecoes ordenadas por severidade e, dentro dela, por volume. */
export function sortAttentionBySeverity(items: ExecutiveAttentionItem[]): ExecutiveAttentionItem[] {
  return [...items].sort((left, right) => {
    const delta = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
    if (delta !== 0) {
      return delta;
    }
    return right.count - left.count;
  });
}

/** Frase de situacao lida na FILA EXECUTIVA, por severidade real do item. */
export function attentionSituationLabel(severity: ExecutiveAttentionItem['severity']): string {
  return severity === 'critical' ? 'Crítico' : severity === 'warning' ? 'Atenção' : 'Acompanhar';
}

/** Ordem em que as situacoes aparecem no resumo da fila executiva. */
export const ATTENTION_SITUATION_ORDER: ReadonlyArray<ExecutiveAttentionItem['severity']> = [
  'critical',
  'warning',
  'info',
];

/**
 * TETO DO DINHEIRO EM ATRASO — EXIBIDO SOMENTE QUANDO O VALOR E COMPROVADO.
 *
 * `receivables.overdue_amount` e metrica CONFIRMED do catalogo SMC-001 e o
 * serializer executivo ja a calcula. O unico valor monetario de atraso publicado
 * no snapshot hoje e a exposicao dos faturamentos vencidos, que chega no `detail`
 * do item de atencao `overdue-receivables` no MESMO evento de render — logo o
 * rotulo nunca aparece sem o numero ao lado.
 *
 * Enquanto `receivables.overdue_amount` nao existir como campo de primeira classe
 * do snapshot, NAO se soma o aging por faixa para "reconstruir" o total: isso
 * seria derivar metrica no navegador.
 */
export function extractOverdueExposure(item: ExecutiveAttentionItem | undefined): string | null {
  if (!item?.detail) {
    return null;
  }
  const matched = item.detail.match(/R\$\s*[\d.,]+/);
  return matched ? matched[0] : null;
}

/**
 * PROCESS RAIL — cadeia empresarial Comercial -> Operacao -> Medicao -> Faturamento -> Recebimento.
 *
 * Cada etapa e alimentada por um FATO DIFERENTE, ja resolvido pelo servidor na cadeia real do
 * dominio (`CLIENTE -> SOLICITACAO -> PROPOSTA -> PO -> OS -> EXECUCAO -> MEDICAO -> FATURAMENTO
 * -> RECEBIVEL`). Nenhuma etapa soma outra etapa.
 *
 * duas naturezas de etapa, e a diferenca importa:
 *  - `count` numerico   = o snapshot publicou a contagem daquela etapa;
 *  - `count: null`      = o snapshot publicou o estado da etapa SEM contagem. A etapa existe,
 *                         esta nomeada e continua na cadeia; o que nao existe e o numero.
 *
 * `count: null` NUNCA e renderizado como zero: ausencia nao e zero.
 */
export type BusinessFlowStage = {
  id: string;
  label: string;
  /** Contagem real publicada; `null` quando a etapa nao tem contagem publicada. */
  count: number | null;
  amount: string | null;
  situation: 'critical' | 'attention' | 'normal';
  /** Estado dominante da etapa, em linguagem de negocio. */
  situationLabel: string;
  href: string | null;
  /** Fato que ancora a etapa — nunca uma promessa de funcionalidade. */
  hint: string;
  /**
   * ESTAGIO DO PROCESSO SEM CONTADOR PUBLICADO.
   *
   * A etapa existe no processo do CISNE (Solicitacao -> Proposta -> Contrato -> OS -> Medicao ->
   * Faturamento -> Recebimento) ainda que o snapshot nao publique um numero para ela. Nesse caso o
   * estagio continua na trilha com `count: null` e este flag ligado: a tela mostra `—` e "sem
   * contagem publicada".
   *
   * FLUXO DESCREVE PROCESSO. CONTADOR DESCREVE DADO. Remover a etapa porque falta o numero
   * confundiria os dois — e apagaria do operador a forma do processo que ele opera.
   */
  unmeasured: boolean;
};

/**
 * DESTINOS DE DRILL — apenas recortes que a lista de destino comprovadamente
 * interpreta hoje. O modulo AUTHZ permanece intacto: quem revalida capability,
 * escopo e unidade e a propria lista de destino, nunca a URL.
 */
export const DASHBOARD_DRILL_DESTINATIONS = {
  'service-orders-active': '/app/service-orders?status=active',
  'orders-in-progress': '/app/service-orders?status=IN_EXECUTION',
  'orders-awaiting-release': '/app/service-orders?status=RELEASED',
  'measurements-pending': '/app/billing',
  'awaiting-billing': '/app/billing',
  'receivables-overdue': '/app/finance/receivables?status=OVERDUE',
  'receivables-open': '/app/finance/receivables?status=OPEN',
  'receivables-partial': '/app/finance/receivables?status=PARTIALLY_PAID',
  'payables-overdue': '/app/finance/payables?status=OVERDUE',
} as const;

export type DashboardDrillId = keyof typeof DASHBOARD_DRILL_DESTINATIONS;

export function drillHref(id: DashboardDrillId): string {
  return DASHBOARD_DRILL_DESTINATIONS[id];
}

function drillHrefIfKnown(id: string): string | null {
  return id in DASHBOARD_DRILL_DESTINATIONS
    ? DASHBOARD_DRILL_DESTINATIONS[id as DashboardDrillId]
    : null;
}

/**
 * Drill do item de atencao: o `href` do servidor tem precedencia (contrato
 * FDC-001); quando ausente, o recorte e resolvido por identidade conhecida.
 * Item sem lista filtrada real devolve `null` — a tela nao inventa modulo.
 */
export function attentionDrillHref(item: ExecutiveAttentionItem): string | null {
  return item.href ?? drillHrefIfKnown(item.id);
}

/**
 * Contagem de um item de atencao — `null` QUANDO O ITEM NAO FOI PUBLICADO.
 *
 * O `?? 0` desta funcao era um gerador de mentira: `overdue-receivables` ausente do snapshot
 * (porque o executor nao publica essa contagem) virava "0 titulos vencidos" na tela — uma
 * AFIRMACAO DE AUSENCIA que o servidor nunca fez. AUSENCIA != ZERO.
 *
 * Quem precisa do numero para decidir recebe `null` e trata como "nao publicado". Quem so quer
 * saber se ha trabalho usa `attentionCount(...) ?? 0`, explicitamente, no ponto de decisao.
 */
function attentionCountOrNull(
  snapshot: ExecutiveDashboardSnapshot,
  id: string,
): number | null {
  return snapshot.attention.find((item) => item.id === id)?.count ?? null;
}

/**
 * CADEIA EMPRESARIAL DO PAINEL.
 *
 * Ordem de negocio fixa: Comercial -> Operacao -> Medicao -> Faturamento -> Recebimento. Uma etapa
 * entra na cadeia quando o fato dela foi publicado; etapa sem fato nao e afirmada nem ocupa lugar.
 * Etapa cuja contagem nao veio continua na cadeia com o estado publicado e `count: null`.
 *
 * `domain` e RECORTE DE APRESENTACAO: ele apenas seleciona quais etapas da MESMA cadeia ficam em
 * foco. Nunca altera contagem, nunca soma etapa e nunca cria etapa que o servidor nao publicou.
 */
export function buildBusinessFlow(
  snapshot: ExecutiveDashboardSnapshot,
  domain: string | null = null,
): BusinessFlowStage[] {
  const visibility = snapshot.visibility;
  const overdueOrders = attentionCountOrNull(snapshot, 'overdue-service-orders');
  const activeOrders = snapshot.charts.serviceOrdersByStatus.items.reduce(
    (total, item) => total + item.count,
    0,
  );
  const stages: BusinessFlowStage[] = [];

  /*
   * A TRILHA E O PROCESSO INTEIRO, NAO SO AS ETAPAS COM CONTADOR.
   *
   * O fluxo do CISNE e: SOLICITACAO -> PROPOSTA -> CONTRATO -> ORDEM DE SERVICO -> MEDICAO ->
   * FATURAMENTO -> RECEBIMENTO. As tres primeiras existem como modulo real no produto, mas o
   * snapshot executivo nao publica contagem por elas; as demais publicam (ou publicam o FATO da
   * etapa sem numero, como Faturamento).
   *
   * Antes, uma etapa so entrava na trilha quando a dimensao inteira era publicada — e por isso a
   * tela abria com "Operacao -> Medicao -> Faturamento -> Recebimento", escondendo do operador
   * metade do processo que ele opera. Agora a trilha e SEMPRE completa: etapa sem contador publicado
   * permanece, com `count: null` e `unmeasured: true`, e a tela mostra `—` + "sem contagem
   * publicada". Ausencia de numero nao apaga a forma do processo.
   *
   * O RECORTE DE DOMINIO continua governando a CONTAGEM, nao a existencia da etapa: fora do dominio
   * que a alimenta, a etapa permanece visivel com a contagem suprimida (`unmeasured`), em vez de
   * exibir numero de OPERACOES sob um chip COMERCIAL.
   */
  const operationInScope =
    domain === null || domain === 'OPERACOES' || domain === 'FINANCEIRO' ||
    domain === 'FISCAL' || domain === 'CONTABILIDADE';
  const financeInScope = visibility.billing && (domain === null || domain === 'FINANCEIRO');

  /* ---- ETAPAS COMERCIAIS: o processo comeca aqui, mesmo sem contador publicado -------------- */

  stages.push({
    id: 'request',
    label: 'Solicitação',
    count: null,
    amount: null,
    situation: 'normal',
    situationLabel: 'Sem contagem publicada',
    href: '/app/requests',
    hint: 'Demanda registrada pelo cliente e triada pelo comercial',
    unmeasured: true,
  });

  stages.push({
    id: 'proposal',
    label: 'Proposta',
    count: null,
    amount: null,
    situation: 'normal',
    situationLabel: 'Sem contagem publicada',
    href: '/app/proposals',
    hint: 'Oferta comercial derivada da solicitação',
    unmeasured: true,
  });

  stages.push({
    id: 'contract',
    label: 'Contrato',
    count: null,
    amount: null,
    situation: 'normal',
    situationLabel: 'Sem contagem publicada',
    href: '/app/contracts',
    hint: 'Vínculo formal que autoriza a execução',
    unmeasured: true,
  });

  /* ---- OPERACAO ------------------------------------------------------------------------------ */

  stages.push({
    id: 'operation',
    label: 'Ordem de serviço',
    count: visibility.serviceOrders && operationInScope ? activeOrders : null,
    amount: null,
    situation:
      operationInScope && overdueOrders !== null && overdueOrders > 0 ? 'critical' : 'normal',
    situationLabel: !operationInScope
      ? 'Fora do recorte ativo'
      : overdueOrders === null
        ? 'Atraso não publicado'
        : overdueOrders > 0
          ? `${overdueOrders} ${overdueOrders === 1 ? 'ordem vencida' : 'ordens vencidas'}`
          : 'Nenhuma ordem vencida',
    href: DASHBOARD_DRILL_DESTINATIONS['service-orders-active'],
    hint: 'Ordens ativas no escopo autorizado',
    unmeasured: !visibility.serviceOrders || !operationInScope || activeOrders === 0,
  });

  /* ---- MEDICAO ------------------------------------------------------------------------------- */

  const pending = visibility.measurements && operationInScope
    ? attentionCountOrNull(snapshot, 'pending-measurements')
    : null;
  stages.push({
    id: 'measurement',
    label: 'Medição',
    count: pending,
    amount: null,
    situation: pending !== null && pending > 0 ? 'attention' : 'normal',
    situationLabel: pending === null
      ? 'Sem contagem publicada'
      : pending > 0
        ? 'Aguardando aprovação'
        : 'Nenhuma parada',
    href: pending !== null && pending > 0
      ? DASHBOARD_DRILL_DESTINATIONS['measurements-pending']
      : DASHBOARD_DRILL_DESTINATIONS['awaiting-billing'],
    hint: 'Serviço executado medido e submetido à aprovação',
    unmeasured: pending === null,
  });

  /* ---- FATURAMENTO E RECEBIMENTO ------------------------------------------------------------- */

  stages.push({
    id: 'billing',
    label: 'Faturamento',
    count: null,
    amount: null,
    situation: 'normal',
    situationLabel: financeInScope ? 'Sem contagem publicada' : 'Fora do recorte ativo',
    href: DASHBOARD_DRILL_DESTINATIONS['awaiting-billing'],
    hint: 'Cobrança preparada a partir da medição aprovada',
    unmeasured: true,
  });

  const overdueReceivables = financeInScope
    ? attentionCountOrNull(snapshot, 'overdue-receivables')
    : null;
  const exposure = extractOverdueExposure(
    snapshot.attention.find((item) => item.id === 'overdue-receivables'),
  );
  stages.push({
    id: 'receivement',
    label: 'Recebimento',
    count: overdueReceivables,
    amount: financeInScope ? exposure : null,
    situation: overdueReceivables !== null && overdueReceivables > 0 ? 'critical' : 'normal',
    situationLabel: !financeInScope
      ? 'Fora do recorte ativo'
      : overdueReceivables === null
        ? 'Sem contagem publicada'
        : overdueReceivables > 0
          ? `${overdueReceivables} ${overdueReceivables === 1 ? 'título vencido' : 'títulos vencidos'}`
          : 'Nenhum título vencido',
    href: DASHBOARD_DRILL_DESTINATIONS['receivables-overdue'],
    hint: 'Títulos emitidos e não liquidados',
    unmeasured: overdueReceivables === null,
  });

  return stages;
}

/**
 * ETAPAS DO PAINEL QUE NAO SAO EXCECAO OPERACIONAL.
 *
 * `divergences` e a unica excecao que fala de CONTEUDO do documento (medição rejeitada ou
 * faturamento anulado), nao de prazo. Ela aparece na cadeia, junto do estagio que a produz —
 * e nao duas vezes na fila de trabalho.
 */
export const DASHBOARD_CHAIN_ONLY_ATTENTION = ['divergences'] as const;

/* ============================================================================
   RECORTE DE DOMINIO DO WORKSPACE — o que CADA dominio realmente alcanca
   ============================================================================ */

/**
 * DIMENSOES DE DADO QUE O SNAPSHOT PUBLICA HOJE.
 *
 * O snapshot executivo e um payload COMPOSTO: ele nao publica, por campo, sob qual dominio aquele
 * numero foi apurado. A unica correspondencia sustentada pelo contrato existente e esta:
 *
 *   serviceOrdersByStatus / throughputTrend / sla / productivity  -> OPERACAO (ordens de servico)
 *   financialAging                                                -> FINANCEIRO (carteira)
 *   attention[]                                                   -> por declaracao do servidor
 *
 * As demais dimensoes (FISCAL, CONTABILIDADE, SUPRIMENTOS, COMERCIAL) existem na fila de trabalho
 * (`GET /work-inbox`, que RECORTA no servidor por `domain`) mas NAO tem, hoje, contraparte no
 * snapshot executivo. Isso nao e defeito de tela: e o limite do contrato.
 *
 * CONSEQUENCIA NA APRESENTACAO — e esta e a regra que a tela obedece:
 *   - o painel SEM recorte (Tudo) e AGREGADO: soma sobre os dominios autorizados, como sempre foi;
 *   - dentro de um recorte de dominio, uma dimensao de OUTRO dominio NAO e exibida. Nem zerada,
 *     nem estimada, nem "filtrada" por um filtro que o servidor nao aplicou.
 *
 * Escolha deliberada contra a alternativa: manter a faixa de OS e os indicadores de produtividade
 * visiveis sob o chip "Fiscal" faria o operador ler numeros de OPERACAO como se fossem fiscais.
 * Ocultar e honesto; tingir seria mentir.
 */
export const DOMAIN_DATA_DIMENSIONS: Record<string, ReadonlyArray<'OPERACAO' | 'FINANCEIRO'>> = {
  OPERACOES: ['OPERACAO'],
  FINANCEIRO: ['FINANCEIRO'],
  FISCAL: [],
  CONTABILIDADE: [],
  COMERCIAL: [],
  SUPRIMENTOS: [],
};

/** O recorte ativo alcanca o dado de OPERACAO (ordens, throughput, SLA, produtividade)? */
export function domainReachesOperation(domain: string | null): boolean {
  return domain === null || (DOMAIN_DATA_DIMENSIONS[domain]?.includes('OPERACAO') ?? false);
}

/** O recorte ativo alcanca o dado FINANCEIRO (carteira, aging)? */
export function domainReachesFinance(domain: string | null): boolean {
  return domain === null || (DOMAIN_DATA_DIMENSIONS[domain]?.includes('FINANCEIRO') ?? false);
}

/**
 * AS SETE POSICOES DO RECORTE — a mesma lista que a barra de dominio oferece.
 *
 * A ORDEM E RESPONSABILIDADE DE PRODUTO, nao do `WORK_DOMAINS`: a barra abre com "Tudo" e mantem
 * a ordem institucional (Financeiro, Fiscal, Contabilidade, Operacoes, Comercial, Suprimentos)
 * que o menu do CISNE ja usa.
 */
export const DASHBOARD_DOMAIN_ORDER: ReadonlyArray<WorkDomain> = [
  'FINANCEIRO',
  'FISCAL',
  'CONTABILIDADE',
  'OPERACOES',
  'COMERCIAL',
  'SUPRIMENTOS',
];

/** Excecoes de dominio que a tela NAO repete: elas vivem na etapa da cadeia que as produz. */
const CHAIN_OWNED_ATTENTION: ReadonlyArray<string> = DASHBOARD_CHAIN_ONLY_ATTENTION;

/**
 * EXCECOES DENTRO DO RECORTE ATIVO — com a origem da AFIRMACAO.
 *
 * A distincao que este tipo carrega e a regra central do Situation Handling:
 *
 *   `'published'`    o servidor avaliou esta excecao e publicou o numero;
 *   `'not-evaluated'` o servidor NAO publicou esta excecao para o recorte. Ausencia de item nao e
 *                     "zero itens": e ausencia de avaliacao, e a tela precisa dizer isso.
 *
 * Sem essa distincao, um recorte em que o executor nao publicou `overdue-service-orders` aparecia
 * na tela como "operacao sem excecoes criticas" — uma conclusao que o dado nunca autorizou.
 */
export type ScopedAttention = {
  /** Excecoes publicadas e aplicaveis ao recorte, ordenadas por severidade. */
  items: ExecutiveAttentionItem[];
  /** Ids de excecao que o recorte alcanca mas que o snapshot NAO publicou. */
  notEvaluated: string[];
};

/**
 * MAPA RECORTE -> EXCECOES QUE AQUELE RECORTE ALCANCA.
 *
 * Declaracao explicita, nao heuristica: cada dominio lista as excecoes cujo OBJETO pertence a ele.
 */
const DOMAIN_ATTENTION_IDS: Record<string, ReadonlyArray<string>> = {
  FINANCEIRO: ['overdue-receivables'],
  OPERACOES: ['overdue-service-orders', 'approaching-due-service-orders', 'pending-measurements'],
  FISCAL: [],
  CONTABILIDADE: [],
  COMERCIAL: [],
  SUPRIMENTOS: [],
};

/** Rotulo humano da excecao conhecida — usado quando o recorte alcanca uma excecao nao publicada. */
const ATTENTION_FALLBACK_LABEL: Record<string, string> = {
  'overdue-service-orders': 'ordens de serviço vencidas',
  'approaching-due-service-orders': 'ordens de serviço a vencer',
  'pending-measurements': 'medições aguardando análise',
  'overdue-receivables': 'títulos a receber vencidos',
  divergences: 'divergências de conteúdo',
};

export function attentionLabelFor(id: string): string {
  return ATTENTION_FALLBACK_LABEL[id] ?? id;
}

/**
 * EXCECOES DO RECORTE — SEM inventar avaliacao que o servidor nao fez.
 *
 * `divergences` fica de fora porque ela NAO e excecao de prazo: a cadeia a exibe na etapa que a
 * produz, e repeti-la na fila contaria o mesmo fato duas vezes.
 */
export function scopedAttention(
  snapshot: ExecutiveDashboardSnapshot,
  domain: string | null,
): ScopedAttention {
  const operational = snapshot.attention.filter((item) => !CHAIN_OWNED_ATTENTION.includes(item.id));

  if (domain === null) {
    return { items: operational, notEvaluated: [] };
  }

  const expected = DOMAIN_ATTENTION_IDS[domain] ?? [];
  const published = operational.filter((item) => expected.includes(item.id));
  const notEvaluated = expected.filter(
    (id) => !snapshot.attention.some((item) => item.id === id),
  );

  return { items: published, notEvaluated };
}
