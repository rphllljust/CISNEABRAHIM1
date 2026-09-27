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
  Textarea,
} from '../../ui';
import { PROPOSAL_PRICING_STRUCTURES } from '../types/proposal.types';
import { formatDateTime, formatMoney, formatProposalPricingStructure } from '../utils/proposal-labels';
import {
  createProposalItemRow,
  validateProposalForm,
  type ProposalFormFieldErrors,
  type ProposalFormValues,
} from '../utils/proposal-form-validation';

type ClientOption = {
  id: string;
  label: string;
};

type ProposalFormProps = {
  mode: 'create' | 'edit';
  values: ProposalFormValues;
  clients: ClientOption[];
  clientsLoading: boolean;
  fieldErrors: ProposalFormFieldErrors;
  submitError: string | null;
  submitting: boolean;
  onChange: (values: ProposalFormValues) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  cancelHref: string;
};

const FIELD_GRID = 'grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3';

/** Explica, em linguagem de negocio, o que ainda impede o registro. */
function describePending(errors: ProposalFormFieldErrors): string | null {
  const pending: string[] = [];
  if (errors.clientId) {
    pending.push('cliente');
  }
  if (errors.unitId) {
    pending.push('unidade operacional');
  }
  if (errors.title) {
    pending.push('título');
  }
  if (errors.globalSalePrice) {
    pending.push('preço global de venda');
  }
  if (errors.itemsRequired) {
    pending.push('ao menos um item na composição');
  }
  if (errors.items) {
    pending.push('descrição e valor de cada item');
  }
  return pending.length > 0 ? `Falta preencher: ${pending.join(', ')}.` : null;
}

