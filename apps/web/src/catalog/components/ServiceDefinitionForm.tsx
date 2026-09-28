import { useId, useState } from 'react';
import type { HumanLookupOption } from '../../financial-ui/HumanLookupField';
import { HumanLookupField } from '../../financial-ui/HumanLookupField';
import {
  BuilderSection,
  BuilderSummary,
  Button,
  Checkbox,
  CollectionEditor,
  CurrencyField,
  Field,
  FieldError,
  Input,
  Radio,
  Select,
  Textarea,
  cn,
} from '../../ui';
import type { PolicyOption, UnitOfMeasureOption } from '../api/catalog-reference-api';
import {
  ARCHETYPE_LABELS,
  BILLING_ENTITLEMENT_POLICIES,
  BILLING_ENTITLEMENT_POLICY_LABELS,
  EXECUTION_CONDITION_TYPES,
  EXECUTION_CONDITION_TYPE_LABELS,
  EXECUTION_REQUIREMENT_TYPES,
  EXECUTION_REQUIREMENT_TYPE_LABELS,
  MEASUREMENT_BASES,
  MEASUREMENT_BASIS_LABELS,
  MEASUREMENT_MODES,
  MEASUREMENT_MODE_LABELS,
  OPERATIONAL_ARCHETYPES,
  PRICING_MODEL_CODES,
  PRICING_MODEL_LABELS,
  REQUIREMENT_LEVEL_LABELS,
  vocabularyLabel,
} from '../constants/catalog-vocabulary';
import type { CatalogReferenceData } from '../hooks/useCatalogReferenceData';
import type { RequirementLevel } from '../types/service-catalog.types';
import { REQUIREMENT_LEVELS as DOMAIN_REQUIREMENT_LEVELS } from '../types/service-catalog.types';
import {
  validateServiceDefinitionForm,
  type ServiceDefinitionFormErrors,
  type ServiceDefinitionFormState,
} from '../utils/catalog-form-state';

/**
 * SERVICE DEFINITION FORM — BUILDER ESTRUTURADO do catalogo de servicos.
 *
 * A tela anterior parecia backoffice: campos crues, um botao azul "Remover modelo", "Adicionar"
 * solto no meio do card e a acao principal perdida no fim da pagina. Aqui a mesma estrutura
 * empresarial e editada com as primitivas compartilhadas do CISNE:
 *
 * - `BuilderSummary` resume a EDICAO ATUAL (nunca indicador inventado);
 * - `BuilderSection` da hierarquia e acao propria a cada bloco;
 * - `CollectionEditor` e o repetidor unico (cabecalho compacto, remocao discreta);
 * - `CurrencyField` e o unico campo monetario (valor normalizado, nunca string crua);
 * - `HumanLookupField` troca o identificador tecnico de categoria por escolha humana.
 *
 * Nada de regra de negocio muda: `catalog-form-state.ts` continua sendo a autoridade de
 * validacao, o payload e montado pelas mesmas funcoes e cada capacidade de escrita continua
 * decidindo quem edita o que (inclusive o CUSTO INTERNO, dado sensivel).
 */

const REQUIREMENT_LEVEL_OPTIONS: RequirementLevel[] = [...DOMAIN_REQUIREMENT_LEVELS];

function parseRequirementLevel(value: string): RequirementLevel {
  return REQUIREMENT_LEVEL_OPTIONS.includes(value as RequirementLevel)
    ? (value as RequirementLevel)
    : 'OPTIONAL';
}

