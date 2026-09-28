import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import {
  EMPTY_SMART_LIST_CONFIG,
  isPersistableValue,
  sanitizeSmartListConfig,
  sanitizeViewName,
  storageKeyFor,
  type SavedView,
} from './smart-list/useSavedViews';
import { SavedViewsBar } from './smart-list/SavedViewsBar';
import { useSelection } from './bulk/useSelection';
import { exportSelectionToCsv } from './bulk/BulkActionBar';
import {
  buildSearchCommand,
  OPERATIONAL_VIEW_COMMANDS,
  rankCommands,
  scoreCommand,
  type OperatorCommand,
} from './commands/registry';
import { buildWorkInbox, countByArea } from './work-inbox/work-inbox';
import { BUSINESS_ALERT_TYPES, type BusinessAlertListItem } from '../alerts/types/alerts.types';

/* ------------------------------------------------------------------ fixtures */

function alert(overrides: Partial<BusinessAlertListItem> = {}): BusinessAlertListItem {
  return {
    id: 'alert-1',
    alertType: BUSINESS_ALERT_TYPES.ServiceOrderOverdue,
    severity: 'CRITICAL',
    status: 'ACTIVE',
    title: 'OS-1042 vencida',
    message: 'Ordem de serviço com prazo vencido há 6 dias.',
    entityHref: '/app/service-orders/so-1',
    unitId: null,
    triggeredAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
    lastSeenAt: '2026-01-07T00:00:00.000Z',
    ...overrides,
  };
}

/* ------------------------------------------- SAVED VIEWS: fronteira de segurança */

describe('saved views — fronteira de persistência', () => {
  it('persiste somente valores enumerados de filtro', () => {
    const config = sanitizeSmartListConfig({
      filters: { status: 'OVERDUE', bucket: '90_PLUS' },
      sortKey: 'dueDate',
      sortDirection: 'desc',
      groupKey: null,
    });

    expect(config).toEqual({
      filters: { status: 'OVERDUE', bucket: '90_PLUS' },
      sortKey: 'dueDate',
      sortDirection: 'desc',
      groupKey: null,
    });
  });

  it('NÃO persiste nome de cliente, valor monetário, documento ou texto livre', () => {
    // Cada um destes é dado de negócio que jamais pode ir para o browser.
    const structurallyRejected = [
      '12.345.678/0001-99', // documento
      'cliente@empresa.com.br', // e-mail
      '180000.00', // valor monetário
      'Maria Aparecida da Silva', // nome com espaço
      'OS 1042', // referência com espaço
      'lucro-liquido', // alfabeto com hífen não é token de enum
    ];

    for (const value of structurallyRejected) {
      expect(isPersistableValue(value)).toBe(false);
      expect(
        sanitizeSmartListConfig({
          ...EMPTY_SMART_LIST_CONFIG,
          filters: { q: value },
        }),
      ).toBeNull();
    }

    expect(isPersistableValue('OVERDUE')).toBe(true);
  });

  it('com allow-list, um nome de cliente NÃO é persistido mesmo sendo alfabético', () => {
    // `Amaggi` é alfabético e passaria na checagem de alfabeto. A allow-list por
    // tela é o que impede: só valores de opções reais de filtros declarados entram.
    const allowedFilters = {
      filters: { status: ['OPEN', 'OVERDUE', 'PAID'] },
      sortKeys: ['dueDate', 'remainingBalance'],
    };

    expect(
      sanitizeSmartListConfig({ ...EMPTY_SMART_LIST_CONFIG, filters: { q: 'Amaggi' } }, allowedFilters),
    ).toBeNull();

    expect(
      sanitizeSmartListConfig(
        { ...EMPTY_SMART_LIST_CONFIG, filters: { status: 'AMAGGI_CLIENTE' } },
        allowedFilters,
      ),
    ).toBeNull();

    expect(
      sanitizeSmartListConfig(
        { ...EMPTY_SMART_LIST_CONFIG, filters: { status: 'OVERDUE' } },
        allowedFilters,
      ),
    ).toEqual({
      filters: { status: 'OVERDUE' },
      sortKey: null,
      sortDirection: 'asc',
      groupKey: null,
    });
  });

  it('com allow-list, uma chave de ordenação desconhecida não é persistida', () => {
    const allowedFilters = {
      filters: { status: ['OVERDUE'] },
      sortKeys: ['dueDate'],
    };
    const config = sanitizeSmartListConfig(
      {
        filters: { status: 'OVERDUE' },
        sortKey: 'clientName',
        sortDirection: 'asc',
        groupKey: null,
      },
      allowedFilters,
    );
    expect(config?.sortKey).toBeNull();
  });

  it('recusa configuração vazia em vez de gravar uma visão inútil', () => {
    expect(sanitizeSmartListConfig(EMPTY_SMART_LIST_CONFIG)).toBeNull();
  });

  it('recusa nome de visão vazio ou longo demais', () => {
    expect(sanitizeViewName('   ')).toBeNull();
    expect(sanitizeViewName('a'.repeat(49))).toBeNull();
    expect(sanitizeViewName('  Vencidos  ')).toBe('Vencidos');
  });

  it('não grava o identificador de identidade em claro na chave local', () => {
    const key = storageKeyFor('finance.receivables', 'identity-abc-123');
    expect(key).not.toContain('identity-abc-123');
    expect(key.startsWith('cisne:operator:views:v1:finance.receivables:')).toBe(true);
  });
});

