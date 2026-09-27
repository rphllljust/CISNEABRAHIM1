/**
 * COMMAND CENTER — registro explicito de comandos do Ctrl+K.
 *
 * SEM IA. SEM interpretacao de linguagem livre.
 *
 * O operador digita tokens; o motor casa por prefixo/substring sobre um texto
 * normalizado e ordena de forma deterministica. Nao ha modelo, nao ha
 * "entendimento": ha uma lista conhecida de comandos e um casamento de texto.
 *
 * Um comando so existe aqui se o destino existir de verdade:
 * - Navegar -> item de menu real (SHELL_NAV_ITEMS), filtrado por acesso real.
 * - Ver     -> lista real com filtro que a lista sabe aplicar.
 * - Criar   -> rota de criacao real.
 * - Buscar  -> busca global existente.
 *
 * Nenhum comando executa transicao de dominio. O Command Center e uma central de
 * NAVEGACAO: ele leva o operador ao ponto de decisao, nao decide por ele.
 */

export type OperatorCommandKind = 'navigate' | 'view' | 'create' | 'search';

export type OperatorCommand = {
  id: string;
  kind: OperatorCommandKind;
  label: string;
  /** Grupo exibido na paleta. */
  group: string;
  /** Rota de destino. Para `search`, o termo e anexado pelo motor. */
  to: string;
  /** Tokens extras de busca (sinonimos operacionais em pt-BR). */
  keywords: string[];
  /** Explicacao curta do que a lista mostra. */
  hint?: string;
  /** Id do item de menu, quando o comando e uma rota de navegacao. */
  navItemId?: string;
};

export const COMMAND_GROUPS = {
  navigate: 'Navegar',
  view: 'Ver lista filtrada',
  create: 'Criar',
  search: 'Buscar',
} as const;

/**
 * Views operacionais — atalhos para as listas que respondem "o que esta
 * pendente / atrasado / precisa de mim". Os valores de filtro sao EXATAMENTE os
 * status reais persistidos (ver `financial-ui/labels.ts` e os types de cada
 * modulo). Nenhum status e inventado aqui.
 */
