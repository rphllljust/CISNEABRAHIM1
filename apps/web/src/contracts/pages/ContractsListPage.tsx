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
  EnterpriseMetric,
  RecordStatusCell,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  WorklistStatePanel,
  worklistCellClass,
  worklistHeadCellClass,
  worklistSelectClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
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
  const [clientFilter, setClientFilter] = useState('');
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
  const [urlParams, setUrlParams] = useSearchParams();
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
    <ModulePage>
      {/*
        ZONA 1 — CABECALHO DA WORKLIST, na gramatica `WorklistHeader` que as worklists
        enterprise irmaes (pedidos de compra, ordens de servico) ja usam.

        HIERARQUIA: o titulo da tela concentra o maior peso da pagina; o contexto de dominio
        entra como UMA linha de leitura, no lugar do antigo paragrafo solto. A acao primaria
        aparece UMA UNICA VEZ em toda a tela.

        CONTAGEM — declarada UMA VEZ, na barra de filtros ("N nesta página"). O chip de contagem
        do cabecalho foi removido: ele repetia o mesmo numero que a faixa de metricas ja
        descreve por classe (vigente/exigindo atenção/rascunho/encerrado), e a tela tinha o
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
      */}
      <WorklistHeader
        title="Contratos"
        context="Carteira de contratos comerciais, com vigência, situação e unidade de cada um."
        action={
          showCreateInHeader ? (
            <ModulePrimaryLink to="/app/contracts/new">Novo contrato</ModulePrimaryLink>
          ) : null
        }
        metrics={
          items.length > 0 ? (
            <>
              <EnterpriseMetric value={activeCount} label="vigente(s)" tone="info" />
              <EnterpriseMetric
                value={attentionCount}
                label="exigindo atenção"
                tone={attentionCount > 0 ? 'warning' : 'neutral'}
              />
              <EnterpriseMetric value={draftCount} label="rascunho(s)" />
              <EnterpriseMetric value={settledCount} label="encerrado(s)" />
            </>
          ) : null
        }
      />

      {/*
        ZONA 2 — COMMAND SURFACE COMPACTA. Barra unica: busca de cliente humana, unidade
        (escopo autorizado) e visoes salvas na MESMA linha de operacao — sem formulario cru,
        sem cartao de respiro largo empurrando a grade para fora da primeira dobra.
      */}
      <WorklistFilterBar meta={items.length > 0 ? `${items.length} nesta página` : undefined}>
        {/*
          BUSCA DE CLIENTE — `HumanLookupField` compacto NAO encolhe.

          O aviso de erro do lookup e um `<span>`/`<p>` SEM `nowrap`: como item de flex sem
          largura minima, ele era comprimido pelo select ao lado e o texto quebrava uma palavra
          por linha. O componente e COMPARTILHADO por outros modulos, entao o ajuste fica AQUI,
          no dono da barra: o wrapper reserva a largura minima e impede o encolhimento.
        */}
        <WorklistField label="Cliente" htmlFor="contract-client-search" grow>
          <span className="min-w-0 flex-1 [&>div>span]:shrink-0 [&>div>span]:whitespace-nowrap">
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
            className={worklistSelectClass}
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
            className={worklistSelectClass}
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        </WorklistField>
        <WorklistField label="até" htmlFor="contract-effective-to">
          <input
            id="contract-effective-to"
            type="date"
            className={worklistSelectClass}
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
      </WorklistFilterBar>

      {/*
        FILTRO AVANÇADO COMPOSTO — área própria, dirigida por METADADO.
      */}
      <div data-region="advanced-filter-surface" className="mb-2">
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

      {/*
        VISOES SALVAS — integradas a command surface, na MESMA faixa dos filtros que elas
        restauram. O recorte (cliente + unidade) e o que o comercial remonta todo dia e a visao
        reaplica o recorte SERVER-SIDE real. `persistedLocally` e declarado pela engine: sem
        endpoint de visoes salvas o armazenamento e local, e a barra diz isso em vez de fingir
        backend. O `-mt-1` apenas cola a barra na faixa de filtros, sem cartao proprio.
      */}
      {items.length > 0 ? (
        <div className="-mt-1 mb-2 flex flex-wrap items-center gap-2 [&>div]:mb-0">
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
      ) : null}

      {/*
        ZONA 3 — PROCESSING WORKLIST. A lista domina a pagina. Identidade primeiro (contrato,
        titulo/objeto e cliente), decisao depois (situacao + o fato que exige o operador) e
        ciclo/vigencia por ultimo. A barra de acento marca o contrato que EXIGE o operador.
      */}
      {items.length === 0 ? (
        /*
          ESTADO VAZIO — menor e mais funcional: a moldura `WorklistStatePanel` explica o que um
          contrato e e carrega a UNICA acao primaria quando a criacao e permitida. Sem o
          enquadramento de altura minima que deixava a tela orfa, o vazio ocupa o que precisa e
          devolve a primeira dobra para a area de trabalho.
        */
        <WorklistStatePanel
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
      ) : (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Lista de contratos">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  Contrato
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Situação
                </th>
                <th scope="col" className={worklistHeadCellClass}>
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
                    className="group relative cursor-pointer transition-colors hover:bg-brand-50/40"
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
                    <td className={cn(worklistCellClass, 'pl-3')}>
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
                    <td className={cn(worklistCellClass, 'z-[1]')}>
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
                    <td className={cn(worklistCellClass, 'z-[1] pr-3')}>
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
      )}

      {items.length > 0 ? (
        <WorklistFooter rangeLabel={`${offset + 1}–${offset + items.length} nesta página`}>
          <ModulePagination
            pageNumber={pageNumber}
            previousDisabled={offset === 0}
            nextDisabled={!hasMore}
            onPrevious={() => void loadPage(Math.max(0, offset - PAGE_SIZE))}
            onNext={() => void loadPage(offset + PAGE_SIZE)}
          />
        </WorklistFooter>
      ) : null}

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
