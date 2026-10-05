import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, Field, Input, Money, Select, worklistTableCardClass } from '../../ui';
import {
  FilterCard,
  ModulePage,
  ModulePageHeader,
  ModuleTableLink,
  UnitScopeLabel,
} from '../../ui/module-layout';
import {
  EnterpriseMetric,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistHeader,
  worklistCellClass,
  worklistSelectClass,
  worklistTableClass,
  worklistHeadCellClass,
  worklistRowClass,
} from '../../ui/enterprise-list';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { CreateRecordForm } from '../../financial-ui/VersionedActionForm';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { BackofficeCapabilityRoute } from '../../financial-ui/BackofficeCapabilityRoute';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import { INVENTORY_ITEM_STATUS_LABELS, WAREHOUSE_STATUS_LABELS } from '../../financial-ui/labels';
import { SavedViewsBar, useSmartList } from '../../operator';
import {
  createInventoryItem,
  createWarehouse,
  createCostingRule,
  getStockBalance,
  listInventoryItems,
  listStockMovements,
  listStockReservations,
  listWarehouses,
  mapInventoryErrorToMessage,
  postStockMovement,
  probeInventoryReadAccess,
  releaseReservation,
  reconcileInventoryCost,
  reconcileStockQuantity,
  reserveStock,
  reverseStockMovement,
  type InventoryItem,
  type StockMovementSummary,
  type StockReservationSummary,
  type Warehouse,
} from '../api/inventory-api';
import { buildStockMovementPayload, type StockMovementType } from '../utils/movement-payload';

const PAGE_SIZE = 20;

export function InventoryRoute({ children }: { children: ReactNode }) {
  return (
    <BackofficeCapabilityRoute probe={probeInventoryReadAccess} capabilityId="inventory:stock:read">
      {children}
    </BackofficeCapabilityRoute>
  );
}

type ListPhase<T> =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error' }
  | { phase: 'ready'; items: T[]; total: number };

function ListMessageRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr className={worklistRowClass}>
      <td className={worklistCellClass} colSpan={colSpan}>
        {children}
      </td>
    </tr>
  );
}

/**
 * Escopo estavel de persistencia das visoes salvas desta tela.
 */
const SCOPE = 'inventory.center';

/**
 * APRESENTACAO HUMANA dos enums persistidos. O dominio continua sendo o token do servidor
 * (IN/OUT/TRANSFER/ADJUSTMENT, ACTIVE/RELEASED/CANCELLED); aqui ele so deixa de aparecer cru
 * na superficie operacional. Token desconhecido cai no proprio valor.
 */
const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  IN: 'Entrada',
  OUT: 'Saída',
  TRANSFER: 'Transferência',
  ADJUSTMENT: 'Ajuste',
};

const MOVEMENT_STATUS_LABELS: Record<string, string> = {
  POSTED: 'Lançado',
  DRAFT: 'Rascunho',
  CANCELLED: 'Cancelado',
  REVERSED: 'Estornado',
};

const RESERVATION_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativa',
  RELEASED: 'Liberada',
  CANCELLED: 'Cancelada',
  CONSUMED: 'Consumida',
};

function humanLabel(value: string, labels: Record<string, string>): string {
  return labels[value] ?? value;
}

/** Allow-list: somente os tipos de movimento que o backend ja aceita. */
const INVENTORY_ALLOWED_FILTERS = {
  filters: { movementType: ['IN', 'OUT', 'TRANSFER', 'ADJUSTMENT'] },
} as const;

/**
 * Visoes embutidas derivadas da operacao real do estoque: entrada e saida sao as duas
 * leituras cotidianas da central. Sao exatamente os recortes que os comandos do Ctrl+K
 * abrem — nenhum filtro novo e inventado aqui.
 */
const INVENTORY_BUILT_IN_VIEWS = [
  {
    id: 'builtin.inventory.in',
    name: 'Entradas',
    description: 'Movimentos de entrada de estoque.',
    config: { filters: { movementType: 'IN' }, sortKey: null, sortDirection: 'asc' as const, groupKey: null },
  },
  {
    id: 'builtin.inventory.out',
    name: 'Saídas',
    description: 'Movimentos de saída de estoque.',
    config: { filters: { movementType: 'OUT' }, sortKey: null, sortDirection: 'asc' as const, groupKey: null },
  },
];

/**
 * Central operacional do estoque: depósitos, itens, movimentos e reservas são LISTAS com busca e
 * navegação. Nenhuma operação cotidiana exige identificador digitado — depósito e item vêm das
 * listas, e a unidade é derivada do depósito escolhido pelo servidor.
 */
