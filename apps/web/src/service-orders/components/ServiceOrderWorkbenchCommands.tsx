import { useRef, useState, type FormEvent } from 'react';
import { planResource } from '../api/service-order-planning-api';
import {
  recordOperationalCost,
  ServiceOrdersApiError,
  type RecordOperationalCostPayload,
} from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import type { ServiceOrderEnterpriseWorkbench } from '../types/service-order-enterprise-workbench.types';
import { createIdempotencyKey } from '../utils/create-idempotency-key';

type OperationsProps = {
  snapshot: ServiceOrderEnterpriseWorkbench;
  onMutated: (successMessage: string) => Promise<void>;
  onConflict: () => Promise<void>;
};

const COST_CATEGORIES: Array<{ value: RecordOperationalCostPayload['category']; label: string }> = [
  { value: 'FUEL', label: 'Combustível' },
  { value: 'THIRD_PARTY', label: 'Terceiros' },
  { value: 'RESOURCE', label: 'Recurso' },
  { value: 'TRAVEL', label: 'Viagem' },
  { value: 'MATERIAL', label: 'Material' },
  { value: 'LABOR', label: 'Mão de obra' },
  { value: 'OTHER', label: 'Outro' },
];

function commandError(error: unknown): string {
  if (error instanceof ServiceOrdersApiError) {
    return mapServiceOrdersErrorToMessage(error.code, error.status);
  }
  return 'Não foi possível concluir o comando. Nenhum sucesso foi presumido.';
}

function isConflict(error: unknown): boolean {
  return error instanceof ServiceOrdersApiError &&
    (error.status === 409 || error.kind === 'version_conflict');
}

/**
 * Planning command inside the business workbench. The user selects a requirement
 * from the persisted SERVICE snapshot, never enters a technical type code or UUID.
 * Backend validates eligibility, operational window and the object-specific grant.
 */
export function WorkbenchResourcePlanForm({ snapshot, onMutated, onConflict }: OperationsProps) {
  const order = snapshot.serviceOrder;
  const requirements = order.serviceSnapshot?.requirements;
  const options = [
    ...(requirements?.resources ?? []).map((item) => ({
      kind: 'PHYSICAL_RESOURCE' as const,
      code: item.physicalResourceTypeCode,
      label: 'Recurso físico · ' + item.physicalResourceTypeCode,
    })),
    ...(requirements?.labor ?? []).map((item) => ({
      kind: 'LABOR' as const,
      code: item.laborTypeCode,
      label: 'Mão de obra · ' + item.laborTypeCode,
    })),
  ].filter((item) => Boolean(item.code));
  const [selected, setSelected] = useState('');
  const [quantity, setQuantity] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!snapshot.actions.canPlanResource || snapshot.plannedResources.state !== 'ready') return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const requirement = options[Number(selected)];
    const validQuantity = /^\d+(?:[.,]\d{1,4})?$/.test(quantity.trim()) && Number(quantity.replace(',', '.')) > 0;
    if (!requirement || !validQuantity) {
      setError('Selecione um requisito do serviço e informe a quantidade planejada positiva.');
      return;
    }
    if (Boolean(start) !== Boolean(end) || (start && end && new Date(start) >= new Date(end))) {
      setError('Informe início e fim válidos para a janela operacional, ou deixe ambos vazios.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await planResource(order.id, {
        requirementKind: requirement.kind,
        ...(requirement.kind === 'PHYSICAL_RESOURCE'
          ? { resourceTypeCode: requirement.code }
          : { laborTypeCode: requirement.code }),
        plannedQuantity: quantity.replace(',', '.'),
        ...(start && end ? {
          operationalStart: new Date(start).toISOString(),
          operationalEnd: new Date(end).toISOString(),
        } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setSelected('');
      setQuantity('');
      setStart('');
      setEnd('');
      setNotes('');
      await onMutated('Recurso planejado e registrado com auditoria no servidor.');
    } catch (reason) {
      if (isConflict(reason)) {
        await onConflict();
      } else {
        setError(commandError(reason));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Criar plano de recurso" className="border-t border-gray-200 pt-4">
      <h3 className="m-0 text-sm font-semibold">Registrar recurso planejado</h3>
      <p className="mb-3 text-xs text-gray-600">O backend valida requisitos, capacidade, janela, estado e permissão. Planejar não equivale a alocar.</p>
      <form onSubmit={(event) => void submit(event)} className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-gray-700">
          Requisito do serviço
          <select value={selected} onChange={(event) => setSelected(event.target.value)}
            required className="mt-1 w-full rounded border border-gray-300 bg-white p-2 text-sm">
            <option value="">Selecionar requisito</option>
            {options.map((item, index) => <option key={item.kind + ':' + item.code + ':' + index} value={String(index)}>{item.label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-gray-700">
          Quantidade planejada
          <input required inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)}
            placeholder="Ex.: 2" className="mt-1 w-full rounded border border-gray-300 bg-white p-2 text-sm" />
        </label>
        <label className="block text-xs font-semibold text-gray-700">
          Início operacional (quando aplicável)
          <input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)}
            className="mt-1 w-full rounded border border-gray-300 bg-white p-2 text-sm" />
        </label>
        <label className="block text-xs font-semibold text-gray-700">
          Fim operacional (quando aplicável)
          <input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)}
            className="mt-1 w-full rounded border border-gray-300 bg-white p-2 text-sm" />
        </label>
        <label className="block text-xs font-semibold text-gray-700 sm:col-span-2">
          Observação operacional
          <input value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)}
            className="mt-1 w-full rounded border border-gray-300 bg-white p-2 text-sm" />
        </label>
        <div className="sm:col-span-2">
          {error ? <p role="alert" className="mb-2 text-sm text-red-700">{error}</p> : null}
          <button type="submit" disabled={busy || options.length === 0}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Registrando plano…' : 'Salvar recurso planejado'}
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * Operational cost mutation: category, kind, amount and currency are entered
 * by the operator, never inferred from quantities or a measured subtotal.
 * SOURCE=SERVICE_ORDER: execution-linked actuals remain on their own domain screen.
 * An idempotency key persists across retries until fields change or success is confirmed.
 */
