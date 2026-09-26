import { useId, type ReactNode } from 'react';
import {
  EXECUTION_CONDITION_TYPES,
  EXECUTION_REQUIREMENT_TYPES,
  MEASUREMENT_BASES,
  MEASUREMENT_MODES,
  OPERATIONAL_ARCHETYPES,
  PRICING_MODEL_CODES,
  ARCHETYPE_LABELS,
} from '../constants/catalog-vocabulary';
import type { CatalogReferenceData } from '../hooks/useCatalogReferenceData';
import type {
  LaborRequirementInput,
  RequirementLevel,
  ResourceRequirementInput,
} from '../types/service-catalog.types';

const REQUIREMENT_LEVELS: RequirementLevel[] = ['REQUIRED', 'OPTIONAL', 'CONDITIONAL'];

function parseRequirementLevel(value: string): RequirementLevel {
  if (REQUIREMENT_LEVELS.includes(value as RequirementLevel)) {
    return value as RequirementLevel;
  }
  return 'OPTIONAL';
}
import type { ServiceDefinitionFormErrors, ServiceDefinitionFormState } from '../utils/catalog-form-state';

type ServiceDefinitionFormProps = {
  formId: string;
  state: ServiceDefinitionFormState;
  errors: ServiceDefinitionFormErrors;
  referenceData: CatalogReferenceData;
  includeCode: boolean;
  readOnly?: boolean;
  onChange: (next: ServiceDefinitionFormState) => void;
};