export function InventoryPage() {
  const [term, setTerm] = useState('');
  const [appliedTerm, setAppliedTerm] = useState('');
  // ADOCAO DE MECANISMO: o tipo de movimento passa a viver na URL, o mesmo mecanismo das
  // outras listas da plataforma. E o que permite o Ctrl+K abrir a central de estoque ja
  // recortada (entradas ou saidas) e o endereco ser compartilhado.
  const smartList = useSmartList({
    scope: SCOPE,
    builtInViews: INVENTORY_BUILT_IN_VIEWS,
    allowedFilters: INVENTORY_ALLOWED_FILTERS,
    urlSync: true,
  });
  const movementType = smartList.filters.movementType ?? '';
  const [warehouses, setWarehouses] = useState<ListPhase<Warehouse>>({ phase: 'loading' });
  const [items, setItems] = useState<ListPhase<InventoryItem>>({ phase: 'loading' });
  const [movements, setMovements] = useState<ListPhase<StockMovementSummary>>({ phase: 'loading' });
  const [reservations, setReservations] = useState<ListPhase<StockReservationSummary>>({
    phase: 'loading',
  });

  const loadAll = useCallback(
    async (signal?: AbortSignal) => {
      const q = appliedTerm || undefined;
      setWarehouses({ phase: 'loading' });
      setItems({ phase: 'loading' });
      setMovements({ phase: 'loading' });
      setReservations({ phase: 'loading' });

      const settle = <T,>(
        promise: Promise<{ items: T[]; total: number }>,
        apply: (value: ListPhase<T>) => void,
      ) => {
        void promise.then(
          (response) => apply({ phase: 'ready', items: response.items, total: response.total }),
          () => apply({ phase: 'denied' }),
        );
      };

      settle(
        listWarehouses({ limit: PAGE_SIZE, offset: 0, q }, signal),
        setWarehouses,
      );
      settle(listInventoryItems({ limit: PAGE_SIZE, offset: 0, q }, signal), setItems);
      settle(
        listStockMovements(
          { limit: PAGE_SIZE, offset: 0, q, movementType: movementType || undefined },
          signal,
        ),
        setMovements,
      );
      settle(listStockReservations({ limit: PAGE_SIZE, offset: 0, q }, signal), setReservations);
    },
    [appliedTerm, movementType],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadAll(controller.signal);
    return () => controller.abort();
  }, [loadAll]);

  return (
    <ModulePage>
      <WorklistHeader
        title="Estoque"
        count={items.phase === 'ready' ? items.total : null}
        context="Depósitos, itens, movimentos e reservas. Saldos e custos são os persistidos pelo servidor; FIFO/média permanecem indecisos."
        metrics={
          <>
            <EnterpriseMetric
              label="Depósitos"
              value={warehouses.phase === 'ready' ? warehouses.total : '—'}
            />
            <EnterpriseMetric
              label="Itens"
              value={items.phase === 'ready' ? items.total : '—'}
            />
            <EnterpriseMetric
              label="Movimentos"
              value={movements.phase === 'ready' ? movements.total : '—'}
              tone={movementType ? 'info' : 'neutral'}
            />
            <EnterpriseMetric
              label="Reservas ativas"
              value={reservations.phase === 'ready' ? reservations.total : '—'}
              tone={
                reservations.phase === 'ready' && reservations.total > 0 ? 'warning' : 'neutral'
              }
            />
          </>
        }
      />

      {/* BARRA OPERACIONAL DENSA — busca e tipo de movimento na mesma linha das demais worklists. */}
      <WorklistFilterBar
        meta={
          movements.phase === 'ready' ? `${movements.total} movimento(s) no recorte` : undefined
        }
      >
        <WorklistField label="Buscar" htmlFor="inventory-search" grow>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setAppliedTerm(term.trim());
            }}
          >
            <input
              id="inventory-search"
              type="search"
              className={worklistSelectClass}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Código, nome, SKU ou descrição"
            />
            <button type="submit" className="button-secondary">
              Buscar
            </button>
          </form>
        </WorklistField>
        <WorklistField label="Tipo de movimento" htmlFor="movement-type-filter">
          <select
            id="movement-type-filter"
            className={worklistSelectClass}
            value={movementType}
            onChange={(event) => smartList.setFilter('movementType', event.target.value)}
          >
            <option value="">Todos</option>
            <option value="IN">Entrada</option>
            <option value="OUT">Saída</option>
            <option value="TRANSFER">Transferência</option>
            <option value="ADJUSTMENT">Ajuste</option>
          </select>
        </WorklistField>
        <WorklistClearFilters
          visible={movementType !== ''}
          label="Limpar tipo"
          onClick={() => smartList.setFilter('movementType', '')}
        />
      </WorklistFilterBar>

      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Depósitos">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>Depósito</th>
              <th scope="col" className={worklistHeadCellClass}>Código</th>
              <th scope="col" className={worklistHeadCellClass}>Unidade</th>
              <th scope="col" className={worklistHeadCellClass}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {warehouses.phase === 'ready' && warehouses.items.length === 0 ? (
              <ListMessageRow colSpan={4}>Nenhum depósito encontrado.</ListMessageRow>
            ) : null}
            {warehouses.phase === 'denied' ? (
              <ListMessageRow colSpan={4}>
                Você não tem permissão para listar depósitos.
              </ListMessageRow>
            ) : null}
            {warehouses.phase === 'ready'
              ? warehouses.items.map((warehouse) => (
                  <tr key={warehouse.id} className={worklistRowClass}>
                    <td className={worklistCellClass}>
                      <ModuleTableLink to={`/app/inventory/warehouses/${warehouse.id}`}>
                        {warehouse.name}
                      </ModuleTableLink>
                    </td>
                    <td className={`${worklistCellClass} font-mono tabular-nums text-gray-600`}>
                      {warehouse.code}
                    </td>
                    <td className={worklistCellClass}>
                      <UnitScopeLabel unitId={warehouse.unitId} />
                    </td>
                    <td className={worklistCellClass}>
                      <FinanceStatusBadge status={warehouse.status} labels={WAREHOUSE_STATUS_LABELS} />
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
      <p className="mb-6 mt-2 text-xs text-gray-500" role="status">
        {warehouses.phase === 'ready' ? `${warehouses.total} depósito(s) no total.` : 'Carregando depósitos…'}
      </p>

      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Itens de estoque">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>Item</th>
              <th scope="col" className={worklistHeadCellClass}>SKU</th>
              <th scope="col" className={worklistHeadCellClass}>Unidade</th>
              <th scope="col" className={worklistHeadCellClass}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.phase === 'ready' && items.items.length === 0 ? (
              <ListMessageRow colSpan={4}>Nenhum item de estoque encontrado.</ListMessageRow>
            ) : null}
            {items.phase === 'denied' ? (
              <ListMessageRow colSpan={4}>Você não tem permissão para listar itens.</ListMessageRow>
            ) : null}
            {items.phase === 'ready'
              ? items.items.map((item) => (
                  <tr key={item.id} className={worklistRowClass}>
                    <td className={worklistCellClass}>
                      <ModuleTableLink to={`/app/inventory/items/${item.id}`}>{item.name}</ModuleTableLink>
                    </td>
                    <td className={`${worklistCellClass} font-mono tabular-nums text-gray-600`}>
                      {item.sku}
                    </td>
                    <td className={worklistCellClass}>
                      <UnitScopeLabel unitId={item.unitId} />
                    </td>
                    <td className={worklistCellClass}>
                      <FinanceStatusBadge status={item.status} labels={INVENTORY_ITEM_STATUS_LABELS} />
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
      <p className="mb-6 mt-2 text-xs text-gray-500" role="status">
        {items.phase === 'ready' ? `${items.total} item(ns) no total.` : 'Carregando itens…'}
      </p>

      <SavedViewsBar
        views={smartList.savedViews.views}
        builtInViews={smartList.savedViews.builtInViews}
        activeViewId={smartList.activeViewId}
        onApply={(view) => smartList.applyView(view)}
        onSave={smartList.savedViews.saveView}
        onRename={smartList.savedViews.renameView}
        onRemove={smartList.savedViews.removeView}
        currentConfig={smartList.currentConfig}
        canSave={movementType !== ''}
        allLabel="Todos"
        className="mb-4"
      />

      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Movimentos de estoque">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>Data</th>
              <th scope="col" className={worklistHeadCellClass}>Item</th>
              <th scope="col" className={worklistHeadCellClass}>Depósito</th>
              <th scope="col" className={worklistHeadCellClass}>Tipo</th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>Quantidade</th>
              <th scope="col" className={worklistHeadCellClass}>Descrição</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {movements.phase === 'ready' && movements.items.length === 0 ? (
              <ListMessageRow colSpan={6}>
                {movementType
                  ? 'Nenhum movimento para o tipo selecionado. Limpe o filtro para ver todos.'
                  : 'Nenhum movimento encontrado.'}
              </ListMessageRow>
            ) : null}
            {movements.phase === 'denied' ? (
              <ListMessageRow colSpan={6}>Você não tem permissão para listar movimentos.</ListMessageRow>
            ) : null}
            {movements.phase === 'ready'
              ? movements.items.map((movement) => (
                  <tr key={movement.id} className={worklistRowClass}>
                    <td className={worklistCellClass}>{movement.occurredOn}</td>
                    <td className={worklistCellClass}>
                      {movement.itemName ?? 'Item não identificado'}
                      {movement.itemSku ? (
                        <span className="block text-xs text-gray-500">{movement.itemSku}</span>
                      ) : null}
                    </td>
                    <td className={worklistCellClass}>
                      {movement.warehouseName ?? 'Depósito não identificado'}
                      {movement.warehouseCode ? (
                        <span className="block text-xs text-gray-500">{movement.warehouseCode}</span>
                      ) : null}
                    </td>
                    <td className={worklistCellClass}>
                      {humanLabel(movement.movementType, MOVEMENT_TYPE_LABELS)}
                    </td>
                    <td className={`${worklistCellClass} text-right`}>{movement.signedQuantity}</td>
                    <td className={worklistCellClass}>{movement.description}</td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
      <p className="mb-6 mt-2 text-xs text-gray-500" role="status">
        {movements.phase === 'ready'
          ? `${movements.total} movimento(s) no total.`
          : 'Carregando movimentos…'}
      </p>

      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Reservas de estoque">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>Item</th>
              <th scope="col" className={worklistHeadCellClass}>Depósito</th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>Quantidade</th>
              <th scope="col" className={worklistHeadCellClass}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {reservations.phase === 'ready' && reservations.items.length === 0 ? (
              <ListMessageRow colSpan={4}>Nenhuma reserva encontrada.</ListMessageRow>
            ) : null}
            {reservations.phase === 'denied' ? (
              <ListMessageRow colSpan={4}>Você não tem permissão para listar reservas.</ListMessageRow>
            ) : null}
            {reservations.phase === 'ready'
              ? reservations.items.map((reservation) => (
                  <tr key={reservation.id} className={worklistRowClass}>
                    <td className={worklistCellClass}>
                      {reservation.itemName ?? 'Item não identificado'}
                      {reservation.itemSku ? (
                        <span className="block text-xs text-gray-500">{reservation.itemSku}</span>
                      ) : null}
                    </td>
                    <td className={worklistCellClass}>
                      {reservation.warehouseName ?? 'Depósito não identificado'}
                      {reservation.warehouseCode ? (
                        <span className="block text-xs text-gray-500">{reservation.warehouseCode}</span>
                      ) : null}
                    </td>
                    <td className={`${worklistCellClass} text-right`}>{reservation.quantity}</td>
                    <td className={worklistCellClass}>
                      <FinanceStatusBadge
                        status={reservation.status}
                        labels={RESERVATION_STATUS_LABELS}
                      />
                    </td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
      <p className="mb-8 mt-2 text-xs text-gray-500" role="status">
        {reservations.phase === 'ready'
          ? `${reservations.total} reserva(s) no total.`
          : 'Carregando reservas…'}
      </p>

      <CatalogForms />
      <CostingRuleForm />

      <p className="mt-6 text-sm text-gray-500">
        Movimentar, reservar e estornar ficam no detalhe do item, onde depósito e item são
        escolhidos nas listas — não digitados.
      </p>
    </ModulePage>
  );
}

/** Cadastro de depósito e item: a unidade é a âncora de escopo informada uma vez, no cadastro. */
function CatalogForms() {
  const [unitId, setUnitId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [itemName, setItemName] = useState('');
  const [created, setCreated] = useState<string | null>(null);

  return (
    <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
      <CreateRecordForm
        title="Criar depósito"
        description="A unidade é a âncora de escopo do depósito; código e nome são validados pela API."
        submitLabel="Criar depósito"
        mapError={mapInventoryErrorToMessage}
        onSubmit={async () => {
          const warehouse = await createWarehouse({
            unitId: unitId.trim(),
            code: code.trim(),
            name: name.trim(),
          });
          setCreated(`Depósito ${warehouse.code} criado.`);
        }}
      >
        <Field label="Unidade" htmlFor="wh-unit" required>
          <Input id="wh-unit" value={unitId} onChange={(event) => setUnitId(event.target.value)} required />
        </Field>
        <Field label="Código" htmlFor="wh-code" required>
          <Input id="wh-code" value={code} onChange={(event) => setCode(event.target.value)} required />
        </Field>
        <Field label="Nome" htmlFor="wh-name" required className="md:col-span-2">
          <Input id="wh-name" value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
      </CreateRecordForm>
      <CreateRecordForm
        title="Criar item"
        description="SKU e nome são validados pela API. O método de custeio permanece indeciso."
        submitLabel="Criar item"
        mapError={mapInventoryErrorToMessage}
        onSubmit={async () => {
          const item = await createInventoryItem({
            unitId: unitId.trim(),
            sku: sku.trim(),
            name: itemName.trim(),
          });
          setCreated(`Item ${item.sku} criado.`);
        }}
      >
        <Field label="SKU" htmlFor="item-sku" required>
          <Input id="item-sku" value={sku} onChange={(event) => setSku(event.target.value)} required />
        </Field>
        <Field label="Nome do item" htmlFor="item-name" required className="md:col-span-2">
          <Input id="item-name" value={itemName} onChange={(event) => setItemName(event.target.value)} required />
        </Field>
      </CreateRecordForm>
      {created ? (
        <p className="text-sm text-gray-600 md:col-span-2" role="status">
          {created}
        </p>
      ) : null}
    </div>
  );
}

function CostingRuleForm() {
  const [unitId, setUnitId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);

  return (
    <CreateRecordForm
      title="Regra de custeio"
      description="FIFO/média permanecem indecisos. O servidor só aceita método UNDECIDED."
      submitLabel="Criar regra"
      mapError={mapInventoryErrorToMessage}
      onSubmit={async () => {
        const rule = await createCostingRule({
          unitId: unitId.trim(),
          code: code.trim(),
          name: name.trim(),
        });
        setNote(`Regra ${rule.code} criada.`);
      }}
    >
      <Field label="Unidade" htmlFor="cost-unit" required>
        <Input id="cost-unit" value={unitId} onChange={(event) => setUnitId(event.target.value)} required />
      </Field>
      <Field label="Código" htmlFor="cost-code" required>
        <Input id="cost-code" value={code} onChange={(event) => setCode(event.target.value)} required />
      </Field>
      <Field label="Nome" htmlFor="cost-name" required className="md:col-span-2">
        <Input id="cost-name" value={name} onChange={(event) => setName(event.target.value)} required />
      </Field>
      {note ? (
        <p className="text-sm text-gray-600 md:col-span-2" role="status">
          {note}
        </p>
      ) : null}
    </CreateRecordForm>
  );
}

/** Depósito escolhido a partir da lista: o valor é o identificador, nunca o texto digitado. */
function WarehouseSelect({
  warehouses,
  value,
  onChange,
  label,
  htmlFor,
  required,
}: {
  warehouses: Warehouse[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  htmlFor: string;
  required?: boolean;
}) {
  return (
    <Field label={label} htmlFor={htmlFor} required={required}>
      <Select id={htmlFor} value={value} onChange={(event) => onChange(event.target.value)} required={required}>
        <option value="">Selecione o depósito</option>
        {warehouses.map((warehouse) => (
          <option key={warehouse.id} value={warehouse.id}>
            {warehouse.name} — {warehouse.code}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function InventoryItemDetailPage() {
  const { itemId = '' } = useParams();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [movementType, setMovementType] = useState<StockMovementType>('IN');
  const [adjustmentEffect, setAdjustmentEffect] = useState('INCREASE');
  const [quantity, setQuantity] = useState('');
  const [occurredOn, setOccurredOn] = useState('');
  const [description, setDescription] = useState('');
  const [movements, setMovements] = useState<ListPhase<StockMovementSummary>>({ phase: 'loading' });
  const [notes, setNotes] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void listWarehouses({ limit: 100, offset: 0 }, controller.signal).then(
      (response) => setWarehouses(response.items),
      () => setWarehouses([]),
    );
    return () => controller.abort();
  }, []);

  const loadMovements = useCallback(
    async (signal?: AbortSignal) => {
      setMovements({ phase: 'loading' });
      try {
        const response = await listStockMovements(
          { limit: PAGE_SIZE, offset: 0, inventoryItemId: itemId },
          signal,
        );
        setMovements({ phase: 'ready', items: response.items, total: response.total });
      } catch {
        setMovements({ phase: 'denied' });
      }
    },
    [itemId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadMovements(controller.signal);
    return () => controller.abort();
  }, [loadMovements]);

  const selectedWarehouse = useMemo(
    () => warehouses.find((warehouse) => warehouse.id === warehouseId) ?? null,
    [warehouses, warehouseId],
  );

  const balanceLoader = useCallback(
    (signal?: AbortSignal) => getStockBalance(warehouseId, itemId, signal),
    [itemId, warehouseId],
  );
  const balance = useBackofficeQuery({
    loader: balanceLoader,
    mapError: mapInventoryErrorToMessage,
    enabled: Boolean(warehouseId && itemId),
    autoLoad: Boolean(warehouseId && itemId),
  });
  const reconcileQuantity = useBackofficeQuery({
    loader: useCallback(
      (signal?: AbortSignal) => reconcileStockQuantity(warehouseId, itemId, signal),
      [itemId, warehouseId],
    ),
    mapError: mapInventoryErrorToMessage,
    enabled: Boolean(warehouseId && itemId),
    autoLoad: Boolean(warehouseId && itemId),
  });
  const reconcileCost = useBackofficeQuery({
    loader: useCallback(
      (signal?: AbortSignal) => reconcileInventoryCost(warehouseId, itemId, signal),
      [itemId, warehouseId],
    ),
    mapError: mapInventoryErrorToMessage,
    enabled: Boolean(warehouseId && itemId),
    autoLoad: Boolean(warehouseId && itemId),
  });

  const movementQuantity = Number(quantity);
  const quantityValid = quantity.trim() !== '' && Number.isFinite(movementQuantity) && movementQuantity > 0;
  const destinationRequired = movementType === 'TRANSFER';
  const movementReady =
    quantityValid &&
    Boolean(warehouseId && occurredOn.trim() && description.trim()) &&
    (!destinationRequired || Boolean(destinationWarehouseId && destinationWarehouseId !== warehouseId));

  return (
    <ModulePage>
      {/*
        FLOORPLAN DE OBJETO — o detalhe do item é OBJECT PAGE, não worklist. `WorklistHeader`
        pertence às listas; aqui cabe a moldura de detalhe (`ModulePageHeader`), que continua
        sendo a gramática real desta superfície até a migração própria para
        EnterpriseObjectPage/EnterpriseObjectHeader.
      */}
      <ModulePageHeader
        title="Item de estoque"
        description="Saldo, movimentos e reservas do item. O identificador técnico permanece interno."
        action={
          <Link className="text-sm font-semibold text-gray-700 hover:text-gray-900" to="/app/inventory">
            Voltar para o estoque
          </Link>
        }
      />

      <FilterCard>
        <WarehouseSelect
          warehouses={warehouses}
          value={warehouseId}
          onChange={setWarehouseId}
          label="Depósito"
          htmlFor="item-warehouse"
        />
      </FilterCard>

      {warehouseId ? (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
          <DefinitionList
            items={[
              {
                label: 'Depósito',
                value: selectedWarehouse
                  ? `${selectedWarehouse.name} — ${selectedWarehouse.code}`
                  : 'Depósito selecionado',
              },
              { label: 'Em mãos', value: balance.state.phase === 'ready' ? balance.state.data.onHand : '—' },
              { label: 'Reservado', value: balance.state.phase === 'ready' ? balance.state.data.reserved : '—' },
              { label: 'Disponível', value: balance.state.phase === 'ready' ? balance.state.data.available : '—' },
            ]}
          />
          {balance.state.phase === 'ready' && reconcileQuantity.state.phase === 'ready' ? (
            <p className="mt-4 text-sm text-gray-600">
              Conciliação de quantidade informada pelo servidor:{' '}
              {reconcileQuantity.state.data.matches ? 'coincide' : 'não coincide'} (em mãos{' '}
              {reconcileQuantity.state.data.onHand}, derivado {reconcileQuantity.state.data.derivedOnHand}).
            </p>
          ) : null}
          {balance.state.phase === 'ready' && reconcileCost.state.phase === 'ready' ? (
            <p className="mt-2 text-sm text-gray-600">
              Conciliação de custo informada pelo servidor:{' '}
              {reconcileCost.state.data.matches ? 'coincide' : 'não coincide'} (
              {reconcileCost.state.data.movementCount} movimentos).
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CreateRecordForm
          title="Movimentar estoque"
          description="Entrada, saída, transferência e ajuste são validados pelo servidor."
          submitLabel="Lançar movimento"
          disabled={!movementReady}
          mapError={mapInventoryErrorToMessage}
          onSubmit={async (idempotencyKey) => {
            const result = await postStockMovement(
              buildStockMovementPayload({
                unitId: selectedWarehouse?.unitId ?? '',
                warehouseId,
                inventoryItemId: itemId,
                movementType,
                quantity: quantity.trim(),
                occurredOn: occurredOn.trim(),
                description: description.trim(),
                idempotencyKey,
                destinationWarehouseId: destinationWarehouseId || null,
                adjustmentEffect,
              }),
            );
            setNotes((current) => [
              `Movimento lançado (${result.movements.map((movement) => movement.id).join(', ')}).`,
              ...current,
            ]);
            await loadMovements();
          }}
        >
          <Field label="Tipo" htmlFor="move-type" required>
            <Select
              id="move-type"
              value={movementType}
              onChange={(event) => setMovementType(event.target.value as StockMovementType)}
            >
              <option value="IN">Entrada</option>
              <option value="OUT">Saída</option>
              <option value="TRANSFER">Transferência</option>
              <option value="ADJUSTMENT">Ajuste</option>
            </Select>
          </Field>
          {destinationRequired ? (
            <WarehouseSelect
              warehouses={warehouses}
              value={destinationWarehouseId}
              onChange={setDestinationWarehouseId}
              label="Depósito de destino"
              htmlFor="move-destination"
              required
            />
          ) : null}
          {movementType === 'ADJUSTMENT' ? (
            <Field label="Efeito do ajuste" htmlFor="move-effect" required>
              <Select
                id="move-effect"
                value={adjustmentEffect}
                onChange={(event) => setAdjustmentEffect(event.target.value)}
              >
                <option value="INCREASE">Aumentar</option>
                <option value="DECREASE">Diminuir</option>
              </Select>
            </Field>
          ) : null}
          <Field label="Quantidade" htmlFor="move-qty" required>
            <Input
              id="move-qty"
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
            />
          </Field>
          <Field label="Data" htmlFor="move-on" required>
            <Input
              id="move-on"
              type="date"
              value={occurredOn}
              onChange={(event) => setOccurredOn(event.target.value)}
              required
            />
          </Field>
          <Field label="Descrição" htmlFor="move-desc" required className="md:col-span-2">
            <Input
              id="move-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              required
            />
          </Field>
          {!warehouseId ? (
            <p className="text-sm text-gray-600 md:col-span-2" role="status">
              Selecione o depósito para movimentar este item.
            </p>
          ) : null}
          {destinationRequired && destinationWarehouseId === warehouseId && warehouseId !== '' ? (
            <p className="text-sm text-red-700 md:col-span-2" role="alert">
              O depósito de destino deve ser distinto do depósito de origem.
            </p>
          ) : null}
        </CreateRecordForm>

        <CreateRecordForm
          title="Reservar"
          description="A reserva reduz disponibilidade no servidor."
          submitLabel="Reservar"
          disabled={!warehouseId || !quantityValid}
          mapError={mapInventoryErrorToMessage}
          onSubmit={async (idempotencyKey) => {
            const reservation = await reserveStock({
              unitId: selectedWarehouse?.unitId ?? '',
              warehouseId,
              inventoryItemId: itemId,
              quantity: quantity.trim(),
              idempotencyKey,
            });
            setNotes((current) => [
              `Reserva ${reservation.id} criada (quantidade ${reservation.quantity}).`,
              ...current,
            ]);
          }}
        >
          <p className="text-sm text-gray-600 md:col-span-2">
            Usa a quantidade informada no formulário de movimentação e o depósito selecionado.
          </p>
        </CreateRecordForm>
      </div>

      {notes.map((note) => (
        <p key={note} className="mb-2 text-sm text-gray-600" role="status">
          {note}
        </p>
      ))}

      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Movimentos do item">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>Data</th>
              <th scope="col" className={worklistHeadCellClass}>Depósito</th>
              <th scope="col" className={worklistHeadCellClass}>Tipo</th>
              <th scope="col" className={worklistHeadCellClass}>Status</th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>Quantidade</th>
              <th scope="col" className={worklistHeadCellClass}>Custo</th>
              <th scope="col" className={worklistHeadCellClass}>Descrição</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {movements.phase === 'ready' && movements.items.length === 0 ? (
              <ListMessageRow colSpan={7}>Nenhum movimento para este item.</ListMessageRow>
            ) : null}
            {movements.phase === 'denied' ? (
              <ListMessageRow colSpan={7}>
                Você não tem permissão para ver os movimentos deste item.
              </ListMessageRow>
            ) : null}
            {movements.phase === 'ready'
              ? movements.items.map((movement) => (
                  <tr key={movement.id} className={worklistRowClass}>
                    <td className={worklistCellClass}>{movement.occurredOn}</td>
                    <td className={worklistCellClass}>
                      {movement.warehouseName ?? 'Depósito não identificado'}
                      {movement.warehouseCode ? (
                        <span className="block text-xs text-gray-500">{movement.warehouseCode}</span>
                      ) : null}
                    </td>
                    <td className={worklistCellClass}>
                      {humanLabel(movement.movementType, MOVEMENT_TYPE_LABELS)}
                    </td>
                    <td className={worklistCellClass}>
                      {humanLabel(movement.status, MOVEMENT_STATUS_LABELS)}
                    </td>
                    <td className={`${worklistCellClass} text-right`}>{movement.signedQuantity}</td>
                    <td className={worklistCellClass}>
                      {movement.totalCost ? <Money value={movement.totalCost} /> : '—'}
                    </td>
                    <td className={worklistCellClass}>{movement.description}</td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>

      <ReverseMovementForm
        movements={movements.phase === 'ready' ? movements.items : []}
        unitId={selectedWarehouse?.unitId ?? ''}
        onReversed={() => void loadMovements()}
      />
    </ModulePage>
  );
}

/**
 * Estorno a partir do próprio movimento: a chave do comando original vem da linha, não de um campo
 * digitado. A chave de estorno é derivada no cliente (idempotência do comando, não regra de negócio).
 */
function ReverseMovementForm({
  movements,
  unitId,
  onReversed,
}: {
  movements: StockMovementSummary[];
  unitId: string;
  onReversed: () => void;
}) {
  const [commandKey, setCommandKey] = useState('');
  const [reversalKey, setReversalKey] = useState('');
  const [note, setNote] = useState<string | null>(null);

  return (
    <CreateRecordForm
      title="Estornar movimento"
      description="A chave do comando original é preenchida pelo movimento escolhido na lista acima."
      submitLabel="Estornar"
      disabled={!commandKey || !reversalKey}
      mapError={mapInventoryErrorToMessage}
      onSubmit={async () => {
        await reverseStockMovement({
          unitId,
          commandIdempotencyKey: commandKey.trim(),
          reversalKey: reversalKey.trim(),
        });
        setNote('Estorno solicitado ao servidor.');
        setCommandKey('');
        setReversalKey('');
        onReversed();
      }}
    >
      <Field label="Movimento a estornar" htmlFor="reverse-movement" required className="md:col-span-2">
        <Select
          id="reverse-movement"
          value={commandKey}
          onChange={(event) => {
            setCommandKey(event.target.value);
            setReversalKey(event.target.value ? `REV-${event.target.value}` : '');
          }}
          required
        >
          <option value="">Selecione o movimento</option>
          {movements.map((movement) => (
            <option key={movement.id} value={movement.commandIdempotencyKey}>
              {movement.occurredOn} — {movement.movementType} {movement.signedQuantity} (
              {movement.description})
            </option>
          ))}
        </Select>
      </Field>
      {note ? (
        <p className="text-sm text-gray-600 md:col-span-2" role="status">
          {note}
        </p>
      ) : null}
    </CreateRecordForm>
  );
}

export function InventoryWarehouseDetailPage() {
  const { warehouseId = '' } = useParams();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemId, setItemId] = useState('');
  const [movements, setMovements] = useState<ListPhase<StockMovementSummary>>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void listWarehouses({ limit: 100, offset: 0 }, controller.signal).then(
      (response) => setWarehouses(response.items),
      () => setWarehouses([]),
    );
    void listInventoryItems({ limit: 100, offset: 0 }, controller.signal).then(
      (response) => setItems(response.items),
      () => setItems([]),
    );
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setMovements({ phase: 'loading' });
    void listStockMovements({ limit: PAGE_SIZE, offset: 0, warehouseId }, controller.signal).then(
      (response) => setMovements({ phase: 'ready', items: response.items, total: response.total }),
      () => setMovements({ phase: 'denied' }),
    );
    return () => controller.abort();
  }, [warehouseId]);

  const warehouse = warehouses.find((candidate) => candidate.id === warehouseId) ?? null;
  const balance = useBackofficeQuery({
    loader: useCallback(
      (signal?: AbortSignal) => getStockBalance(warehouseId, itemId, signal),
      [itemId, warehouseId],
    ),
    mapError: mapInventoryErrorToMessage,
    enabled: Boolean(warehouseId && itemId),
    autoLoad: Boolean(warehouseId && itemId),
  });
  const gate = itemId
    ? renderQueryGate(
        'Saldo',
        'Carregando saldo…',
        'Você não tem permissão para consultar o saldo deste item.',
        balance.state,
        () => void balance.reload(),
      )
    : null;

  return (
    <ModulePage>
      {/* FLOORPLAN DE OBJETO — detalhe de depósito é OBJECT PAGE, não worklist. */}
      <ModulePageHeader
        title={warehouse ? `${warehouse.name}` : 'Depósito'}
        description="Saldo por item e histórico de movimentos do depósito."
        action={
          <Link className="text-sm font-semibold text-gray-700 hover:text-gray-900" to="/app/inventory">
            Voltar para o estoque
          </Link>
        }
      />

      {warehouse ? (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
          <DefinitionList
            items={[
              { label: 'Código', value: warehouse.code },
              { label: 'Unidade', value: warehouse.unitId },
              {
                label: 'Status',
                value: <FinanceStatusBadge status={warehouse.status} labels={WAREHOUSE_STATUS_LABELS} />,
              },
            ]}
          />
        </div>
      ) : null}

      <CreateRecordForm
        title="Consultar saldo"
        description="Escolha o item no cadastro; o saldo é o persistido pelo servidor."
        submitLabel="Registrar consulta"
        mapError={mapInventoryErrorToMessage}
        onSubmit={async () => {
          await balance.reload();
        }}
      >
        <Field label="Item" htmlFor="warehouse-item" required className="md:col-span-2">
          <Select
            id="warehouse-item"
            value={itemId}
            onChange={(event) => setItemId(event.target.value)}
            required
          >
            <option value="">Selecione o item</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} — {item.sku}
              </option>
            ))}
          </Select>
        </Field>
      </CreateRecordForm>
      {gate}
      {balance.state.phase === 'ready' ? (
        <div className="mb-6 mt-4 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
          <DefinitionList
            items={[
              { label: 'Em mãos', value: balance.state.data.onHand },
              { label: 'Reservado', value: balance.state.data.reserved },
              { label: 'Disponível', value: balance.state.data.available },
            ]}
          />
        </div>
      ) : null}

      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Movimentos do depósito">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>Data</th>
              <th scope="col" className={worklistHeadCellClass}>Item</th>
              <th scope="col" className={worklistHeadCellClass}>Tipo</th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>Quantidade</th>
              <th scope="col" className={worklistHeadCellClass}>Descrição</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {movements.phase === 'ready' && movements.items.length === 0 ? (
              <ListMessageRow colSpan={5}>Nenhum movimento neste depósito.</ListMessageRow>
            ) : null}
            {movements.phase === 'denied' ? (
              <ListMessageRow colSpan={5}>
                Você não tem permissão para ver os movimentos deste depósito.
              </ListMessageRow>
            ) : null}
            {movements.phase === 'ready'
              ? movements.items.map((movement) => (
                  <tr key={movement.id} className={worklistRowClass}>
                    <td className={worklistCellClass}>{movement.occurredOn}</td>
                    <td className={worklistCellClass}>
                      {movement.itemName ?? 'Item não identificado'}
                      {movement.itemSku ? (
                        <span className="block text-xs text-gray-500">{movement.itemSku}</span>
                      ) : null}
                    </td>
                    <td className={worklistCellClass}>
                      {humanLabel(movement.movementType, MOVEMENT_TYPE_LABELS)}
                    </td>
                    <td className={`${worklistCellClass} text-right`}>{movement.signedQuantity}</td>
                    <td className={worklistCellClass}>{movement.description}</td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
      <p className="mb-6 mt-2 text-xs text-gray-500" role="status">
        {movements.phase === 'ready'
          ? `${movements.total} movimento(s) no total.`
          : 'Carregando movimentos…'}
      </p>

      <ReleaseReservationForm onReleased={() => undefined} />

      {!warehouse ? (
        <EmptyState
          title="Depósito não encontrado na lista"
          description="Volte para a lista de depósitos e escolha um depósito carregado pelo servidor."
        />
      ) : null}
    </ModulePage>
  );
}

/** Liberação de reserva a partir da própria reserva do item, sem digitar identificador. */
function ReleaseReservationForm({ onReleased }: { onReleased: () => void }) {
  const [reservations, setReservations] = useState<StockReservationSummary[]>([]);
  const [reservationId, setReservationId] = useState('');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void listStockReservations({ limit: 100, offset: 0, status: 'ACTIVE' }, controller.signal).then(
      (response) => setReservations(response.items),
      () => setReservations([]),
    );
    return () => controller.abort();
  }, []);

  return (
    <CreateRecordForm
      title="Liberar reserva"
      description="A reserva é escolhida entre as ativas do servidor."
      submitLabel="Liberar"
      disabled={!reservationId}
      mapError={mapInventoryErrorToMessage}
      onSubmit={async () => {
        await releaseReservation(reservationId);
        setNote('Reserva liberada.');
        setReservationId('');
        onReleased();
      }}
    >
      <Field label="Reserva" htmlFor="release-reservation" required className="md:col-span-2">
        <Select
          id="release-reservation"
          value={reservationId}
          onChange={(event) => setReservationId(event.target.value)}
          required
        >
          <option value="">Selecione a reserva</option>
          {reservations.map((reservation) => (
            <option key={reservation.id} value={reservation.id}>
              {reservation.itemName ?? 'Item'} — {reservation.quantity} em{' '}
              {reservation.warehouseName ?? 'depósito'}
            </option>
          ))}
        </Select>
      </Field>
      {note ? (
        <p className="text-sm text-gray-600 md:col-span-2" role="status">
          {note}
        </p>
      ) : null}
    </CreateRecordForm>
  );
}