export function ProposalForm({
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
}: ProposalFormProps) {
  const formErrorId = useId();
  const isItemized = values.pricingStructure === PROPOSAL_PRICING_STRUCTURES.Itemized;

  const lastClientOptions = useRef<HumanLookupOption[]>([]);
  const [pickedClient, setPickedClient] = useState<{ id: string; label: string } | null>(null);
  const [invalidMoney, setInvalidMoney] = useState<string[]>([]);

  function updateField<K extends keyof ProposalFormValues>(
    key: K,
    value: ProposalFormValues[K],
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

  function updateItem(index: number, patch: Partial<ProposalFormValues['items'][number]>) {
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

  const liveErrors = validateProposalForm(values, mode);
  const missing = describePending(liveErrors);
  const canSubmit = !submitting && invalidMoney.length === 0 && missing === null;

  const note = submitting
    ? 'Registrando a proposta…'
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
          { label: 'Tipo', value: formatProposalPricingStructure(values.pricingStructure) },
          {
            label: isItemized ? 'Itens' : 'Preço global',
            value: isItemized
              ? values.items.length
              : values.globalSalePrice
                ? formatMoney(values.globalSalePrice, values.currencyCode.trim() || 'BRL')
                : null,
          },
          {
            label: 'Moeda',
            value: values.currencyCode.trim() ? values.currencyCode.trim().toUpperCase() : null,
          },
          {
            label: 'Validade',
            value: values.validUntil ? formatDateTime(values.validUntil) : null,
          },
        ]}
      />

      {submitError ? (
        <p id={formErrorId} className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {submitError}
        </p>
      ) : null}

      <BuilderSection
        title="Identificação"
        description="Cliente, unidade operacional e título comercial da proposta."
      >
        <div className={FIELD_GRID}>
          {mode === 'create' ? (
            <HumanLookupField
              label="Cliente"
              htmlFor="proposal-client"
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
              htmlFor="proposal-client"
              required
              hint="O cliente é definido na abertura da proposta e não muda nesta versão."
              error={fieldErrors.clientId}
            >
              <Select
                id="proposal-client"
                value={values.clientId}
                onChange={(event) => updateField('clientId', event.target.value)}
                disabled
              >
                <option value="">
                  {clientsLoading ? 'Carregando…' : 'Selecione o cliente'}
                </option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Unidade operacional" htmlFor="proposal-unit" required error={fieldErrors.unitId}>
            <Input
              id="proposal-unit"
              value={values.unitId}
              onChange={(event) => updateField('unitId', event.target.value)}
              disabled={submitting}
              placeholder="Código, ex. UN-POA-01"
              invalid={Boolean(fieldErrors.unitId)}
            />
          </Field>

          <Field label="Título" htmlFor="proposal-title" required error={fieldErrors.title}>
            <Input
              id="proposal-title"
              value={values.title}
              onChange={(event) => updateField('title', event.target.value)}
              disabled={submitting}
              invalid={Boolean(fieldErrors.title)}
            />
          </Field>
        </div>
      </BuilderSection>

      <BuilderSection
        title="Condições comerciais"
        description="Como o valor é apurado, em que moeda e até quando a proposta vale."
      >
        <div className={FIELD_GRID}>
          <Field label="Estrutura de preço" htmlFor="proposal-pricing">
            <Select
              id="proposal-pricing"
              value={values.pricingStructure}
              onChange={(event) =>
                updateField(
                  'pricingStructure',
                  event.target.value as ProposalFormValues['pricingStructure'],
                )
              }
              disabled={submitting}
            >
              {Object.values(PROPOSAL_PRICING_STRUCTURES).map((structure) => (
                <option key={structure} value={structure}>
                  {formatProposalPricingStructure(structure)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Moeda" htmlFor="proposal-currency">
            <Input
              id="proposal-currency"
              value={values.currencyCode}
              onChange={(event) => updateField('currencyCode', event.target.value)}
              maxLength={3}
              disabled={submitting}
            />
          </Field>

          {!isItemized ? (
            <CurrencyField
              id="proposal-global-price"
              label="Preço global de venda"
              required
              value={values.globalSalePrice || null}
              currencyCode={values.currencyCode.trim() || 'BRL'}
              error={fieldErrors.globalSalePrice}
              disabled={submitting}
              onChange={(value) => updateField('globalSalePrice', value ?? '')}
              onInvalid={(invalid) => markMoneyInvalid('global', invalid)}
            />
          ) : null}

          <Field label="Validade" htmlFor="proposal-valid-until">
            <Input
              id="proposal-valid-until"
              type="datetime-local"
              value={values.validUntil}
              onChange={(event) => updateField('validUntil', event.target.value)}
              disabled={submitting}
            />
          </Field>
        </div>
      </BuilderSection>

      {isItemized ? (
        <BuilderSection
          title="Composição"
          description="Linhas que formam o valor de venda da proposta."
          footer={
            values.items.length > 0
              ? `${values.items.length} ${values.items.length === 1 ? 'item' : 'itens'} na composição.`
              : undefined
          }
        >
          <CollectionEditor
            items={values.items}
            getKey={(item) => item.rowId}
            itemTitle={(item, index) => `Item ${index + 1}`}
            itemSubtitle={(item) =>
              item.description.trim() || 'Descrição não informada'
            }
            emptyMessage="Nenhum item informado. Adicione ao menos um item com valor de venda para registrar a proposta."
            addLabel="+ Adicionar item"
            removeLabel="Remover"
            removeAriaLabel={(item, index) =>
              `Remover item ${index + 1}${
                item.description.trim() ? `: ${item.description.trim()}` : ' da composição'
              }`
            }
            confirmRemove
            disabled={submitting}
            onAdd={() => updateField('items', [...values.items, createProposalItemRow()])}
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
                  htmlFor={`proposal-item-description-${item.rowId}`}
                  error={liveErrors.items?.[index]?.description}
                >
                  <Input
                    id={`proposal-item-description-${item.rowId}`}
                    value={item.description}
                    onChange={(event) => updateItem(index, { description: event.target.value })}
                    disabled={submitting}
                    invalid={Boolean(liveErrors.items?.[index]?.description)}
                  />
                </Field>
                <CurrencyField
                  id={`proposal-item-amount-${item.rowId}`}
                  label="Valor de venda"
                  required
                  value={item.lineSaleAmount || null}
                  currencyCode={values.currencyCode.trim() || 'BRL'}
                  error={liveErrors.items?.[index]?.lineSaleAmount}
                  disabled={submitting}
                  onChange={(value) => updateItem(index, { lineSaleAmount: value ?? '' })}
                  onInvalid={(invalid) => markMoneyInvalid(item.rowId, invalid)}
                />
              </div>
            )}
          />
        </BuilderSection>
      ) : null}

      <BuilderSection
        title="Observações"
        description="Condições e ressalvas que acompanham a proposta."
      >
        <Field label="Observações" htmlFor="proposal-notes">
          <Textarea
            id="proposal-notes"
            value={values.notes}
            onChange={(event) => updateField('notes', event.target.value)}
            rows={3}
            disabled={submitting}
          />
        </Field>
      </BuilderSection>

      <StickyActionBar note={note}>
        <Link to={cancelHref} className="button-link button-secondary">
          Cancelar
        </Link>
        <Button
          type="submit"
          disabled={!canSubmit}
          loading={submitting}
          loadingText="Registrando proposta…"
        >
          {mode === 'create' ? 'Registrar proposta' : 'Salvar alterações'}
        </Button>
      </StickyActionBar>
    </form>
  );
}
