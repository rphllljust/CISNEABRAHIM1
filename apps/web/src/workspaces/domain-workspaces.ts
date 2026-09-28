import { WORK_DOMAIN_LABELS, type WorkDomain } from '../work-inbox/api/work-inbox-api';

/**
 * WORKSPACES DE DOMINIO — configuracao da superficie de decisao.
 *
 * Um workspace NAO calcula nada: a zona AGORA le `byDomain[domain]` da MESMA leitura que
 * abastece a fila de trabalho (`GET /work-inbox`, sem filtro de dominio) e a zona ATENCAO le a
 * mesma leitura recortada por natureza (BLOCKER/EXCEPTION). Nao existe contador paralelo aqui.
 *
 * Este arquivo guarda somente o que a tela acrescenta ao read model: a identidade humana do
 * dominio e as rotas REAIS por onde o operador continua o trabalho que ja existe.
 */

export type WorkspaceShortcut = {
  label: string;
  /** Rota que JA existe na aplicacao. Nenhuma rota nova nasce aqui. */
  to: string;
};

export type DomainWorkspaceConfig = {
  domain: WorkDomain;
  /** Titulo humano — identico ao rotulo usado na fila de trabalho. */
  title: string;
  /** O que esta tela responde, em uma linha. */
  purpose: string;
  /** Listas reais do dominio: por onde o trabalho em andamento continua. */
  shortcuts: WorkspaceShortcut[];
};

/**
 * Rota canonica de cada workspace.
 *
 * O financeiro e o unico que vive fora de `/app/workspaces`: a conversao aconteceu na propria
 * `/app/finance`, onde a posicao financeira ja era publicada. `/app/workspaces/financeiro`
 * redireciona para la — duas superficies financeiras divergentes seriam pior que uma.
 */
export const DOMAIN_WORKSPACE_PATHS: Record<WorkDomain, string> = {
  FINANCEIRO: '/app/finance',
  FISCAL: '/app/workspaces/fiscal',
  CONTABILIDADE: '/app/workspaces/contabilidade',
  OPERACOES: '/app/workspaces/operacoes',
  COMERCIAL: '/app/workspaces/comercial',
  SUPRIMENTOS: '/app/workspaces/suprimentos',
};

export const DOMAIN_WORKSPACES: Record<WorkDomain, DomainWorkspaceConfig> = {
  COMERCIAL: {
    domain: 'COMERCIAL',
    title: WORK_DOMAIN_LABELS.COMERCIAL,
    purpose:
      'O que exige decisão comercial agora. As carteiras em andamento ficam logo abaixo, para continuar sem procurar.',
    shortcuts: [
      { label: 'Clientes', to: '/app/clients' },
      { label: 'Solicitações', to: '/app/requests' },
      { label: 'Propostas', to: '/app/proposals' },
      { label: 'Pedidos de compra', to: '/app/purchase-orders' },
      { label: 'Contratos', to: '/app/contracts' },
      { label: 'Faturamento interno', to: '/app/billing' },
    ],
  },
  OPERACOES: {
    domain: 'OPERACOES',
    title: WORK_DOMAIN_LABELS.OPERACOES,
    purpose:
      'O que está travado ou vencido na operação. Ordens, medições e execução em curso ficam logo abaixo.',
    shortcuts: [
      { label: 'Ordens de serviço', to: '/app/service-orders' },
      { label: 'Solicitações', to: '/app/requests' },
      { label: 'Locações', to: '/app/rentals' },
      { label: 'Transporte', to: '/app/transport' },
      { label: 'Frota', to: '/app/fleet' },
      { label: 'Ativos físicos', to: '/app/assets' },
    ],
  },
  FINANCEIRO: {
    domain: 'FINANCEIRO',
    title: WORK_DOMAIN_LABELS.FINANCEIRO,
    purpose:
      'O trabalho financeiro primeiro: o que exige decisão e o que está bloqueado. A posição de receber, pagar e caixa vem depois.',
    shortcuts: [
      { label: 'Contas a receber', to: '/app/finance/receivables' },
      { label: 'Contas a pagar', to: '/app/finance/payables' },
      { label: 'Caixa e bancos', to: '/app/finance/treasury' },
      { label: 'Conciliação', to: '/app/finance/reconciliation' },
      { label: 'Despesas', to: '/app/finance/expenses' },
      { label: 'Orçamentos', to: '/app/finance/budgets' },
    ],
  },
  FISCAL: {
    domain: 'FISCAL',
    title: WORK_DOMAIN_LABELS.FISCAL,
    purpose:
      'Pendências fiscais reais e as superfícies de documento, apuração e obrigação do período.',
    shortcuts: [
      { label: 'Documentos fiscais', to: '/app/fiscal/documents' },
      { label: 'Períodos fiscais', to: '/app/fiscal/periods' },
      { label: 'Apuração', to: '/app/fiscal/apuracao' },
      { label: 'Tributos', to: '/app/fiscal/tributos' },
      { label: 'Obrigações tributárias', to: '/app/fiscal/assessments' },
    ],
  },
  CONTABILIDADE: {
    domain: 'CONTABILIDADE',
    title: WORK_DOMAIN_LABELS.CONTABILIDADE,
    purpose:
      'O que impede o fechamento e os livros do período. Nenhum bloqueio é estimado: só o que o servidor declarou.',
    shortcuts: [
      { label: 'Lançamentos', to: '/app/accounting/journals' },
      { label: 'Razão', to: '/app/accounting/razao' },
      { label: 'Balancete', to: '/app/accounting/balancete' },
      { label: 'DRE', to: '/app/accounting/dre' },
      { label: 'Balanço', to: '/app/accounting/balanco' },
      { label: 'Central de fechamento', to: '/app/closing' },
    ],
  },
  SUPRIMENTOS: {
    domain: 'SUPRIMENTOS',
    title: WORK_DOMAIN_LABELS.SUPRIMENTOS,
    purpose:
      'Compras, recebimento e estoque com pendência real. O que está em andamento fica logo abaixo.',
    shortcuts: [
      { label: 'Compras', to: '/app/procurement' },
      { label: 'Notas de fornecedor', to: '/app/procurement/invoices' },
      { label: 'Nova solicitação de compra', to: '/app/procurement/requests/new' },
      { label: 'Estoque', to: '/app/inventory' },
      { label: 'Fornecedores', to: '/app/suppliers' },
    ],
  },
};
