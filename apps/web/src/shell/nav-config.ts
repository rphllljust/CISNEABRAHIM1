import type { ShellNavGroup, ShellNavItem } from './types';

/**
 * Navegação estrutural agrupada por domínio.
 * Visibilidade com accessCheck é decidida pelo backend (probes existentes).
 */
export const SHELL_NAV_GROUPS: ShellNavGroup[] = [
  {
    id: 'overview',
    label: 'Visão geral',
    items: [
      {
        id: 'home',
        label: 'Painel operacional',
        path: '/app',
        capabilityId: null,
      },
      {
        // Superfície "Minhas pendências": porta de entrada do dia. A autorização
        // real continua sendo a da lista de alertas, que é a origem da fila —
        // o accessCheck abaixo apenas evita exibir um link que levaria a negado.
        id: 'work-inbox',
        label: 'Minhas pendências',
        path: '/app/work-inbox',
        capabilityId: 'service-orders:service-order:list',
        accessCheck: 'request-list',
        featureFlag: 'alerts',
      },
    ],
  },
  {
    id: 'commercial',
    label: 'Comercial',
    items: [
      {
        id: 'clients',
        label: 'Clientes',
        path: '/app/clients',
        capabilityId: 'client:client:list',
        accessCheck: 'client-list',
      },
      {
        id: 'requests',
        label: 'Solicitações',
        path: '/app/requests',
        capabilityId: 'requests:service-request:list',
        accessCheck: 'request-list',
      },
      {
        id: 'proposals',
        label: 'Propostas',
        path: '/app/proposals',
        capabilityId: 'commercial:proposal:list',
        accessCheck: 'proposal-list',
      },
      {
        id: 'purchase-orders',
        label: 'Pedidos de compra',
        path: '/app/purchase-orders',
        capabilityId: 'commercial:purchase-order:list',
        accessCheck: 'purchase-order-list',
      },
    ],
  },
  {
    id: 'operations',
    label: 'Operações',
    items: [
      {
        id: 'catalog',
        label: 'Catálogo de serviços',
        path: '/app/catalog',
        capabilityId: 'catalog:service:list',
        accessCheck: 'catalog-list',
      },
      {
        id: 'fleet',
        label: 'Frota',
        path: '/app/fleet',
        capabilityId: 'resources:asset:list',
        accessCheck: 'asset-list',
      },
      {
        id: 'assets',
        label: 'Ativos físicos',
        path: '/app/assets',
        capabilityId: 'resources:asset:list',
        accessCheck: 'asset-list',
      },
      {
        id: 'people',
        label: 'Pessoas',
        path: '/app/people',
        capabilityId: 'people:person:list',
        accessCheck: 'people-list',
        featureFlag: 'people',
      },
      {
        id: 'rentals',
        label: 'Locações',
        path: '/app/rentals',
        capabilityId: 'service-orders:service-order:list',
        accessCheck: 'service-order-list',
        featureFlag: 'rentals',
      },
      {
        id: 'transport',
        label: 'Transporte',
        path: '/app/transport',
        capabilityId: 'service-orders:service-order:list',
        accessCheck: 'service-order-list',
        featureFlag: 'transport',
      },
      {
        id: 'service-orders',
        label: 'Ordens de serviço',
        path: '/app/service-orders',
        capabilityId: 'service-orders:service-order:list',
        accessCheck: 'service-order-list',
      },
      {
        id: 'documents',
        label: 'Documentos',
        path: '/app/documents',
        capabilityId: 'documents:document:list',
        accessCheck: 'document-list',
      },
      {
        id: 'alerts',
        label: 'Alertas',
        path: '/app/alerts',
        capabilityId: 'service-orders:service-order:list',
        accessCheck: 'request-list',
        featureFlag: 'alerts',
      },
    ],
  },
  {
    id: 'financial',
    label: 'Medição e faturamento interno',
    items: [
      {
        id: 'billing',
        label: 'Faturamento interno',
        path: '/app/billing',
        capabilityId: 'billing:billing-record:read',
        accessCheck: 'billing-list',
      },
    ],
  },
  {
    id: 'finance',
    label: 'Financeiro',
    items: [
      {
        id: 'finance-overview',
        label: 'Visão Geral',
        path: '/app/finance',
        capabilityId: 'finance:receivable:list',
        accessCheck: 'finance-overview',
        featureFlag: 'finance',
      },
      {
        id: 'finance-receivables',
        label: 'Contas a Receber',
        path: '/app/finance/receivables',
        capabilityId: 'finance:receivable:list',
        accessCheck: 'finance-receivable-list',
        featureFlag: 'finance',
      },
      {
        id: 'finance-payables',
        label: 'Contas a Pagar',
        path: '/app/finance/payables',
        capabilityId: 'finance:payable:list',
        accessCheck: 'finance-payable-list',
        featureFlag: 'finance',
      },
      {
        id: 'finance-treasury',
        label: 'Caixa e Bancos',
        path: '/app/finance/treasury',
        capabilityId: 'finance:treasury:list',
        accessCheck: 'finance-treasury-list',
        featureFlag: 'finance',
      },
      {
        id: 'finance-reconciliation',
        label: 'Conciliação',
        path: '/app/finance/reconciliation',
        capabilityId: 'finance:reconciliation:read',
        accessCheck: 'finance-reconciliation-read',
        featureFlag: 'finance',
      },
      {
        id: 'finance-expenses',
        label: 'Despesas',
        path: '/app/finance/expenses',
        capabilityId: 'finance:expense:list',
        accessCheck: 'finance-expense-read',
        featureFlag: 'finance',
      },
      {
        id: 'finance-budgets',
        label: 'Orçamentos',
        path: '/app/finance/budgets',
        capabilityId: 'finance:budget:list',
        accessCheck: 'finance-budget-read',
        featureFlag: 'finance',
      },
    ],
  },
  {
    id: 'fiscal',
    label: 'Fiscal',
    items: [
      {
        id: 'fiscal-documents',
        label: 'Documentos Fiscais',
        path: '/app/fiscal/documents',
        capabilityId: 'fiscal:document:read',
        accessCheck: 'fiscal-document-read',
        featureFlag: 'fiscal',
      },
      {
        id: 'fiscal-periods',
        label: 'Períodos Fiscais',
        path: '/app/fiscal/periods',
        capabilityId: 'fiscal:period:read',
        accessCheck: 'fiscal-period-read',
        featureFlag: 'fiscal',
      },
      {
        id: 'fiscal-assessments',
        label: 'Obrigações Tributárias',
        path: '/app/fiscal/assessments',
        capabilityId: 'fiscal:tax-assessment:read',
        accessCheck: 'fiscal-tax-read',
        featureFlag: 'fiscal',
      },
      {
        id: 'fiscal-apuracao',
        label: 'Apuração',
        path: '/app/fiscal/apuracao',
        capabilityId: 'fiscal:tax:read',
        accessCheck: 'fiscal-tax-read',
        featureFlag: 'fiscal',
      },
      {
        id: 'fiscal-tributos',
        label: 'Tributos',
        path: '/app/fiscal/tributos',
        capabilityId: 'fiscal:tax:read',
        accessCheck: 'fiscal-tax-read',
        featureFlag: 'fiscal',
      },
    ],
  },
  {
    id: 'accounting',
    label: 'Contabilidade',
    items: [
      {
        id: 'accounting-chart',
        label: 'Plano de Contas',
        path: '/app/accounting/chart',
        capabilityId: 'accounting:journal:read',
        accessCheck: 'accounting-journal-read',
        featureFlag: 'accounting',
      },
      {
        id: 'accounting-journals',
        label: 'Lançamentos',
        path: '/app/accounting/journals',
        capabilityId: 'accounting:journal:read',
        accessCheck: 'accounting-journal-read',
        featureFlag: 'accounting',
      },
      {
        id: 'accounting-diario',
        label: 'Diário',
        path: '/app/accounting/diario',
        capabilityId: 'accounting:journal:list',
        accessCheck: 'accounting-journal-read',
        featureFlag: 'accounting',
      },
      {
        id: 'accounting-razao',
        label: 'Razão',
        path: '/app/accounting/razao',
        capabilityId: 'accounting:journal:list',
        accessCheck: 'accounting-journal-read',
        featureFlag: 'accounting',
      },
      {
        id: 'accounting-balancete',
        label: 'Balancete',
        path: '/app/accounting/balancete',
        capabilityId: 'accounting:journal:list',
        accessCheck: 'accounting-journal-read',
        featureFlag: 'accounting',
      },
      {
        id: 'accounting-dre',
        label: 'DRE',
        path: '/app/accounting/dre',
        capabilityId: 'accounting:journal:list',
        accessCheck: 'accounting-journal-read',
        featureFlag: 'accounting',
      },
      {
        id: 'accounting-balanco',
        label: 'Balanço',
        path: '/app/accounting/balanco',
        capabilityId: 'accounting:journal:list',
        accessCheck: 'accounting-journal-read',
        featureFlag: 'accounting',
      },
      {
        id: 'accounting-fechamentos',
        label: 'Fechamentos',
        path: '/app/accounting/fechamentos',
        capabilityId: 'accounting:period:close',
        accessCheck: 'accounting-journal-read',
        featureFlag: 'accounting',
      },
      {
        id: 'accounting-origens',
        label: 'Origem dos lançamentos',
        path: '/app/accounting/origens',
        capabilityId: 'accounting:journal:list',
        accessCheck: 'accounting-journal-read',
        featureFlag: 'accounting',
      },
      {
        id: 'accounting-fixed-assets',
        label: 'Ativo imobilizado',
        path: '/app/accounting/fixed-assets',
        capabilityId: 'accounting:fixed-asset:read',
        accessCheck: 'accounting-fixed-asset-read',
        featureFlag: 'accounting',
      },
    ],
  },
  {
    id: 'supply',
    label: 'Suprimentos',
    items: [
      {
        id: 'procurement',
        label: 'Compras',
        path: '/app/procurement',
        capabilityId: 'procurement:request:read',
        accessCheck: 'procurement-read',
        featureFlag: 'procurement',
      },
      {
        id: 'inventory',
        label: 'Estoque',
        path: '/app/inventory',
        capabilityId: 'inventory:stock:read',
        accessCheck: 'inventory-read',
        featureFlag: 'inventory',
      },
    ],
  },
  {
    id: 'people-ops',
    label: 'Pessoas e folha',
    items: [
      {
        id: 'payroll',
        label: 'Folha',
        path: '/app/payroll',
        capabilityId: 'payroll:period:read',
        accessCheck: 'payroll-read',
        featureFlag: 'payroll',
      },
    ],
  },
  {
    id: 'insights',
    label: 'Relatórios',
    items: [
      {
        id: 'reports',
        label: 'Relatórios',
        path: '/app/reports',
        capabilityId: 'service-orders:service-order:list',
        accessCheck: 'request-list',
        featureFlag: 'reports',
      },
      {
        id: 'operational-profitability',
        label: 'Rentabilidade operacional',
        path: '/app/operational-profitability',
        capabilityId: 'service-orders:service-order:list',
        accessCheck: 'service-order-list',
        featureFlag: 'operational-profitability',
      },
      {
        // A autorizacao efetiva e decidida no servidor (fiscal:document:read ou
        // accounting:journal:read); a pagina exibe a negacao quando nenhuma existe.
        id: 'reports-compliance',
        label: 'Conformidade fiscal e contábil',
        path: '/app/reports/compliance',
        capabilityId: 'accounting:journal:read',
        featureFlag: 'reports',
      },
    ],
  },
  {
    id: 'admin',
    label: 'Administração',
    items: [
      {
        id: 'platform',
        label: 'Diagnóstico da plataforma',
        path: '/app/platform',
        capabilityId: 'CAP-001',
        accessCheck: 'authz-probe',
      },
    ],
  },
  {
    id: 'access',
    label: 'Acesso',
    items: [
      {
        id: 'access-admin',
        label: 'Administração de acesso',
        path: '/app/access-admin',
        capabilityId: 'authz:access-admin:read',
        accessCheck: 'access-admin',
      },
    ],
  },
  {
    id: 'system',
    label: 'Sistema',
    items: [
      {
        id: 'modules',
        label: 'Módulos',
        path: '/app/modules',
        capabilityId: null,
      },
    ],
  },
];

