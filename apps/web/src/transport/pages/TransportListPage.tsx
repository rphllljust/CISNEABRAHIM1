import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listTransportServiceOrders } from '../api/transport-api';
import { ServiceOrdersApiError } from '../../service-orders/api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../../service-orders/api/service-orders-error-messages';
import { ServiceOrderStatusBadge } from '../../service-orders/components/ServiceOrderStatusBadge';
import { formatClientLabel, formatDateTime } from '../../service-orders/utils/service-order-labels';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
  ModulePagination,
} from '../../ui/module-layout';
import {
  RecordStatusCell,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  WorklistStatePanel,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistRowClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { cn } from '../../ui/utils/cn';

const PAGE_SIZE = 20;

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | {
      phase: 'ready';
      items: Awaited<ReturnType<typeof listTransportServiceOrders>>['items'];
      offset: number;
      hasMore: boolean;
    };

function readTransportRouteLabel(location: Record<string, unknown> | null | undefined): string | null {
  const origin = typeof location?.origin === 'string' ? location.origin.trim() : '';
  const destination = typeof location?.destination === 'string' ? location.destination.trim() : '';
  if (!origin || !destination) {
    return null;
  }
  return `${origin} -> ${destination}`;
}

export function TransportListPage() {
  const [offset, setOffset] = useState(0);
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });
  /**
   * LINHA EM CONTEXTO — qual ordem a coluna lateral esta descrevendo.
   *
   * `null` = nada selecionado, e a coluna declara isso em vez de inventar um registro. A
   * selecao vive na TELA, nao na engine: esta worklist nao e governada por metadado.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadPage = useCallback(async (pageOffset: number, signal?: AbortSignal) => {
    setListState({ phase: 'loading' });
    try {
      const response = await listTransportServiceOrders(
        { limit: PAGE_SIZE, offset: pageOffset },
        signal,
      );
      setListState({
        phase: 'ready',
        items: response.items,
        offset: response.offset,
        hasMore: response.items.length === response.limit,
      });
    } catch (error) {
      if (error instanceof ServiceOrdersApiError) {
        if (error.kind === 'denied') {
          setListState({ phase: 'denied' });
          return;
        }
        setListState({
          phase: 'error',
          message: mapServiceOrdersErrorToMessage(error.code, error.status),
          retryable: error.kind === 'network' || error.kind === 'unknown',
        });
        return;
      }
      setListState({
        phase: 'error',
        message: 'Não foi possível carregar os transportes.',
        retryable: true,
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(offset, controller.signal);
    return () => controller.abort();
  }, [loadPage, offset]);

  if (listState.phase === 'loading') {
    return (
      <ModuleStatePage title="Transporte">
        <ModuleLoadingState message="Carregando ordens de transporte..." />
      </ModuleStatePage>
    );
  }
  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Transporte">
        <ModuleDeniedState message="Você não tem permissão para listar transportes." />
      </ModuleStatePage>
    );
  }
  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Transporte">
        <ModuleErrorState
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(offset)}
        />
      </ModuleStatePage>
    );
  }

  const { items, hasMore } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  /*
   * A SELECAO E DERIVADA DAS LINHAS CARREGADAS, nunca um objeto guardado: trocar de pagina
   * descarta a selecao sozinho, porque a ordem selecionada deixa de estar na lista. Guardar o
   * registro faria o painel continuar descrevendo uma linha que ja saiu do recorte.
   */
  const selected = items.find((order) => order.id === selectedId) ?? null;

  return (
    <ModulePage layout="workspace">
      {/*
        GRAMATICA DE REGIOES — a mesma das outras 15 listas.

        Esta tela declarava `WorklistHeader` e a grade densa, mas NENHUMA regiao. A governanca
        de divisor em `theme.css` casa `#main-content > * + *` e `[data-region] + [data-region]`:
        sem as regioes, cabecalho, fila e rodape ficavam colados sem a regua que separa
        "o que leio" de "o que e a fila" — exatamente a leitura de blocos soltos que a
        foundation remove.

        A tela NAO tem filtro publicado pelo contrato, entao nao ha `command-filter-surface`:
        uma regiao vazia so para completar a gramatica seria decoracao.
      */}
      <div data-region="work-surface">
        <div data-region="operating-header">
          <WorklistHeader
            title="Transporte"
            count={items.length}
            context="Ordens de serviço com arquétipo TRANSPORT. Origem, destino, veículo, cliente e pedido permanecem nos módulos existentes."
          />
        </div>

      <div data-region="work-split" className="grid items-start gap-x-4 xl:grid-cols-[minmax(0,74fr)_minmax(0,26fr)]">
      <div data-region="worklist-master" className="flex min-w-0 flex-col">
      {items.length === 0 ? (
        <WorklistStatePanel
          title="Nenhum transporte encontrado."
          description="Nenhuma ordem de serviço com arquétipo TRANSPORT no seu escopo autorizado."
        />
      ) : (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Lista de transportes">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  OS
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Cliente
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Trecho
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Status
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Atualizado
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => (
                <tr
                  key={order.id}
                  className={cn(worklistRowClass, 'cursor-pointer')}
                  data-selected={order.id === selectedId ? 'true' : undefined}
                  /*
                    SELECIONAR NAO E NAVEGAR, e o clique precisa respeitar os dois gestos.

                    O clique na linha ABRE O CONTEXTO (o operador continua na fila); ir para o
                    registro e o que o LINK promete, e por isso ele para a propagacao — sem isso
                    um clique sobre o numero faria as duas coisas ao mesmo tempo. Cliques em
                    controles internos tambem sao ignorados, senao um botao futuro dentro da
                    linha selecionaria a linha em vez de agir.
                  */
                  onClick={(event) => {
                    const target = event.target as HTMLElement;
                    if (target.closest('a, button, select, input')) {
                      return;
                    }
                    setSelectedId(order.id === selectedId ? null : order.id);
                  }}
                >
                  <td className={worklistCellClass}>
                    <WorklistRowLink href={`/app/service-orders/${order.id}/planning`}>
                      {order.orderNumber}
                    </WorklistRowLink>
                  </td>
                  <td className={worklistCellRaisedClass}>
                    {formatClientLabel(order.clientSnapshot, order.clientId)}
                  </td>
                  <td className={worklistCellRaisedClass}>
                    {readTransportRouteLabel(order.location) ?? '—'}
                  </td>
                  <td className={worklistCellRaisedClass}>
                    <RecordStatusCell badge={<ServiceOrderStatusBadge status={order.status} />} />
                  </td>
                  <td className={worklistCellRaisedClass}>
                    <span className="whitespace-nowrap">{formatDateTime(order.updatedAt)}</span>
                  </td>
                </tr>
              ))}
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
            onPrevious={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            onNext={() => setOffset(offset + PAGE_SIZE)}
          />
        </WorklistFooter>
      ) : null}
      </div>

      {/*
        COLUNA DE CONTEXTO — a CONTEXTO do transporte, sem sair da fila.

        Transporte era a unica das 17 worklists do produto SEM contexto: a unica forma de saber
        quem e o cliente, qual o trecho ou quando a OS foi atualizada era ler a propria linha, e
        qualquer detalhe exigia abandonar o recorte indo para o planejamento. As outras 16 ja
        declaram `context-column`; esta ficou para tras.

        `xl:block` e deliberado: abaixo de xl a coluna nao cabe sem esmagar a grade, e a grade
        densa e o produto. Escondida, ela nao deixa espaco morto — o que acontece e a fila usar
        toda a largura, que e a leitura correta em tela estreita.
      */}
      <aside
        className="hidden min-w-0 xl:block"
        data-region="context-column"
        aria-label="Contexto do transporte"
      >
        {selected ? (
          <section className="cisne-panel flex flex-col gap-2 px-3 py-2.5">
            <div>
              <p className="cisne-meta-label m-0">Transporte</p>
              <p className="cisne-type-primary m-0 mt-0.5">{selected.orderNumber}</p>
            </div>

            <dl className="m-0 grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              <dt className="cisne-meta-label pt-0.5">Cliente</dt>
              <dd className="cisne-meta-value m-0">
                {formatClientLabel(selected.clientSnapshot, selected.clientId)}
              </dd>

              <dt className="cisne-meta-label pt-0.5">Trecho</dt>
              {/* Trecho ausente NAO vira travessao nem texto inventado: a linha nao entra. */}
              <dd className="cisne-meta-value m-0">
                {readTransportRouteLabel(selected.location) ?? (
                  <span className="cisne-type-helper">Trecho não publicado</span>
                )}
              </dd>

              <dt className="cisne-meta-label pt-0.5">Situação</dt>
              <dd className="m-0">
                <ServiceOrderStatusBadge status={selected.status} />
              </dd>

              <dt className="cisne-meta-label pt-0.5">Atualizado</dt>
              <dd className="cisne-meta-value m-0 whitespace-nowrap">
                {formatDateTime(selected.updatedAt)}
              </dd>
            </dl>

            {/*
              O DRILLDOWN E O LINK REAL. O contexto mostra o que a linha JA publica e oferece a
              saida para o registro completo — ele nao duplica a tela de planejamento nem tenta
              carregar dados que este contrato nao entrega.
            */}
            <div className="cisne-divider--top mt-0.5 pt-2">
              <Link
                to={`/app/service-orders/${selected.id}/planning`}
                className="cisne-type-action text-brand-700 no-underline hover:underline"
              >
                Abrir planejamento da ordem
              </Link>
            </div>
          </section>
        ) : (
          <section className="cisne-panel px-3 py-2.5">
            <p className="cisne-meta-label m-0">Contexto do transporte</p>
            <p className="cisne-type-helper m-0 mt-1">
              Selecione uma ordem na fila para ver cliente, trecho, situação e atualização sem
              sair do recorte.
            </p>
          </section>
        )}
      </aside>
      </div>
      </div>
    </ModulePage>
  );
}