export const OPERATIONAL_VIEW_COMMANDS: OperatorCommand[] = [
  {
    id: 'view.receivables.overdue',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Contas a receber vencidas',
    to: '/app/finance/receivables?status=OVERDUE',
    keywords: ['receber', 'vencido', 'inadimplencia', 'overdue', 'cobranca', 'atrasado'],
    hint: 'Títulos a receber com status Vencido',
  },
  {
    id: 'view.receivables.open',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Contas a receber em aberto',
    to: '/app/finance/receivables?status=OPEN',
    keywords: ['receber', 'aberto', 'a vencer', 'carteira'],
    hint: 'Títulos a receber ainda não recebidos',
  },
  {
    id: 'view.payables.overdue',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Contas a pagar vencidas',
    to: '/app/finance/payables?status=OVERDUE',
    keywords: ['pagar', 'vencido', 'atrasado', 'overdue', 'obrigacao'],
    hint: 'Títulos a pagar com status Vencido',
  },
  {
    id: 'view.payables.approval',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Contas a pagar aguardando aprovação',
    to: '/app/finance/payables?status=OPEN',
    keywords: ['pagar', 'aprovacao', 'aguardando', 'pendente'],
    hint: 'Títulos a pagar em aberto, ainda não liquidados',
  },
  {
    id: 'view.expenses.submitted',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Despesas aguardando aprovação',
    to: '/app/finance/expenses?status=SUBMITTED',
    keywords: ['despesa', 'aprovacao', 'enviada', 'pendente'],
    hint: 'Despesas com status Enviada',
  },
  {
    id: 'view.expenses.rejected',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Despesas rejeitadas',
    to: '/app/finance/expenses?status=REJECTED',
    keywords: ['despesa', 'rejeitada', 'recusada', 'divergencia'],
    hint: 'Despesas com status Rejeitada',
  },
  {
    id: 'view.budgets.draft',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Orçamentos em rascunho',
    to: '/app/finance/budgets?status=DRAFT',
    keywords: ['orcamento', 'rascunho', 'budget', 'draft'],
    hint: 'Orçamentos ainda não aprovados',
  },
  {
    id: 'view.reconciliation.unmatched',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Não conciliados',
    to: '/app/finance/reconciliation?matchStatus=UNMATCHED',
    keywords: ['conciliacao', 'nao conciliado', 'banco', 'divergencia', 'unmatched'],
    hint: 'Itens de extrato sem vínculo com o sistema',
  },
  {
    id: 'view.reconciliation.review',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Conciliação exigindo revisão',
    to: '/app/finance/reconciliation?matchStatus=REVIEW_REQUIRED',
    keywords: ['conciliacao', 'revisao', 'divergencia', 'review'],
    hint: 'Itens de conciliação marcados para revisão',
  },
  {
    id: 'view.journals.draft',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Rascunhos contábeis',
    to: '/app/accounting/journals?status=DRAFT',
    keywords: ['rascunho', 'lancamento', 'contabil', 'journal', 'draft', 'contabilidade'],
    hint: 'Lançamentos contábeis com status Rascunho',
  },
  {
    id: 'view.journals.posted',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Lançamentos contábeis lançados',
    to: '/app/accounting/journals?status=POSTED',
    keywords: ['lancamento', 'contabil', 'postado', 'contabilidade'],
    hint: 'Lançamentos contábeis já lançados',
  },
  {
    id: 'view.periods.open',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Períodos contábeis abertos',
    to: '/app/accounting/fechamentos?status=OPEN',
    keywords: ['periodo', 'aberto', 'fechamento', 'contabil', 'contabilidade'],
    hint: 'Períodos contábeis ainda abertos',
  },
  {
    id: 'view.periods.closed',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Períodos contábeis fechados',
    to: '/app/accounting/fechamentos?status=CLOSED',
    keywords: ['periodo', 'fechado', 'fechamento', 'contabil'],
    hint: 'Períodos contábeis já fechados',
  },
  {
    id: 'view.fiscal.rejected',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Documentos fiscais rejeitados',
    to: '/app/fiscal/documents?status=REJECTED',
    keywords: ['fiscal', 'documento', 'rejeitado', 'nota', 'nf', 'erro'],
    hint: 'Documentos fiscais com status Rejeitado',
  },
  {
    id: 'view.fiscal.failed',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Documentos fiscais com falha',
    to: '/app/fiscal/documents?status=FAILED',
    keywords: ['fiscal', 'documento', 'falha', 'erro', 'nota', 'nf'],
    hint: 'Documentos fiscais com status Falhou',
  },
  {
    id: 'view.fiscal.draft',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Documentos fiscais em rascunho',
    to: '/app/fiscal/documents?status=DRAFT',
    keywords: ['fiscal', 'documento', 'rascunho', 'nota', 'nf'],
    hint: 'Documentos fiscais com status Rascunho',
  },
  {
    id: 'view.fiscal.periods.open',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Períodos fiscais abertos',
    to: '/app/fiscal/periods?status=OPEN',
    keywords: ['fiscal', 'periodo', 'aberto', 'apuracao'],
    hint: 'Períodos fiscais ainda abertos',
  },
  {
    id: 'view.fiscal.assessments.draft',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Obrigações tributárias em rascunho',
    to: '/app/fiscal/assessments?status=DRAFT',
    keywords: ['tributario', 'obrigacao', 'apuracao', 'rascunho', 'imposto'],
    hint: 'Apurações tributárias ainda em rascunho',
  },
  {
    id: 'view.documents',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Documentos',
    to: '/app/documents',
    keywords: ['documento', 'arquivo', 'anexo', 'gestao documental'],
  },
  {
    id: 'view.alerts.critical',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Alertas críticos',
    to: '/app/alerts?status=ACTIVE&severity=CRITICAL',
    keywords: ['alerta', 'critico', 'urgente', 'risco'],
    hint: 'Alertas ativos com severidade crítica',
  },
  /*
   * OPERAÇÕES — a lista de OS JÁ deriva seus filtros do URL
   * (`parseServiceOrderListParams` + `updateFilters` em ServiceOrdersListPage),
   * então estes comandos apenas reutilizam o transporte existente. Os valores são
   * os reais de `SERVICE_ORDER_LIST_FILTERS` e `SERVICE_ORDER_STATUSES`.
   * Nenhuma regra de OS, transição ou permissão é criada aqui.
   */
  {
    id: 'view.serviceOrders.overdue',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Ordens de serviço vencidas',
    to: '/app/service-orders?filter=overdue',
    keywords: ['os', 'ordem', 'servico', 'vencida', 'atrasada', 'overdue', 'operacoes'],
    hint: 'Fila de OS com prazo vencido',
  },
  {
    id: 'view.serviceOrders.approaching',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Ordens de serviço vencendo',
    to: '/app/service-orders?filter=approaching-due',
    keywords: ['os', 'ordem', 'servico', 'vencendo', 'prazo', 'aproximando'],
    hint: 'OS com prazo próximo do fim',
  },
  {
    id: 'view.serviceOrders.mine',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Minhas ordens de serviço',
    to: '/app/service-orders?filter=mine',
    keywords: ['os', 'minhas', 'ordem', 'servico', 'responsavel', 'minha fila'],
    hint: 'OS atribuídas a mim',
  },
  {
    id: 'view.serviceOrders.unassigned',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Ordens de serviço sem responsável',
    to: '/app/service-orders?filter=unassigned',
    keywords: ['os', 'ordem', 'servico', 'sem responsavel', 'nao atribuida', 'alocacao'],
    hint: 'OS em aberto sem empregado atribuído',
  },
  {
    id: 'view.serviceOrders.unscheduled',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Ordens de serviço sem agendamento',
    to: '/app/service-orders?filter=unscheduled',
    keywords: ['os', 'ordem', 'servico', 'sem agendamento', 'janela', 'nao planejada'],
    hint: 'OS em aberto sem janela operacional',
  },
  {
    id: 'view.serviceOrders.inExecution',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Ordens de serviço em execução',
    to: '/app/service-orders?status=IN_EXECUTION',
    keywords: ['os', 'ordem', 'servico', 'execucao', 'andamento', 'operacoes'],
    hint: 'OS com status Em execução',
  },
  {
    id: 'view.serviceOrders.paused',
    kind: 'view',
    group: COMMAND_GROUPS.view,
    label: 'Ordens de serviço pausadas',
    to: '/app/service-orders?status=PAUSED',
    keywords: ['os', 'ordem', 'servico', 'pausada', 'parada', 'bloqueada'],
    hint: 'OS com status Pausada',
  },
];

