import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useOptionalIdentityId } from '../../auth/context/AuthProvider';
import {
  DynamicContextDrawer,
  DynamicFilterBuilder,
  DynamicSavedViewsBar,
  FILTER_PARAM,
  advancedFilterFromGroup,
  filterGroupToQuery,
  readFilterGroup,
  useEntitySchema,
  useSavedViews,
  type AdvancedFilterFieldSpec,
  type CrossReference,
  type FilterGroup,
} from '../../engine';

/**
 * CAMPOS DO FILTRO AVANÇADO PARA O CONVERSOR COMPARTILHADO.
 *
 * Allow-list idêntico ao publicado por `buildContractListWhere`
 * (`apps/api/src/commercial/repositories/contract-list-sql.ts`).
 */
const CONTRACT_FILTER_SPECS: AdvancedFilterFieldSpec[] = [
  { field: 'internal_code', contractField: 'internalCode', kind: 'text' },
  { field: 'contract_number', contractField: 'contractNumber', kind: 'text' },
  { field: 'title', contractField: 'title', kind: 'text' },
  { field: 'currency_code', contractField: 'currencyCode', kind: 'text' },
  { field: 'status', contractField: 'status', kind: 'enum' },
  { field: 'valid_from', contractField: 'validFrom', kind: 'date' },
  { field: 'valid_to', contractField: 'validTo', kind: 'date' },
  { field: 'created_at', contractField: 'createdAt', kind: 'date' },
  { field: 'updated_at', contractField: 'updatedAt', kind: 'date' },
];
import { ContractsApiError, listContracts } from '../api/contracts-api';
import { mapContractErrorToMessage } from '../api/contracts-error-messages';
import { ContractStatusBadge } from '../components/ContractStatusBadge';
import { useContractCapabilities } from '../hooks/useContractCapabilities';
import { CONTRACT_STATUSES, type Contract } from '../types';
import {
  formatClientSnapshot,
  formatContractStatus,
  formatDate,
} from '../utils/contract-status-labels';
import { HumanLookupField } from '../../financial-ui/HumanLookupField';
import { searchClientOptions } from '../../financial-ui/client-lookup';
import { OperationalUnitOptions, useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import {
  RecordStatusCell,
  WorklistClearFilters,
  WorklistField,
  WorklistRowLink,
  worklistControlClass,
  worklistSelectClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
/*
 * A MOLDURA DA BANCADA VEM DO PRIMITIVO COMPARTILHADO (`ui/workspace-frame`).
 *
 * Nenhuma moldura paralela: as reguas, a faixa de comando, a grade elastica e as classes de
 * celula desta tela sao as MESMAS de Clientes e das demais worklists que ja adotaram o frame.
 */
import {
  WorkspaceBody,
  WorkspaceEmpty,
  WorkspaceHeader,
  WorkspacePane,
  WorkspaceStatusLine,
  WorkspaceToolbar,
  workspaceCellClass,
  workspaceCellRaisedClass,
  workspaceHeadCellClass,
  workspaceRowClass,
} from '../../ui/workspace-frame';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
  ModulePagination,
  ModulePrimaryLink,
  UnitScopeLabel,
} from '../../ui/module-layout';
import { cn } from '../../ui/utils/cn';

const PAGE_SIZE = 20;

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: Contract[]; offset: number; hasMore: boolean };

/**
 * PESO DO CICLO DE VIDA — a regra de leitura da carteira de contratos.
 *
 * Contrato ATIVO em vigor e a condicao normal: nao exige trabalho. Contrato EXPIRADO e a
 * excecao que pede o operador (a vigencia terminou e a relacao comercial esta sem cobertura).
 * Rascunho ainda nao foi ativado; encerrado ja teve o ciclo fechado. E a mesma classificacao que
 * a maquina de estados define, usada apenas para decidir contraste — nada e inferido.
 */
type LifecycleWeight = 'open' | 'attention' | 'settled';

function contractWeight(
  status: Contract['status'],
  validTo: string | null,
  now: Date,
): LifecycleWeight {
  if (status === CONTRACT_STATUSES.Expired) {
    return 'attention';
  }
  if (status === CONTRACT_STATUSES.Active) {
    // Em vigor mas a vigencia ja terminou no relogio: o dominio ainda nao marcou como expirado,
    // mas o operador precisa ver que nao ha mais vigencia.
    if (validTo) {
      const end = new Date(`${validTo}T23:59:59`);
      if (!Number.isNaN(end.getTime()) && end.getTime() < now.getTime()) {
        return 'attention';
      }
    }
    return 'open';
  }
  if (status === CONTRACT_STATUSES.Draft) {
    return 'open';
  }
  return 'settled';
}

