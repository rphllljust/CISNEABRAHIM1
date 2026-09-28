import { Link } from 'react-router-dom';
import { useCallback, useId, useRef, useState, type FormEvent } from 'react';
import { HumanLookupField, type HumanLookupOption } from '../../financial-ui/HumanLookupField';
import { searchClientOptions } from '../../financial-ui/client-lookup';
import {
  BuilderSection,
  BuilderSummary,
  Button,
  CollectionEditor,
  CurrencyField,
  Field,
  Input,
  Select,
  StickyActionBar,
} from '../../ui';
import { PURCHASE_ORDER_PRICING_STRUCTURES } from '../types/purchase-order.types';
import {
  formatDate,
  formatMoney,
  formatPurchaseOrderPricingStructure,
} from '../utils/purchase-order-labels';
import {
  createPurchaseOrderItemRow,
  validatePurchaseOrderForm,
  type PurchaseOrderFormFieldErrors,
  type PurchaseOrderFormValues,
} from '../utils/purchase-order-form-validation';

type ClientOption = {
  id: string;
  label: string;
};

type PurchaseOrderFormProps = {
  mode: 'create' | 'edit';
  values: PurchaseOrderFormValues;
  clients: ClientOption[];
  clientsLoading: boolean;
  fieldErrors: PurchaseOrderFormFieldErrors;
  submitError: string | null;
  submitting: boolean;
  onChange: (values: PurchaseOrderFormValues) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  cancelHref: string;
};

const FIELD_GRID = 'grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3';

/** Explica, em linguagem de negocio, o que ainda impede o registro. */
function describePending(errors: PurchaseOrderFormFieldErrors): string | null {
  const pending: string[] = [];
  if (errors.clientId) {
    pending.push('cliente');
  }
  if (errors.unitId) {
    pending.push('unidade operacional');
  }
  if (errors.poNumber) {
    pending.push('número do pedido');
  }
  if (errors.totalAmount) {
    pending.push('valor total autorizado');
  }
  if (errors.itemsRequired) {
    pending.push('ao menos um item');
  }
  if (errors.items) {
    pending.push('descrição e total de cada item');
  }
  return pending.length > 0 ? `Falta preencher: ${pending.join(', ')}.` : null;
}

