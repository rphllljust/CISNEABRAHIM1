import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DynamicContextDrawer,
  DynamicSavedViewsBar,
  useSavedViews,
  type CrossReference,
} from '../../engine';
import { ContractsApiError, listContracts } from '../api/contracts-api';
import { mapContractErrorToMessage } from '../api/contracts-error-messages';
import { ContractStatusBadge } from '../components/ContractStatusBadge';
import { useContractCapabilities } from '../hooks/useContractCapabilities';
import type { Contract } from '../types';
import { formatClientSnapshot, formatDate, formatDateTime } from '../utils/contract-status-labels';
import { HumanLookupField } from '../../financial-ui/HumanLookupField';
import { searchClientOptions } from '../../financial-ui/client-lookup';
import { OperationalUnitOptions, useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import {
  RecordStatusCell,
  RowActionCell,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  WorklistStatePanel,
  rowPrimaryActionClass,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistRowClass,
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

const PAGE_SIZE = 20;

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: Contract[]; offset: number; hasMore: boolean };

export function ContractsListPage() {
  const { capabilities } = useContractCapabilities();
  const { options: unitOptions } = useOperationalUnits();
  /*
   * VISÕES SALVAS — o recorte (cliente + unidade) é o que o comercial remonta todo dia ao
   * acompanhar a vigência de uma carteira. A visão restaura o recorte SERVER-SIDE real, que é
   * o que a consulta usa; nada de estado visual desconectado do filtro.
   */
  const savedViews = useSavedViews('local-operator', 'contracts');
  const [selected, setSelected] = useState<Contract | null>(null);
  const [clientFilter, setClientFilter] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

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
    [clientFilter, unitFilter],
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

  return (
    <ModulePage>
      {/*
        GRAMATICA UNICA. O titulo saia de um `PageHeader` de 8 unidades de margem + `FilterCard`
        com grid de duas colunas, e a grade era a legada `px-6 py-3.5` — a superficie parecia de
        outro produto ao lado das worklists ja convergidas. Contrato, filtros, grade, paginacao e
        estados passam a usar as mesmas primitivas: nenhuma consulta, rota, capability ou filtro
        mudou de semantica.
      */}
      <WorklistHeader
        title="Contratos"
        count={items.length}
        context="Contratos comerciais no seu escopo autorizado."
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/contracts/new">Novo contrato</ModulePrimaryLink>
          ) : null
        }
      />

      <WorklistFilterBar>
        <WorklistField label="Cliente">
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
        </WorklistField>
        {/*
          FILTRO DE UNIDADE HUMANO: era um campo de texto onde o operador tinha de DIGITAR o
          identificador interno da unidade. O valor enviado a API continua sendo o identificador
          real; o que sai e a digitacao dele — as unidades vem do escopo autorizado do usuario.
        */}
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
          }}
        />
      </WorklistFilterBar>

      {/*
        VISÕES SALVAS — cliente + unidade é o recorte que o comercial reconstrói a cada turno.
        `persistedLocally` é declarado pela engine: sem endpoint de visões salvas, o
        armazenamento é local por identidade.
      */}
      <DynamicSavedViewsBar
        views={savedViews.views}
        persistedLocally={savedViews.persistedLocally}
        onSave={(name) => savedViews.save(name, { clientFilter, unitFilter }, 'list')}
        onDelete={savedViews.remove}
        onApply={(view) => {
          setClientFilter(view.filters['clientFilter'] ?? '');
          setUnitFilter(view.filters['unitFilter'] ?? '');
        }}
      />

      {items.length === 0 ? (
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
                label="Revisar filtros"
                onClick={() => {
                  setClientFilter('');
                  setUnitFilter('');
                }}
              />
            ) : capabilities.canCreate ? (
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
                  Código interno
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Situação
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Cliente
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Vigência
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Unidade
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Atualizado em
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={worklistRowClass}
                  /*
                   * CONTEXTO SEM ABANDONAR A LISTA — o comercial compara vigências de vários
                   * contratos da mesma carteira. O painel lateral mostra os fatos da linha
                   * clicada sem perder o recorte; o número continua levando à ficha.
                   */
                  onClick={() => setSelected(item)}
                >
                  <td className={worklistCellClass}>
                    {/* Registro inteiro e a superficie de navegacao: link real esticado na linha. */}
                    <WorklistRowLink href={`/app/contracts/${item.id}`}>
                      {item.contractNumber}
                    </WorklistRowLink>
                    {item.title ? (
                      <p className="max-w-[36ch] truncate text-[11px] text-gray-500" title={item.title}>
                        {item.title}
                      </p>
                    ) : null}
                  </td>
                  <td className={worklistCellRaisedClass}>{item.internalCode}</td>
                  <td className={worklistCellRaisedClass}>
                    <RecordStatusCell badge={<ContractStatusBadge status={item.status} />} />
                  </td>
                  <td className={worklistCellRaisedClass}>
                    {formatClientSnapshot(item.clientSnapshot)}
                  </td>
                  <td className={worklistCellRaisedClass}>
                    <span className="tabular-nums whitespace-nowrap">
                      {formatDate(item.validFrom)}
                      {item.validTo ? ` → ${formatDate(item.validTo)}` : ''}
                    </span>
                  </td>
                  {/*
                    ESCOPO, nao o identificador. `unitId` e dado interno (em HML, um slug de
                    ambiente) e era o que a grade mostrava como se fosse o nome da unidade.
                  */}
                  <td className={worklistCellRaisedClass}>
                    <UnitScopeLabel unitId={item.unitId} />
                  </td>
                  <td className={worklistCellRaisedClass}>
                    <span className="whitespace-nowrap">{formatDateTime(item.updatedAt)}</span>
                  </td>
                  {/*
                    ACAO DA LINHA — mesmo contrato de Pedidos (GOLD 1) e Pessoas (GOLD 3).

                    O contrato so oferecia navegacao pelo numero. A leitura aqui e a MESMA que a
                    listagem bem-sucedida ja provou: abrir o contrato. As transicoes de contrato
                    (ativar/encerrar) exigem contrato proprio no detalhe — nao sao oferecidas na
                    grade para nao prometer operacao que nao conclui ali.
                  */}
                  <RowActionCell className="w-16">
                    <Link
                      to={`/app/contracts/${item.id}`}
                      className={rowPrimaryActionClass}
                      /* O clique na ação NAVEGA; o da linha abre o contexto. Parar a propagação
                         impede que os dois gestos signifiquem a mesma coisa. */
                      onClick={(event) => event.stopPropagation()}
                    >
                      Abrir
                    </Link>
                  </RowActionCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        RODAPÉ — só existe quando há o que paginar.

        Com ZERO registros a tela exibia "1–0 nesta página", "Página 1" e os botões
        Anterior/Próxima: faixa que não descreve nada, ocupa a primeira dobra de uma tela já
        vazia e sugere um dataset que não existe. Sem registro, o rodapé simplesmente não é
        montado — a leitura do vazio fica com o painel de estado, que é quem tem a saída.
      */}
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
        RELAÇÕES DO CONTRATO — montadas do que a LINHA já traz, sem chamada de rede nova.
        Contagem de pedidos, OS ou medições vinculadas NÃO é publicada por esta listagem, então
        nenhuma é afirmada: número sem origem não entra.
      */}
      <DynamicContextDrawer
        open={selected !== null}
        title={selected ? selected.contractNumber : 'Contrato'}
        onClose={() => setSelected(null)}
        crossReferences={selected ? contractCrossReferences(selected) : []}
      >
        {selected ? (
          <Link to={`/app/contracts/${selected.id}`} className={rowPrimaryActionClass}>
            Abrir contrato
          </Link>
        ) : null}
      </DynamicContextDrawer>
    </ModulePage>
  );
}

/**
 * Referências cruzadas do contrato, a partir do payload da listagem.
 *
 * Cada item entra só quando o campo existe. Contrato sem término tem a AUSÊNCIA declarada
 * ("em vigor por prazo indeterminado" só é afirmado quando não há `validTo`) — nunca uma data
 * fabricada.
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
  if (item.internalCode) {
    references.push({ label: 'Código interno', detail: item.internalCode });
  }
  return references;
}