/** Rotas de criação reais. Nenhuma tela nova é criada por este registro. */
export const CREATE_COMMANDS: OperatorCommand[] = [
  {
    id: 'create.expense',
    kind: 'create',
    group: COMMAND_GROUPS.create,
    label: 'Nova despesa',
    to: '/app/finance/expenses/new',
    keywords: ['criar', 'nova', 'despesa', 'lancamento', 'gasto'],
  },
  {
    id: 'create.request',
    kind: 'create',
    group: COMMAND_GROUPS.create,
    label: 'Nova solicitação',
    to: '/app/requests/new',
    keywords: ['criar', 'nova', 'solicitacao', 'chamado', 'pedido'],
  },
  {
    id: 'create.proposal',
    kind: 'create',
    group: COMMAND_GROUPS.create,
    label: 'Nova proposta',
    to: '/app/proposals/new',
    keywords: ['criar', 'nova', 'proposta', 'orcamento comercial'],
  },
  {
    id: 'create.purchaseOrder',
    kind: 'create',
    group: COMMAND_GROUPS.create,
    label: 'Novo pedido de compra',
    to: '/app/purchase-orders/new',
    keywords: ['criar', 'novo', 'pedido', 'compra', 'po'],
  },
  {
    id: 'create.client',
    kind: 'create',
    group: COMMAND_GROUPS.create,
    label: 'Novo cliente',
    to: '/app/clients/new',
    keywords: ['criar', 'novo', 'cliente', 'cadastro'],
  },
  {
    id: 'create.budget',
    kind: 'create',
    group: COMMAND_GROUPS.create,
    label: 'Novo orçamento',
    to: '/app/finance/budgets/new',
    keywords: ['criar', 'novo', 'orcamento', 'budget', 'planejamento'],
  },
  {
    id: 'create.person',
    kind: 'create',
    group: COMMAND_GROUPS.create,
    label: 'Nova pessoa',
    to: '/app/people/new',
    keywords: ['criar', 'nova', 'pessoa', 'colaborador', 'cadastro'],
  },
  {
    id: 'create.asset',
    kind: 'create',
    group: COMMAND_GROUPS.create,
    label: 'Novo ativo físico',
    to: '/app/assets/new',
    keywords: ['criar', 'novo', 'ativo', 'patrimonio', 'equipamento'],
  },
  {
    id: 'create.supplier',
    kind: 'create',
    group: COMMAND_GROUPS.create,
    label: 'Novo fornecedor',
    to: '/app/suppliers/new',
    keywords: ['criar', 'novo', 'fornecedor', 'supplier'],
  },
];

