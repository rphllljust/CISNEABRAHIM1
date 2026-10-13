import { useEffect, useState } from 'react';
import { DateTime, Money, worklistTableCardClass } from '../../ui';
import { ModulePagination, ModuleTableLink } from '../../ui/module-layout';
import {
  EnterpriseMetric,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  rowPrimaryActionClass,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistNumericCellClass,
  worklistNumericHeadCellClass,
  worklistRowClass,
  worklistSelectClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import {
  PROCUREMENT_REQUEST_STATUS_LABELS,
  SUPPLIER_INVOICE_STATUS_LABELS,
  SUPPLIER_PO_STATUS_LABELS,
} from '../../financial-ui/labels';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import { formatCnpjDisplay } from '../../clients/utils/format-cnpj';
import { ContextDrawer, type ContextPreviewBody } from '../../operator';
import {
  listPurchaseRequests,
  listSupplierInvoices,
  listSupplierPurchaseOrders,
  type PurchaseRequestSummary,
  type SupplierInvoiceSummary,
  type SupplierPurchaseOrderSummary,
} from '../api/procurement-api';

const LIST_PAGE_SIZE = 20;

type ProcurementPreview =
  | { kind: 'request'; item: PurchaseRequestSummary }
  | { kind: 'order'; item: SupplierPurchaseOrderSummary }
  | { kind: 'invoice'; item: SupplierInvoiceSummary };

type ListsState = {
  requests: { phase: 'loading' } | { phase: 'ready'; items: PurchaseRequestSummary[]; total: number } | { phase: 'denied' } | { phase: 'error' };
  orders: { phase: 'loading' } | { phase: 'ready'; items: SupplierPurchaseOrderSummary[]; total: number } | { phase: 'denied' } | { phase: 'error' };
  invoices: { phase: 'loading' } | { phase: 'ready'; items: SupplierInvoiceSummary[]; total: number } | { phase: 'denied' } | { phase: 'error' };
};

/**
 * Listas operacionais do módulo. Cada lista é uma entidade do fluxo de compras que antes só era
 * alcançável por identificador digitado: requisição → pedido ao fornecedor → nota.
 */
export function ProcurementLists() {
  const [state, setState] = useState<ListsState>({
    requests: { phase: 'loading' },
    orders: { phase: 'loading' },
    invoices: { phase: 'loading' },
  });
  const [term, setTerm] = useState('');
  const [appliedTerm, setAppliedTerm] = useState('');
  const [statusFilters, setStatusFilters] = useState({
    requests: '',
    orders: '',
    invoices: '',
  });
  const [preview, setPreview] = useState<ProcurementPreview | null>(null);
  const [offsets, setOffsets] = useState({ requests: 0, orders: 0, invoices: 0 });

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, requests: { phase: 'loading' } }));
    void listPurchaseRequests(
      {
        limit: LIST_PAGE_SIZE,
        offset: offsets.requests,
        q: appliedTerm || undefined,
        status: statusFilters.requests || undefined,
      },
      controller.signal,
    ).then(
      (response) =>
        setState((current) => ({
          ...current,
          requests: { phase: 'ready', items: response.items, total: response.total },
        })),
      () => setState((current) => ({ ...current, requests: { phase: 'denied' } })),
    );
    return () => controller.abort();
  }, [appliedTerm, offsets.requests, statusFilters.requests]);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, orders: { phase: 'loading' } }));
    void listSupplierPurchaseOrders(
      {
        limit: LIST_PAGE_SIZE,
        offset: offsets.orders,
        q: appliedTerm || undefined,
        status: statusFilters.orders || undefined,
      },
      controller.signal,
    ).then(
      (response) =>
        setState((current) => ({
          ...current,
          orders: { phase: 'ready', items: response.items, total: response.total },
        })),
      () => setState((current) => ({ ...current, orders: { phase: 'denied' } })),
    );
    return () => controller.abort();
  }, [appliedTerm, offsets.orders, statusFilters.orders]);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, invoices: { phase: 'loading' } }));
    void listSupplierInvoices(
      {
        limit: LIST_PAGE_SIZE,
        offset: offsets.invoices,
        q: appliedTerm || undefined,
        status: statusFilters.invoices || undefined,
      },
      controller.signal,
    ).then(
      (response) =>
        setState((current) => ({
          ...current,
          invoices: { phase: 'ready', items: response.items, total: response.total },
        })),
      () => setState((current) => ({ ...current, invoices: { phase: 'denied' } })),
    );
    return () => controller.abort();
  }, [appliedTerm, offsets.invoices, statusFilters.invoices]);

  return (
    <>
      <WorklistFilterBar>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setOffsets({ requests: 0, orders: 0, invoices: 0 });
            setAppliedTerm(term.trim());
          }}
        >
          <WorklistField label="Buscar" htmlFor="procurement-search" grow>
            <input
              id="procurement-search"
              type="search"
              className={`${worklistSelectClass} w-full min-w-0`}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Justificativa, fornecedor ou número da nota"
            />
          </WorklistField>
          <WorklistField label="Solicitações" htmlFor="procurement-request-status">
            <select
              id="procurement-request-status"
              className={worklistSelectClass}
              value={statusFilters.requests}
              onChange={(event) => {
                setOffsets((current) => ({ ...current, requests: 0 }));
                setStatusFilters((current) => ({ ...current, requests: event.target.value }));
              }}
            >
              <option value="">Todos os estados</option>
              {Object.entries(PROCUREMENT_REQUEST_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </WorklistField>
          <WorklistField label="Pedidos" htmlFor="procurement-order-status">
            <select
              id="procurement-order-status"
              className={worklistSelectClass}
              value={statusFilters.orders}
              onChange={(event) => {
                setOffsets((current) => ({ ...current, orders: 0 }));
                setStatusFilters((current) => ({ ...current, orders: event.target.value }));
              }}
            >
              <option value="">Todos os estados</option>
              {Object.entries(SUPPLIER_PO_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </WorklistField>
          <WorklistField label="Notas" htmlFor="procurement-invoice-status">
            <select
              id="procurement-invoice-status"
              className={worklistSelectClass}
              value={statusFilters.invoices}
              onChange={(event) => {
                setOffsets((current) => ({ ...current, invoices: 0 }));
                setStatusFilters((current) => ({ ...current, invoices: event.target.value }));
              }}
            >
              <option value="">Todos os estados</option>
              {Object.entries(SUPPLIER_INVOICE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </WorklistField>
          <button
            type="submit"
            className="rounded border border-brand-600 bg-brand-600 px-2.5 py-1 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Buscar
          </button>
          <WorklistClearFilters
            visible={
              appliedTerm !== '' ||
              statusFilters.requests !== '' ||
              statusFilters.orders !== '' ||
              statusFilters.invoices !== ''
            }
            label="Limpar filtros"
            onClick={() => {
              setTerm('');
              setOffsets({ requests: 0, orders: 0, invoices: 0 });
              setAppliedTerm('');
              setStatusFilters({ requests: '', orders: '', invoices: '' });
            }}
          />
        </form>
      </WorklistFilterBar>

      <div className="mb-3 flex flex-wrap gap-2" aria-label="Resumo das filas de compras">
        <EnterpriseMetric
          label="solicitações"
          value={state.requests.phase === 'ready' ? state.requests.total : '—'}
          tone={state.requests.phase === 'ready' && state.requests.total > 0 ? 'info' : 'neutral'}
        />
        <EnterpriseMetric
          label="pedidos ao fornecedor"
          value={state.orders.phase === 'ready' ? state.orders.total : '—'}
          tone={state.orders.phase === 'ready' && state.orders.total > 0 ? 'info' : 'neutral'}
        />
        <EnterpriseMetric
          label="notas de fornecedor"
          value={state.invoices.phase === 'ready' ? state.invoices.total : '—'}
          tone={state.invoices.phase === 'ready' && state.invoices.total > 0 ? 'info' : 'neutral'}
        />
      </div>

      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Solicitações de compra">
          <thead>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>Solicitação</th>
              <th scope="col" className={worklistHeadCellClass}>Itens</th>
              <th scope="col" className={worklistNumericHeadCellClass}>Valor</th>
              <th scope="col" className={worklistHeadCellClass}>Status</th>
              <th scope="col" className={worklistHeadCellClass}>Contexto</th>
            </tr>
          </thead>
          <tbody>
            {state.requests.phase === 'ready' && state.requests.items.length === 0 ? (
              <tr className={worklistRowClass}>
                <td className={worklistCellClass} colSpan={5}>Nenhuma solicitação de compra encontrada.</td>
              </tr>
            ) : null}
            {state.requests.phase === 'denied' ? (
              <tr className={worklistRowClass}>
                <td className={worklistCellClass} colSpan={5}>Você não tem permissão para listar solicitações de compra.</td>
              </tr>
            ) : null}
            {state.requests.phase === 'ready'
              ? state.requests.items.map((request) => (
                  <tr key={request.id} className={worklistRowClass}>
                    <td className={worklistCellClass}>
                      <ModuleTableLink to={`/app/procurement/requests/${request.id}`}>
                        {request.justification}
                      </ModuleTableLink>
                    </td>
                    <td className={worklistCellRaisedClass}>{request.lineCount}</td>
                    <td className={worklistNumericCellClass}>
                      <Money value={request.totalAmount} currencyCode={request.currencyCode} />
                    </td>
                    <td className={worklistCellRaisedClass}>
                      <FinanceStatusBadge status={request.status} labels={PROCUREMENT_REQUEST_STATUS_LABELS} />
                    </td>
                    <td className={worklistCellClass}>
                      <button
                        type="button"
                        className={rowPrimaryActionClass}
                        onClick={() => setPreview({ kind: 'request', item: request })}
                      >
                        Ver contexto
                      </button>
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
        <WorklistFooter
          rangeLabel={
            state.requests.phase === 'ready'
              ? state.requests.total === 0
                ? '0 solicitações no recorte'
                : `${offsets.requests + 1}–${Math.min(offsets.requests + state.requests.items.length, state.requests.total)} de ${state.requests.total} solicitações`
              : 'Carregando solicitações…'
          }
        >
          {state.requests.phase === 'ready' && state.requests.total > LIST_PAGE_SIZE ? (
            <ModulePagination
              pageNumber={Math.floor(offsets.requests / LIST_PAGE_SIZE) + 1}
              previousDisabled={offsets.requests === 0}
              nextDisabled={offsets.requests + state.requests.items.length >= state.requests.total}
              onPrevious={() =>
                setOffsets((current) => ({
                  ...current,
                  requests: Math.max(0, current.requests - LIST_PAGE_SIZE),
                }))
              }
              onNext={() =>
                setOffsets((current) => ({ ...current, requests: current.requests + LIST_PAGE_SIZE }))
              }
            />
          ) : null}
        </WorklistFooter>
      </div>

      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Pedidos ao fornecedor">
          <thead>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>Fornecedor</th>
              <th scope="col" className={worklistHeadCellClass}>Condição</th>
              <th scope="col" className={worklistNumericHeadCellClass}>Valor</th>
              <th scope="col" className={worklistHeadCellClass}>Status</th>
              <th scope="col" className={worklistHeadCellClass}>Contexto</th>
            </tr>
          </thead>
          <tbody>
            {state.orders.phase === 'ready' && state.orders.items.length === 0 ? (
              <tr className={worklistRowClass}>
                <td className={worklistCellClass} colSpan={5}>Nenhum pedido ao fornecedor encontrado.</td>
              </tr>
            ) : null}
            {state.orders.phase === 'denied' ? (
              <tr className={worklistRowClass}>
                <td className={worklistCellClass} colSpan={5}>Você não tem permissão para listar pedidos ao fornecedor.</td>
              </tr>
            ) : null}
            {state.orders.phase === 'ready'
              ? state.orders.items.map((order) => (
                  <tr key={order.id} className={worklistRowClass}>
                    <td className={worklistCellClass}>
                      <ModuleTableLink to={`/app/procurement/orders/${order.id}`}>
                        {order.supplierName ?? 'Fornecedor não identificado'}
                      </ModuleTableLink>
                      {order.supplierTaxId ? (
                        <span className="block text-[11px] text-gray-500">
                          {formatCnpjDisplay(order.supplierTaxId)}
                        </span>
                      ) : null}
                    </td>
                    <td className={worklistCellRaisedClass}>{order.paymentTerms}</td>
                    <td className={worklistNumericCellClass}>
                      <Money value={order.totalAmount} currencyCode={order.currencyCode} />
                    </td>
                    <td className={worklistCellRaisedClass}>
                      <FinanceStatusBadge status={order.status} labels={SUPPLIER_PO_STATUS_LABELS} />
                    </td>
                    <td className={worklistCellClass}>
                      <button
                        type="button"
                        className={rowPrimaryActionClass}
                        onClick={() => setPreview({ kind: 'order', item: order })}
                      >
                        Ver contexto
                      </button>
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
        <WorklistFooter
          rangeLabel={
            state.orders.phase === 'ready'
              ? state.orders.total === 0
                ? '0 pedidos no recorte'
                : `${offsets.orders + 1}–${Math.min(offsets.orders + state.orders.items.length, state.orders.total)} de ${state.orders.total} pedidos`
              : 'Carregando pedidos…'
          }
        >
          {state.orders.phase === 'ready' && state.orders.total > LIST_PAGE_SIZE ? (
            <ModulePagination
              pageNumber={Math.floor(offsets.orders / LIST_PAGE_SIZE) + 1}
              previousDisabled={offsets.orders === 0}
              nextDisabled={offsets.orders + state.orders.items.length >= state.orders.total}
              onPrevious={() =>
                setOffsets((current) => ({
                  ...current,
                  orders: Math.max(0, current.orders - LIST_PAGE_SIZE),
                }))
              }
              onNext={() =>
                setOffsets((current) => ({ ...current, orders: current.orders + LIST_PAGE_SIZE }))
              }
            />
          ) : null}
        </WorklistFooter>
      </div>

      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Notas de fornecedor">
          <thead>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>Nota</th>
              <th scope="col" className={worklistHeadCellClass}>Fornecedor</th>
              <th scope="col" className={worklistHeadCellClass}>Vencimento</th>
              <th scope="col" className={worklistNumericHeadCellClass}>Total</th>
              <th scope="col" className={worklistHeadCellClass}>Status</th>
              <th scope="col" className={worklistHeadCellClass}>Contexto</th>
            </tr>
          </thead>
          <tbody>
            {state.invoices.phase === 'ready' && state.invoices.items.length === 0 ? (
              <tr className={worklistRowClass}>
                <td className={worklistCellClass} colSpan={6}>Nenhuma nota de fornecedor encontrada.</td>
              </tr>
            ) : null}
            {state.invoices.phase === 'denied' ? (
              <tr className={worklistRowClass}>
                <td className={worklistCellClass} colSpan={6}>Você não tem permissão para listar notas de fornecedor.</td>
              </tr>
            ) : null}
            {state.invoices.phase === 'ready'
              ? state.invoices.items.map((invoice) => (
                  <tr key={invoice.id} className={worklistRowClass}>
                    <td className={worklistCellClass}>
                      <ModuleTableLink to={`/app/procurement/invoices/${invoice.id}`}>
                        {invoice.invoiceNumber}
                      </ModuleTableLink>
                    </td>
                    <td className={worklistCellRaisedClass}>
                      {invoice.supplierName ?? 'Fornecedor não identificado'}
                    </td>
                    <td className={worklistCellRaisedClass}>
                      <DateTime value={invoice.dueDate} mode="date" />
                    </td>
                    <td className={worklistNumericCellClass}>
                      <Money value={invoice.totalAmount} currencyCode={invoice.currencyCode} />
                    </td>
                    <td className={worklistCellRaisedClass}>
                      <FinanceStatusBadge status={invoice.status} labels={SUPPLIER_INVOICE_STATUS_LABELS} />
                    </td>
                    <td className={worklistCellClass}>
                      <button
                        type="button"
                        className={rowPrimaryActionClass}
                        onClick={() => setPreview({ kind: 'invoice', item: invoice })}
                      >
                        Ver contexto
                      </button>
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
        <WorklistFooter
          rangeLabel={
            state.invoices.phase === 'ready'
              ? state.invoices.total === 0
                ? '0 notas no recorte'
                : `${offsets.invoices + 1}–${Math.min(offsets.invoices + state.invoices.items.length, state.invoices.total)} de ${state.invoices.total} notas`
              : 'Carregando notas…'
          }
        >
          {state.invoices.phase === 'ready' && state.invoices.total > LIST_PAGE_SIZE ? (
            <ModulePagination
              pageNumber={Math.floor(offsets.invoices / LIST_PAGE_SIZE) + 1}
              previousDisabled={offsets.invoices === 0}
              nextDisabled={offsets.invoices + state.invoices.items.length >= state.invoices.total}
              onPrevious={() =>
                setOffsets((current) => ({
                  ...current,
                  invoices: Math.max(0, current.invoices - LIST_PAGE_SIZE),
                }))
              }
              onNext={() =>
                setOffsets((current) => ({ ...current, invoices: current.invoices + LIST_PAGE_SIZE }))
              }
            />
          ) : null}
        </WorklistFooter>
      </div>

      <ContextDrawer
        open={preview !== null}
        title="Contexto de compras"
        preview={preview ? buildProcurementPreview(preview) : null}
        onClose={() => setPreview(null)}
      />
    </>
  );
}

function buildProcurementPreview(preview: ProcurementPreview): ContextPreviewBody {
  if (preview.kind === 'request') {
    const item = preview.item;
    return {
      identifier: item.justification,
      subtitle: 'Solicitação de compra',
      status: <FinanceStatusBadge status={item.status} labels={PROCUREMENT_REQUEST_STATUS_LABELS} />,
      facts: [
        { label: 'Itens', value: item.lineCount },
        { label: 'Valor', value: <Money value={item.totalAmount} currencyCode={item.currencyCode} emphasis /> },
        { label: 'Versão', value: item.version },
        { label: 'Criada em', value: <DateTime value={item.createdAt} /> },
        { label: 'Atualizada em', value: <DateTime value={item.updatedAt} /> },
      ],
      relations: [],
      nextAction: {
        label: 'Abrir solicitação',
        href: `/app/procurement/requests/${item.id}`,
      },
      detailHref: `/app/procurement/requests/${item.id}`,
      detailLabel: 'Abrir solicitação completa',
    };
  }

  if (preview.kind === 'order') {
    const item = preview.item;
    return {
      identifier: item.supplierName ?? 'Pedido ao fornecedor',
      subtitle: item.supplierTaxId ? formatCnpjDisplay(item.supplierTaxId) : 'Pedido ao fornecedor',
      status: <FinanceStatusBadge status={item.status} labels={SUPPLIER_PO_STATUS_LABELS} />,
      facts: [
        { label: 'Condição', value: item.paymentTerms },
        { label: 'Itens', value: item.lineCount },
        { label: 'Recebido', value: item.receivedQuantity },
        { label: 'Valor', value: <Money value={item.totalAmount} currencyCode={item.currencyCode} emphasis /> },
        { label: 'Emitido em', value: <DateTime value={item.issuedAt} /> },
        { label: 'Versão', value: item.version },
      ],
      relations: [],
      nextAction: {
        label: 'Abrir pedido',
        href: `/app/procurement/orders/${item.id}`,
      },
      detailHref: `/app/procurement/orders/${item.id}`,
      detailLabel: 'Abrir pedido completo',
    };
  }

  const item = preview.item;
  return {
    identifier: item.invoiceNumber,
    subtitle: item.supplierName ?? 'Nota de fornecedor',
    status: <FinanceStatusBadge status={item.status} labels={SUPPLIER_INVOICE_STATUS_LABELS} />,
    facts: [
      { label: 'Emissão', value: <DateTime value={item.issuedOn} mode="date" /> },
      { label: 'Vencimento', value: <DateTime value={item.dueDate} mode="date" /> },
      { label: 'Valor', value: <Money value={item.totalAmount} currencyCode={item.currencyCode} emphasis /> },
      { label: 'Versão', value: item.version },
      { label: 'Título a pagar', value: item.payableId ? 'Gerado' : 'Ainda não gerado' },
    ],
    relations: [],
    nextAction: {
      label: 'Abrir nota',
      href: `/app/procurement/invoices/${item.id}`,
    },
    detailHref: `/app/procurement/invoices/${item.id}`,
    detailLabel: 'Abrir nota completa',
  };
}

