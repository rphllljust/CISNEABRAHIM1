import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmptyState, Field, Input, Money, worklistTableCardClass } from '../../ui';
import { FilterCard, ModulePage, ModulePageHeader, ModulePrimaryLink, ModuleTableLink, filterControlClass, filterLabelClass } from '../../ui/module-layout';
import { worklistCellClass, worklistTableClass, worklistHeadCellClass, worklistRowClass } from '../../ui/enterprise-list';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { CreateRecordForm, VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { PROCUREMENT_REQUEST_STATUS_LABELS, SUPPLIER_INVOICE_STATUS_LABELS, SUPPLIER_PO_STATUS_LABELS } from '../../financial-ui/labels';
import { HumanLookupField } from '../../financial-ui/HumanLookupField';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { BackofficeCapabilityRoute } from '../../financial-ui/BackofficeCapabilityRoute';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import { formatCnpjDisplay } from '../../clients/utils/format-cnpj';
import {
  approvePurchaseRequest,
  cancelPurchaseOrder,
  cancelPurchaseRequest,
  computeThreeWayMatch,
  createPurchaseRequest,
  createSupplierInvoice,
  getPurchaseOrder,
  getPurchaseRequest,
  getSupplierInvoice,
  getThreeWayMatch,
  issuePurchaseOrder,
  listPurchaseRequests,
  listSupplierInvoices,
  listSupplierPurchaseOrders,
  probeProcurementReadAccess,
  receivePurchaseOrder,
  rejectPurchaseRequest,
  searchSupplierOptions,
  submitPurchaseRequest,
  validateSupplierInvoice,
  type PurchaseRequest,
  type PurchaseRequestSummary,
  type SupplierInvoice,
  type SupplierInvoiceSummary,
  type SupplierPurchaseOrder,
  type SupplierPurchaseOrderSummary,
  type ThreeWayMatch,
} from '../api/procurement-api';
import { mapProcurementErrorToMessage } from '../api/procurement-error-messages';
import {
  buildPartialReceive,
  defaultReceiveQuantities,
  remainingQuantity,
} from '../utils/partial-receive';

export function ProcurementRoute({ children }: { children: ReactNode }) {
  return (
    <BackofficeCapabilityRoute probe={probeProcurementReadAccess} capabilityId="procurement:request:read">
      {children}
    </BackofficeCapabilityRoute>
  );
}

export function ProcurementHubPage() {
  return (
    <ModulePage>
      <ModulePageHeader
        title="Compras"
        description="Solicitações, pedidos ao fornecedor e notas. Distinto do pedido de compra do cliente."
        action={
          <div className="flex flex-wrap items-center gap-4">
            <Link className="text-sm font-semibold text-gray-700 hover:text-gray-900" to="/app/suppliers">
              Fornecedores
            </Link>
            <ModulePrimaryLink to="/app/procurement/requests/new">Nova solicitação</ModulePrimaryLink>
          </div>
        }
      />
      <ProcurementLists />
    </ModulePage>
  );
}

const LIST_PAGE_SIZE = 20;

type ListsState = {
  requests: { phase: 'loading' } | { phase: 'ready'; items: PurchaseRequestSummary[]; total: number } | { phase: 'denied' } | { phase: 'error' };
  orders: { phase: 'loading' } | { phase: 'ready'; items: SupplierPurchaseOrderSummary[]; total: number } | { phase: 'denied' } | { phase: 'error' };
  invoices: { phase: 'loading' } | { phase: 'ready'; items: SupplierInvoiceSummary[]; total: number } | { phase: 'denied' } | { phase: 'error' };
};

/**
 * Listas operacionais do módulo. Cada lista é uma entidade do fluxo de compras que antes só era
 * alcançável por identificador digitado: requisição → pedido ao fornecedor → nota.
 */
function ProcurementLists() {
  const [state, setState] = useState<ListsState>({
    requests: { phase: 'loading' },
    orders: { phase: 'loading' },
    invoices: { phase: 'loading' },
  });
  const [term, setTerm] = useState('');
  const [appliedTerm, setAppliedTerm] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setState({
      requests: { phase: 'loading' },
      orders: { phase: 'loading' },
      invoices: { phase: 'loading' },
    });
    const query = { limit: LIST_PAGE_SIZE, offset: 0, q: appliedTerm || undefined };

    void listPurchaseRequests(query, controller.signal).then(
      (response) => setState((current) => ({ ...current, requests: { phase: 'ready', items: response.items, total: response.total } })),
      () => setState((current) => ({ ...current, requests: { phase: 'denied' } })),
    );
    void listSupplierPurchaseOrders(query, controller.signal).then(
      (response) => setState((current) => ({ ...current, orders: { phase: 'ready', items: response.items, total: response.total } })),
      () => setState((current) => ({ ...current, orders: { phase: 'denied' } })),
    );
    void listSupplierInvoices(query, controller.signal).then(
      (response) => setState((current) => ({ ...current, invoices: { phase: 'ready', items: response.items, total: response.total } })),
      () => setState((current) => ({ ...current, invoices: { phase: 'denied' } })),
    );

    return () => controller.abort();
  }, [appliedTerm]);

  return (
    <>
      <FilterCard>
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedTerm(term.trim());
          }}
        >
          <div>
            <label className={filterLabelClass} htmlFor="procurement-search">
              Buscar
            </label>
            <input
              id="procurement-search"
              type="search"
              className={`${filterControlClass} w-72`}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Justificativa, fornecedor ou número da nota"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Buscar
          </button>
        </form>
      </FilterCard>

      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Solicitações de compra">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>Solicitação</th>
              <th scope="col" className={worklistHeadCellClass}>Itens</th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>Valor</th>
              <th scope="col" className={worklistHeadCellClass}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {state.requests.phase === 'ready' && state.requests.items.length === 0 ? (
              <tr className={worklistRowClass}>
                <td className={worklistCellClass} colSpan={4}>
                  Nenhuma solicitação de compra encontrada.
                </td>
              </tr>
            ) : null}
            {state.requests.phase === 'denied' ? (
              <tr className={worklistRowClass}>
                <td className={worklistCellClass} colSpan={4}>
                  Você não tem permissão para listar solicitações de compra.
                </td>
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
                    <td className={worklistCellClass}>{request.lineCount}</td>
                    <td className={`${worklistCellClass} text-right`}>
                      <Money value={request.totalAmount} currencyCode={request.currencyCode} />
                    </td>
                    <td className={worklistCellClass}>
                      <FinanceStatusBadge status={request.status} labels={PROCUREMENT_REQUEST_STATUS_LABELS} />
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
      <p className="mb-6 mt-2 text-xs text-gray-500" role="status">
        {state.requests.phase === 'ready' ? `${state.requests.total} solicitação(ões) no total.` : 'Carregando solicitações…'}
      </p>

      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Pedidos ao fornecedor">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>Fornecedor</th>
              <th scope="col" className={worklistHeadCellClass}>Condição</th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>Valor</th>
              <th scope="col" className={worklistHeadCellClass}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {state.orders.phase === 'ready' && state.orders.items.length === 0 ? (
              <tr className={worklistRowClass}>
                <td className={worklistCellClass} colSpan={4}>
                  Nenhum pedido ao fornecedor encontrado.
                </td>
              </tr>
            ) : null}
            {state.orders.phase === 'denied' ? (
              <tr className={worklistRowClass}>
                <td className={worklistCellClass} colSpan={4}>
                  Você não tem permissão para listar pedidos ao fornecedor.
                </td>
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
                        <span className="block text-xs text-gray-500">
                          {formatCnpjDisplay(order.supplierTaxId)}
                        </span>
                      ) : null}
                    </td>
                    <td className={worklistCellClass}>{order.paymentTerms}</td>
                    <td className={`${worklistCellClass} text-right`}>
                      <Money value={order.totalAmount} currencyCode={order.currencyCode} />
                    </td>
                    <td className={worklistCellClass}>
                      <FinanceStatusBadge status={order.status} labels={SUPPLIER_PO_STATUS_LABELS} />
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
      <p className="mb-6 mt-2 text-xs text-gray-500" role="status">
        {state.orders.phase === 'ready' ? `${state.orders.total} pedido(s) no total.` : 'Carregando pedidos…'}
      </p>

      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Notas de fornecedor">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>Nota</th>
              <th scope="col" className={worklistHeadCellClass}>Fornecedor</th>
              <th scope="col" className={worklistHeadCellClass}>Vencimento</th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>Total</th>
              <th scope="col" className={worklistHeadCellClass}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {state.invoices.phase === 'ready' && state.invoices.items.length === 0 ? (
              <tr className={worklistRowClass}>
                <td className={worklistCellClass} colSpan={5}>
                  Nenhuma nota de fornecedor encontrada.
                </td>
              </tr>
            ) : null}
            {state.invoices.phase === 'denied' ? (
              <tr className={worklistRowClass}>
                <td className={worklistCellClass} colSpan={5}>
                  Você não tem permissão para listar notas de fornecedor.
                </td>
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
                    <td className={worklistCellClass}>
                      {invoice.supplierName ?? 'Fornecedor não identificado'}
                    </td>
                    <td className={worklistCellClass}>{invoice.dueDate}</td>
                    <td className={`${worklistCellClass} text-right`}>
                      <Money value={invoice.totalAmount} currencyCode={invoice.currencyCode} />
                    </td>
                    <td className={worklistCellClass}>
                      <FinanceStatusBadge status={invoice.status} labels={SUPPLIER_INVOICE_STATUS_LABELS} />
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
      <p className="mb-6 mt-2 text-xs text-gray-500" role="status">
        {state.invoices.phase === 'ready' ? `${state.invoices.total} nota(s) no total.` : 'Carregando notas…'}
      </p>
    </>
  );
}

export function PurchaseRequestCreatePage() {
  const navigate = useNavigate();
  const [unitId, setUnitId] = useState('');
  const [justification, setJustification] = useState('');
  const [lineDescription, setLineDescription] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitAmount, setUnitAmount] = useState('');

  return (
    <ModulePage>
      <ModulePageHeader
        title="Nova solicitação de compra"
        description="Quantidade × valor unitário é calculado pelo servidor."
      />
      <CreateRecordForm
        title="Solicitação"
        description="A solicitação nasce em rascunho e segue o fluxo de aprovação."
        submitLabel="Criar solicitação"
        mapError={mapProcurementErrorToMessage}
        onSubmit={async () => {
          const created = await createPurchaseRequest({
            unitId: unitId.trim(),
            justification: justification.trim(),
            lines: [
              {
                description: lineDescription.trim(),
                quantity: quantity.trim(),
                unitAmount: unitAmount.trim(),
              },
            ],
          });
          void navigate(`/app/procurement/requests/${created.id}`);
        }}
      >
        <Field label="Unidade" htmlFor="pr-unit" required>
          <Input id="pr-unit" value={unitId} onChange={(event) => setUnitId(event.target.value)} required />
        </Field>
        <Field label="Justificativa" htmlFor="pr-justification" required>
          <Input
            id="pr-justification"
            value={justification}
            onChange={(event) => setJustification(event.target.value)}
            required
          />
        </Field>
        <Field label="Item" htmlFor="pr-item" required>
          <Input
            id="pr-item"
            value={lineDescription}
            onChange={(event) => setLineDescription(event.target.value)}
            required
          />
        </Field>
        <Field label="Quantidade" htmlFor="pr-qty" required>
          <Input
            id="pr-qty"
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
          />
        </Field>
        <Field label="Valor unitário" htmlFor="pr-amount" required>
          <Input
            id="pr-amount"
            inputMode="decimal"
            value={unitAmount}
            onChange={(event) => setUnitAmount(event.target.value)}
            required
          />
        </Field>
      </CreateRecordForm>
      <p className="mt-4 text-sm text-gray-500">
        <Link className="font-semibold text-gray-700 hover:text-gray-900" to="/app/procurement">
          Voltar para as compras
        </Link>
      </p>
    </ModulePage>
  );
}

export function PurchaseRequestPage() {
  const { requestId = '' } = useParams();
  const navigate = useNavigate();
  const [supplierId, setSupplierId] = useState('');
  const loader = useCallback((signal?: AbortSignal) => getPurchaseRequest(requestId, signal), [requestId]);
  const { state, reload, setReady } = useBackofficeQuery<PurchaseRequest>({
    loader,
    mapError: mapProcurementErrorToMessage,
    enabled: Boolean(requestId),
  });
  const gate = renderQueryGate(
    'Solicitação de compra',
    'Carregando solicitação…',
    'Você não tem permissão para ver esta solicitação.',
    state,
    () => void reload(),
  );
  if (gate) {
    return gate;
  }
  if (state.phase !== 'ready') {
    return (
      <ModulePage>
        <ModulePageHeader title="Solicitação de compra" />
        <EmptyState title="Informe um identificador válido" />
      </ModulePage>
    );
  }
  const item = state.data;
  return (
    <ModulePage>
      <ModulePageHeader title="Solicitação de compra" description={item.justification} />
      <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
        <DefinitionList
          items={[
            {
              label: 'Status',
              value: <FinanceStatusBadge status={item.status} labels={PROCUREMENT_REQUEST_STATUS_LABELS} />,
            },
            { label: 'Versão', value: String(item.version) },
            { label: 'Moeda', value: item.currencyCode },
          ]}
        />
      </div>
      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Linhas da solicitação">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>Item</th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>Qtd</th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>Total informado</th>
            </tr>
          </thead>
          <tbody>
            {item.lines.map((line) => (
              <tr key={line.id} className={worklistRowClass}>
                <td className={worklistCellClass}>{line.description}</td>
                <td className={`${worklistCellClass} text-right`}>{line.quantity}</td>
                <td className={`${worklistCellClass} text-right`}>
                  <Money value={line.lineAmount} currencyCode={item.currencyCode} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <VersionedActionForm
          title="Enviar"
          confirmTitle="Enviar solicitação"
          confirmDescription="O servidor valida o estado atual."
          confirmLabel="Enviar"
          description="Envia a solicitação para aprovação."
          disabled={item.status !== 'DRAFT'}
          mapError={mapProcurementErrorToMessage}
          onReload={() => void reload()}
          onSubmit={async () => setReady(await submitPurchaseRequest(item.id, { version: item.version }))}
        />
        <VersionedActionForm
          title="Aprovar"
          confirmTitle="Aprovar solicitação"
          confirmDescription="A autoaprovação é recusada pelo backend."
          confirmLabel="Aprovar"
          description="Aprovação segue SOD."
          disabled={item.status !== 'PENDING_APPROVAL'}
          mapError={mapProcurementErrorToMessage}
          onReload={() => void reload()}
          onSubmit={async () => setReady(await approvePurchaseRequest(item.id, { version: item.version }))}
        />
        <VersionedActionForm
          title="Rejeitar"
          confirmTitle="Rejeitar solicitação"
          confirmDescription="A rejeição exige versão atual."
          confirmLabel="Rejeitar"
          variant="danger"
          reasonLabel="Motivo"
          description="Justificativa enviada ao servidor."
          disabled={item.status !== 'PENDING_APPROVAL'}
          mapError={mapProcurementErrorToMessage}
          onReload={() => void reload()}
          onSubmit={async ({ reason }) =>
            setReady(await rejectPurchaseRequest(item.id, { version: item.version, reason }))
          }
        />
        <VersionedActionForm
          title="Cancelar"
          confirmTitle="Cancelar solicitação"
          confirmDescription="O cancelamento só ocorre se o backend aceitar o estado atual."
          confirmLabel="Cancelar"
          variant="danger"
          reasonLabel="Motivo"
          description="Cancelamento versionado no servidor."
          disabled={item.status === 'CANCELLED' || item.status === 'REJECTED'}
          mapError={mapProcurementErrorToMessage}
          onReload={() => void reload()}
          onSubmit={async ({ reason }) =>
            setReady(await cancelPurchaseRequest(item.id, { version: item.version, reason }))
          }
        />
        <CreateRecordForm
          title="Emitir pedido"
          description="Escolha o fornecedor pelo nome ou CNPJ. O pedido é criado pelo servidor."
          submitLabel="Emitir pedido"
          disabled={item.status !== 'APPROVED'}
          mapError={mapProcurementErrorToMessage}
          onSubmit={async () => {
            const order = await issuePurchaseOrder(item.id, {
              version: item.version,
              supplierId,
            });
            void navigate(`/app/procurement/orders/${order.id}`);
          }}
        >
          <HumanLookupField
            className="md:col-span-2"
            label="Fornecedor"
            htmlFor="issue-supplier-search"
            required
            search={searchSupplierOptions}
            value={supplierId}
            onChange={setSupplierId}
            emptyMessage="Nenhum fornecedor encontrado para a busca."
          />
        </CreateRecordForm>
      </div>
    </ModulePage>
  );
}

export function PurchaseOrderPage() {
  const { orderId = '' } = useParams();
  const navigate = useNavigate();
  const [expenseCategoryId, setExpenseCategoryId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [costCenterCode, setCostCenterCode] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [matchResult, setMatchResult] = useState<ThreeWayMatch | null>(null);
  const [receiveQuantities, setReceiveQuantities] = useState<Record<string, string>>({});
  const loader = useCallback((signal?: AbortSignal) => getPurchaseOrder(orderId, signal), [orderId]);
  const { state, reload, setReady } = useBackofficeQuery<SupplierPurchaseOrder>({
    loader,
    mapError: mapProcurementErrorToMessage,
    enabled: Boolean(orderId),
  });
  useEffect(() => {
    if (state.phase === 'ready') {
      setReceiveQuantities(defaultReceiveQuantities(state.data.lines));
    }
  }, [state]);
  const gate = renderQueryGate(
    'Pedido ao fornecedor',
    'Carregando pedido…',
    'Você não tem permissão para ver este pedido.',
    state,
    () => void reload(),
  );
  if (gate) {
    return gate;
  }
  if (state.phase !== 'ready') {
    return (
      <ModulePage>
        <ModulePageHeader title="Pedido ao fornecedor" />
        <EmptyState title="Informe um identificador válido" />
      </ModulePage>
    );
  }
  const order = state.data;
  const receiveResult = buildPartialReceive(order.lines, receiveQuantities);
  const receiveAllowed = order.status === 'ISSUED' || order.status === 'PARTIALLY_RECEIVED';
  return (
    <ModulePage>
      <ModulePageHeader title="Pedido ao fornecedor" />
      <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
        <DefinitionList
          items={[
            {
              label: 'Status',
              value: <FinanceStatusBadge status={order.status} labels={SUPPLIER_PO_STATUS_LABELS} />,
            },
            {
              label: 'Fornecedor',
              value: order.supplierName ? (
                <>
                  <Link
                    className="font-semibold text-gray-700 hover:text-gray-900"
                    to={`/app/suppliers/${order.supplierId}`}
                  >
                    {order.supplierName}
                  </Link>
                  {order.supplierTaxId ? (
                    <span className="ml-2 text-gray-500">{formatCnpjDisplay(order.supplierTaxId)}</span>
                  ) : null}
                </>
              ) : (
                'Fornecedor não identificado no cadastro'
              ),
            },
            { label: 'Versão', value: String(order.version) },
          ]}
        />
      </div>
      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Linhas do pedido">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>Item</th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>Pedido</th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>Recebido</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.id} className={worklistRowClass}>
                <td className={worklistCellClass}>{line.description}</td>
                <td className={`${worklistCellClass} text-right`}>{line.orderedQuantity}</td>
                <td className={`${worklistCellClass} text-right`}>{line.receivedQuantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {order.receipts.length > 0 ? (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Recebimentos do pedido">
            <thead className={worklistHeadCellClass}>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>Recebimento</th>
                <th scope="col" className={worklistHeadCellClass}>Status</th>
                <th scope="col" className={worklistHeadCellClass}>Título a pagar</th>
              </tr>
            </thead>
            <tbody>
              {order.receipts.map((receipt) => (
                <tr key={receipt.id} className={worklistRowClass}>
                  <td className={worklistCellClass}>{receipt.id}</td>
                  <td className={worklistCellClass}>{receipt.status}</td>
                  <td className={worklistCellClass}>{receipt.payableId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <CreateRecordForm
        title="Receber"
        description="Informe por linha a quantidade a receber. O recebimento gera o título a pagar no backend."
        submitLabel="Registrar recebimento"
        disabled={!receiveAllowed || !receiveResult.valid}
        mapError={mapProcurementErrorToMessage}
        onSubmit={async (idempotencyKey) => {
          setReady(
            await receivePurchaseOrder(order.id, {
              version: order.version,
              idempotencyKey,
              expenseCategoryId: expenseCategoryId.trim(),
              costCenterId: costCenterId.trim(),
              costCenterCode: costCenterCode.trim(),
              dueDate: dueDate.trim(),
              lines: receiveResult.payload,
            }),
          );
        }}
      >
        <Field label="Categoria" htmlFor="recv-cat" required>
          <Input id="recv-cat" value={expenseCategoryId} onChange={(event) => setExpenseCategoryId(event.target.value)} required />
        </Field>
        <Field label="Centro de custo (id)" htmlFor="recv-cc-id" required>
          <Input id="recv-cc-id" value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)} required />
        </Field>
        <Field label="Centro de custo (código)" htmlFor="recv-cc-code" required>
          <Input id="recv-cc-code" value={costCenterCode} onChange={(event) => setCostCenterCode(event.target.value)} required />
        </Field>
        <Field label="Vencimento" htmlFor="recv-due" required>
          <Input id="recv-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
        </Field>
        {order.lines.map((line) => {
          const remaining = remainingQuantity(line.orderedQuantity, line.receivedQuantity);
          return (
            <Field
              key={line.id}
              label="Quantidade a receber"
              htmlFor={`recv-qty-${line.id}`}
              hint={`${line.description} — pedido ${line.orderedQuantity}, recebido ${line.receivedQuantity}, saldo ${remaining}`}
              className="md:col-span-2"
            >
              <Input
                id={`recv-qty-${line.id}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={receiveQuantities[line.id] ?? ''}
                onChange={(event) =>
                  setReceiveQuantities((current) => ({ ...current, [line.id]: event.target.value }))
                }
                disabled={remaining === '0'}
              />
            </Field>
          );
        })}
        {!receiveAllowed ? (
          <p className="text-sm text-amber-700 md:col-span-2" role="status">
            {order.status === 'RECEIVED'
              ? 'Pedido totalmente recebido; não há saldo a receber.'
              : 'O estado atual do pedido não permite recebimento.'}
          </p>
        ) : null}
        {receiveResult.issues.map((issue) => (
          <p key={issue} className="text-sm text-red-700 md:col-span-2" role="alert">
            {issue}
          </p>
        ))}
      </CreateRecordForm>
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <VersionedActionForm
          title="Conferência tripla"
          description="A classificação vem do servidor. Quantidades não são conferidas neste formulário."
          confirmTitle="Calcular conferência"
          confirmDescription="O backend compara pedido, recebimento e nota."
          confirmLabel="Calcular conferência"
          mapError={mapProcurementErrorToMessage}
          onReload={() => void reload()}
          onSubmit={async ({ idempotencyKey }) => {
            const match = await computeThreeWayMatch(order.id, { idempotencyKey });
            setMatchResult(match);
            void navigate(`/app/procurement/matches/${match.id}`);
          }}
        />
        <VersionedActionForm
          title="Cancelar pedido"
          description="Cancelamento versionado no servidor."
          confirmTitle="Cancelar pedido"
          confirmDescription="O pedido só cancela se o backend aceitar."
          confirmLabel="Cancelar"
          variant="danger"
          reasonLabel="Motivo"
          disabled={
            order.status === 'CANCELLED' ||
            order.status === 'RECEIVED' ||
            order.status === 'PARTIALLY_RECEIVED'
          }
          mapError={mapProcurementErrorToMessage}
          onReload={() => void reload()}
          onSubmit={async ({ reason }) =>
            setReady(await cancelPurchaseOrder(order.id, { version: order.version, reason }))
          }
        />
      </div>
      {matchResult ? (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
          <DefinitionList
            items={[
              { label: 'Classificação', value: matchResult.classification },
              { label: 'Motivos', value: matchResult.reasons.join(', ') || '—' },
            ]}
          />
        </div>
      ) : null}
    </ModulePage>
  );
}

export function SupplierInvoicePage() {
  const { invoiceId = '' } = useParams();
  const navigate = useNavigate();
  const [unitId, setUnitId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [supplierPurchaseOrderId, setSupplierPurchaseOrderId] = useState('');
  const [expenseCategoryId, setExpenseCategoryId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [costCenterCode, setCostCenterCode] = useState('');
  const loader = useCallback((signal?: AbortSignal) => getSupplierInvoice(invoiceId, signal), [invoiceId]);
  const { state, reload, setReady } = useBackofficeQuery<SupplierInvoice>({
    loader,
    mapError: mapProcurementErrorToMessage,
    enabled: Boolean(invoiceId),
    autoLoad: Boolean(invoiceId),
  });
  const gate = invoiceId
    ? renderQueryGate(
        'Nota do fornecedor',
        'Carregando nota…',
        'Você não tem permissão para ver notas de fornecedor.',
        state,
        () => void reload(),
      )
    : null;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Nota do fornecedor"
        description="Validação e conferência são do servidor. Totais não são recalculados no navegador."
        action={
          <Link className="text-sm font-semibold text-gray-700 hover:text-gray-900" to="/app/procurement">
            Voltar para as compras
          </Link>
        }
      />
      <CreateRecordForm
        title="Registrar nota"
        description="Valores e datas são validados pela API."
        submitLabel="Registrar nota"
        mapError={mapProcurementErrorToMessage}
        onSubmit={async (idempotencyKey) => {
          const created = await createSupplierInvoice({
            unitId: unitId.trim(),
            supplierId,
            invoiceNumber: invoiceNumber.trim(),
            issuedOn: issuedOn.trim(),
            dueDate: dueDate.trim(),
            totalAmount: totalAmount.trim(),
            paymentTerms: paymentTerms.trim(),
            supplierPurchaseOrderId: supplierPurchaseOrderId.trim() || undefined,
            idempotencyKey,
          });
          void navigate(`/app/procurement/invoices/${created.id}`);
        }}
      >
        <Field label="Unidade" htmlFor="si-unit" required>
          <Input id="si-unit" value={unitId} onChange={(event) => setUnitId(event.target.value)} required />
        </Field>
        <HumanLookupField
          label="Fornecedor"
          htmlFor="si-supplier-search"
          required
          search={searchSupplierOptions}
          value={supplierId}
          onChange={setSupplierId}
          emptyMessage="Nenhum fornecedor encontrado para a busca."
        />
        <Field label="Número" htmlFor="si-number" required>
          <Input id="si-number" value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} required />
        </Field>
        <Field label="Emissão" htmlFor="si-issued" required>
          <Input id="si-issued" type="date" value={issuedOn} onChange={(event) => setIssuedOn(event.target.value)} required />
        </Field>
        <Field label="Vencimento" htmlFor="si-due" required>
          <Input id="si-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
        </Field>
        <Field label="Total informado" htmlFor="si-total" required>
          <Input
            id="si-total"
            inputMode="decimal"
            value={totalAmount}
            onChange={(event) => setTotalAmount(event.target.value)}
            required
          />
        </Field>
        <Field label="Condição de pagamento" htmlFor="si-terms" required>
          <Input id="si-terms" value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} required />
        </Field>
        <Field label="Pedido ao fornecedor" htmlFor="si-po">
          <Input
            id="si-po"
            value={supplierPurchaseOrderId}
            onChange={(event) => setSupplierPurchaseOrderId(event.target.value)}
          />
        </Field>
      </CreateRecordForm>
      {gate}
      {!invoiceId ? (
        <EmptyState title="Nenhuma nota carregada" description="A API atual consulta a nota por identificador." />
      ) : null}
      {state.phase === 'ready' ? (
        <>
          <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
            <DefinitionList
              items={[
                {
                  label: 'Status',
                  value: (
                    <FinanceStatusBadge status={state.data.status} labels={SUPPLIER_INVOICE_STATUS_LABELS} />
                  ),
                },
                {
                  label: 'Total informado',
                  value: <Money value={state.data.totalAmount} currencyCode={state.data.currencyCode} emphasis />,
                },
                { label: 'Número', value: state.data.invoiceNumber },
                { label: 'Título a pagar', value: state.data.payableId ?? '—' },
                { label: 'Versão', value: String(state.data.version) },
              ]}
            />
          </div>
          <CreateRecordForm
            title="Validar nota"
            description="A validação gera o título a pagar no backend."
            submitLabel="Validar"
            disabled={state.data.status !== 'DRAFT'}
            mapError={mapProcurementErrorToMessage}
            onSubmit={async () => {
              setReady(
                await validateSupplierInvoice(state.data.id, {
                  version: state.data.version,
                  expenseCategoryId: expenseCategoryId.trim(),
                  costCenterId: costCenterId.trim(),
                  costCenterCode: costCenterCode.trim(),
                }),
              );
            }}
          >
            <Field label="Categoria" htmlFor="si-cat" required>
              <Input
                id="si-cat"
                value={expenseCategoryId}
                onChange={(event) => setExpenseCategoryId(event.target.value)}
                required
              />
            </Field>
            <Field label="Centro de custo (id)" htmlFor="si-cc-id" required>
              <Input
                id="si-cc-id"
                value={costCenterId}
                onChange={(event) => setCostCenterId(event.target.value)}
                required
              />
            </Field>
            <Field label="Centro de custo (código)" htmlFor="si-cc-code" required>
              <Input
                id="si-cc-code"
                value={costCenterCode}
                onChange={(event) => setCostCenterCode(event.target.value)}
                required
              />
            </Field>
          </CreateRecordForm>
        </>
      ) : null}
    </ModulePage>
  );
}

export function ThreeWayMatchPage() {
  const { matchId = '' } = useParams();
  const loader = useCallback((signal?: AbortSignal) => getThreeWayMatch(matchId, signal), [matchId]);
  const { state, reload } = useBackofficeQuery<ThreeWayMatch>({
    loader,
    mapError: mapProcurementErrorToMessage,
    enabled: Boolean(matchId),
  });
  const gate = renderQueryGate(
    'Conferência tripla',
    'Carregando conferência…',
    'Você não tem permissão para ver a conferência tripla.',
    state,
    () => void reload(),
  );
  if (gate) {
    return gate;
  }
  if (state.phase !== 'ready') {
    return (
      <ModulePage>
        <ModulePageHeader title="Conferência tripla" />
        <EmptyState title="Informe um identificador válido" />
      </ModulePage>
    );
  }
  const match = state.data;
  return (
    <ModulePage>
      <ModulePageHeader
        title="Conferência tripla"
        description="Classificação e quantidades são as persistidas pelo servidor."
      />
      <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
        <DefinitionList
          items={[
            { label: 'Classificação', value: match.classification },
            { label: 'Motivos', value: match.reasons.join(', ') || '—' },
            { label: 'Qtd pedida', value: match.orderedQuantity },
            { label: 'Qtd recebida', value: match.receivedQuantity },
            {
              label: 'Valor pedido',
              value: <Money value={match.orderedAmount} />,
            },
            {
              label: 'Valor recebido',
              value: <Money value={match.receivedAmount} />,
            },
            {
              label: 'Valor faturado',
              value: <Money value={match.invoicedAmount} />,
            },
            { label: 'Recebimentos', value: String(match.receiptCount) },
            { label: 'Notas', value: String(match.invoiceCount) },
          ]}
        />
      </div>
    </ModulePage>
  );
}