export function PurchaseOrderForm({
  mode,
  values,
  clients,
  clientsLoading,
  fieldErrors,
  submitError,
  submitting,
  onChange,
  onSubmit,
  cancelHref,
}: PurchaseOrderFormProps) {
  const formErrorId = useId();
  const isLineItems = values.pricingStructure === PURCHASE_ORDER_PRICING_STRUCTURES.LineItems;

  const lastClientOptions = useRef<HumanLookupOption[]>([]);
  const [pickedClient, setPickedClient] = useState<{ id: string; label: string } | null>(null);
  const [invalidMoney, setInvalidMoney] = useState<string[]>([]);

  function updateField<K extends keyof PurchaseOrderFormValues>(
    key: K,
    value: PurchaseOrderFormValues[K],
  ) {
    onChange({ ...values, [key]: value });
  }

  function markMoneyInvalid(key: string, invalid: boolean) {
    setInvalidMoney((current) => {
      if (invalid) {
        return current.includes(key) ? current : [...current, key];
      }
      return current.filter((item) => item !== key);
    });
  }

  function updateItem(index: number, patch: Partial<PurchaseOrderFormValues['items'][number]>) {
    onChange({
      ...values,
      items: values.items.map((current, position) =>
        position === index ? { ...current, ...patch } : current,
      ),
    });
  }

  const searchClients = useCallback(async (term: string, signal?: AbortSignal) => {
    const options = await searchClientOptions(term, signal);
    lastClientOptions.current = options;
    return options;
  }, []);

  /** Nome humano do cliente desta edicao; nunca o identificador tecnico (ausente = omitido). */
  const clientLabel =
    pickedClient && pickedClient.id === values.clientId
      ? pickedClient.label
      : (clients.find((client) => client.id === values.clientId)?.label ?? null);

  const liveErrors = validatePurchaseOrderForm(values);
  const missing = describePending(liveErrors);
  const canSubmit = !submitting && invalidMoney.length === 0 && missing === null;

  const note = submitting
    ? 'Registrando o pedido…'
    : invalidMoney.length > 0
      ? 'Corrija o valor monetário destacado antes de registrar.'
      : missing;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-3"
      aria-describedby={submitError ? formErrorId : undefined}
    >
      <BuilderSummary
        items={[
          { label: 'Cliente', value: clientLabel },
          { label: 'Pedido', value: values.poNumber.trim() || null },
          { label: 'Tipo', value: formatPurchaseOrderPricingStructure(values.pricingStructure) },
          {
            label: isLineItems ? 'Itens' : 'Valor autorizado',
            value: isLineItems
              ? values.items.length
              : values.totalAmount
                ? formatMoney(values.totalAmount, values.currencyCode.trim() || 'BRL')
                : null,
          },
          {
            label: 'Moeda',
            value: values.currencyCode.trim() ? values.currencyCode.trim().toUpperCase() : null,
          },
          {
            label: 'Emissão',
            value: values.issueDate ? formatDate(values.issueDate) : null,
          },
        ]}
      />

      {submitError ? (
        <p id={formErrorId} className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {submitError}
        </p>
      ) : null}

      <BuilderSection
        title="Identificação do pedido"
        description="Cliente, unidade e referências do pedido de compra."
      >
        <div className={FIELD_GRID}>
          {mode === 'create' ? (
            <HumanLookupField
              label="Cliente"
              htmlFor="po-client"
              required
              search={searchClients}
              value={values.clientId}
              initialLabel={clientLabel ?? undefined}
              onChange={(id) => {
                const option = lastClientOptions.current.find((item) => item.id === id);
                setPickedClient(option ? { id, label: option.label } : null);
                updateField('clientId', id);
              }}
              emptyOptionLabel="Selecione o cliente"
              emptyMessage="Nenhum cliente encontrado para a busca."
            />
          ) : (
            <Field
              label="Cliente"
              htmlFor="po-client"
              required
              hint="O cliente é definido na abertura do pedido e não muda no rascunho."
              error={fieldErrors.clientId}
            >
              <Select
                id="po-client"
                value={values.clientId}
                onChange={(event) => updateField('clientId', event.target.value)}
                disabled
              >
                <option value="">{clientsLoading ? 'Carregando…' : 'Selecione o cliente'}</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Unidade operacional" htmlFor="po-unit" required error={fieldErrors.unitId}>
            <Input
              id="po-unit"
              value={values.unitId}
              onChange={(event) => updateField('unitId', event.target.value)}
              disabled={submitting}
              placeholder="Código, ex. UN-POA-01"
              invalid={Boolean(fieldErrors.unitId)}
            />
          </Field>

          <Field
            label="Número do pedido (PO)"
            htmlFor="po-number"
            required
            error={fieldErrors.poNumber}
          >
            <Input
              id="po-number"
              value={values.poNumber}
              onChange={(event) => updateField('poNumber', event.target.value)}
              disabled={submitting}
              invalid={Boolean(fieldErrors.poNumber)}
            />
          </Field>

          <Field label="Número RC" htmlFor="po-rc-number">
            <Input
              id="po-rc-number"
              value={values.rcNumber}
              onChange={(event) => updateField('rcNumber', event.target.value)}
              disabled={submitting}
            />
          </Field>
        </div>
      </BuilderSection>

      <BuilderSection
        title="Emissão e responsável"
        description="Quando o pedido foi emitido e quem acompanha o serviço."
      >
        <div className={FIELD_GRID}>
          <Field label="Data de emissão" htmlFor="po-issue-date">
            <Input
              id="po-issue-date"
              type="date"
              value={values.issueDate}
              onChange={(event) => updateField('issueDate', event.target.value)}
              disabled={submitting}
            />
          </Field>

          <Field label="Gestor de serviço" htmlFor="po-service-manager">
            <Input
              id="po-service-manager"
              value={values.serviceManager}
              onChange={(event) => updateField('serviceManager', event.target.value)}
              disabled={submitting}
            />
          </Field>
        </div>
      </BuilderSection>

      <BuilderSection
        title="Valores e condições"
        description="Como o pedido é precificado e como será pago."
      >
        <div className={FIELD_GRID}>
          <Field label="Estrutura de preço" htmlFor="po-pricing">
            <Select
              id="po-pricing"
              value={values.pricingStructure}
              onChange={(event) =>
                updateField(
                  'pricingStructure',
                  event.target.value as PurchaseOrderFormValues['pricingStructure'],
                )
              }
              disabled={submitting}
            >
              {Object.values(PURCHASE_ORDER_PRICING_STRUCTURES).map((structure) => (
                <option key={structure} value={structure}>
                  {formatPurchaseOrderPricingStructure(structure)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Moeda" htmlFor="po-currency">
            <Input
              id="po-currency"
              value={values.currencyCode}
              onChange={(event) => updateField('currencyCode', event.target.value)}
              maxLength={3}
              disabled={submitting}
            />
          </Field>

          {!isLineItems ? (
            <CurrencyField
              id="po-total-amount"
              label="Valor total autorizado"
              required
              value={values.totalAmount || null}
              currencyCode={values.currencyCode.trim() || 'BRL'}
              error={fieldErrors.totalAmount}
              disabled={submitting}
              onChange={(value) => updateField('totalAmount', value ?? '')}
              onInvalid={(invalid) => markMoneyInvalid('total', invalid)}
            />
          ) : null}

          <Field label="Condições de pagamento" htmlFor="po-payment-terms">
            <Input
              id="po-payment-terms"
              value={values.paymentTerms}
              onChange={(event) => updateField('paymentTerms', event.target.value)}
              disabled={submitting}
            />
          </Field>

          <Field label="Forma de pagamento" htmlFor="po-payment-method">
            <Input
              id="po-payment-method"
              value={values.paymentMethod}
              onChange={(event) => updateField('paymentMethod', event.target.value)}
              disabled={submitting}
            />
          </Field>
        </div>
      </BuilderSection>

      {isLineItems ? (
        <BuilderSection
          title="Itens do pedido"
          description="Linhas que o pedido autoriza, com o total de cada uma."
          footer={
            values.items.length > 0
              ? `${values.items.length} ${values.items.length === 1 ? 'item' : 'itens'} no pedido.`
              : undefined
          }
        >
          <CollectionEditor
            items={values.items}
            getKey={(item) => item.rowId}
            itemTitle={(item, index) => `Item ${index + 1}`}
            itemSubtitle={(item) => item.description.trim() || 'Descrição não informada'}
            emptyMessage="Nenhum item informado. Adicione ao menos um item com o total da linha para registrar o pedido."
            addLabel="+ Adicionar item"
            removeLabel="Remover"
            removeAriaLabel={(item, index) =>
              `Remover item ${index + 1}${
                item.description.trim() ? `: ${item.description.trim()}` : ' do pedido'
              }`
            }
            confirmRemove
            disabled={submitting}
            onAdd={() => updateField('items', [...values.items, createPurchaseOrderItemRow()])}
            onChange={(index, item) => updateItem(index, item)}
            onRemove={(index) =>
              updateField(
                'items',
                values.items.filter((_, position) => position !== index),
              )
            }
            renderItem={(item, index) => (
              <div className="grid gap-x-3 gap-y-2 sm:grid-cols-[2fr_1fr]">
                <Field
                  label="Descrição"
                  htmlFor={`po-item-description-${item.rowId}`}
                  error={liveErrors.items?.[index]?.description}
                >
                  <Input
                    id={`po-item-description-${item.rowId}`}
                    value={item.description}
                    onChange={(event) => updateItem(index, { description: event.target.value })}
                    disabled={submitting}
                    invalid={Boolean(liveErrors.items?.[index]?.description)}
                  />
                </Field>
                <CurrencyField
                  id={`po-item-total-${item.rowId}`}
                  label="Total da linha"
                  required
                  value={item.lineTotal || null}
                  currencyCode={values.currencyCode.trim() || 'BRL'}
                  error={liveErrors.items?.[index]?.lineTotal}
                  disabled={submitting}
                  onChange={(value) => updateItem(index, { lineTotal: value ?? '' })}
                  onInvalid={(invalid) => markMoneyInvalid(item.rowId, invalid)}
                />
              </div>
            )}
          />
        </BuilderSection>
      ) : null}

      <StickyActionBar note={note}>
        <Link to={cancelHref} className="button-link button-secondary">
          Cancelar
        </Link>
        <Button
          type="submit"
          disabled={!canSubmit}
          loading={submitting}
          loadingText="Registrando pedido…"
        >
          {mode === 'create' ? 'Registrar pedido' : 'Salvar alterações'}
        </Button>
      </StickyActionBar>
    </form>
  );
}
