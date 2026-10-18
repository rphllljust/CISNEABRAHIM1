import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  cancelServiceOrder,
  getServiceOrder,
  listServiceOrders,
  prepareServiceOrder,
  releaseServiceOrder,
  reopenServiceOrder,
  ServiceOrdersApiError,
} from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import type { ServiceOrderDetail, ServiceOrderStatus } from '../types/service-order.types';
import {
  SERVICE_ORDER_LIST_FILTERS,
  SERVICE_ORDER_LIST_ORDERS,
  type ServiceOrderListFilter,
  type ServiceOrderListOrder,
} from '../types/service-order-list.types';
import { formatServiceOrderOrigin, toHumanStatusLabel } from '../utils/service-order-labels';
import { Skeleton } from '../../ui/Skeleton';
import {
  CommandPalette,
  DynamicBulkActions,
  DynamicContextDrawer,
  DynamicExportCsv,
  DynamicFilterBar,
  DynamicFilterBuilder,
  DynamicKanban,
  DynamicKpiDrilldown,
  DynamicList,
  DynamicSavedViewsBar,
  DynamicViewHost,
  DynamicViewSwitcher,
  FILTER_PARAM,
  advancedFilterFromGroup,
  filterGroupToQuery,
  readFilterGroup,
  buildKpiMetrics,
  filtersToSearchParams,
  functionalViewTypes,
  listColumns,
  nonFunctionalViews,
  paletteActionsFromSchema,
  useCommandPaletteShortcut,
  useEntitySchema,
  useSavedViews,
  toDisplayText,
  type CrossReference,
  type AdvancedFilterFieldSpec,
  type FilterGroup,
  type KpiSpec,
  type MetaEntitySchema,
} from '../../engine';
import { useAuth } from '../../auth/context/AuthProvider';
import { entityLabel, useLanguage } from '../../i18n';
import {
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistStatePanel,
  worklistSelectClass,
} from '../../ui/enterprise-list';
import { ModulePage, ModulePagination } from '../../ui/module-layout';
import { Button } from '../../ui/Button';
import { serviceOrderEngineRows, serviceOrderWorklistSchema, type ServiceOrderEngineRow } from './service-order-engine-rows';

/**
 * CAMPOS DO FILTRO AVANÇADO PARA O CONVERSOR COMPARTILHADO.
 *
 * Allow-list idêntico ao publicado por `buildServiceOrderAdvancedClause`
 * (`apps/api/src/service-orders/domain/service-order-list.query.ts`).
 */
const SERVICE_ORDER_FILTER_SPECS: AdvancedFilterFieldSpec[] = [
  { field: 'order_number', contractField: 'order_number', kind: 'text' },
  { field: 'status', contractField: 'status', kind: 'enum' },
  { field: 'client_id', contractField: 'client_id', kind: 'text' },
  { field: 'unit_id', contractField: 'unit_id', kind: 'text' },
  { field: 'created_at', contractField: 'created_at', kind: 'date' },
  { field: 'updated_at', contractField: 'updated_at', kind: 'date' },
];

/**
 * Lista de ordens de serviço RENDERIZADA PELA ENGINE — a tela de referência do ERP.
 *
 * Não há coluna, rótulo, ordem, filtro nem aba escritos em JSX. Tudo vem do metadata store:
 *   - colunas  → `meta.views['list'].layout.columns`
 *   - abas     → `meta.views` (qualquer `view_type` vira aba)
 *   - filtros  → `meta.fields.in_filter`
 *   - ações    → `meta.workflow_transitions`
 *
 * O que permanece é o ENCANAMENTO: qual endpoint alimenta a entidade e como cada comando
 * chega ao backend — conhecimento que a engine não tem como adivinhar.
 */
/*
 * SABER DESENHAR NÃO É O MESMO QUE CONSEGUIR ALIMENTAR.
 *
 * `RENDERABLE_VIEW_TYPES` responde "a engine tem renderizador?". A pergunta do operador é
 * "esta aba vai mostrar alguma coisa NESTA entidade?". As duas respostas divergem e a
 * divergência é visível: o metadata store declara para `service-orders` uma view `tree` com
 * `{"parentField":"unit_id"}` — e `unit_id` aponta para a UNIDADE, não para outra ordem de
 * serviço. A aba abria, pintava, respondia ao clique, e mostrava uma floresta rasa: toda
 * linha virava raiz porque nenhum pai está na página. O agrupamento prometido não existia.
 *
 * Por isso a tela NÃO passa `RENDERABLE_VIEW_TYPES` ao switcher. Ela passa
 * `functionalViewTypes(schema)`, que cruza as duas perguntas e devolve só o que esta entidade
 * consegue alimentar de verdade — ver `supportedViewTypes` abaixo.
 *
 * O critério NÃO é volume de dado: entidade sem nenhuma linha mantém todas as suas views.
 * O que se recusa é eixo inexistente, condição que nenhuma carteira cheia corrige.
 */

/**
 * Tamanho da página.
 *
 * A tela pedia 50 linhas e parava ali, sem paginação: acima de 50 ordens a carteira era
 * truncada em silêncio. Com paginação explícita, o operador sabe onde está e alcança o resto.
 */
const PAGE_SIZE = 20;

const QUEUE_FILTER_OPTIONS: Array<{ value: ServiceOrderListFilter; label: string }> = [
  { value: SERVICE_ORDER_LIST_FILTERS.Overdue, label: 'Atrasadas' },
  { value: SERVICE_ORDER_LIST_FILTERS.ApproachingDue, label: 'Próximas do prazo' },
  { value: SERVICE_ORDER_LIST_FILTERS.Mine, label: 'Minhas ordens' },
  { value: SERVICE_ORDER_LIST_FILTERS.Unassigned, label: 'Sem responsável' },
  { value: SERVICE_ORDER_LIST_FILTERS.Unscheduled, label: 'Sem agenda' },
  { value: SERVICE_ORDER_LIST_FILTERS.ScheduledToday, label: 'Agendadas hoje' },
];