export function WorkbenchCostRecordForm({ snapshot, onMutated, onConflict }: OperationsProps) {
  const order = snapshot.serviceOrder;
  const { canRecordActualCost, canRecordEstimatedCost } = snapshot.actions;
  const [selectedKind, setSelectedKind] = useState<'ACTUAL' | 'ESTIMATED'>('ESTIMATED');
  const [category, setCategory] = useState<RecordOperationalCostPayload['category']>('RESOURCE');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('BRL');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  const kind = selectedKind === 'ACTUAL' && canRecordActualCost
    ? 'ACTUAL' : canRecordEstimatedCost ? 'ESTIMATED' : 'ACTUAL';

  if ((!canRecordActualCost && !canRecordEstimatedCost) || snapshot.costs.state !== 'ready') return null;

  function resetRetry() { idempotencyKey.current = null; }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const normalizedAmount = amount.trim().replace(',', '.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalizedAmount) || Number(normalizedAmount) <= 0) {
      setError('Informe um valor monetário positivo com até duas casas decimais.');
      return;
    }
    if (!/^[A-Z]{3}$/.test(currency.trim().toUpperCase())) {
      setError('Informe uma moeda ISO de três letras, como BRL.');
      return;
    }
    if (description.trim().length < 3) {
      setError('Descreva a origem econômica real deste custo para a auditoria.');
      return;
    }
    setBusy(true);
    setError(null);
    if (!idempotencyKey.current) idempotencyKey.current = createIdempotencyKey();
    try {
      await recordOperationalCost(order.id, {
        origin: 'SERVICE_ORDER',
        category,
        costKind: kind,
        amount: normalizedAmount,
        currencyCode: currency.toUpperCase(),
        description: description.trim(),
        rowVersion: order.rowVersion,
        idempotencyKey: idempotencyKey.current,
      });
      resetRetry();
      setAmount('');
      setDescription('');
      await onMutated('Custo operacional registrado e posição econômica reconsultada.');
    } catch (reason) {
      if (isConflict(reason)) {
        await onConflict();
      } else {
        setError(commandError(reason));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Registrar custo operacional" className="border-t border-gray-200 pt-4">
      <h3 className="m-0 text-sm font-semibold">Registrar custo com origem e auditoria</h3>
      <p className="mb-3 text-xs text-gray-600">Registro monetário autoritativo por versão e chave idempotente; não substitui consumo, apontamento ou documento fiscal.</p>
      <form onSubmit={(event) => void submit(event)} className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-gray-700">
          Natureza do custo
          <select value={kind} onChange={(event) => { setSelectedKind(event.target.value as 'ACTUAL' | 'ESTIMATED'); resetRetry(); }}
            className="mt-1 w-full rounded border border-gray-300 bg-white p-2 text-sm">
            {canRecordEstimatedCost ? <option value="ESTIMATED">Estimado</option> : null}
            {canRecordActualCost ? <option value="ACTUAL">Realizado</option> : null}
          </select>
        </label>
        <label className="block text-xs font-semibold text-gray-700">
          Categoria
          <select value={category} onChange={(event) => { setCategory(event.target.value as RecordOperationalCostPayload['category']); resetRetry(); }}
            className="mt-1 w-full rounded border border-gray-300 bg-white p-2 text-sm">
            {COST_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-gray-700">
          Valor monetário
          <input required inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); resetRetry(); }}
            placeholder="Ex.: 1250,00" className="mt-1 w-full rounded border border-gray-300 bg-white p-2 text-sm" />
        </label>
        <label className="block text-xs font-semibold text-gray-700">
          Moeda ISO
          <input required maxLength={3} value={currency} onChange={(event) => { setCurrency(event.target.value.toUpperCase()); resetRetry(); }}
            className="mt-1 w-full rounded border border-gray-300 bg-white p-2 text-sm" />
        </label>
        <label className="block text-xs font-semibold text-gray-700 sm:col-span-2">
          Descrição e origem do lançamento
          <textarea required minLength={3} rows={2} value={description}
            onChange={(event) => { setDescription(event.target.value); resetRetry(); }}
            className="mt-1 w-full rounded border border-gray-300 bg-white p-2 text-sm" />
        </label>
        <div className="sm:col-span-2">
          {error ? <p role="alert" className="mb-2 text-sm text-red-700">{error}</p> : null}
          <button disabled={busy} type="submit" className="rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Registrando custo…' : 'Registrar custo no livro operacional'}
          </button>
        </div>
      </form>
    </section>
  );
}