export function ServiceDefinitionForm({
  formId,
  state,
  errors,
  referenceData,
  includeCode,
  readOnly = false,
  onChange,
}: ServiceDefinitionFormProps) {
  const codeId = useId();
  const nameId = useId();
  const descriptionId = useId();
  const categoryId = useId();

  function update<K extends keyof ServiceDefinitionFormState>(
    key: K,
    value: ServiceDefinitionFormState[K],
  ): void {
    onChange({ ...state, [key]: value });
  }

  return (
    <form id={formId} className="catalog-form" noValidate>
      <section className="catalog-form__section" aria-labelledby={`${formId}-basic`}>
        <h2 id={`${formId}-basic`}>Identificação</h2>
        {includeCode ? (
          <div className="form-field">
            <label htmlFor={codeId}>Código da definição</label>
            <input
              id={codeId}
              value={state.code}
              onChange={(event) => update('code', event.target.value.toUpperCase())}
              disabled={readOnly}
              required
            />
            {errors.code ? <p className="field-error">{errors.code}</p> : null}
          </div>
        ) : null}
        <div className="form-field">
          <label htmlFor={nameId}>Nome</label>
          <input
            id={nameId}
            value={state.name}
            onChange={(event) => update('name', event.target.value)}
            disabled={readOnly}
            required
          />
          {errors.name ? <p className="field-error">{errors.name}</p> : null}
        </div>
        <div className="form-field">
          <label htmlFor={descriptionId}>Descrição</label>
          <textarea
            id={descriptionId}
            value={state.description}
            onChange={(event) => update('description', event.target.value)}
            disabled={readOnly}
            rows={3}
          />
        </div>
        <div className="form-field">
          <label htmlFor={categoryId}>Categoria</label>
          {referenceData.categories.length > 0 ? (
            <select
              id={categoryId}
              value={state.categoryId}
              onChange={(event) => update('categoryId', event.target.value)}
              disabled={readOnly}
              required
            >
              <option value="">Selecione</option>
              {referenceData.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name} ({category.code})
                </option>
              ))}
            </select>
          ) : (
            <input
              id={categoryId}
              value={state.categoryId}
              onChange={(event) => update('categoryId', event.target.value)}
              disabled={readOnly}
              required
            />
          )}
          {errors.categoryId ? <p className="field-error">{errors.categoryId}</p> : null}
        </div>
        <div className="form-field">
          <label htmlFor={`${formId}-archetype`}>Arquétipo operacional</label>
          <select
            id={`${formId}-archetype`}
            value={state.archetype}
            onChange={(event) => update('archetype', event.target.value)}
            disabled={readOnly}
          >
            {OPERATIONAL_ARCHETYPES.map((archetype) => (
              <option key={archetype} value={archetype}>
                {ARCHETYPE_LABELS[archetype] ?? archetype}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="catalog-form__section" aria-labelledby={`${formId}-measurement`}>
        <h2 id={`${formId}-measurement`}>Medição</h2>
        <div className="catalog-form__grid">
          <div className="form-field">
            <label htmlFor={`${formId}-measurement-mode`}>Modo de medição</label>
            <select
              id={`${formId}-measurement-mode`}
              value={state.measurementMode}
              onChange={(event) => update('measurementMode', event.target.value)}
              disabled={readOnly}
            >
              {MEASUREMENT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor={`${formId}-measurement-basis`}>Base de medição</label>
            <select
              id={`${formId}-measurement-basis`}
              value={state.measurementBasis}
              onChange={(event) => update('measurementBasis', event.target.value)}
              disabled={readOnly}
            >
              {MEASUREMENT_BASES.map((basis) => (
                <option key={basis} value={basis}>
                  {basis}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor={`${formId}-billing-policy`}>Política de faturamento</label>
            <select
              id={`${formId}-billing-policy`}
              value={state.billingEntitlementPolicy}
              onChange={(event) => update('billingEntitlementPolicy', event.target.value)}
              disabled={readOnly}
            >
              {['MEASUREMENT_APPROVED', 'FIXED_PRICE', 'PERIODIC', 'MILESTONE'].map((policy) => (
                <option key={policy} value={policy}>
                  {policy}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor={`${formId}-requires-po`} className="inline-check">
              <input
                id={`${formId}-requires-po`}
                type="checkbox"
                checked={state.requiresPurchaseOrder}
                onChange={(event) => update('requiresPurchaseOrder', event.target.checked)}
                disabled={readOnly}
              />
              Exige Purchase Order antes do faturamento
            </label>
          </div>
          <div className="form-field">
            <label htmlFor={`${formId}-default-unit`}>Unidade padrão</label>
            <select
              id={`${formId}-default-unit`}
              value={state.defaultUnitCode}
              onChange={(event) => update('defaultUnitCode', event.target.value)}
              disabled={readOnly}
            >
              <option value="">—</option>
              {referenceData.units.map((unit) => (
                <option key={unit.code} value={unit.code}>
                  {unit.code} — {unit.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="catalog-repeatable">
          <legend>Unidades permitidas</legend>
          {errors.allowedUnits ? <p className="field-error">{errors.allowedUnits}</p> : null}
          {state.allowedUnits.map((unit, index) => (
            <div key={`unit-${index}`} className="catalog-repeatable__row">
              <select
                aria-label={`Unidade ${index + 1}`}
                value={unit.unitCode}
                disabled={readOnly}
                onChange={(event) => {
                  const next = [...state.allowedUnits];
                  next[index] = { ...unit, unitCode: event.target.value };
                  update('allowedUnits', next);
                }}
              >
                {referenceData.units.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.code}
                  </option>
                ))}
              </select>
              <label>
                <input
                  type="radio"
                  name={`${formId}-default-unit-radio`}
                  checked={unit.isDefault}
                  disabled={readOnly}
                  onChange={() => {
                    update(
                      'allowedUnits',
                      state.allowedUnits.map((entry, entryIndex) => ({
                        ...entry,
                        isDefault: entryIndex === index,
                      })),
                    );
                  }}
                />
                Padrão
              </label>
              {!readOnly ? (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() =>
                    update(
                      'allowedUnits',
                      state.allowedUnits.filter((_, entryIndex) => entryIndex !== index),
                    )
                  }
                >
                  Remover
                </button>
              ) : null}
            </div>
          ))}
          {!readOnly ? (
            <button
              type="button"
              className="button-secondary"
              onClick={() =>
                update('allowedUnits', [
                  ...state.allowedUnits,
                  {
                    unitCode: referenceData.units[0]?.code ?? 'UN',
                    isDefault: state.allowedUnits.length === 0,
                    sortOrder: state.allowedUnits.length,
                  },
                ])
              }
            >
              Adicionar unidade
            </button>
          ) : null}
        </fieldset>
      </section>

      <section className="catalog-form__section" aria-labelledby={`${formId}-pricing`}>
        <h2 id={`${formId}-pricing`}>Modelos de preço</h2>
        {errors.pricingModels ? <p className="field-error">{errors.pricingModels}</p> : null}
        {state.pricingModels.map((model, index) => (
          <fieldset key={`pricing-${index}`} className="catalog-repeatable">
            <legend>Modelo {index + 1}</legend>
            <div className="catalog-form__grid">
              <div className="form-field">
                <label htmlFor={`${formId}-pricing-code-${index}`}>Código</label>
                <select
                  id={`${formId}-pricing-code-${index}`}
                  value={model.modelCode}
                  disabled={readOnly}
                  onChange={(event) => {
                    const next = [...state.pricingModels];
                    next[index] = { ...model, modelCode: event.target.value };
                    update('pricingModels', next);
                  }}
                >
                  {(referenceData.pricingModels.length > 0
                    ? referenceData.pricingModels.map((item) => item.code)
                    : PRICING_MODEL_CODES
                  ).map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor={`${formId}-pricing-unit-${index}`}>Unidade</label>
                <select
                  id={`${formId}-pricing-unit-${index}`}
                  value={model.unitCode ?? ''}
                  disabled={readOnly}
                  onChange={(event) => {
                    const next = [...state.pricingModels];
                    next[index] = {
                      ...model,
                      unitCode: event.target.value || null,
                    };
                    update('pricingModels', next);
                  }}
                >
                  <option value="">—</option>
                  {referenceData.units.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unit.code}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor={`${formId}-sale-${index}`}>Preço de venda</label>
                <input
                  id={`${formId}-sale-${index}`}
                  value={model.salePrice ?? ''}
                  disabled={readOnly}
                  inputMode="decimal"
                  onChange={(event) => {
                    const next = [...state.pricingModels];
                    next[index] = { ...model, salePrice: event.target.value || null };
                    update('pricingModels', next);
                  }}
                />
              </div>
              <div className="form-field">
                <label htmlFor={`${formId}-cost-${index}`}>Custo interno</label>
                <input
                  id={`${formId}-cost-${index}`}
                  value={model.internalCost ?? ''}
                  disabled={readOnly}
                  inputMode="decimal"
                  onChange={(event) => {
                    const next = [...state.pricingModels];
                    next[index] = { ...model, internalCost: event.target.value || null };
                    update('pricingModels', next);
                  }}
                />
              </div>
            </div>
            {!readOnly ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() =>
                  update(
                    'pricingModels',
                    state.pricingModels.filter((_, entryIndex) => entryIndex !== index),
                  )
                }
              >
                Remover modelo
              </button>
            ) : null}
          </fieldset>
        ))}
        {!readOnly ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() =>
              update('pricingModels', [
                ...state.pricingModels,
                {
                  modelCode: 'DAILY',
                  unitCode: null,
                  salePrice: null,
                  internalCost: null,
                  currencyCode: 'BRL',
                  sortOrder: state.pricingModels.length,
                },
              ])
            }
          >
            Adicionar modelo de preço
          </button>
        ) : null}
      </section>

      <RequirementRepeatableSection<ResourceRequirementInput>
        title="Requisitos de recurso físico"
        readOnly={readOnly}
        items={state.resourceRequirements}
        onChange={(resourceRequirements) => update('resourceRequirements', resourceRequirements)}
        renderRow={(item, index, onRowChange) => (
          <>
            <select
              aria-label={`Tipo de recurso ${index + 1}`}
              value={item.resourceTypeCode}
              disabled={readOnly}
              onChange={(event) => onRowChange({ ...item, resourceTypeCode: event.target.value })}
            >
              {referenceData.resourceTypes.map((type) => (
                <option key={type.code} value={type.code}>
                  {type.code}
                </option>
              ))}
            </select>
            <select
              aria-label={`Nível do recurso ${index + 1}`}
              value={item.requirementLevel}
              disabled={readOnly}
              onChange={(event) =>
                onRowChange({
                  ...item,
                  requirementLevel: parseRequirementLevel(event.target.value),
                })
              }
            >
              {REQUIREMENT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <input
              aria-label={`Quantidade mínima ${index + 1}`}
              type="number"
              min={0}
              value={item.minQuantity}
              disabled={readOnly}
              onChange={(event) =>
                onRowChange({ ...item, minQuantity: Number(event.target.value) || 0 })
              }
            />
          </>
        )}
        createEmpty={() => ({
          resourceTypeCode: referenceData.resourceTypes[0]?.code ?? 'OTHER',
          requirementLevel: 'OPTIONAL' satisfies RequirementLevel,
          minQuantity: 1,
          sortOrder: state.resourceRequirements.length,
        })}
      />

      <RequirementRepeatableSection<LaborRequirementInput>
        title="Requisitos de mão de obra"
        readOnly={readOnly}
        items={state.laborRequirements}
        onChange={(laborRequirements) => update('laborRequirements', laborRequirements)}
        renderRow={(item, index, onRowChange) => (
          <>
            <select
              aria-label={`Tipo de mão de obra ${index + 1}`}
              value={item.laborTypeCode}
              disabled={readOnly}
              onChange={(event) => onRowChange({ ...item, laborTypeCode: event.target.value })}
            >
              {referenceData.laborTypes.map((type) => (
                <option key={type.code} value={type.code}>
                  {type.code}
                </option>
              ))}
            </select>
            <select
              aria-label={`Nível da mão de obra ${index + 1}`}
              value={item.requirementLevel}
              disabled={readOnly}
              onChange={(event) =>
                onRowChange({
                  ...item,
                  requirementLevel: parseRequirementLevel(event.target.value),
                })
              }
            >
              {REQUIREMENT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <input
              aria-label={`Quantidade mínima ${index + 1}`}
              type="number"
              min={0}
              value={item.minQuantity}
              disabled={readOnly}
              onChange={(event) =>
                onRowChange({ ...item, minQuantity: Number(event.target.value) || 0 })
              }
            />
          </>
        )}
        createEmpty={() => ({
          laborTypeCode: referenceData.laborTypes[0]?.code ?? 'DRIVER',
          requirementLevel: 'OPTIONAL' satisfies RequirementLevel,
          minQuantity: 1,
          sortOrder: state.laborRequirements.length,
        })}
      />

      <RequirementRepeatableSection
        title="Requisitos de evidência"
        readOnly={readOnly}
        items={state.executionRequirements}
        onChange={(executionRequirements) => update('executionRequirements', executionRequirements)}
        renderRow={(item, index, onRowChange) => (
          <>
            <select
              aria-label={`Tipo de evidência ${index + 1}`}
              value={item.requirementType}
              disabled={readOnly}
              onChange={(event) => onRowChange({ ...item, requirementType: event.target.value })}
            >
              {EXECUTION_REQUIREMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <select
              aria-label={`Nível da evidência ${index + 1}`}
              value={item.requirementLevel}
              disabled={readOnly}
              onChange={(event) =>
                onRowChange({
                  ...item,
                  requirementLevel: parseRequirementLevel(event.target.value),
                })
              }
            >
              {REQUIREMENT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            {item.requirementLevel === 'CONDITIONAL' ? (
              <select
                aria-label={`Condição da evidência ${index + 1}`}
                value={item.config?.conditional?.conditionType ?? ''}
                disabled={readOnly}
                onChange={(event) =>
                  onRowChange({
                    ...item,
                    config: {
                      schemaVersion: 1,
                      conditional: { conditionType: event.target.value },
                    },
                  })
                }
              >
                <option value="">Selecione…</option>
                {EXECUTION_CONDITION_TYPES.map((condition) => (
                  <option key={condition} value={condition}>
                    {condition}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        )}
        createEmpty={() => ({
          requirementType: 'PHOTO',
          requirementLevel: 'OPTIONAL' as const,
          config: null,
          sortOrder: state.executionRequirements.length,
        })}
      />
    </form>
  );
}

type RequirementRepeatableSectionProps<T> = {
  title: string;
  readOnly: boolean;
  items: T[];
  onChange: (items: T[]) => void;
  renderRow: (item: T, index: number, onRowChange: (item: T) => void) => ReactNode;
  createEmpty: () => T;
};

function RequirementRepeatableSection<T>({
  title,
  readOnly,
  items,
  onChange,
  renderRow,
  createEmpty,
}: RequirementRepeatableSectionProps<T>) {
  return (
    <section className="catalog-form__section">
      <h2>{title}</h2>
      {items.map((item, index) => (
        <div key={`${title}-${index}`} className="catalog-repeatable__row">
          {renderRow(item, index, (nextItem) => {
            const next = [...items];
            next[index] = nextItem;
            onChange(next);
          })}
          {!readOnly ? (
            <button
              type="button"
              className="button-secondary"
              onClick={() => onChange(items.filter((_, entryIndex) => entryIndex !== index))}
            >
              Remover
            </button>
          ) : null}
        </div>
      ))}
      {!readOnly ? (
        <button type="button" className="button-secondary" onClick={() => onChange([...items, createEmpty()])}>
          Adicionar
        </button>
      ) : null}
    </section>
  );
}