function replaceAt<T>(items: T[], index: number, next: T): T[] {
  const copy = [...items];
  copy[index] = next;
  return copy;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Nome humano da unidade. O código (`DAY`, `KM`) é o VALOR do payload e não vai para a tela:
 * o operador lê "Dia", "Quilômetro". Sem nome cadastrado no servidor, o código é o último
 * recurso honesto — melhor exibir `DAY` do que inventar um nome.
 */
function unitName(code: string, units: UnitOfMeasureOption[]): string {
  const name = units.find((unit) => unit.code === code)?.name.trim();
  return name ? name : code;
}

/** Nome humano de um tipo de recurso/mão de obra, com o código como último recurso. */
function referenceTypeLabel(code: string, types: Array<{ code: string; name: string }>): string {
  const name = types.find((type) => type.code === code)?.name.trim();
  return name ? name : code;
}

/**
 * Modelo de preço: o rótulo humano do servidor vence quando existir; sem ele, o vocabulário
 * registrado em `catalog-vocabulary.ts`; sem rótulo registrado, o próprio código.
 */
function pricingModelLabel(modelCode: string, policies: PolicyOption[]): string {
  const serverLabel = policies.find((policy) => policy.code === modelCode)?.label?.trim();
  if (serverLabel) {
    return serverLabel;
  }
  return vocabularyLabel(PRICING_MODEL_LABELS, modelCode);
}

/**
 * Contexto REAL da política comercial: o servidor informa a unidade exigida (DAILY → DAY) e a
 * implícita. Nada é preenchido automaticamente — o texto só evita que o operador monte uma
 * combinação que o backend recusa por incompatibilidade de unidade. Códigos aparecem traduzidos.
 */
function pricingUnitHint(
  modelCode: string,
  policies: PolicyOption[],
  units: UnitOfMeasureOption[],
): string | undefined {
  const policy = policies.find((entry) => entry.code === modelCode);
  const model = pricingModelLabel(modelCode, policies);
  const required = policy?.requiredUnitCode?.trim();
  if (required) {
    return `O modelo ${model} usa a unidade ${unitName(required, units)}.`;
  }
  const implied = policy?.impliedUnitCode?.trim();
  if (implied) {
    return `Unidade sugerida pelo modelo: ${unitName(implied, units)}.`;
  }
  return undefined;
}

const BLOCKER_LABELS: Partial<Record<keyof ServiceDefinitionFormState, string>> = {
  code: 'código',
  name: 'nome',
  categoryId: 'categoria',
  allowedUnits: 'unidade permitida',
  pricingModels: 'modelo de preço',
};

/**
 * Traduz a validacao autoritativa (`validateServiceDefinitionForm`) para o rodape da barra de
 * acao: "Faltam: nome, categoria." Nao e uma segunda validacao nem um novo bloqueio — e a mesma
 * funcao, apenas com rotulos humanos, para a acao principal nunca ficar muda quando desabilitada.
 */
export function listFormBlockers(
  state: ServiceDefinitionFormState,
  options: { includeCode: boolean },
): string[] {
  const errors = validateServiceDefinitionForm(state, options);
  return (Object.keys(errors) as Array<keyof ServiceDefinitionFormState>)
    .map((key) => BLOCKER_LABELS[key])
    .filter((label): label is string => Boolean(label));
}

type ServiceDefinitionFormProps = {
  formId: string;
  state: ServiceDefinitionFormState;
  errors: ServiceDefinitionFormErrors;
  referenceData: CatalogReferenceData;
  includeCode: boolean;
  readOnly?: boolean;
  /**
   * Custo interno e dado sensivel. A tela so o recebe quando a capability que ja autoriza o
   * editor existe: sem ela o campo NAO e renderizado (jamais desabilitado exibindo o valor).
   */
  showInternalCost?: boolean;
  onChange: (next: ServiceDefinitionFormState) => void;
};

export function ServiceDefinitionForm({
  formId,
  state,
  errors,
  referenceData,
  includeCode,
  readOnly = false,
  showInternalCost = false,
  onChange,
}: ServiceDefinitionFormProps) {
  const codeId = useId();
  const nameId = useId();
  const descriptionId = useId();
  const categoryId = useId();
  const archetypeId = useId();
  const measurementModeId = useId();
  const measurementBasisId = useId();
  const billingPolicyId = useId();
  const defaultUnitId = useId();
  const requiresPurchaseOrderId = useId();
  const [touched, setTouched] = useState<
    Partial<Record<keyof ServiceDefinitionFormState, boolean>>
  >({});

  const units = referenceData.units;
  const resourceTypes = referenceData.resourceTypes;
  const laborTypes = referenceData.laborTypes;
  const pricingPolicies = referenceData.pricingModels;
  const pricingModelCodes =
    pricingPolicies.length > 0 ? pricingPolicies.map((policy) => policy.code) : [...PRICING_MODEL_CODES];

  // A validacao continua vindo de `catalog-form-state.ts`; o builder decide apenas QUANDO
  // mostrar o erro (campo ja tocado) para nao gritar em um formulario intocado.
  const liveErrors = validateServiceDefinitionForm(state, { includeCode });

  function errorFor(key: keyof ServiceDefinitionFormState): string | undefined {
    return touched[key] ? liveErrors[key] : errors[key];
  }

  function update<K extends keyof ServiceDefinitionFormState>(
    key: K,
    value: ServiceDefinitionFormState[K],
  ): void {
    setTouched((previous) => (previous[key] ? previous : { ...previous, [key]: true }));
    onChange({ ...state, [key]: value });
  }

  /**
   * Busca humana da categoria. O catálogo de categorias tem dezenas de registros: sem termo
   * digitado NÃO devolvemos a lista inteira — isso reproduziria o select nativo gigante que esta
   * tela está substituindo. A categoria já selecionada continua visível pelo `initialLabel`.
   */
  const searchCategories = (term: string): Promise<HumanLookupOption[]> => {
    const needle = term.trim().toLowerCase();
    if (needle.length === 0) {
      return Promise.resolve([]);
    }
    const matches = referenceData.categories.filter((category) =>
      `${category.name} ${category.code}`.toLowerCase().includes(needle),
    );
    return Promise.resolve(
      matches.map((category) => ({ id: category.id, label: category.name, support: category.code })),
    );
  };

  const selectedCategory = referenceData.categories.find(
    (category) => category.id === state.categoryId,
  );

  function addUnit(): void {
    update('allowedUnits', [
      ...state.allowedUnits,
      {
        unitCode: units[0]?.code ?? 'UN',
        isDefault: state.allowedUnits.length === 0,
        sortOrder: state.allowedUnits.length,
      },
    ]);
  }

  function addPricingModel(): void {
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
    ]);
  }

  function addResourceRequirement(): void {
    update('resourceRequirements', [
      ...state.resourceRequirements,
      {
        resourceTypeCode: resourceTypes[0]?.code ?? 'OTHER',
        requirementLevel: 'OPTIONAL',
        minQuantity: 1,
        sortOrder: state.resourceRequirements.length,
      },
    ]);
  }

  function addLaborRequirement(): void {
    update('laborRequirements', [
      ...state.laborRequirements,
      {
        laborTypeCode: laborTypes[0]?.code ?? 'DRIVER',
        requirementLevel: 'OPTIONAL',
        minQuantity: 1,
        sortOrder: state.laborRequirements.length,
      },
    ]);
  }

  function addExecutionRequirement(): void {
    update('executionRequirements', [
      ...state.executionRequirements,
      {
        requirementType: 'PHOTO',
        requirementLevel: 'OPTIONAL',
        config: null,
        sortOrder: state.executionRequirements.length,
      },
    ]);
  }

  const categoryError = errorFor('categoryId');
  const allowedUnitsError = errorFor('allowedUnits');
  const pricingModelsError = errorFor('pricingModels');

  return (
    <form id={formId} className="grid gap-3" noValidate>
      <BuilderSummary
        items={[
          {
            label: 'Tipo de serviço',
            value: ARCHETYPE_LABELS[state.archetype] ?? state.archetype,
          },
          {
            label: 'Precificação',
            value: countLabel(
              state.pricingModels.length,
              'modelo de preço',
              'modelos de preço',
            ),
          },
          {
            label: 'Recursos',
            value: countLabel(
              state.resourceRequirements.length,
              'recurso físico',
              'recursos físicos',
            ),
          },
          {
            label: 'Mão de obra',
            value: countLabel(
              state.laborRequirements.length,
              'requisito de mão de obra',
              'requisitos de mão de obra',
            ),
          },
          {
            label: 'Evidências',
            value: countLabel(
              state.executionRequirements.length,
              'requisito de evidência',
              'requisitos de evidência',
            ),
          },
        ]}
      />

      <BuilderSection
        title="Identificação"
        description="O que o serviço é e como o negócio o classifica."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {includeCode ? (
            <Field
              label="Código da definição"
              htmlFor={codeId}
              required
              error={errorFor('code')}
              hint="A-Z, 0-9, _ e -."
            >
              <Input
                id={codeId}
                value={state.code}
                onChange={(event) => update('code', event.target.value.toUpperCase())}
                disabled={readOnly}
                required
                invalid={Boolean(errorFor('code'))}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          ) : null}

          <Field label="Nome" htmlFor={nameId} required error={errorFor('name')}>
            <Input
              id={nameId}
              value={state.name}
              onChange={(event) => update('name', event.target.value)}
              disabled={readOnly}
              required
              invalid={Boolean(errorFor('name'))}
              autoComplete="off"
            />
          </Field>

          <div>
            {/*
              Categoria é REFERÊNCIA de entidade: o operador escolhe pelo nome/código humano e o
              identificador nunca aparece na tela. `HumanLookupField` não expõe `disabled`, por isso
              em modo leitura o contêiner é neutralizado em vez de deixar a busca ativa.
            */}
            <HumanLookupField
              label="Categoria"
              htmlFor={categoryId}
              required
              value={state.categoryId}
              onChange={(categoryValue) => update('categoryId', categoryValue)}
              search={searchCategories}
              emptyMessage="Busque a categoria pelo nome ou pelo código para ver as opções."
              emptyOptionLabel="Selecione a categoria"
              placeholder="Buscar por nome ou código"
              initialLabel={
                selectedCategory
                  ? `${selectedCategory.name} — ${selectedCategory.code}`
                  : undefined
              }
              className={readOnly ? 'pointer-events-none opacity-70' : undefined}
            />
            {categoryError ? <FieldError>{categoryError}</FieldError> : null}
          </div>

          <Field label="Arquétipo operacional" htmlFor={archetypeId}>
            <Select
              id={archetypeId}
              value={state.archetype}
              onChange={(event) => update('archetype', event.target.value)}
              disabled={readOnly}
            >
              {OPERATIONAL_ARCHETYPES.map((archetype) => (
                <option key={archetype} value={archetype}>
                  {ARCHETYPE_LABELS[archetype] ?? archetype}
                </option>
              ))}
            </Select>
          </Field>

          <div className="sm:col-span-2">
            <Field label="Descrição" htmlFor={descriptionId}>
              <Textarea
                id={descriptionId}
                value={state.description}
                onChange={(event) => update('description', event.target.value)}
                disabled={readOnly}
                rows={2}
              />
            </Field>
          </div>
        </div>
      </BuilderSection>

      <BuilderSection
        title="Medição e faturamento"
        description="Como o serviço é medido e quando pode ser faturado."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Modo de medição" htmlFor={measurementModeId}>
            <Select
              id={measurementModeId}
              value={state.measurementMode}
              onChange={(event) => update('measurementMode', event.target.value)}
              disabled={readOnly}
            >
              {MEASUREMENT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {vocabularyLabel(MEASUREMENT_MODE_LABELS, mode)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Base de medição" htmlFor={measurementBasisId}>
            <Select
              id={measurementBasisId}
              value={state.measurementBasis}
              onChange={(event) => update('measurementBasis', event.target.value)}
              disabled={readOnly}
            >
              {MEASUREMENT_BASES.map((basis) => (
                <option key={basis} value={basis}>
                  {vocabularyLabel(MEASUREMENT_BASIS_LABELS, basis)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Política de faturamento" htmlFor={billingPolicyId}>
            <Select
              id={billingPolicyId}
              value={state.billingEntitlementPolicy}
              onChange={(event) => update('billingEntitlementPolicy', event.target.value)}
              disabled={readOnly}
            >
              {BILLING_ENTITLEMENT_POLICIES.map((policy) => (
                <option key={policy} value={policy}>
                  {vocabularyLabel(BILLING_ENTITLEMENT_POLICY_LABELS, policy)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Unidade padrão" htmlFor={defaultUnitId}>
            <Select
              id={defaultUnitId}
              value={state.defaultUnitCode}
              onChange={(event) => update('defaultUnitCode', event.target.value)}
              disabled={readOnly}
            >
              <option value="">—</option>
              {units.map((unit) => (
                <option key={unit.code} value={unit.code}>
                  {unitName(unit.code, units)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex items-end pb-1">
            <label
              htmlFor={requiresPurchaseOrderId}
              className="flex items-center gap-2 text-xs font-semibold text-gray-700"
            >
              <Checkbox
                id={requiresPurchaseOrderId}
                checked={state.requiresPurchaseOrder}
                onChange={(event) => update('requiresPurchaseOrder', event.target.checked)}
                disabled={readOnly}
              />
              Exige Purchase Order antes do faturamento
            </label>
          </div>
        </div>
      </BuilderSection>

      <BuilderSection
        title="Unidades e medidas permitidas"
        description="Unidades aceitas na medição e no preço do serviço."
        action={
          <Button variant="secondary" onClick={addUnit} disabled={readOnly}>
            + Adicionar unidade
          </Button>
        }
        footer={
          units.length === 0
            ? 'O servidor não retornou unidades de medida; sem elas a unidade não pode ser escolhida.'
            : undefined
        }
      >
        {allowedUnitsError ? <FieldError>{allowedUnitsError}</FieldError> : null}
        <CollectionEditor
          items={state.allowedUnits}
          getKey={(unit, index) => `${unit.unitCode}-${index}`}
          itemTitle={(unit) => unitName(unit.unitCode, units)}
          itemSubtitle={(unit, index) =>
            `Unidade ${index + 1} de ${state.allowedUnits.length}${unit.isDefault ? ' · padrão' : ''}`
          }
          renderItem={(unit, index) => (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Unidade" htmlFor={`${formId}-unit-${index}`}>
                <Select
                  id={`${formId}-unit-${index}`}
                  value={unit.unitCode}
                  disabled={readOnly}
                  onChange={(event) =>
                    update(
                      'allowedUnits',
                      replaceAt(state.allowedUnits, index, {
                        ...unit,
                        unitCode: event.target.value,
                      }),
                    )
                  }
                >
                  {units.map((option) => (
                    <option key={option.code} value={option.code}>
                      {unitName(option.code, units)}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="flex items-end pb-1">
                <label
                  htmlFor={`${formId}-unit-default-${index}`}
                  className="flex items-center gap-2 text-xs font-semibold text-gray-700"
                >
                  <Radio
                    id={`${formId}-unit-default-${index}`}
                    name={`${formId}-default-unit-radio`}
                    checked={unit.isDefault}
                    disabled={readOnly}
                    onChange={() =>
                      update(
                        'allowedUnits',
                        state.allowedUnits.map((entry, entryIndex) => ({
                          ...entry,
                          isDefault: entryIndex === index,
                        })),
                      )
                    }
                  />
                  Padrão
                </label>
              </div>
            </div>
          )}
          onChange={(index, item) =>
            update('allowedUnits', replaceAt(state.allowedUnits, index, item))
          }
          onRemove={(index) =>
            update(
              'allowedUnits',
              state.allowedUnits.filter((_, entryIndex) => entryIndex !== index),
            )
          }
          onAdd={addUnit}
          addLabel="Nova unidade"
          removeLabel="Remover"
          removeAriaLabel={(_, index) => `Remover a unidade ${index + 1}`}
          emptyMessage="Nenhuma unidade permitida ainda. Ao menos uma é obrigatória."
          disabled={readOnly}
        />
      </BuilderSection>

      <BuilderSection
        title="Modelos de preço"
        description="Como o serviço é cobrado: modelo, unidade e valores."
        action={
          <Button variant="secondary" onClick={addPricingModel} disabled={readOnly}>
            + Adicionar modelo de preço
          </Button>
        }
      >
        {pricingModelsError ? <FieldError>{pricingModelsError}</FieldError> : null}
        <CollectionEditor
          items={state.pricingModels}
          getKey={(model, index) => `${model.modelCode}-${index}`}
          itemTitle={(model) =>
            `${pricingModelLabel(model.modelCode, pricingPolicies)}${
              model.unitCode ? ` · ${unitName(model.unitCode, units)}` : ''
            }`
          }
          itemSubtitle={(_, index) =>
            `Modelo ${index + 1} de ${state.pricingModels.length}`
          }
          renderItem={(model, index) => (
            <div
              className={cn(
                'grid gap-3 sm:grid-cols-2',
                showInternalCost ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
              )}
            >
              <Field label="Modelo" htmlFor={`${formId}-pricing-model-${index}`}>
                <Select
                  id={`${formId}-pricing-model-${index}`}
                  value={model.modelCode}
                  disabled={readOnly}
                  onChange={(event) =>
                    update(
                      'pricingModels',
                      replaceAt(state.pricingModels, index, {
                        ...model,
                        modelCode: event.target.value,
                      }),
                    )
                  }
                >
                  {pricingModelCodes.map((code) => (
                    <option key={code} value={code}>
                      {pricingModelLabel(code, pricingPolicies)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Unidade"
                htmlFor={`${formId}-pricing-unit-${index}`}
                hint={pricingUnitHint(model.modelCode, pricingPolicies, units)}
              >
                <Select
                  id={`${formId}-pricing-unit-${index}`}
                  value={model.unitCode ?? ''}
                  disabled={readOnly}
                  onChange={(event) =>
                    update(
                      'pricingModels',
                      replaceAt(state.pricingModels, index, {
                        ...model,
                        unitCode: event.target.value || null,
                      }),
                    )
                  }
                >
                  <option value="">—</option>
                  {units.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unitName(unit.code, units)}
                    </option>
                  ))}
                </Select>
              </Field>

              <CurrencyField
                label="Preço de venda"
                value={model.salePrice}
                currencyCode={model.currencyCode}
                disabled={readOnly}
                onChange={(salePrice) =>
                  update(
                    'pricingModels',
                    replaceAt(state.pricingModels, index, { ...model, salePrice }),
                  )
                }
              />

              {/*
                CUSTO INTERNO — dado sensivel. Renderizado SOMENTE quando a tela autoriza o
                editor (`showInternalCost`) e o formulario esta em edicao; sem autorizacao o
                campo nao existe, em vez de aparecer desabilitado exibindo o valor.
              */}
              {showInternalCost && !readOnly ? (
                <CurrencyField
                  label="Custo interno"
                  value={model.internalCost}
                  currencyCode={model.currencyCode}
                  onChange={(internalCost) =>
                    update(
                      'pricingModels',
                      replaceAt(state.pricingModels, index, { ...model, internalCost }),
                    )
                  }
                />
              ) : null}
            </div>
          )}
          onChange={(index, item) =>
            update('pricingModels', replaceAt(state.pricingModels, index, item))
          }
          onRemove={(index) =>
            update(
              'pricingModels',
              state.pricingModels.filter((_, entryIndex) => entryIndex !== index),
            )
          }
          onAdd={addPricingModel}
          addLabel="Novo modelo de preço"
          removeLabel="Remover"
          removeAriaLabel={(_, index) => `Remover o modelo de preço ${index + 1}`}
          emptyMessage="Nenhum modelo de preço ainda. Ao menos um é obrigatório."
          confirmRemove
          disabled={readOnly}
        />
      </BuilderSection>

      <BuilderSection
        title="Requisitos de recurso físico"
        description="Recursos que a execução precisa ter disponíveis."
        action={
          <Button variant="secondary" onClick={addResourceRequirement} disabled={readOnly}>
            + Adicionar recurso físico
          </Button>
        }
        footer={
          resourceTypes.length === 0
            ? 'O servidor não retornou tipos de recurso físico; o tipo não pode ser escolhido.'
            : 'O servidor recusa o mesmo tipo de recurso duas vezes e exige quantidade mínima inteira de pelo menos 1.'
        }
      >
        <CollectionEditor
          items={state.resourceRequirements}
          getKey={(item, index) => `${item.resourceTypeCode}-${index}`}
          itemTitle={(item) =>
            `${referenceTypeLabel(item.resourceTypeCode, resourceTypes)} · ${vocabularyLabel(REQUIREMENT_LEVEL_LABELS, item.requirementLevel)} · mín. ${item.minQuantity}`
          }
          itemSubtitle={(_, index) =>
            `Recurso ${index + 1} de ${state.resourceRequirements.length}`
          }
          renderItem={(item, index) => (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Tipo de recurso" htmlFor={`${formId}-resource-type-${index}`}>
                <Select
                  id={`${formId}-resource-type-${index}`}
                  value={item.resourceTypeCode}
                  disabled={readOnly}
                  onChange={(event) =>
                    update(
                      'resourceRequirements',
                      replaceAt(state.resourceRequirements, index, {
                        ...item,
                        resourceTypeCode: event.target.value,
                      }),
                    )
                  }
                >
                  {resourceTypes.map((type) => (
                    <option key={type.code} value={type.code}>
                      {referenceTypeLabel(type.code, resourceTypes)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Nível do recurso" htmlFor={`${formId}-resource-level-${index}`}>
                <Select
                  id={`${formId}-resource-level-${index}`}
                  value={item.requirementLevel}
                  disabled={readOnly}
                  onChange={(event) =>
                    update(
                      'resourceRequirements',
                      replaceAt(state.resourceRequirements, index, {
                        ...item,
                        requirementLevel: parseRequirementLevel(event.target.value),
                      }),
                    )
                  }
                >
                  {REQUIREMENT_LEVEL_OPTIONS.map((level) => (
                    <option key={level} value={level}>
                      {vocabularyLabel(REQUIREMENT_LEVEL_LABELS, level)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Quantidade mínima" htmlFor={`${formId}-resource-quantity-${index}`}>
                <Input
                  id={`${formId}-resource-quantity-${index}`}
                  type="number"
                  min={1}
                  step={1}
                  value={item.minQuantity}
                  disabled={readOnly}
                  className="text-right tabular-nums"
                  onChange={(event) =>
                    update(
                      'resourceRequirements',
                      replaceAt(state.resourceRequirements, index, {
                        ...item,
                        minQuantity: Number(event.target.value) || 0,
                      }),
                    )
                  }
                />
              </Field>
            </div>
          )}
          onChange={(index, item) =>
            update('resourceRequirements', replaceAt(state.resourceRequirements, index, item))
          }
          onRemove={(index) =>
            update(
              'resourceRequirements',
              state.resourceRequirements.filter((_, entryIndex) => entryIndex !== index),
            )
          }
          onAdd={addResourceRequirement}
          addLabel="Novo recurso físico"
          removeLabel="Remover"
          removeAriaLabel={(_, index) => `Remover o recurso físico ${index + 1}`}
          emptyMessage="Nenhum recurso físico exigido para este serviço."
          confirmRemove
          disabled={readOnly}
        />
      </BuilderSection>

      <BuilderSection
        title="Requisitos de mão de obra"
        description="Funções que a execução precisa alocar."
        action={
          <Button variant="secondary" onClick={addLaborRequirement} disabled={readOnly}>
            + Adicionar mão de obra
          </Button>
        }
        footer={
          laborTypes.length === 0
            ? 'O servidor não retornou tipos de mão de obra; a função não pode ser escolhida.'
            : 'O servidor recusa a mesma função duas vezes e exige quantidade mínima inteira de pelo menos 1.'
        }
      >
        <CollectionEditor
          items={state.laborRequirements}
          getKey={(item, index) => `${item.laborTypeCode}-${index}`}
          itemTitle={(item) =>
            `${referenceTypeLabel(item.laborTypeCode, laborTypes)} · ${vocabularyLabel(REQUIREMENT_LEVEL_LABELS, item.requirementLevel)} · mín. ${item.minQuantity}`
          }
          itemSubtitle={(_, index) =>
            `Mão de obra ${index + 1} de ${state.laborRequirements.length}`
          }
          renderItem={(item, index) => (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Tipo de mão de obra" htmlFor={`${formId}-labor-type-${index}`}>
                <Select
                  id={`${formId}-labor-type-${index}`}
                  value={item.laborTypeCode}
                  disabled={readOnly}
                  onChange={(event) =>
                    update(
                      'laborRequirements',
                      replaceAt(state.laborRequirements, index, {
                        ...item,
                        laborTypeCode: event.target.value,
                      }),
                    )
                  }
                >
                  {laborTypes.map((type) => (
                    <option key={type.code} value={type.code}>
                      {referenceTypeLabel(type.code, laborTypes)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Nível da mão de obra" htmlFor={`${formId}-labor-level-${index}`}>
                <Select
                  id={`${formId}-labor-level-${index}`}
                  value={item.requirementLevel}
                  disabled={readOnly}
                  onChange={(event) =>
                    update(
                      'laborRequirements',
                      replaceAt(state.laborRequirements, index, {
                        ...item,
                        requirementLevel: parseRequirementLevel(event.target.value),
                      }),
                    )
                  }
                >
                  {REQUIREMENT_LEVEL_OPTIONS.map((level) => (
                    <option key={level} value={level}>
                      {vocabularyLabel(REQUIREMENT_LEVEL_LABELS, level)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Quantidade mínima" htmlFor={`${formId}-labor-quantity-${index}`}>
                <Input
                  id={`${formId}-labor-quantity-${index}`}
                  type="number"
                  min={1}
                  step={1}
                  value={item.minQuantity}
                  disabled={readOnly}
                  className="text-right tabular-nums"
                  onChange={(event) =>
                    update(
                      'laborRequirements',
                      replaceAt(state.laborRequirements, index, {
                        ...item,
                        minQuantity: Number(event.target.value) || 0,
                      }),
                    )
                  }
                />
              </Field>
            </div>
          )}
          onChange={(index, item) =>
            update('laborRequirements', replaceAt(state.laborRequirements, index, item))
          }
          onRemove={(index) =>
            update(
              'laborRequirements',
              state.laborRequirements.filter((_, entryIndex) => entryIndex !== index),
            )
          }
          onAdd={addLaborRequirement}
          addLabel="Nova mão de obra"
          removeLabel="Remover"
          removeAriaLabel={(_, index) => `Remover a mão de obra ${index + 1}`}
          emptyMessage="Nenhuma mão de obra exigida para este serviço."
          confirmRemove
          disabled={readOnly}
        />
      </BuilderSection>

      <BuilderSection
        title="Requisitos de evidência"
        description="Evidências exigidas para comprovar a execução."
        action={
          <Button variant="secondary" onClick={addExecutionRequirement} disabled={readOnly}>
            + Adicionar evidência
          </Button>
        }
        footer="O servidor exige a condição quando o nível é Condicional e recusa o mesmo tipo de evidência duas vezes."
      >
        <CollectionEditor
          items={state.executionRequirements}
          getKey={(item, index) => `${item.requirementType}-${index}`}
          itemTitle={(item) =>
            `${vocabularyLabel(EXECUTION_REQUIREMENT_TYPE_LABELS, item.requirementType)} · ${vocabularyLabel(REQUIREMENT_LEVEL_LABELS, item.requirementLevel)}${
              item.requirementLevel === 'CONDITIONAL' && item.config?.conditional?.conditionType
                ? ` · ${vocabularyLabel(EXECUTION_CONDITION_TYPE_LABELS, item.config.conditional.conditionType)}`
                : ''
            }`
          }
          itemSubtitle={(_, index) =>
            `Evidência ${index + 1} de ${state.executionRequirements.length}`
          }
          renderItem={(item, index) => (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Tipo de evidência" htmlFor={`${formId}-evidence-type-${index}`}>
                <Select
                  id={`${formId}-evidence-type-${index}`}
                  value={item.requirementType}
                  disabled={readOnly}
                  onChange={(event) =>
                    update(
                      'executionRequirements',
                      replaceAt(state.executionRequirements, index, {
                        ...item,
                        requirementType: event.target.value,
                      }),
                    )
                  }
                >
                  {EXECUTION_REQUIREMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {vocabularyLabel(EXECUTION_REQUIREMENT_TYPE_LABELS, type)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Nível da evidência" htmlFor={`${formId}-evidence-level-${index}`}>
                <Select
                  id={`${formId}-evidence-level-${index}`}
                  value={item.requirementLevel}
                  disabled={readOnly}
                  onChange={(event) =>
                    update(
                      'executionRequirements',
                      replaceAt(state.executionRequirements, index, {
                        ...item,
                        requirementLevel: parseRequirementLevel(event.target.value),
                      }),
                    )
                  }
                >
                  {REQUIREMENT_LEVEL_OPTIONS.map((level) => (
                    <option key={level} value={level}>
                      {vocabularyLabel(REQUIREMENT_LEVEL_LABELS, level)}
                    </option>
                  ))}
                </Select>
              </Field>

              {item.requirementLevel === 'CONDITIONAL' ? (
                <Field label="Condição da evidência" htmlFor={`${formId}-evidence-condition-${index}`}>
                  <Select
                    id={`${formId}-evidence-condition-${index}`}
                    value={item.config?.conditional?.conditionType ?? ''}
                    disabled={readOnly}
                    onChange={(event) =>
                      update(
                        'executionRequirements',
                        replaceAt(state.executionRequirements, index, {
                          ...item,
                          config: {
                            schemaVersion: 1,
                            conditional: { conditionType: event.target.value },
                          },
                        }),
                      )
                    }
                  >
                    <option value="">Selecione…</option>
                    {EXECUTION_CONDITION_TYPES.map((condition) => (
                      <option key={condition} value={condition}>
                        {vocabularyLabel(EXECUTION_CONDITION_TYPE_LABELS, condition)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </div>
          )}
          onChange={(index, item) =>
            update('executionRequirements', replaceAt(state.executionRequirements, index, item))
          }
          onRemove={(index) =>
            update(
              'executionRequirements',
              state.executionRequirements.filter((_, entryIndex) => entryIndex !== index),
            )
          }
          onAdd={addExecutionRequirement}
          addLabel="Nova evidência"
          removeLabel="Remover"
          removeAriaLabel={(_, index) => `Remover a evidência ${index + 1}`}
          emptyMessage="Nenhuma evidência exigida para este serviço."
          confirmRemove
          disabled={readOnly}
        />
      </BuilderSection>
    </form>
  );
}