export const SHELL_NAV_ITEMS: ShellNavItem[] = SHELL_NAV_GROUPS.flatMap((group) => group.items);

const STATIC_ROUTE_LABELS: Record<string, string> = {
  '/app': 'Painel operacional',
  '/app/clients': 'Clientes',
  '/app/clients/new': 'Novo cliente',
  '/app/catalog': 'Catálogo de serviços',
  '/app/catalog/new': 'Nova definição',
  '/app/assets': 'Ativos físicos',
  '/app/assets/new': 'Novo ativo',
  '/app/people': 'Pessoas',
  '/app/people/new': 'Nova pessoa',
  '/app/requests': 'Solicitações',
  '/app/requests/new': 'Nova solicitação',
  '/app/proposals': 'Propostas',
  '/app/proposals/new': 'Nova proposta',
  '/app/purchase-orders': 'Pedidos de compra',
  '/app/purchase-orders/new': 'Novo pedido de compra',
  '/app/contracts': 'Contratos',
  '/app/contracts/new': 'Novo contrato',
  '/app/documents': 'Documentos',
  '/app/billing': 'Faturamento interno',
  '/app/finance': 'Visão Geral',
  '/app/finance/receivables': 'Contas a Receber',
  '/app/finance/payables': 'Contas a Pagar',
  '/app/finance/treasury': 'Caixa e Bancos',
  '/app/finance/reconciliation': 'Conciliação',
  '/app/finance/expenses': 'Despesas',
  '/app/finance/expenses/new': 'Nova despesa',
  '/app/finance/budgets': 'Orçamentos',
  '/app/finance/forecast': 'Previsão de caixa',
  '/app/fiscal/documents': 'Documentos Fiscais',
  '/app/fiscal/apuracao': 'Apuração',
  '/app/fiscal/tributos': 'Tributos',
  '/app/fiscal/periods': 'Períodos fiscais',
  '/app/fiscal/assessments': 'Obrigações tributárias',
  '/app/accounting/chart': 'Plano de Contas',
  '/app/accounting/journals': 'Lançamentos',
  '/app/accounting/diario': 'Diário',
  '/app/accounting/razao': 'Razão',
  '/app/accounting/balancete': 'Balancete',
  '/app/accounting/dre': 'DRE',
  '/app/accounting/balanco': 'Balanço',
  '/app/accounting/fechamentos': 'Fechamentos',
  '/app/accounting/origens': 'Origem dos lançamentos',
  '/app/accounting/fixed-assets': 'Ativo imobilizado',
  '/app/suppliers': 'Fornecedores',
  '/app/suppliers/new': 'Novo fornecedor',
  '/app/procurement': 'Compras',
  '/app/procurement/requests': 'Solicitações de compra',
  '/app/procurement/requests/new': 'Nova solicitação',
  '/app/procurement/invoices': 'Notas de fornecedor',
  '/app/inventory': 'Estoque',
  '/app/payroll': 'Folha',
  '/app/fleet': 'Frota',
  '/app/alerts': 'Alertas',
  '/app/reports': 'Relatórios',
  '/app/operational-profitability': 'Rentabilidade operacional',
  '/app/reports/compliance': 'Conformidade fiscal e contábil',
  '/app/rentals': 'Locações',
  '/app/transport': 'Transporte',
  '/app/search': 'Pesquisa',
  '/app/platform': 'Diagnóstico da plataforma',
  '/app/no-access': 'Acesso negado',
};