/** Destinos que respondem diretamente "o que precisa de mim". */
export const PRIORITY_COMMANDS: OperatorCommand[] = [
  {
    id: 'priority.work-inbox',
    kind: 'navigate',
    group: COMMAND_GROUPS.navigate,
    label: 'Minhas pendências',
    to: '/app/work-inbox',
    keywords: ['pendencia', 'inbox', 'trabalho', 'fila', 'dia', 'comecar', 'minhas'],
    hint: 'Fila de trabalho agrupada por área',
  },
  {
    id: 'priority.overview',
    kind: 'navigate',
    group: COMMAND_GROUPS.navigate,
    label: 'Painel operacional',
    to: '/app',
    keywords: ['painel', 'dashboard', 'visao geral', 'inicio'],
  },
];

/* ------------------------------------------------------------------ matching */

/** Normaliza para casamento: minusculas, sem acento, espaco unico. */
export function normalizeCommandText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function searchableText(command: OperatorCommand): string {
  return normalizeCommandText(`${command.label} ${command.keywords.join(' ')}`);
}

/**
 * Pontua um comando contra a consulta. Zero significa "nao casa".
 *
 * Deterministico e explicavel: casamento de prefixo de palavra vale mais que
 * substring, e casamento no rotulo vale mais que em palavra-chave.
 */
export function scoreCommand(command: OperatorCommand, rawQuery: string): number {
  const query = normalizeCommandText(rawQuery);
  if (query.length === 0) {
    return 1;
  }
  const tokens = query.split(/\s+/).filter(Boolean);
  const labelText = normalizeCommandText(command.label);
  const haystack = searchableText(command);

  let score = 0;
  for (const token of tokens) {
    const labelWords = labelText.split(/\s+/);
    if (labelWords.some((word) => word.startsWith(token))) {
      score += 10;
    } else if (labelWords.some((word) => word.includes(token))) {
      score += 6;
    } else if (haystack.split(/\s+/).some((word) => word.startsWith(token))) {
      score += 4;
    } else if (haystack.includes(token)) {
      score += 2;
    } else {
      // Um token nao encontrado desqualifica: o operador nao recebe ruido.
      return 0;
    }
  }
  if (labelText === query) {
    score += 50;
  } else if (labelText.startsWith(query)) {
    score += 20;
  }
  return score;
}

export type RankCommandsOptions = {
  /** Consulta digitada. */
  query: string;
  /** Comandos de navegacao derivados do menu real, ja filtrados por acesso. */
  navigationCommands: OperatorCommand[];
  /** Limite de resultados. */
  limit?: number;
};

export function rankCommands({
  query,
  navigationCommands,
  limit = 12,
}: RankCommandsOptions): OperatorCommand[] {
  const all = [
    ...PRIORITY_COMMANDS,
    ...OPERATIONAL_VIEW_COMMANDS,
    ...CREATE_COMMANDS,
    ...navigationCommands,
  ];

  const unique = new Map<string, OperatorCommand>();
  for (const command of all) {
    if (!unique.has(command.id)) {
      unique.set(command.id, command);
    }
  }

  const ranked = [...unique.values()]
    .map((command) => ({ command, score: scoreCommand(command, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      // Desempate estavel: prioridade operacional, depois alfabetico.
      const priority = (kind: OperatorCommandKind) =>
        kind === 'view' ? 0 : kind === 'create' ? 1 : kind === 'navigate' ? 2 : 3;
      const byKind = priority(left.command.kind) - priority(right.command.kind);
      if (byKind !== 0) {
        return byKind;
      }
      return left.command.label.localeCompare(right.command.label, 'pt-BR');
    })
    .slice(0, limit);

  return ranked.map((entry) => entry.command);
}

/** Comando de busca global para o termo livre digitado (sem IA, apenas repasse). */
export function buildSearchCommand(rawQuery: string): OperatorCommand | null {
  const trimmed = rawQuery.trim();
  if (trimmed.length < 2) {
    return null;
  }
  return {
    id: 'search.global',
    kind: 'search',
    group: COMMAND_GROUPS.search,
    label: `Buscar "${trimmed}" em todo o sistema`,
    to: `/app/search?q=${encodeURIComponent(trimmed)}`,
    keywords: [],
    hint: 'Busca global existente',
  };
}