export function ContractsListPage() {
  const { capabilities } = useContractCapabilities();
  const { options: unitOptions } = useOperationalUnits();
  /*
   * VISOES SALVAS — o recorte (cliente + unidade) e o que o comercial remonta ao acompanhar a
   * vigencia de uma carteira. A visao restaura o recorte SERVER-SIDE real.
   */
  /* DONO REAL: sem identidade a visão não é persistida nem lida (ver `useSavedViews`). */
  const savedViews = useSavedViews(useOptionalIdentityId(), 'contracts');
  const [selected, setSelected] = useState<Contract | null>(null);
  // A URL é a fonte do recorte de Cliente. O Customer 360 navega com
  // ?clientId=...; manter uma segunda cópia em useState perdia esse contexto.
  // Alterações pelo lookup e Saved Views também preservam o deep link.
  const [urlParams, setUrlParams] = useSearchParams();
  const clientFilter = urlParams.get('clientId') ?? '';
  const setClientFilter = useCallback(
    (next: string) => {
      setUrlParams((previous) => {
        const params = new URLSearchParams(previous);
        if (next.trim()) {
          params.set('clientId', next.trim());
        } else {
          params.delete('clientId');
        }
        params.delete('offset');
        return params;
      }, { replace: true });
    },
    [setUrlParams],
  );
  const [unitFilter, setUnitFilter] = useState('');
  /**
   * RECORTES QUE O SERVIDOR JÁ EXECUTAVA E A TELA NÃO OFERECIA.
   *
   * `GET /contracts` aceita `status`, `q`, janela de VIGÊNCIA, ordenação e filtro avançado desde
   * `contract-list-sql` — e nada disso chegava ao operador, que só recortava por cliente e unidade.
   */
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  /**
   * FILTRO AVANÇADO — mesma engine de metadados do resto do produto.
   *
   * A árvore vive na URL pela chave da engine e é convertida pelo conversor COMPARTILHADO; o mapa
   * é o allow-list que `buildContractListWhere` executa.
   */
  const urlQuery: string = urlParams.toString();
  const { schema: contractSchema } = useEntitySchema('contract');
  const advancedGroup = useMemo<FilterGroup>(() => readFilterGroup(urlQuery), [urlQuery]);
  const advancedPayload = useMemo(
    () => advancedFilterFromGroup(advancedGroup, CONTRACT_FILTER_SPECS),
    [advancedGroup],
  );

  const loadPage = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listContracts(
          {
            limit: PAGE_SIZE,
            offset,
            clientId: clientFilter.trim() || undefined,
            unitId: unitFilter.trim() || undefined,
            status: statusFilter || undefined,
            search: search.trim() || undefined,
            effectiveFrom: effectiveFrom || undefined,
            effectiveTo: effectiveTo || undefined,
            advanced: advancedPayload,
          },
          signal,
        );
        setListState({
          phase: 'ready',
          items: response.items,
          offset: response.offset,
          hasMore: response.items.length === response.limit,
        });
      } catch (error) {
        if (error instanceof ContractsApiError) {
          if (error.kind === 'denied') {
            setListState({ phase: 'denied' });
            return;
          }
          setListState({
            phase: 'error',
            message: mapContractErrorToMessage(error.code, error.status),
            retryable: error.kind === 'network' || error.kind === 'unknown',
          });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar os contratos.',
          retryable: true,
        });
      }
    },
    [
      advancedPayload,
      clientFilter,
      effectiveFrom,
      effectiveTo,
      search,
      statusFilter,
      unitFilter,
    ],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(0, controller.signal);
    return () => controller.abort();
  }, [loadPage]);

  if (listState.phase === 'loading') {
    return (
      <ModuleStatePage title="Contratos">
        <ModuleLoadingState message="Carregando contratos…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Contratos">
        <ModuleDeniedState message="Você não tem permissão para listar contratos comerciais." />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Contratos">
        <ModuleErrorState
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(0)}
        />
      </ModuleStatePage>
    );
  }

  const { items, offset, hasMore } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const hasActiveFilters = Boolean(clientFilter.trim() || unitFilter.trim());
  const now = new Date();

  /**
   * A ACAO PRIMARIA EXISTE UMA VEZ, E SO.
   *
   * A tela vazia nao tem carteira para operar, entao a criacao desce para dentro do painel de
   * estado vazio (junto da explicacao do que e um contrato) e desaparece do cabecalho. Havendo
   * contrato, ou havendo recorte aplicado, ela fica no cabecalho e o painel de vazio NAO a
   * repete. As duas condicoes sao mutuamente exclusivas por construcao — nao ha caminho em que
   * os dois links coexistam.
   */
  const showCreateInHeader = capabilities.canCreate && (items.length > 0 || hasActiveFilters);
  const showCreateInEmptyState = capabilities.canCreate && items.length === 0 && !hasActiveFilters;

  /**
   * LEITURA DA CARTEIRA — contagens da PAGINA carregada, nunca do dominio.
   *
   * A listagem NAO publica `total`: so a pagina e o `hasMore`. Declarar um total aqui seria
   * inventar numero. Cada celula da faixa e rotulada "nesta página" e a paginacao continua sendo
   * a unica fonte do "tem mais".
   */
  const attentionCount = items.filter(
    (item) => contractWeight(item.status, item.validTo, now) === 'attention',
  ).length;
  const activeCount = items.filter((item) => item.status === CONTRACT_STATUSES.Active).length;
  const draftCount = items.filter((item) => item.status === CONTRACT_STATUSES.Draft).length;
  const settledCount = items.filter(
    (item) => item.status === CONTRACT_STATUSES.Closed || item.status === CONTRACT_STATUSES.Expired,
  ).length;

  return (
    /*
     * `layout="workspace"` — A BANCADA OCUPA A ALTURA DO SHELL.
     *
     * A moldura passa a ser uma coluna flexivel de altura cheia: o painel da grade dentro dela e
     * elastico e a tela deixa de medir o proprio conteudo (que era o que sobrava em canvas vazio
     * abaixo do ultimo registro). Nenhuma chamada, filtro ou rota muda por causa disso.
     */
    <ModulePage layout="workspace">
      {/*
        ZONA 1 — CABECALHO DA BANCADA, na gramatica `WorkspaceHeader` da moldura de workspace
        (a MESMA que as worklists irmaes ja usam).

        HIERARQUIA: o titulo da tela concentra o maior peso da pagina; o contexto de dominio
        entra como UMA linha de leitura, no lugar do antigo paragrafo solto. A acao primaria
        aparece UMA UNICA VEZ em toda a tela.

        IDENTIDADE — a linha que declara o que a AREA e, e nao o recorte. O texto que esta tela ja
        publicava como `context` do `WorklistHeader` nunca mudou com filtro nenhum, entao ele
        pertence ao `identity` da moldura (a linha que NAO muda); `scope` fica reservado ao recorte
        ATIVO, que aqui continua sem texto proprio. A redacao e EXATAMENTE a mesma de antes.

        CONTAGEM — declarada UMA VEZ, na linha de status do cabecalho ("N nesta página"). O chip
        de contagem do cabecalho foi removido: ele repetia o mesmo numero que a faixa de metricas
        ja descreve por classe (vigente/exigindo atenção/rascunho/encerrado), e a tela tinha o
        total da pagina escrito em tres lugares. Reference de densidade: Fiori/Dynamics declaram
        o tamanho uma vez, junto do recorte que o produziu.

        ACAO PRIMARIA — UMA UNICA EXPRESSAO. Quando nao ha contrato nenhum e a criacao e
        permitida, ela desce para DENTRO do painel de estado vazio (que ja explica o que um
        contrato e) e nao existe no cabecalho; nos demais casos fica no cabecalho. Nunca nas
        duas. O e2e usa `getByRole('link', { name: 'Novo contrato' })`, que exige UM unico no.

        METRICAS — o operador responde "qual e o tamanho e o estado desta pagina?" antes da
        primeira linha. Todos os numeros sao contagens da PAGINA carregada e cada um e derivado
        de `status`/`validTo` que a listagem ja publica: a listagem NAO publica `total`, entao
        nao ha contagem de dominio afirmada aqui. O recorte real (cliente + unidade) continua
        sendo o unico filtro que o servidor executa — as metricas DECLARAM, nao filtram.

        Os MESMOS numeros passam a viver em `WorkspaceStatusLine`, ao lado do titulo: uma linha
        de metadata no lugar de quatro caixas contornadas que gastavam faixa propria acima da
        grade. Nenhum numero novo e afirmado e nenhum numero existente foi perdido: o rotulo
        "nesta página" e exatamente o que a barra de filtros publicava (`N nesta página`), agora
        como item da mesma linha. `tone: 'alert'` continua exclusivo do que EXIGE o operador — o
        contrato com vigencia vencida —, que antes era o unico indicador em `tone="warning"`.
      */}
      <WorkspaceHeader
        title="Contratos"
        identity="Carteira de contratos comerciais, com vigência, situação e unidade de cada um."
        action={
          showCreateInHeader ? (
            <ModulePrimaryLink to="/app/contracts/new">Novo contrato</ModulePrimaryLink>
          ) : null
        }
        status={
          items.length > 0 ? (
            <WorkspaceStatusLine
              items={[
                { value: activeCount, label: 'vigente(s)' },
                {
                  value: attentionCount,
                  label: 'exigindo atenção',
                  tone: attentionCount > 0 ? 'alert' : 'neutral',
                },
                { value: draftCount, label: 'rascunho(s)' },
                { value: settledCount, label: 'encerrado(s)' },
                { value: items.length, label: 'nesta página' },
              ]}
            />
          ) : undefined
        }
      />

      {/*
        ZONA 2 — BARRA DE FERRAMENTAS DA BANCADA. Uma faixa de comando, com a ordem fixa da
        moldura: VISOES a esquerda e CONSULTA a direita.

        Busca de cliente humana, busca textual, situacao, janela de vigencia, unidade (escopo
        autorizado) e as visoes salvas continuam na MESMA linha de operacao — sem formulario cru,
        sem cartao de respiro largo empurrando a grade para fora da primeira dobra.
      */}
      <div className="cisne-query-deck mb-2">
      <WorkspaceToolbar
        views={
            <div data-region="saved-view-surface">
              {/*
                VISOES SALVAS — integradas a command surface, na MESMA faixa dos filtros que elas
                restauram. O recorte (cliente + unidade) e o que o comercial remonta todo dia e a visao
                reaplica o recorte SERVER-SIDE real. `persistedLocally` e declarado pela engine: sem
                endpoint de visoes salvas o armazenamento e local, e a barra diz isso em vez de fingir
                backend. O antigo `-mt-1`, que colava a barra na faixa de filtros, deixou de existir:
                dentro de `WorkspaceToolbar` a barra ja vive na faixa, sem cartao proprio.
              */}
              <DynamicSavedViewsBar
                views={savedViews.views}
                persistedLocally={savedViews.persistedLocally}
                persistable={savedViews.persistable}
                onSave={(name) => savedViews.save(name, { clientFilter, unitFilter }, 'list')}
                onDelete={savedViews.remove}
                onApply={(view) => {
                  setClientFilter(view.filters['clientFilter'] ?? '');
                  setUnitFilter(view.filters['unitFilter'] ?? '');
                }}
              />
            </div>
        }
      >
        {/*
          BUSCA DE CLIENTE — `HumanLookupField` compacto NAO encolhe.

          O aviso de erro do lookup e um `<span>`/`<p>` SEM `nowrap`: como item de flex sem
          largura minima, ele era comprimido pelo select ao lado e o texto quebrava uma palavra
          por linha. O componente e COMPARTILHADO por outros modulos, entao o ajuste fica AQUI,
          no dono da barra: o wrapper reserva a largura minima e impede o encolhimento.
        */}
        <WorklistField label="Cliente" htmlFor="contract-client-search" grow>
          <span className="min-w-[24rem] flex-1 [&>div>span]:shrink-0 [&>div>span]:whitespace-nowrap">
            <HumanLookupField
              label="Cliente"
              htmlFor="contract-client-search"
              variant="compact"
              search={searchClientOptions}
              value={clientFilter}
              onChange={setClientFilter}
              emptyOptionLabel="Todos os clientes"
              emptyMessage="Nenhum cliente encontrado para a busca."
            />
          </span>
        </WorklistField>

        <WorklistField label="Buscar" htmlFor="contract-search" grow>
          <input
            id="contract-search"
            type="search"
            className={worklistControlClass}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setSearch(searchInput);
              }
            }}
            placeholder="Número do contrato, código interno ou título"
            autoComplete="off"
          />
        </WorklistField>

        <WorklistField label="Situação" htmlFor="contract-status-filter">
          <select
            id="contract-status-filter"
            className={worklistSelectClass}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">Todas</option>
            <option value={CONTRACT_STATUSES.Draft}>Rascunho</option>
            <option value={CONTRACT_STATUSES.Active}>Ativo</option>
            <option value={CONTRACT_STATUSES.Closed}>Encerrado</option>
            <option value={CONTRACT_STATUSES.Expired}>Expirado</option>
          </select>
        </WorklistField>

        {/*
          JANELA DE VIGÊNCIA — o recorte mais próprio deste domínio.

          O predicado do servidor trata `valid_to IS NULL` como prazo INDETERMINADO e mantém esses
          contratos no recorte. A tela não reinterpreta: envia as datas e mostra o que o servidor
          devolveu.
        */}
        <WorklistField label="Vigente de" htmlFor="contract-effective-from">
          <input
            id="contract-effective-from"
            type="date"
            className={worklistControlClass}
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        </WorklistField>
        <WorklistField label="até" htmlFor="contract-effective-to">
          <input
            id="contract-effective-to"
            type="date"
            className={worklistControlClass}
            value={effectiveTo}
            onChange={(event) => setEffectiveTo(event.target.value)}
          />
        </WorklistField>

        <WorklistField label="Unidade" htmlFor="contract-unit-filter">
          <select
            id="contract-unit-filter"
            className={worklistSelectClass}
            value={unitFilter}
            onChange={(event) => setUnitFilter(event.target.value)}
          >
            <OperationalUnitOptions options={unitOptions} includeAllLabel="Todas as unidades" />
          </select>
        </WorklistField>

        <WorklistClearFilters
          visible={hasActiveFilters}
          onClick={() => {
            setClientFilter('');
            setUnitFilter('');
            setStatusFilter('');
            setSearchInput('');
            setSearch('');
            setEffectiveFrom('');
            setEffectiveTo('');
            const params = new URLSearchParams(urlQuery);
            params.delete(FILTER_PARAM);
            params.delete('offset');
            setUrlParams(params, { replace: true });
          }}
        />
      </WorkspaceToolbar>

      {/*
        FILTRO AVANÇADO COMPOSTO — área própria, dirigida por METADADO.
      */}
      <div data-region="advanced-filter-surface">
        <DynamicFilterBuilder
          schema={contractSchema}
          value={advancedGroup}
          onChange={(next) => {
            const params = new URLSearchParams(urlQuery);
            const serialized = filterGroupToQuery(next).get(FILTER_PARAM);
            if (serialized) {
              params.set(FILTER_PARAM, serialized);
            } else {
              params.delete(FILTER_PARAM);
            }
            params.delete('offset');
            setUrlParams(params, { replace: true });
          }}
        />
      </div>
      </div>

      {/*
        ZONA 3 — PROCESSING WORKLIST. A lista domina a pagina. Identidade primeiro (contrato,
        titulo/objeto e cliente), decisao depois (situacao + o fato que exige o operador) e
        ciclo/vigencia por ultimo. A barra de acento marca o contrato que EXIGE o operador.
      */}
      <WorkspaceBody>
        {/*
          A GRADE VIVE NA SUPERFICIE DA MOLDURA.

          Antes a tabela era `worklistTableCardClass`: um card que crescia com o conteudo, e o
          resto da tela ficava em canvas vazio. Agora o painel ocupa a ALTURA que o shell deixou e
          a rolagem e do miolo (`min-h-0 flex-1 overflow-auto`) — tres contratos ou vinte ocupam o
          mesmo quadro, e o rodape de paginacao continua visivel porque e `shrink-0`.

          `data-region="worklist-master"` e declarado no proprio painel: a fila inclui os estados
          (vazio/sem resultado), nao apenas a tabela.
        */}
        <WorkspacePane className={items.length === 0 ? 'overflow-hidden' : 'h-full overflow-hidden'} data-region="worklist-master">
          {items.length === 0 ? (
            /*
              ESTADO VAZIO — A MOLDURA PERMANECE; so o miolo da grade muda. O cabecalho e a
              toolbar continuam montados e `WorkspaceEmpty` explica o que um contrato e, com a
              UNICA acao primaria quando a criacao e permitida.
            */
            <WorkspaceEmpty
              title={
                hasActiveFilters
                  ? 'Nenhum contrato corresponde aos filtros aplicados.'
                  : 'Nenhum contrato no recorte atual.'
              }
              description={
                hasActiveFilters
                  ? 'Ajuste o cliente ou a unidade para ver outros contratos.'
                  : 'Os contratos formalizam a vigência comercial com o cliente: duração, status e unidade. Quando o primeiro for registrado, ele aparece aqui.'
              }
              action={
                hasActiveFilters ? (
                  <WorklistClearFilters
                    visible
                    onClick={() => {
                      setClientFilter('');
                      setUnitFilter('');
                    }}
                  />
                ) : showCreateInEmptyState ? (
                  <ModulePrimaryLink to="/app/contracts/new">Novo contrato</ModulePrimaryLink>
                ) : null
              }
            />
          ) : null}

          {items.length > 0 ? (
            <>
              <div className="min-h-0 flex-1 overflow-auto">
                <table className={worklistTableClass} aria-label="Lista de contratos">
                  <thead>
                    <tr>
                      <th scope="col" className={workspaceHeadCellClass}>
                        Contrato
                      </th>
                      <th scope="col" className={workspaceHeadCellClass}>
                        Situação
                      </th>
                      <th scope="col" className={workspaceHeadCellClass}>
                        Vigência
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const weight = contractWeight(item.status, item.validTo, now);
                      return (
                        <tr
                          key={item.id}
                          /* O registro cujo contexto esta aberto e o alvo da bancada: `data-selected`
                             e o canal que `workspaceRowClass` usa para marcar isso. A LOGICA de
                             selecao nao mudou — continua sendo `onClick` sobre a linha. */
                          data-selected={selected?.id === item.id}
                          className={cn(workspaceRowClass)}
                          /*
                           * CONTEXTO SEM ABANDONAR A LISTA — o comercial compara vigencias de varios
                           * contratos da mesma carteira. O painel lateral mostra os fatos da linha
                           * clicada sem perder o recorte.
                           */
                          onClick={() => setSelected(item)}
                        >
                          {/*
                            IDENTIDADE — contrato, cliente e titulo num bloco so.

                            O `WorklistRowLink` estica a area de clique do link por meio de um
                            pseudo-elemento posicionado contra o ancestral posicionado mais proximo.
                            Medido no gate visual: esse ancestral e a PROPRIA `<td>` (402px), nao a
                            linha — e por isso o overlay engolia o `onClick` do `<tr>` em TODA a
                            celula de identidade e o painel de contexto nunca abria (`drawerOpen: 0`),
                            navegando para o detalhe em vez de mostrar o contexto.

                            A correcao NAO e empilhar z-index: e dar ao link um ancestral posicionado
                            do tamanho do proprio codigo (`relative` no `<span>` do numero). O overlay
                            passa a cobrir apenas o codigo do contrato — que continua sendo um `<a>`
                            real, com clique do meio, nova aba e foco — e o restante da linha segue
                            abrindo o painel de contexto, como nas worklists irmas.
                          */}
                          {/*
                            `relative` NAO E DECORATIVO NESTA CELULA: a barra de acento de excecao e
                            `absolute` e o `WorklistRowLink` posiciona o overlay contra o ancestral
                            posicionado mais proximo. A classe da moldura (`workspaceCellClass`) nao
                            carrega `position`, entao ela e declarada aqui para que o recorte continue
                            sendo DESTA celula — exatamente como era.
                          */}
                          <td className={cn(workspaceCellClass, 'relative pl-3')}>
                            <span
                              aria-hidden="true"
                              className={cn(
                                'absolute top-1.5 bottom-1.5 left-0 w-[3px]',
                                weight === 'attention' ? 'bg-red-500' : 'bg-transparent',
                              )}
                            />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className="relative">
                                  <WorklistRowLink href={`/app/contracts/${item.id}`}>
                                    {item.contractNumber}
                                  </WorklistRowLink>
                                </span>
                                <span className="text-[12px] text-gray-500">
                                  {formatClientSnapshot(item.clientSnapshot)}
                                </span>
                              </div>
                              <p className="mt-0.5 line-clamp-1 text-[12px] text-gray-500">
                                {item.title}
                              </p>
                              <p className="mt-0.5 truncate text-[11px] text-gray-400">
                                {item.internalCode ? `${item.internalCode} · ` : ''}
                                <UnitScopeLabel unitId={item.unitId} />
                              </p>
                            </div>
                          </td>

                          {/* DECISAO — situacao + o fato que exige o operador, na mesma coluna. */}
                          <td className={workspaceCellRaisedClass}>
                            <RecordStatusCell
                              badge={<ContractStatusBadge status={item.status} />}
                              accent={weight === 'attention' ? 'critical' : 'none'}
                              context={
                                item.status === CONTRACT_STATUSES.Active && item.validTo
                                  ? (() => {
                                      const end = new Date(`${item.validTo}T23:59:59`);
                                      const past =
                                        !Number.isNaN(end.getTime()) && end.getTime() < now.getTime();
                                      return past ? 'Vigência encerrada no relógio' : null;
                                    })()
                                  : null
                              }
                            />
                          </td>

                          {/* CICLO — a vigencia real, sem data fabricada. */}
                          <td className={cn(workspaceCellRaisedClass, 'pr-3')}>
                            <span className="block text-[12px] text-gray-700 tabular-nums">
                              {formatDate(item.validFrom)}
                              {item.validTo
                                ? ` → ${formatDate(item.validTo)}`
                                : ' → sem término registrado'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/*
                RODAPE DA FILA — `shrink-0`, para que a paginacao nao encolha quando a grade rola,
                e separado do dado por REGUA (nao por caixa). O intervalo e o MESMO texto de antes
                (`1–20 nesta página`); ele vive aqui por ser o rodape do painel.
              */}
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[color:var(--color-divider)] px-3 py-1.5">
                <p className="cisne-type-helper m-0 tabular-nums">
                  {`${offset + 1}–${offset + items.length} nesta página`}
                </p>
                <ModulePagination
                  pageNumber={pageNumber}
                  previousDisabled={offset === 0}
                  nextDisabled={!hasMore}
                  onPrevious={() => void loadPage(Math.max(0, offset - PAGE_SIZE))}
                  onNext={() => void loadPage(offset + PAGE_SIZE)}
                />
              </div>
            </>
          ) : null}
        </WorkspacePane>
      </WorkspaceBody>

      {/*
        RELACOES DO CONTRATO — montadas do que a LINHA ja traz, sem chamada de rede nova.
        Contagem de pedidos/OS/medicoes vinculadas NAO e publicada por esta listagem, entao
        nenhuma e afirmada.
      */}
      <DynamicContextDrawer
        open={selected !== null}
        title={selected ? selected.contractNumber : 'Contrato'}
        onClose={() => setSelected(null)}
        crossReferences={selected ? contractCrossReferences(selected) : []}
      >
        {selected ? (
          <Link
            to={`/app/contracts/${selected.id}`}
            className="inline-flex items-center rounded border border-brand-700 bg-brand-700 px-2.5 py-1 text-[12px] font-semibold text-white no-underline hover:bg-brand-800"
          >
            Abrir contrato
          </Link>
        ) : null}
      </DynamicContextDrawer>
    </ModulePage>
  );
}

/**
 * Referencias cruzadas do contrato, a partir do payload da listagem.
 * AUSENCIA e DECLARADA (sem termino = "sem termino registrado"), nunca uma data fabricada.
 */
function contractCrossReferences(item: Contract): CrossReference[] {
  const references: CrossReference[] = [];
  const client = formatClientSnapshot(item.clientSnapshot);
  references.push({ label: 'Cliente', detail: client });
  references.push({
    label: 'Vigência',
    detail: item.validTo
      ? `${formatDate(item.validFrom)} → ${formatDate(item.validTo)}`
      : `${formatDate(item.validFrom)} → sem término registrado`,
  });
  if (item.title) {
    references.push({ label: 'Objeto', detail: item.title });
  }
  if (item.scopeDescription) {
    references.push({ label: 'Escopo', detail: item.scopeDescription });
  }
  if (item.internalCode) {
    references.push({ label: 'Código interno', detail: item.internalCode });
  }
  references.push({ label: 'Situação', detail: formatContractStatus(item.status) });
  if (item.paymentTerms) {
    references.push({ label: 'Condições de pagamento', detail: item.paymentTerms });
  }
  return references;
}
