import { useId, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { BuilderSection, BuilderSummary, Button, Field, Input, StickyActionBar } from '../../ui';
import {
  ASSET_LIFECYCLE_STATUSES,
  type AssetLifecycleStatus,
  type PhysicalAsset,
  type PhysicalResourceTypeOption,
} from '../types/physical-asset.types';
import { resolveAssetOperationalStatus } from '../utils/asset-operational-status';
import {
  isVehicleResourceType,
  type AssetFormFieldErrors,
  type AssetFormValues,
} from '../utils/asset-form-state';
import { AssetOperationalUnitField, AssetResourceTypeField } from './AssetLookupFields';

/**
 * FORMULÁRIO DE ATIVO FÍSICO — cadastro e edição no mesmo contrato estruturado.
 *
 * O ativo não é um CRUD de campos soltos: é um recurso com CLASSIFICAÇÃO (tipo de recurso do
 * catálogo + unidade que responde por ele), IDENTIFICAÇÃO, dados de veículo condicionados ao
 * tipo e uma DISPONIBILIDADE que NÃO se edita aqui (quem decide é a alocação em ordens de
 * serviço). A tela segue a mesma moldura dos builders do CISNE: resumo do que está sendo
 * configurado, seções de negócio, e a ação principal sempre visível.
 *
 * Regras, validações e payload são exatamente os de antes (`asset-form-state`): nenhuma
 * validação foi movida para a tela e nenhuma foi criada.
 */

const LIFECYCLE_LABELS: Record<AssetLifecycleStatus, string> = {
  [ASSET_LIFECYCLE_STATUSES.Active]: 'Ativo',
  [ASSET_LIFECYCLE_STATUSES.Inactive]: 'Inativo',
};

/** Link de cancelamento com a mesma linguagem do botão secundário (sem biblioteca nova). */
const SECONDARY_LINK_CLASS =
  'inline-flex min-h-[var(--spacing-touch)] items-center justify-center rounded-md border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 no-underline ring-1 ring-inset ring-gray-300 hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500';

export type AssetFormProps = {
  mode: 'create' | 'edit';
  values: AssetFormValues;
  resourceTypes: PhysicalResourceTypeOption[];
  resourceTypesLoading: boolean;
  /**
   * Ativo persistido — presente apenas na edição. Alimenta o resumo e os fatos somente leitura
   * (situação, disponibilidade); no cadastro não existe e nada é inventado.
   */
  asset?: PhysicalAsset | null;
  /**
   * Unidades operacionais visíveis para o ator (fonte única já existente em Requests, a mesma
   * que os filtros e formulários de backoffice usam em vez de um campo de identificador livre).
   * Sem lista disponível, o campo volta a aceitar a referência registrada digitada.
   */
  operationalUnits?: string[];
  operationalUnitsLoading?: boolean;
  operationalUnitsUnavailable?: boolean;
  fieldErrors: AssetFormFieldErrors;
  submitError: string | null;
  submitting: boolean;
  onChange: (values: AssetFormValues) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  cancelHref: string;
};

/** Fato persistido exibido em modo de leitura: rótulo, valor e, quando útil, a origem. */
function RecordedFact({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-gray-700">{label}</span>
      <p className="m-0 text-sm text-gray-900">{value}</p>
      {hint ? <p className="m-0 text-[11px] text-gray-500">{hint}</p> : null}
    </div>
  );
}

export function AssetForm({
  mode,
  values,
  resourceTypes,
  resourceTypesLoading,
  asset = null,
  operationalUnits = [],
  operationalUnitsLoading = false,
  operationalUnitsUnavailable = false,
  fieldErrors,
  submitError,
  submitting,
  onChange,
  onSubmit,
  cancelHref,
}: AssetFormProps) {
  const formErrorId = useId();
  const codeId = useId();
  const nameId = useId();
  const plateId = useId();
  const chassisId = useId();
  const modelId = useId();
  const isEdit = mode === 'edit';
  const showVehicleFields = isVehicleResourceType(values.resourceTypeId, resourceTypes);
  const selectedType = resourceTypes.find((type) => type.id === values.resourceTypeId);
  const typeLabel = selectedType
    ? `${selectedType.name} (${selectedType.code})`
    : (asset?.resourceTypeCode ?? null);
  const operationalStatus = asset ? resolveAssetOperationalStatus(asset) : null;

  function updateField<K extends keyof AssetFormValues>(key: K, value: AssetFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  // Fato sem dado real é OMITIDO — nunca uma linha vazia que finge completude.
  const classificationFacts = [
    { label: 'Tipo de recurso', value: typeLabel },
    { label: 'Unidade operacional', value: values.unitId.trim() || asset?.unitId || null },
  ].filter((fact) => fact.value !== null && fact.value !== '');

  const availabilityFacts = asset
    ? [
        { label: 'Disponibilidade operacional', value: operationalStatus?.label ?? null },
        { label: 'Ordem de serviço vigente', value: asset.currentAllocation?.orderNumber ?? null },
      ].filter((fact) => fact.value !== null && fact.value !== '')
    : [];

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-3"
      aria-describedby={submitError ? formErrorId : undefined}
    >
      {submitError ? (
        <p
          id={formErrorId}
          role="alert"
          className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
        >
          {submitError}
        </p>
      ) : null}

      <BuilderSummary
        items={[
          { label: 'Código', value: values.assetCode.trim() || null },
          { label: 'Tipo de recurso', value: typeLabel },
          { label: 'Unidade operacional', value: values.unitId.trim() || null },
          { label: 'Situação', value: asset ? LIFECYCLE_LABELS[asset.lifecycleStatus] : null },
        ]}
      />

      <fieldset
        disabled={submitting}
        className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
        aria-label="Dados do ativo"
      >
        <BuilderSection
          title="Identificação"
          description="Código e nome pelos quais o ativo é reconhecido na operação."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {isEdit ? (
              <RecordedFact
                label="Código do ativo"
                value={asset?.assetCode ?? values.assetCode}
                hint="Definido no cadastro; não é alterado nesta tela."
              />
            ) : (
              <Field
                label="Código do ativo"
                htmlFor={codeId}
                required
                error={fieldErrors.assetCode}
                hint="Registrado em maiúsculas e único no sistema."
              >
                <Input
                  id={codeId}
                  value={values.assetCode}
                  onChange={(event) => updateField('assetCode', event.target.value)}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  invalid={Boolean(fieldErrors.assetCode)}
                  disabled={submitting}
                />
              </Field>
            )}

            <Field label="Nome / descrição" htmlFor={nameId} required error={fieldErrors.name}>
              <Input
                id={nameId}
                value={values.name}
                onChange={(event) => updateField('name', event.target.value)}
                required
                invalid={Boolean(fieldErrors.name)}
                disabled={submitting}
              />
            </Field>
          </div>
        </BuilderSection>

        <BuilderSection
          title="Classificação"
          description="Tipo de recurso do catálogo e unidade operacional que respondem pelo ativo."
          footer={
            isEdit
              ? 'Tipo de recurso e unidade operacional são definidos no cadastro e não mudam nesta tela.'
              : undefined
          }
        >
          {isEdit ? (
            <DefinitionList items={classificationFacts} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <AssetResourceTypeField
                value={values.resourceTypeId}
                onChange={(resourceTypeId) => updateField('resourceTypeId', resourceTypeId)}
                options={resourceTypes}
                loading={resourceTypesLoading}
                error={fieldErrors.resourceTypeId}
                required
              />
              <AssetOperationalUnitField
                value={values.unitId}
                onChange={(unitId) => updateField('unitId', unitId)}
                units={operationalUnits}
                unitsLoading={operationalUnitsLoading}
                unitsUnavailable={operationalUnitsUnavailable}
                error={fieldErrors.unitId}
                required
                disabled={submitting}
              />
            </div>
          )}
        </BuilderSection>

        {showVehicleFields ? (
          <BuilderSection
            title="Dados do veículo"
            description="Campos exigidos para ativos classificados como veículo."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Placa" htmlFor={plateId} required error={fieldErrors.plate}>
                <Input
                  id={plateId}
                  value={values.plate}
                  onChange={(event) => updateField('plate', event.target.value)}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  invalid={Boolean(fieldErrors.plate)}
                  disabled={submitting}
                />
              </Field>
              <Field label="Chassi (opcional)" htmlFor={chassisId}>
                <Input
                  id={chassisId}
                  value={values.chassis}
                  onChange={(event) => updateField('chassis', event.target.value)}
                  disabled={submitting}
                />
              </Field>
              <Field label="Modelo (opcional)" htmlFor={modelId}>
                <Input
                  id={modelId}
                  value={values.model}
                  onChange={(event) => updateField('model', event.target.value)}
                  disabled={submitting}
                />
              </Field>
            </div>
          </BuilderSection>
        ) : null}

        {availabilityFacts.length > 0 ? (
          <BuilderSection
            title="Disponibilidade"
            description="O uso do ativo é decidido pela alocação em ordens de serviço; este cadastro não altera a disponibilidade."
          >
            <DefinitionList items={availabilityFacts} />
          </BuilderSection>
        ) : null}
      </fieldset>

      <StickyActionBar
        note={
          isEdit
            ? 'Salva a versão atual do cadastro; alterações concorrentes são recusadas pelo servidor.'
            : 'O tipo de recurso define os campos exigidos e o código é único.'
        }
      >
        <Link to={cancelHref} className={SECONDARY_LINK_CLASS}>
          Cancelar
        </Link>
        <Button type="submit" loading={submitting} loadingText="Salvando…">
          {isEdit ? 'Salvar alterações' : 'Cadastrar ativo'}
        </Button>
      </StickyActionBar>
    </form>
  );
}