/* ------------------------------------------------ SAVED VIEWS BAR: interação */

describe('SavedViewsBar', () => {
  const views: SavedView[] = [
    {
      id: 'view_1',
      name: 'Vencidos',
      config: { filters: { status: 'OVERDUE' }, sortKey: null, sortDirection: 'asc', groupKey: null },
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  function renderBar(overrides: Partial<Parameters<typeof SavedViewsBar>[0]> = {}) {
    const props = {
      views,
      builtInViews: [],
      activeViewId: null,
      onApply: vi.fn(),
      onSave: vi.fn(() => null),
      onRename: vi.fn(() => true),
      onRemove: vi.fn(),
      currentConfig: {
        filters: { status: 'OVERDUE' },
        sortKey: null,
        sortDirection: 'asc' as const,
        groupKey: null,
      },
      canSave: true,
      ...overrides,
    };
    render(
      <MemoryRouter>
        <SavedViewsBar {...props} />
      </MemoryRouter>,
    );
    return props;
  }

  it('aplica, renomeia e remove uma visão salva', async () => {
    const user = userEvent.setup();
    const props = renderBar();

    await user.click(screen.getByRole('button', { name: 'Vencidos' }));
    expect(props.onApply).toHaveBeenCalledWith(expect.objectContaining({ id: 'view_1' }));

    await user.click(screen.getByRole('button', { name: 'Renomear visão Vencidos' }));
    const renameInput = screen.getByLabelText('Novo nome da visão');
    await user.clear(renameInput);
    await user.type(renameInput, 'Vencidos 90+');
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(props.onRename).toHaveBeenCalledWith('view_1', 'Vencidos 90+');

    await user.click(screen.getByRole('button', { name: 'Remover visão Vencidos' }));
    expect(props.onRemove).toHaveBeenCalledWith('view_1');
  });

  it('salva a configuração atual sob um nome curto', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(() => ({
      id: 'view_2',
      name: 'Minhas pendências',
      config: {
        filters: { status: 'OVERDUE' },
        sortKey: null,
        sortDirection: 'asc' as const,
        groupKey: null,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
    }));
    renderBar({ onSave });

    await user.click(screen.getByRole('button', { name: '+ Salvar visão' }));
    await user.type(screen.getByLabelText('Nome da nova visão'), 'Minhas pendências');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(onSave).toHaveBeenCalledWith('Minhas pendências', {
      filters: { status: 'OVERDUE' },
      sortKey: null,
      sortDirection: 'asc',
      groupKey: null,
    });
  });
});

/* ------------------------------------------------ BULK: prova negativa de seleção */

describe('bulk — prova negativa', () => {
  type Row = { id: string; label: string };
  const rows: Row[] = [
    { id: 'r1', label: 'Selecionado' },
    { id: 'r2', label: 'Negado' },
    { id: 'r3', label: 'Também não selecionado' },
  ];

  function renderSelection() {
    return renderHook(() => useSelection<Row>({ getId: (row) => row.id }));
  }

  it('useSelection devolve apenas as linhas marcadas — o não selecionado fica de fora', async () => {
    const { result } = renderSelection();

    act(() => result.current.toggle('r1'));
    act(() => result.current.toggle('r3'));

    expect(result.current.count).toBe(2);
    const processed = result.current.selectedRows(rows);
    expect(processed.map((row) => row.id)).toEqual(['r1', 'r3']);
    // PROVA NEGATIVA OBRIGATÓRIA: o item não marcado não é processado.
    expect(processed.some((row) => row.id === 'r2')).toBe(false);
    expect(result.current.isSelected('r2')).toBe(false);
  });

  it('desmarcar remove o registro do conjunto processado', () => {
    const { result } = renderSelection();

    act(() => result.current.toggle('r1'));
    act(() => result.current.toggle('r2'));
    expect(result.current.selectedRows(rows).map((row) => row.id)).toEqual(['r1', 'r2']);

    act(() => result.current.toggle('r1'));
    const processed = result.current.selectedRows(rows);
    expect(processed.map((row) => row.id)).toEqual(['r2']);
    expect(processed.some((row) => row.id === 'r1')).toBe(false);
  });

  it('respeita o teto de seleção em vez de silenciosamente selecionar tudo', () => {
    const { result } = renderHook(() =>
      useSelection<Row>({ getId: (row) => row.id, maxSelection: 2 }),
    );
    act(() => result.current.selectAll(rows));
    expect(result.current.count).toBe(2);
  });
});

/* ------------------------------------- BULK: exportação contém somente selecionados */

describe('exportSelectionToCsv', () => {
  const createObjectURL = vi.fn(() => 'blob:mock');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('escreve apenas as linhas selecionadas — o não selecionado não aparece no arquivo', async () => {
    const captured: CapturingBlob[] = [];
    vi.stubGlobal('Blob', makeCapturingBlob(captured));

    exportSelectionToCsv('selecionados.csv', ['Referência'], [['r1'], ['r3']]);

    expect(captured).toHaveLength(1);
    const content = await captured[0]!.text();
    expect(content).toContain('r1');
    expect(content).toContain('r3');
    // PROVA NEGATIVA: a linha não selecionada não está no conteúdo exportado.
    expect(content).not.toContain('r2');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('exporta somente o cabeçalho quando a seleção está vazia', async () => {
    const captured: CapturingBlob[] = [];
    vi.stubGlobal('Blob', makeCapturingBlob(captured));

    exportSelectionToCsv('vazio.csv', ['Referência'], []);
    const content = await captured[0]!.text();
    expect(content.trim()).toBe('"Referência"');
  });
});

type CapturingBlob = {
  parts: string[];
  text: () => Promise<string>;
};

/** jsdom não implementa `Blob.text`; este stub captura as partes escritas. */
function makeCapturingBlob(sink: CapturingBlob[]): typeof Blob {
  class CapturingBlobImpl {
    parts: string[];
    constructor(parts: BlobPart[]) {
      this.parts = parts.map((part) => (typeof part === 'string' ? part : ''));
      sink.push(this);
    }
    text() {
      return Promise.resolve(this.parts.join(''));
    }
  }
  return CapturingBlobImpl as unknown as typeof Blob;
}

/* ------------------------------------------------------- COMMAND CENTER: sem IA */

describe('command center — casamento determinístico', () => {
  const navigation: OperatorCommand[] = [
    {
      id: 'nav:/app/finance/reconciliation',
      kind: 'navigate',
      group: 'Navegar',
      label: 'Ir para Conciliação',
      to: '/app/finance/reconciliation',
      keywords: ['Conciliação', 'abrir', 'ir', 'navegar'],
    },
  ];

  it('encontra o comando explícito por token, sem interpretar linguagem livre', () => {
    const results = rankCommands({ query: 'abrir conciliacao', navigationCommands: navigation });
    expect(results.map((command) => command.id)).toContain(
      'nav:/app/finance/reconciliation',
    );
  });

  it('encontra "contas vencidas" pela view operacional real', () => {
    const results = rankCommands({ query: 'contas vencidas', navigationCommands: [] });
    expect(results.some((command) => command.kind === 'view')).toBe(true);
    expect(results[0]!.to).toContain('status=OVERDUE');
  });

  it('encontra "nova despesa" como comando de criação', () => {
    const results = rankCommands({ query: 'nova despesa', navigationCommands: [] });
    const create = results.find((command) => command.id === 'create.expense');
    expect(create?.to).toBe('/app/finance/expenses/new');
  });

  it('encontra "rascunhos contábeis" e "períodos fiscais abertos"', () => {
    expect(
      rankCommands({ query: 'rascunhos contabeis', navigationCommands: [] }).some(
        (command) => command.id === 'view.journals.draft',
      ),
    ).toBe(true);
    expect(
      rankCommands({ query: 'periodos fiscais abertos', navigationCommands: [] }).some(
        (command) => command.id === 'view.fiscal.periods.open',
      ),
    ).toBe(true);
  });

  it('um token desconhecido desqualifica o comando — sem ruído inventado', () => {
    for (const command of [...navigation]) {
      expect(scoreCommand(command, 'zzzz-nao-existe')).toBe(0);
    }
  });

  it('só oferece busca global com pelo menos 2 caracteres', () => {
    expect(buildSearchCommand('a')).toBeNull();
    const search = buildSearchCommand('amaggi');
    expect(search?.to).toBe('/app/search?q=amaggi');
  });

  it('os comandos de OS usam os filtros e status REAIS do domínio de operações', () => {
    // Conjuntos reais: SERVICE_ORDER_LIST_FILTERS e SERVICE_ORDER_STATUSES.
    const realFilters = [
      'overdue',
      'approaching-due',
      'mine',
      'unassigned',
      'unscheduled',
      'scheduled-today',
    ];
    const realStatuses = [
      'DRAFT',
      'PREPARED',
      'RELEASED',
      'IN_EXECUTION',
      'PAUSED',
      'COMPLETED',
      'CANCELLED',
    ];

    const osCommands = OPERATIONAL_VIEW_COMMANDS.filter((command) =>
      command.id.startsWith('view.serviceOrders.'),
    );
    expect(osCommands.length).toBeGreaterThan(0);

    for (const command of osCommands) {
      expect(command.to.startsWith('/app/service-orders?')).toBe(true);
      const query = new URLSearchParams(command.to.split('?')[1]);
      const filter = query.get('filter');
      const status = query.get('status');
      // Nenhum comando inventa filtro ou status: só valores que o domínio aceita.
      if (filter) {
        expect(realFilters).toContain(filter);
      }
      if (status) {
        expect(realStatuses).toContain(status);
      }
      expect(filter ?? status).not.toBeNull();
    }
  });

  it('o Command Center leva às filas operacionais que respondem "o que precisa de mim"', () => {
    expect(
      rankCommands({ query: 'os vencidas', navigationCommands: [] }).some(
        (command) => command.to === '/app/service-orders?filter=overdue',
      ),
    ).toBe(true);
    expect(
      rankCommands({ query: 'minhas os', navigationCommands: [] }).some(
        (command) => command.to === '/app/service-orders?filter=mine',
      ),
    ).toBe(true);
    expect(
      rankCommands({ query: 'minhas pendencias', navigationCommands: [] }).some(
        (command) => command.to === '/app/work-inbox',
      ),
    ).toBe(true);
  });
});

/* ------------------------------------------------------ WORK INBOX: sem inventar */

describe('work inbox — derivação de estado real', () => {
  const now = new Date('2026-01-08T00:00:00.000Z');

  it('agrupa alertas reais nas áreas operacionais corretas', () => {
    const groups = buildWorkInbox({
      now,
      alerts: [
        alert({ id: 'a1', alertType: BUSINESS_ALERT_TYPES.ServiceOrderOverdue }),
        alert({
          id: 'a2',
          alertType: BUSINESS_ALERT_TYPES.MeasurementAging,
          severity: 'WARNING',
        }),
        alert({ id: 'a3', alertType: BUSINESS_ALERT_TYPES.PaymentOverdue, severity: 'WARNING' }),
      ],
    });

    const counts = countByArea(groups);
    expect(counts.OPERACOES).toBe(1);
    expect(counts.MEDICAO).toBe(1);
    expect(counts.FINANCEIRO).toBe(1);
  });

  it('NÃO inventa pendência para áreas sem feed persistido', () => {
    const groups = buildWorkInbox({ now, alerts: [alert()] });
    const comercial = groups.find((group) => group.area.id === 'COMERCIAL');

    expect(comercial?.items).toHaveLength(0);
    expect(comercial?.area.source).toBe('none');
    expect(comercial?.area.missingSourceReason).toMatch(/não há feed persistido/i);
  });

  it('ignora alerta já resolvido — não é pendência', () => {
    const groups = buildWorkInbox({
      now,
      alerts: [alert({ status: 'RESOLVED', resolvedAt: '2026-01-05T00:00:00.000Z' })],
    });
    expect(countByArea(groups).OPERACOES).toBe(0);
  });

  it('ordena por prioridade derivada e depois pelo mais antigo parado', () => {
    const groups = buildWorkInbox({
      now,
      alerts: [
        alert({
          id: 'warn-antigo',
          severity: 'WARNING',
          triggeredAt: '2025-12-01T00:00:00.000Z',
        }),
        alert({
          id: 'critico-novo',
          severity: 'CRITICAL',
          triggeredAt: '2026-01-07T00:00:00.000Z',
        }),
      ],
    });

    const operational = groups.find((group) => group.area.id === 'OPERACOES');
    expect(operational?.items.map((item) => item.id)).toEqual(['critico-novo', 'warn-antigo']);
    // O rótulo declara que a prioridade é derivada, não persistida.
    expect(operational?.items[0]!.priorityLabel).toMatch(/derivada|Crítico/);
  });

  it('deriva o tempo parado do triggeredAt persistido', () => {
    const groups = buildWorkInbox({
      now,
      alerts: [alert({ triggeredAt: '2026-01-01T00:00:00.000Z' })],
    });
    const item = groups.find((group) => group.area.id === 'OPERACOES')?.items[0];
    expect(item?.stalledLabel).toBe('7 dias');
    expect(item?.stalledSince).toBe('2026-01-01T00:00:00.000Z');
  });

  it('leva a próxima ação a um destino real, sem executar transição', () => {
    const groups = buildWorkInbox({ now, alerts: [alert()] });
    const item = groups.find((group) => group.area.id === 'OPERACOES')?.items[0];
    expect(item?.href).toBe('/app/service-orders/so-1');
    expect(item?.nextAction).toMatch(/Abrir a OS/);
  });
});