export function findNavItemByPath(pathname: string): ShellNavItem | undefined {
  return SHELL_NAV_ITEMS.find((item) => item.path === pathname);
}

export function resolveShellBreadcrumbs(pathname: string): Array<{ label: string; href?: string }> {
  const crumbs: Array<{ label: string; href?: string }> = [
    { label: 'Início', href: '/app' },
  ];

  if (pathname === '/app') {
    crumbs.push({ label: 'Painel operacional' });
    return crumbs;
  }

  const staticLabel = STATIC_ROUTE_LABELS[pathname];
  if (staticLabel) {
    const parentPath = pathname.split('/').slice(0, -1).join('/') || '/app';
    const parentLabel = STATIC_ROUTE_LABELS[parentPath];
    if (parentLabel && parentPath !== pathname) {
      crumbs.push({ label: parentLabel, href: parentPath });
    }
    crumbs.push({ label: staticLabel });
    return crumbs;
  }

  const segments = pathname.replace(/^\/app\/?/, '').split('/').filter(Boolean);
  if (segments.length === 0) {
    crumbs.push({ label: 'Painel operacional' });
    return crumbs;
  }

  const section = segments[0];
  const sectionItem = SHELL_NAV_ITEMS.find((item) => item.path === `/app/${section}`);
  if (sectionItem) {
    crumbs.push({ label: sectionItem.label, href: sectionItem.path });
  }

  if (segments.length > 1) {
    crumbs.push({ label: 'Detalhe' });
  }

  return crumbs;
}