const QUEUE_ORDER_OPTIONS: Array<{ value: ServiceOrderListOrder; label: string }> = [
  { value: SERVICE_ORDER_LIST_ORDERS.Recent, label: 'Mais recentes' },
  { value: SERVICE_ORDER_LIST_ORDERS.Schedule, label: 'Agenda operacional' },
];

function parseQueueFilter(value: string | null): ServiceOrderListFilter | undefined {
  return QUEUE_FILTER_OPTIONS.some((option) => option.value === value)
    ? (value as ServiceOrderListFilter)
    : undefined;
}

function parseQueueOrder(value: string | null): ServiceOrderListOrder | undefined {
  return QUEUE_ORDER_OPTIONS.some((option) => option.value === value)
    ? (value as ServiceOrderListOrder)
    : undefined;
}

const DEFAULT_DESTINATIONS = [
  { id: 'nav-suppliers', label: 'Fornecedores', path: '/app/suppliers', group: 'Navegar' },
  { id: 'nav-billing', label: 'Faturamento interno', path: '/app/billing', group: 'Navegar' },
  { id: 'nav-service-orders', label: 'Ordens de serviço', path: '/app/service-orders', group: 'Navegar' },
];

export function ServiceOrdersEngineListPage() {
  const navigate = useNavigate();
  const { identityId } = useAuth();
  const { schema: entitySchema, status } = useEntitySchema('service-orders');
  const schema = useMemo(() => serviceOrderWorklistSchema(entitySchema), [entitySchema]);
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * FILTRO AVANÇADO — a MESMA engine de metadados que já governa esta entidade.
   *
   * OS é a única entidade do produto já registrada no metadata store, então aqui o construtor lê
   * `meta.fields` direto e não dependeu de seed novo. A árvore vive na URL pela chave da engine e é
   * convertida pelo conversor COMPARTILHADO; o recorte composto é ADITIVO ao recorte operacional
   * (`filter=overdue`, `filter=mine`), que continua respondendo a sua própria pergunta.
   */
  const urlQuery: string = searchParams.toString();
  const advancedGroup = useMemo<FilterGroup>(() => readFilterGroup(urlQuery), [urlQuery]);
  const advancedPayload = useMemo(
    () => advancedFilterFromGroup(advancedGroup, SERVICE_ORDER_FILTER_SPECS),
    [advancedGroup],
  );

  /*
   * ASSINATURA DE IDIOMA.
   *
   * `entityLabel()` é uma função livre e NÃO re-renderiza sozinha: quem dispara o
   * re-render é este hook. Sem esta linha, trocar o idioma no seletor atualizaria o
   * catálogo mas o `<h1>` só mudaria no próximo render por outro motivo — que é
   * exatamente o defeito que a prova de browser ("sem reload") existe para pegar.
   *
   * `language` é lido mas não usado diretamente: a dependência está no hook, não no valor.
   */
  useLanguage();

  const [rows, setRows] = useState<ServiceOrderEngineRow[]>([]);
  const [rowsStatus, setRowsStatus] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [pageBusy, setPageBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  /** Motivo do cancelamento em LOTE, informado pelo operador (registro de auditoria). */
  const [bulkReason, setBulkReason] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  /**
   * RECORTE SERVER-SIDE — busca e situação.
   *
   * O endpoint aceita `q` e `status` desde sempre; a tela carregava 50 linhas fixas e filtrava
   * `status`/`unit_id`/`origin` NO CLIENTE sobre essa página. Numa carteira maior que 50, a OS
   * procurada podia simplesmente não estar entre as carregadas, e a tela dizia "nenhum
   * resultado" para um registro que existe. Agora os dois recortes que o contrato suporta vão ao
   * SERVIDOR, e a paginação deixa de truncar silenciosamente a carteira.
   */
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [pageOffset, setPageOffset] = useState(0);
  const [recutTotal, setRecutTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState<boolean | null>(null);
  /*
   * O ESTADO DO FORMULÁRIO DE CRIAÇÃO SAIU DAQUI junto com o formulário inline.
   *
   * Não há mais `createOpen`/`createBusy`/`createError`: a criação é uma ROTA
   * (`/app/service-orders/new`) com estado próprio, e a fila não guarda nada sobre ela. Manter os
   * três aqui deixaria a tela carregando estado morto que ninguém mais lê.
   */
  /** Linha que abriu o drawer de contexto. `null` = painel fechado. */
  const [contextRow, setContextRow] = useState<ServiceOrderEngineRow | null>(null);

  /*
   * CONTEXTO REAL DA ORDEM — detalhe carregado de `GET /service-orders/:id`.
   *
   * O painel exibia APENAS um botão "Abrir ordem": era um modal decorativo que não dizia nada
   * sobre o registro. O detalhe publica código interno, origem, vínculos reais (solicitação,
   * proposta, pedido de compra) e `rowVersion` — os fatos que permitem DECIDIR sem abandonar a
   * fila. Carregamento LOCALIZADO: só o painel espera.
   */
  const [detailState, setDetailState] = useState<
    | { phase: 'idle' }
    | { phase: 'loading' }
    | { phase: 'error'; message: string }
    | { phase: 'ready'; detail: ServiceOrderDetail }
  >({ phase: 'idle' });

  /*
   * MOTIVO — informado pelo OPERADOR, nunca fabricado.
   *
   * `cancel` e `reopen` exigem motivo no contrato: é registro de auditoria. O código anterior
   * enviava `'Cancelamento em lote solicitado na lista de ordens de serviço.'` como texto FIXO —
   * ou seja, o frontend inventava o fato empresarial para satisfazer o schema. Aqui o motivo é
   * digitado, e o comando fica indisponível enquanto não existir.
   */
  const [commandReason, setCommandReason] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  const contextId = contextRow?.id ?? null;

  useEffect(() => {
    if (!contextId) {
      setDetailState({ phase: 'idle' });
      setCommandReason('');
      setCommandError(null);
      return;
    }
    const controller = new AbortController();
    setDetailState({ phase: 'loading' });
    setCommandError(null);
    void getServiceOrder(contextId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) {
          setDetailState({ phase: 'ready', detail });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDetailState({
            phase: 'error',
            message: 'Não foi possível carregar o contexto da ordem.',
          });
        }
      });
    return () => controller.abort();
  }, [contextId]);

  const activeViewType = searchParams.get('view') ?? 'list';
  const statusFilter = (searchParams.get('status') ?? '') as ServiceOrderStatus | '';
  const queueFilter = parseQueueFilter(searchParams.get('filter'));
  const queueOrder = parseQueueOrder(searchParams.get('order'));

  /*
   * SÓ VIEW PROVADA FUNCIONAL VIRA ABA.
   *
   * O switcher recebe a INTERSEÇÃO entre "a engine sabe desenhar" e "esta entidade consegue
   * alimentar". Sem este recorte ele oferecia `tree`, que o store declara sobre `unit_id` —
   * campo que aponta para a UNIDADE, não para outra ordem. A aba abria e mostrava uma
   * floresta de um nível: cada linha virava raiz porque nenhum pai está na página, e a tela
   * afirmava "a carteira não tem hierarquia" quando o que havia era declaração errada.
   *
   * As recusadas ficam registradas em `refusedViews`, com o motivo — não somem em silêncio.
   * `null` enquanto o schema carrega: a lista vazia seria lida como "nenhuma view funciona".
   */
  const supportedViewTypes = useMemo<string[]>(
    () => (schema ? functionalViewTypes(schema) : []),
    [schema],
  );
  const refusedViews = useMemo(() => (schema ? nonFunctionalViews(schema) : []), [schema]);

  // A busca digitada espera antes de virar requisição: sem o atraso, cada tecla é uma ida à rede.
  useEffect(() => {
    // Só uma alteração real da busca reinicia a página; o timer inicial não pode desfazer Próxima.
    if (searchInput.trim() === search) return;
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPageOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, search]);

  const filters = useMemo(() => {
    const values: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      if (key !== 'view') {
        values[key] = value;
      }
    }
    return values;
  }, [searchParams]);

  /* SEM IDENTIDADE, NÃO PERSISTE: `null` em vez do namespace compartilhado `'anonymous'`. */
  const savedViews = useSavedViews(identityId ?? null, 'service-orders');

  const loadRows = useCallback(
    async (signal?: AbortSignal) => {
      // Recarga preserva as linhas anteriores: trocar a grade por "Carregando…" a cada tecla
      // desmontaria a própria barra de busca durante a digitação.
      setRowsStatus((previous) => (previous === 'ready' ? previous : 'loading'));
      setErrorMessage(null);
      try {
        setPageBusy(true);
        const response = await listServiceOrders(
          {
            limit: PAGE_SIZE,
            offset: pageOffset,
            status: statusFilter || undefined,
            filter: queueFilter,
            order: queueOrder,
            q: search || undefined,
            advanced: advancedPayload,
          },
          signal,
        );
        if (signal?.aborted) {
          return;
        }
        setRows(serviceOrderEngineRows(response.items));
        setRecutTotal(typeof response.total === 'number' ? response.total : null);
        setHasMore(typeof response.hasMore === 'boolean' ? response.hasMore : null);
        setRowsStatus('ready');
        setPageBusy(false);
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        if (error instanceof ServiceOrdersApiError && error.kind === 'denied') {
          setRowsStatus('denied');
          setPageBusy(false);
          return;
        }
        setErrorMessage(
          error instanceof ServiceOrdersApiError
            ? mapServiceOrdersErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar as ordens de serviço.',
        );
        setRowsStatus('error');
        setPageBusy(false);
      }
    },
    [advancedPayload, pageOffset, queueFilter, queueOrder, search, statusFilter],
  );

  /**
   * COMANDO REAL a partir do CONTEXTO do registro. Envia intenção + `rowVersion`; quem valida a
   * transição é o backend. Aqui o motivo vem do operador — em lote ou individual.
   */
  const runContextCommand = useCallback(
    async (command: 'prepare' | 'release' | 'cancel' | 'reopen') => {
      if (!contextId) {
        return;
      }
      const rowVersion = Number(contextRow?.['row_version'] ?? 1);
      setCommandBusy(true);
      setCommandError(null);
      try {
        if (command === 'prepare') {
          await prepareServiceOrder(contextId, rowVersion);
        } else if (command === 'release') {
          await releaseServiceOrder(contextId, rowVersion);
        } else if (command === 'cancel') {
          await cancelServiceOrder(contextId, {
            rowVersion,
            cancellationReason: commandReason,
          });
        } else {
          await reopenServiceOrder(contextId, { rowVersion, reopenReason: commandReason });
        }
        setContextRow(null);
        await loadRows();
      } catch (error) {
        setCommandError(
          error instanceof ServiceOrdersApiError
            ? mapServiceOrdersErrorToMessage(error.code, error.status)
            : 'Não foi possível executar o comando.',
        );
      } finally {
        setCommandBusy(false);
      }
    },
    [commandReason, contextId, contextRow, loadRows],
  );


  useEffect(() => {
    const controller = new AbortController();
    void loadRows(controller.signal);
    return () => controller.abort();
  }, [loadRows]);

  /**
   * As linhas carregadas SÃO o resultado — não há recorte no cliente.
   *
   * O bloco anterior filtrava `status`/`unit_id`/`origin` sobre as 50 linhas da página e
   * declarava GAP_DE_CONTRATO. O gap era real para esses campos, mas `status` e `q` o endpoint
   * aceitava desde sempre: o que faltava era a tela mandar. O que o contrato NÃO suporta
   * continua sem aparecer como filtro — a barra lê `in_filter` do metadado e a busca cobre o
   * que `q` resolve no servidor.
   */
  const visibleRows = rows;

  const items = rows;
  const canGoNext = hasMore ?? (recutTotal === null ? null : pageOffset + items.length < recutTotal);
  const pageNumber = Math.floor(pageOffset / PAGE_SIZE) + 1;

  /**
   * INDICADORES DE DRILL-DOWN — derivados das linhas carregadas, com recortes DECLARADOS.
   *
   * `buildKpiMetrics` conta por `equals` sobre o campo do metadado; a engine não conhece os
   * estados, apenas conta o que a tela declara. O clique aplica o MESMO filtro que a barra usa,
   * então o número do card e a lista filtrada vêm do mesmo recorte.
   */
  const kpiSpecs = useMemo<KpiSpec[]>(
    () => [
      { id: 'execution', label: 'Em execução', field: 'status', equals: 'IN_EXECUTION', tone: 'info' },
      { id: 'paused', label: 'Pausadas', field: 'status', equals: 'PAUSED', tone: 'warning' },
      { id: 'completed', label: 'Concluídas', field: 'status', equals: 'COMPLETED', tone: 'success' },
      { id: 'cancelled', label: 'Canceladas', field: 'status', equals: 'CANCELLED', tone: 'critical' },
    ],
    [],
  );
  const kpiMetrics = useMemo(
    () => buildKpiMetrics(rows, kpiSpecs).map((metric) => ({ ...metric, hint: 'nesta página' })),
    [rows, kpiSpecs],
  );

  const updateFilter = (field: string, value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value.trim() === '') {
      next.delete(field);
    } else {
      next.set(field, value);
    }
    setSearchParams(next, { replace: true });
    // MUDAR O RECORTE VOLTA PARA A PRIMEIRA PÁGINA. Sem este reset, quem estivesse na página 3
    // e filtrasse por situação veria uma página vazia — o recorte mudou, a posição não.
    setPageOffset(0);
  };

  const clearFilters = (): void => {
    const next = filtersToSearchParams({});
    if (activeViewType !== 'list') {
      next.set('view', activeViewType);
    }
    setSearchParams(next, { replace: true });
    setPageOffset(0);
  };

  const changeView = (viewType: string): void => {
    const next = new URLSearchParams(searchParams);
    next.set('view', viewType);
    setSearchParams(next, { replace: true });
  };

  const openRow = (row: Record<string, unknown> & { id: string }): void => {
    void navigate(`/app/service-orders/${row.id}`);
  };

  /**
   * Abre o painel de contexto para a linha clicada.
   *
   * Diferente de `openRow`, que NAVEGA: o drawer mantém o operador na lista e mostra as
   * referências cruzadas do registro sem tirá-lo do recorte em que ele está trabalhando.
   */
  const openContext = (row: ServiceOrderEngineRow): void => {
    setContextRow(row);
  };

  /**
   * Referências cruzadas da linha.
   *
   * Montadas do que o payload JÁ traz — nenhuma chamada de rede nova. Quando um vínculo não
   * veio, ele não é afirmado: a referência simplesmente não entra, e a lista fica vazia se
   * nenhuma existir (o drawer declara isso em vez de quebrar).
   */
  const crossReferencesFor = (row: ServiceOrderEngineRow): CrossReference[] => {
    const references: CrossReference[] = [];
    const status = toDisplayText(row['status']);
    if (status.trim() !== '') {
      references.push({ label: 'Situação', detail: toHumanStatusLabel(status) });
    }
    const client = toDisplayText(row['client_snapshot']);
    if (client.trim() !== '') {
      references.push({ label: 'Cliente', detail: client });
    }
    const unit = toDisplayText(row['unit_id']);
    if (unit.trim() !== '') {
      references.push({ label: 'Unidade', detail: unit });
    }
    const deadline = toDisplayText(row['deadline_at']);
    if (deadline.trim() !== '') {
      references.push({ label: 'Prazo', detail: deadline });
    }
    const responsible = toDisplayText(row['assigned_workforce_name']);
    const responsibleCode = toDisplayText(row['assigned_workforce_code']);
    if (responsible.trim() !== '') {
      references.push({
        label: 'Responsável',
        detail: responsibleCode.trim() !== '' ? `${responsible} · ${responsibleCode}` : responsible,
      });
    } else {
      references.push({ label: 'Responsável', detail: 'Sem responsável atribuído' });
    }
    return references;
  };

  async function runCommand(command: string, ids: string[]): Promise<void> {
    /*
     * MOTIVO DO OPERADOR, NUNCA FABRICADO.
     *
     * O código anterior enviava `'Cancelamento em lote solicitado na lista de ordens de serviço.'`
     * como texto FIXO para satisfazer o schema de `cancel`. O motivo é REGISTRO DE AUDITORIA:
     * quem cancelou, quando e por quê. Preenchê-lo pela tela é o frontend inventando um fato
     * empresarial — e um lote sem motivo real é pior que um lote recusado.
     */
    if (command === 'cancel' && bulkReason.trim() === '') {
      setBulkMessage('Informe o motivo do cancelamento antes de executar o comando.');
      return;
    }
    setBulkBusy(true);
    setBulkMessage(null);
    const failures: string[] = [];
    for (const id of ids) {
      const row = rows.find((candidate) => candidate.id === id);
      const rowVersion = Number(row?.['row_version'] ?? 1);
      try {
        if (command === 'prepare') {
          await prepareServiceOrder(id, rowVersion);
        } else if (command === 'release') {
          await releaseServiceOrder(id, rowVersion);
        } else if (command === 'cancel') {
          await cancelServiceOrder(id, {
            rowVersion,
            cancellationReason: bulkReason.trim(),
          });
        }
      } catch (error) {
        failures.push(
          error instanceof ServiceOrdersApiError
            ? mapServiceOrdersErrorToMessage(error.code, error.status)
            : 'erro',
        );
      }
    }
    setBulkBusy(false);
    setSelectedIds([]);
    if (failures.length > 0) {
      setBulkMessage(`${failures.length} de ${ids.length} não puderam ser concluídas.`);
    }
    await loadRows();
  }

  const stateLabel = useCallback(
    (state: string): string => {
      if (!schema) {
        return state;
      }
      return resolveStateLabel(schema, state);
    },
    [schema],
  );

  /*
   * As ações da palette derivam do workflow do metadado e despacham o MESMO `runCommand` da
   * barra de lote. As dependências incluem `rows` porque `runCommand` lê `row_version` das
   * linhas carregadas — mantê-las explícitas é mais honesto que silenciar a regra.
   */
  const paletteActions = useMemo(
    () => paletteActionsFromSchema(schema, (command) => void runCommand(command, selectedIds)),
    [schema, selectedIds, rows],
  );

  useCommandPaletteShortcut(useCallback(() => setPaletteOpen(true), []));

  return (
    <ModulePage layout="workspace" className="cisne-engine-workspace">
      {/*
        SUPERFÍCIE DE TRABALHO — cabeçalho, visões salvas e comandos numa faixa própria.

        STICKY NÃO É APLICADO AQUI, DE PROPÓSITO. Esta superfície contém 7 blocos (switcher de
        view, drill-down de KPI, cockpit, export, filtro de metadado, busca e lote) e mediria
        ~1100px — MAIS ALTA que a viewport. Um `position: sticky` maior que a janela não fica
        fixo: ele empurra a própria fila para fora da dobra (medido: dobra útil de -441px). Ficar
        "grudado" era pior que não ficar.
      */}
      <div data-region="work-surface">
      <div data-region="operating-header">
      <header className="cisne-divider--section pb-1.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {/*
              ENTITY TITLE — o rótulo da entidade, resolvido pelo i18n.

              O metadata store devolve o rótulo em português (`Ordens de serviço`). Aqui ele
              passa pelo catálogo: em pt-BR sai igual ao metadado, em en-US sai traduzido. O
              `data-testid` é o gancho da prova de browser — é este nó que precisa mudar quando
              o operador troca o idioma, SEM reload.
            */}
            <h1 className="cisne-type-workspace m-0" data-testid="entity-title">
              {entityLabel('service-orders', schema?.label ?? 'Ordens de serviço')}
            </h1>
            <p className="cisne-type-helper m-0 mt-0.5">
              Carteira autorizada de ordens de serviço, com situação e contexto operacional.
            </p>
          </div>
          {/*
            COMANDO PRIMÁRIO — NAVEGA, NÃO ABRE FORMULÁRIO INLINE.

            Antes este botão alternava um `DynamicCreateForm` DENTRO da área de trabalho, e o envio
            era recusado pela própria tela ("a ordem nasce de uma solicitação aprovada..."). O
            formulário existia para não funcionar, e ainda espremia a fila quando aberto.

            A criação passou a ser um passo com endereço próprio (`/app/service-orders/new`), onde
            o contrato REAL do servidor é exercido: criação direta autorizada é válida, e a origem
            por proposta/pedido exige o vínculo correspondente.
          */}
          <Button
            data-testid="service-order-create-link"
            onClick={() => void navigate('/app/service-orders/new')}
          >
            Nova OS
          </Button>
        </div>
      </header>
      </div>

      {status === 'loading' || rowsStatus === 'loading' ? (
        <p className="cisne-type-helper m-0" aria-busy="true">
          Carregando…
        </p>
      ) : null}

      {status === 'error' ? (
        <p className="cisne-type-body m-0 text-red-700" role="alert">
          Não foi possível carregar o schema da entidade.
        </p>
      ) : null}

      {rowsStatus === 'denied' ? (
        <p className="cisne-type-body m-0" role="alert">
          Você não tem permissão para listar ordens de serviço.
        </p>
      ) : null}

      {rowsStatus === 'error' ? (
        <p className="cisne-type-body m-0 text-red-700" role="alert">
          {errorMessage ?? 'Não foi possível carregar as ordens de serviço.'}
        </p>
      ) : null}

      {schema && rowsStatus === 'ready' ? (
        <>
          <DynamicViewSwitcher
            schema={schema}
            activeViewType={activeViewType}
            onChange={changeView}
            supportedViewTypes={supportedViewTypes}
          />

          {/*
            VIEW RECUSADA NÃO DESAPARECE EM SILÊNCIO.
            
            A aba sai do switcher — oferecê-la seria abrir num painel de aviso — mas a tela
            DIZ que ela existe no metadata store e por que não é oferecida. Sem esta linha, a
            recusa vira uma decisão invisível: quem configurou a view no store a veria sumir
            sem explicação, e o próximo a mexer no metadado repetiria o mesmo eixo.
          */}
          {refusedViews.length > 0 ? (
            <details
              className="cisne-engine-capability-note"
              data-testid="service-orders-refused-views"
            >
              <summary>
                {refusedViews.length === 1
                  ? '1 visão indisponível nesta entidade'
                  : `${refusedViews.length} visões indisponíveis nesta entidade`}
              </summary>
              <p>
                {refusedViews.map((view) => `${view.label} (${view.reason})`).join(' ')}
              </p>
            </details>
          ) : null}

          <DynamicKpiDrilldown
            metrics={kpiMetrics}
            activeFilters={filters}
            onDrilldown={(field, value) => updateFilter(field, value)}
          />

          {visibleRows.length > 0 ? (
            <div className="cisne-engine-export">
              <DynamicExportCsv
                schema={schema}
                rows={visibleRows}
                fileName="ordens-de-servico"
                columns={listColumns(schema)}
              />
            </div>
          ) : null}

          {/*
            GRAMÁTICA DE REGIÕES — a ordem da família.

            DEFEITO CORRIGIDO: a superfície de VISÕES SALVAS vinha DEPOIS das DUAS superfícies de
            filtro (`DynamicFilterBar` + `WorklistFilterBar`). Varredura estática desta wave
            encontrou 8 telas ainda invertidas; esta é a maior delas e uma das alcançáveis, o que
            permite verificar a correção por DOM.

                OPERATING HEADER -> SAVED VIEWS -> COMMAND/FILTER -> WORK QUEUE
          */}
          <div className="cisne-query-deck">
          <div data-region="saved-view-surface">
          <DynamicSavedViewsBar
            views={savedViews.views}
            persistedLocally={savedViews.persistedLocally}
            persistable={savedViews.persistable}
            onSave={(name) => savedViews.save(name, filters, activeViewType)}
            onDelete={savedViews.remove}
            onApply={(view) => {
              const next = filtersToSearchParams(view.filters);
              next.set('view', view.viewType);
              setSearchParams(next, { replace: true });
            }}
          />
          </div>

          <div data-region="command-filter-surface">
          <DynamicFilterBar
            schema={schema}
            values={filters}
            onChange={updateFilter}
            onClear={clearFilters}
          />

          {/*
            FILTRO AVANÇADO COMPOSTO — a camada que a `DynamicFilterBar` NÃO cobre.

            A barra acima filtra UM campo por vez (igualdade sobre `in_filter`). O construtor abaixo
            monta um predicado COMBINADO (grupos AND/OR) sobre os mesmos campos, e é ADITIVO ao
            recorte operacional (`filter=overdue`, `filter=mine`): os dois respondem perguntas
            diferentes e convivem na mesma consulta.
          */}
          <div data-region="advanced-filter-surface">
            <DynamicFilterBuilder
              schema={schema}
              value={advancedGroup}
              onChange={(next) => {
                const params = new URLSearchParams(urlQuery);
                const serialized = filterGroupToQuery(next).get(FILTER_PARAM);
                if (serialized) {
                  params.set(FILTER_PARAM, serialized);
                } else {
                  params.delete(FILTER_PARAM);
                }
                // Mudança de recorte volta à primeira página.
                params.delete('offset');
                setSearchParams(params, { replace: true });
              }}
            />
          </div>

          {/*
            BUSCA E SITUAÇÃO — os dois recortes que o CONTRATO suporta, indo ao SERVIDOR.
            A barra acima é dirigida pelo metadado (`in_filter`) e alimenta a URL; esta faixa
            cobre o que o operador mais faz: procurar uma OS por número/cliente e recortar por
            situação. Ambos mudam a CONSULTA, não a página carregada.
          */}
          <WorklistFilterBar meta={`${items.length} nesta página`}>
            <WorklistField label="Buscar" htmlFor="so-engine-search" grow>
              <input
                id="so-engine-search"
                type="search"
                className={worklistSelectClass}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Número da OS ou cliente"
                autoComplete="off"
              />
            </WorklistField>
            <WorklistField label="Fila" htmlFor="so-engine-queue-filter">
              <select
                id="so-engine-queue-filter"
                className={worklistSelectClass}
                value={queueFilter ?? ''}
                onChange={(event) => updateFilter('filter', event.target.value)}
              >
                <option value="">Todas as ordens</option>
                {QUEUE_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </WorklistField>
            <WorklistField label="Ordenar" htmlFor="so-engine-queue-order">
              <select
                id="so-engine-queue-order"
                className={worklistSelectClass}
                value={queueOrder ?? ''}
                onChange={(event) => updateFilter('order', event.target.value)}
              >
                <option value="">Padrão do servidor</option>
                {QUEUE_ORDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </WorklistField>
            {/*
              NÃO há um segundo seletor de situação aqui.
              A `DynamicFilterBar` acima já publica um, dirigido pelo `in_filter` do metadado — e
              é ELE o filtro server-side, porque escreve `status` na URL, que `loadRows` manda à
              consulta. Dois controles para o mesmo recorte confundiriam o operador e poderiam
              divergir. A faixa cobre o que a barra do metadado NÃO tem: busca livre por `q`.
            */}
            <WorklistClearFilters
              visible={Boolean(statusFilter || queueFilter || queueOrder || search.trim() || Object.keys(filters).length > 0)}
              onClick={() => {
                setSearchInput('');
                setSearch('');
                clearFilters();
                setPageOffset(0);
              }}
            />
          </WorklistFilterBar>
          </div>
          </div>

          {/*
            MOTIVO DO LOTE — o operador informa antes de cancelar em massa.
            Sem motivo real o comando é recusado pela própria tela, porque o backend exige o
            registro de auditoria e a tela não tem o direito de inventá-lo.
          */}
          {selectedIds.length > 0 ? (
            <label className="mb-1 block" data-region="bulk-reason">
              <span className="cisne-meta-label mb-0.5 block">
                Motivo do cancelamento em lote (obrigatório para cancelar)
              </span>
              <input
                type="text"
                className="min-h-[var(--control-height)] w-full max-w-xl rounded-md border-0 bg-white px-1.5 text-[length:var(--type-body-size)] ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500"
                value={bulkReason}
                onChange={(event) => setBulkReason(event.target.value)}
                placeholder="Informe o motivo real"
              />
            </label>
          ) : null}

          <div data-region="bulk-command-surface">
          <DynamicBulkActions
            schema={schema}
            selectedIds={selectedIds}
            busy={bulkBusy}
            errorMessage={bulkMessage}
            onApply={(command, ids) => void runCommand(command, ids)}
            onClear={() => setSelectedIds([])}
          />
          </div>

          <div data-region="worklist-master">
          {activeViewType === 'kanban' ? (
            <DynamicKanban
              schema={schema}
              rows={visibleRows}
              stateLabel={stateLabel}
              onCardClick={openRow}
            />
          ) : activeViewType === 'list' ? (
            visibleRows.length === 0 ? (
              <WorklistStatePanel
                title={
                  statusFilter || search.trim() || Object.keys(filters).length > 0
                    ? 'Nenhuma ordem de serviço corresponde aos filtros aplicados.'
                    : 'Nenhuma ordem de serviço no seu escopo.'
                }
                description={
                  statusFilter || search.trim() || Object.keys(filters).length > 0
                    ? 'Ajuste o recorte ou limpe os filtros para voltar à carteira disponível.'
                    : 'As ordens de serviço nascem de solicitações aprovadas ou propostas aceitas; quando a primeira for aberta ela aparece aqui.'
                }
              />
            ) : (
              <DynamicList
                schema={schema}
                rows={visibleRows}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                agingField="deadline_at"
                /*
                 * A LINHA NAVEGA; o painel de contexto abre por um botão PRÓPRIO.
                 *
                 * Os dois gestos existiram na mesma linha em algum momento, e o clique ficou com
                 * o drawer — o que apagou a ida ao detalhe: a lista deixou de abrir a OS e as
                 * provas de browser (campo novo, transição nova, reordenação) passaram a falhar
                 * por não haver detalhe para inspecionar. Um clique não pode significar duas
                 * coisas: navegar é o que a linha promete desde que a lista existe, e o contexto
                 * ganhou botão explícito, que também anuncia a ação a quem usa teclado.
                 */
                onRowClick={openRow}
                renderRowActions={(row) => (
                  <button
                    type="button"
                    data-testid="dynamic-open-context"
                    data-context-row={row.id}
                    className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    onClick={(event) => {
                      // Sem `stopPropagation` o botão também navegaria — o clique subiria ao `<tr>`.
                      event.stopPropagation();
                      openContext(row);
                    }}
                  >
                    Contexto
                  </button>
                )}
              />
            )
          ) : (
            /*
             * AS DEMAIS VIEWS VÊM DO STORE, sem branch por tipo nesta tela.
             *
             * `calendar`, `pivot`, `tree` e `graph` já existem em `meta.views` de outras
             * entidades e são renderizadas por `DynamicViewHost`, que escolhe o renderizador
             * pelo `viewType` declarado. Antes, esta tela precisava conhecer cada tipo novo —
             * o oposto de views-como-dados. Tipo sem renderizador continua sendo dito em voz
             * alta pelo próprio host.
             */
            <DynamicViewHost
              schema={schema}
              rows={visibleRows}
              activeViewType={activeViewType}
              onRowClick={openRow}
              emptyMessage="Nenhuma ordem de serviço no seu escopo."
            />
          )}

          {/*
            PAGINAÇÃO SERVER-SIDE.
            O total e a existência da próxima página vêm da consulta autorizada no servidor.
            Indicadores de estado e prazo desta região são contagens da página corrente e aparecem
            rotulados como tal.
          */}
          {items.length === 0 ? (
            activeViewType === 'list' ? null : (
              <WorklistStatePanel
                title={
                  statusFilter || search.trim()
                    ? 'Nenhuma ordem de serviço corresponde aos filtros aplicados.'
                    : 'Nenhuma ordem de serviço no seu escopo.'
                }
                description={
                  statusFilter || search.trim()
                    ? 'Ajuste a situação ou o termo de busca, ou limpe os filtros para ver a carteira completa.'
                    : 'As ordens de serviço nascem de solicitações aprovadas ou propostas aceitas; quando a primeira for aberta ela aparece aqui.'
                }
              />
            )
          ) : (
            <WorklistFooter
              rangeLabel={
                pageBusy
                  ? 'Atualizando carteira...'
                  : recutTotal === null
                    ? `${pageOffset + 1}–${pageOffset + items.length} nesta página · total não publicado`
                    : `${pageOffset + 1}–${pageOffset + items.length} de ${recutTotal} no recorte`
              }
              extra={
                statusFilter || search.trim()
                  ? `${items.length} nesta página${statusFilter ? ` · situação: ${stateLabel(statusFilter)}` : ''}`
                  : undefined
              }
            >
              <ModulePagination
                pageNumber={pageNumber}
                previousDisabled={pageOffset === 0}
                nextDisabled={canGoNext !== true}
                onPrevious={() => setPageOffset(Math.max(0, pageOffset - PAGE_SIZE))}
                onNext={() => setPageOffset(pageOffset + PAGE_SIZE)}
              />
            </WorklistFooter>
          )}
          </div>
        </>
      ) : null}
      </div>

      <DynamicContextDrawer
        open={contextRow !== null}
        title="Contexto da ordem de serviço"
        onClose={() => setContextRow(null)}
        crossReferences={contextRow ? crossReferencesFor(contextRow) : []}
      >
        <div data-region="context-region">
          {contextRow ? (
            <p className="cisne-type-primary m-0 mb-2 truncate">
              {toDisplayText(contextRow['order_number'])}
            </p>
          ) : null}

          {detailState.phase === 'loading' ? (
            /* SKELETON LOCALIZADO — só o painel espera; a fila segue utilizável. */
            <div aria-busy="true" role="status" className="flex flex-col gap-1.5">
              <span className="cisne-type-helper">Carregando contexto…</span>
              <Skeleton lines={4} />
            </div>
          ) : null}

          {detailState.phase === 'error' ? (
            <p className="cisne-type-body m-0 text-red-700" role="alert">
              {detailState.message}
            </p>
          ) : null}

          {detailState.phase === 'ready' ? (
            <>
              <dl className="m-0 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                <dt className="cisne-meta-label pt-0.5">Número</dt>
                <dd className="cisne-meta-value m-0">{detailState.detail.orderNumber}</dd>
                <dt className="cisne-meta-label pt-0.5">Código interno</dt>
                <dd className="cisne-meta-value m-0 font-mono">{detailState.detail.internalCode}</dd>
                <dt className="cisne-meta-label pt-0.5">Origem</dt>
                <dd className="cisne-meta-value m-0">{formatServiceOrderOrigin(detailState.detail.origin) ?? '—'}</dd>
                {detailState.detail.contractReference ? (
                  <>
                    <dt className="cisne-meta-label pt-0.5">Contrato</dt>
                    <dd className="cisne-meta-value m-0">{detailState.detail.contractReference}</dd>
                  </>
                ) : null}
              </dl>

              {/*
                VÍNCULOS REAIS — só o que o detalhe publica. Cada degrau presente tem DESTINO
                real; ausência de vínculo não vira degrau inventado.
              */}
              <div className="cisne-divider--top mt-2 pt-2">
                <h3 className="cisne-section-title m-0 mb-1">Linhagem</h3>
                <ul className="m-0 flex list-none flex-col gap-0 p-0">
                  {detailState.detail.serviceRequestId ? (
                    <li className="cisne-type-meta">
                      <Link
                        to={`/app/requests/${detailState.detail.serviceRequestId}`}
                        className="text-brand-700 no-underline hover:underline"
                      >
                        Solicitação de origem
                      </Link>
                    </li>
                  ) : null}
                  {detailState.detail.proposalId ? (
                    <li className="cisne-type-meta">
                      <Link
                        to={`/app/proposals/${detailState.detail.proposalId}`}
                        className="text-brand-700 no-underline hover:underline"
                      >
                        Proposta
                      </Link>
                    </li>
                  ) : null}
                  {detailState.detail.purchaseOrderId ? (
                    <li className="cisne-type-meta">
                      <Link
                        to={`/app/purchase-orders/${detailState.detail.purchaseOrderId}`}
                        className="text-brand-700 no-underline hover:underline"
                      >
                        Pedido de compra
                      </Link>
                    </li>
                  ) : null}
                  {!detailState.detail.serviceRequestId &&
                  !detailState.detail.proposalId &&
                  !detailState.detail.purchaseOrderId ? (
                    <li className="cisne-type-helper">
                      Nenhum vínculo de origem publicado para esta ordem.
                    </li>
                  ) : null}
                </ul>
              </div>

              {/*
                COMMAND LAYER — comandos REAIS de transição. `cancel` e `reopen` exigem MOTIVO
                digitado: o motivo é registro de auditoria e NÃO é preenchido pela tela.
              */}
              <div className="cisne-divider--top mt-2 pt-2">
                {(detailState.detail.controlCenter?.nextAction.availableTransitions.includes('cancel') ||
                  detailState.detail.controlCenter?.nextAction.availableTransitions.includes('reopen')) ? (
                  <label className="mb-1 block">
                    <span className="cisne-meta-label mb-0.5 block">
                      Motivo (obrigatório para cancelar ou reabrir)
                    </span>
                    <input
                      type="text"
                      className="min-h-[var(--control-height)] w-full rounded-md border-0 bg-white px-1.5 text-[length:var(--type-body-size)] ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500"
                      value={commandReason}
                      onChange={(event) => setCommandReason(event.target.value)}
                      placeholder="Informe o motivo real"
                    />
                  </label>
                ) : null}

                <div className="flex flex-wrap items-center gap-1.5">
                  {detailState.detail.controlCenter?.nextAction.availableTransitions.includes('prepare') ? (
                    <Button
                      variant="secondary"
                      loading={commandBusy}
                      onClick={() => void runContextCommand('prepare')}
                    >
                      Preparar
                    </Button>
                  ) : null}
                  {detailState.detail.controlCenter?.nextAction.availableTransitions.includes('release') ? (
                    <Button
                      variant="primary"
                      loading={commandBusy}
                      onClick={() => void runContextCommand('release')}
                    >
                      Liberar
                    </Button>
                  ) : null}
                  {detailState.detail.controlCenter?.nextAction.availableTransitions.includes('reopen') ? (
                    <Button
                      variant="secondary"
                      disabled={commandReason.trim() === ''}
                      loading={commandBusy}
                      title={commandReason.trim() === '' ? 'Informe o motivo para executar' : undefined}
                      onClick={() => void runContextCommand('reopen')}
                    >
                      Reabrir
                    </Button>
                  ) : null}
                  {detailState.detail.controlCenter?.nextAction.availableTransitions.includes('cancel') ? (
                    <Button
                      variant="secondary"
                      disabled={commandReason.trim() === ''}
                      loading={commandBusy}
                      title={commandReason.trim() === '' ? 'Informe o motivo para executar' : undefined}
                      onClick={() => void runContextCommand('cancel')}
                    >
                      Cancelar
                    </Button>
                  ) : null}
                </div>

                {commandError ? (
                  <p className="cisne-type-helper m-0 mt-1.5 text-red-700" role="alert">
                    {commandError}
                  </p>
                ) : null}
              </div>

              {/* DRILLBACK ÚNICO — uma vez por registro selecionado, nunca por linha. */}
              <div className="cisne-divider--top mt-2 pt-2">
                <Button
                  variant="secondary"
                  onClick={() => void navigate(`/app/service-orders/${detailState.detail.id}`)}
                >
                  Abrir ficha completa
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </DynamicContextDrawer>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        destinations={DEFAULT_DESTINATIONS}
        actions={paletteActions}
        onNavigate={(path) => void navigate(path)}
      />
    </ModulePage>
  );
}

/** Rótulo humano de um estado, resolvido a partir do metadado. */
function resolveStateLabel(schema: MetaEntitySchema, state: string): string {
  const statusField = schema.fields.find(
    (field) => field.name === schema.workflow?.stateField,
  );
  const option = statusField?.options?.options?.find((candidate) => candidate.value === state);
  return option?.label ?? state;
}

export type { ServiceOrderEngineRow };
