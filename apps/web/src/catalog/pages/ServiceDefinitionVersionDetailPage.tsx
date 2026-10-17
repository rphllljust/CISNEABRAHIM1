import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  CatalogApiError,
  getServiceDefinition,
  getServiceDefinitionVersion,
  publishServiceDefinitionVersion,
} from '../api/service-catalog-api';
import { mapCatalogErrorToMessage } from '../api/catalog-error-messages';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
} from '../../ui/module-layout';
import {
  EnterpriseObjectHeader,
  EnterpriseObjectPage,
} from '../../enterprise-object';
import {
  VERSION_STATUS_LABELS,
  VersionStatusBadge,
} from '../components/VersionStatusBadge';
import {
  ARCHETYPE_LABELS,
  BILLING_ENTITLEMENT_POLICY_LABELS,
  EXECUTION_CONDITION_TYPE_LABELS,
  EXECUTION_REQUIREMENT_TYPE_LABELS,
  MEASUREMENT_BASIS_LABELS,
  MEASUREMENT_MODE_LABELS,
  PRICING_MODEL_LABELS,
  REQUIREMENT_LEVEL_LABELS,
  vocabularyLabel,
} from '../constants/catalog-vocabulary';
import { VERSION_STATUSES, type ServiceDefinitionVersion } from '../types/service-catalog.types';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { Money } from '../../ui';
import { ConfirmDialog } from '../../clients/components/ConfirmDialog';
import { VersionConflictNotice } from '../components/VersionConflictNotice';
import { useCatalogCapabilities } from '../hooks/useCatalogCapabilities';

type VersionDetailState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      version: ServiceDefinitionVersion;
      lineageVersion: number;
      currentDraftVersion: number | null;
    };

function formatDateTime(value: string | null): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString('pt-BR');
}

function formatCategory(version: ServiceDefinitionVersion): string {
  if (version.categoryName && version.categoryCode) {
    return `${version.categoryName} (${version.categoryCode})`;
  }
  return version.categoryName ?? version.categoryCode ?? version.categoryId;
}

function formatEvidenceCondition(
  requirement: ServiceDefinitionVersion['executionRequirements'][number],
): string | null {
  const conditional = requirement.config?.conditional;
  if (!conditional) {
    return null;
  }
  const label = vocabularyLabel(
    EXECUTION_CONDITION_TYPE_LABELS,
    conditional.conditionType,
  );
  if (conditional.measurementBasis) {
    return `${label} ${vocabularyLabel(MEASUREMENT_BASIS_LABELS, conditional.measurementBasis)}`;
  }
  if (conditional.archetype) {
    return `${label} ${ARCHETYPE_LABELS[conditional.archetype] ?? conditional.archetype}`;
  }
  if (conditional.resourceTypeCode) {
    return `${label} ${conditional.resourceTypeCode}`;
  }
  if (conditional.laborTypeCode) {
    return `${label} ${conditional.laborTypeCode}`;
  }
  return label;
}

export function ServiceDefinitionVersionDetailPage() {
  const { definitionId = '', versionNumber = '' } = useParams();
  const parsedVersion = Number(versionNumber);
  const { capabilities } = useCatalogCapabilities();
  const [state, setState] = useState<VersionDetailState>({ phase: 'loading' });
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);

  const reload = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const [definition, version] = await Promise.all([
        getServiceDefinition(definitionId),
        getServiceDefinitionVersion(definitionId, parsedVersion),
      ]);
      setState({
        phase: 'ready',
        version,
        lineageVersion: definition.version,
        currentDraftVersion: definition.currentDraftVersion,
      });
    } catch (error) {
      if (error instanceof CatalogApiError) {
        if (error.kind === 'denied') {
          setState({ phase: 'denied' });
          return;
        }
        if (error.kind === 'not_found') {
          setState({ phase: 'not_found' });
          return;
        }
      }
      setState({
        phase: 'error',
        message:
          error instanceof CatalogApiError
            ? mapCatalogErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar a versão.',
      });
    }
  }, [definitionId, parsedVersion]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handlePublish(): Promise<void> {
    if (state.phase !== 'ready' || state.version.status !== VERSION_STATUSES.Draft) {
      return;
    }

    setPublishing(true);
    setPublishError(null);
    setVersionConflict(false);
    try {
      await publishServiceDefinitionVersion(definitionId, state.version.version, {
        lineageVersion: state.lineageVersion,
      });
      setPublishOpen(false);
      await reload();
    } catch (error) {
      if (error instanceof CatalogApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
      }
      setPublishError(
        error instanceof CatalogApiError
          ? mapCatalogErrorToMessage(error.code, error.status)
          : 'Não foi possível publicar a versão.',
      );
    } finally {
      setPublishing(false);
    }
  }

  if (state.phase === 'loading') {
    return (
      <ModulePage>
        <ModulePageHeader title="Versão de serviço" />
        <ModuleLoadingState title="Versão de serviço" message="Carregando versão…" />
      </ModulePage>
    );
  }

  if (state.phase === 'denied') {
    return (
      <ModulePage>
        <ModulePageHeader title="Versão de serviço" />
        <ModuleDeniedState title="Versão de serviço" message="Acesso negado." />
        <p className="mt-3 mb-0">
          <Link to={`/app/catalog/${definitionId}`}>Voltar à definição</Link>
        </p>
      </ModulePage>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <ModulePage>
        <ModulePageHeader title="Versão de serviço" />
        <ModuleErrorState
          title="Versão de serviço"
          message="Versão não encontrada."
          retryable={false}
        />
        <p className="mt-3 mb-0">
          <Link to={`/app/catalog/${definitionId}`}>Voltar à definição</Link>
        </p>
      </ModulePage>
    );
  }

  if (state.phase === 'error') {
    return (
      <ModulePage>
        <ModulePageHeader title="Versão de serviço" />
        <ModuleErrorState
          title="Versão de serviço"
          message={state.message}
          retryable
          onRetry={() => void reload()}
        />
        <p className="mt-3 mb-0">
          <Link to={`/app/catalog/${definitionId}`}>Voltar à definição</Link>
        </p>
      </ModulePage>
    );
  }

  const { version } = state;
  const isPublished = version.status === VERSION_STATUSES.Published;
  const canPublish = version.status === VERSION_STATUSES.Draft && capabilities.canPublish;

  return (
    <ModulePage>
      {/*
        OBJECT PAGE — a versao entra na mesma gramatica das demais fichas do produto.

        O titulo ja era humano (`CODIGO — vN`), mas vinha de `ModulePageHeader` com o estado e
        os comandos soltos num `action` de fragmento. Agora o cabecalho padrao publica a
        identidade (referencia, titulo, estado) e as acoes por PAPEL: navegacao vai em
        `secondaryActions` (vira LINK), e nada aqui e destrutivo.
      */}
      <EnterpriseObjectPage
        phaseTitle="Versão de serviço"
        header={
          <EnterpriseObjectHeader
            /*
              O TITULO E "CODIGO — vN", EM UM SO HEADING.

              A prova de browser prende `LOCACAO-DEMO ... v2` num unico heading: a versao NAO e
              um registro independente, e a revisao de uma definicao — e o operador precisa ler
              as duas coisas juntas para saber o que esta aberto. Separar codigo em `reference`
              e versao em `title` quebraria essa leitura (e o teste).
            */
            title={`${version.code} — v${version.version}`}
            status={{ label: VERSION_STATUS_LABELS[version.status] }}
            primaryAction={
              canPublish
                ? {
                    id: 'publish',
                    label: 'Publicar',
                    onSelect: () => setPublishOpen(true),
                    disabled: publishing,
                    loading: publishing,
                  }
                : null
            }
            secondaryActions={[
              ...(!isPublished && version.status === VERSION_STATUSES.Draft
                ? [
                    {
                      id: 'edit-draft',
                      label: 'Editar rascunho',
                      to: `/app/catalog/${definitionId}/versions/${version.version}/edit`,
                    },
                  ]
                : []),
              ...(isPublished
                ? [
                    {
                      id: 'new-version',
                      label: 'Criar nova versão',
                      to: `/app/catalog/${definitionId}/versions/new`,
                    },
                  ]
                : []),
            ]}
          />
        }
      >

      {versionConflict ? <VersionConflictNotice onReload={() => void reload()} /> : null}
      {publishError ? (
        <p className="form-error" role="alert">
          {publishError}
        </p>
      ) : null}

      {isPublished ? (
        <p
          className="m-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          role="note"
        >
          Esta versão está publicada e é imutável. Para evoluir o serviço, crie uma nova versão em rascunho.
        </p>
      ) : null}

      <section className="rounded-md border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
        <DefinitionList
          items={[
            { label: 'Nome', value: version.name },
            { label: 'Status', value: <VersionStatusBadge status={version.status} /> },
            { label: 'Categoria', value: formatCategory(version) },
            { label: 'Publicada em', value: formatDateTime(version.publishedAt) },
            { label: 'Arquétipo', value: ARCHETYPE_LABELS[version.archetype] ?? version.archetype },
            {
              label: 'Medição',
              value: `${vocabularyLabel(MEASUREMENT_MODE_LABELS, version.measurementMode)} / ${vocabularyLabel(MEASUREMENT_BASIS_LABELS, version.measurementBasis)}`,
            },
            {
              label: 'Política de faturamento',
              value: vocabularyLabel(
                BILLING_ENTITLEMENT_POLICY_LABELS,
                version.billingEntitlementPolicy,
              ),
            },
            { label: 'Exige Purchase Order', value: version.requiresPurchaseOrder ? 'Sim' : 'Não' },
            { label: 'Unidade padrão', value: version.defaultUnitCode ?? '—' },
            { label: 'Rascunho atual da definição', value: state.currentDraftVersion ?? 'Nenhum' },
            { label: 'Versão de concorrência da definição', value: state.lineageVersion },
            { label: 'Descrição', value: version.description ?? '—' },
          ]}
        />
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
        <h2 className="mt-0 mb-3 text-base font-semibold text-gray-900">Configuração estruturada</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <VersionList
            title="Unidades permitidas"
            items={version.allowedUnits.map((unit) => `${unit.unitCode}${unit.isDefault ? ' (padrão)' : ''}`)}
          />
          <VersionList
            title="Modelos de preço"
            items={version.pricingModels.map((model) => (
              <span key={`${model.modelCode}-${model.sortOrder}`}>
                {vocabularyLabel(PRICING_MODEL_LABELS, model.modelCode)}
                {model.unitCode ? ` · ${model.unitCode}` : ''}
                {' · venda '}
                <Money value={model.salePrice} currencyCode={model.currencyCode} />
                {' · custo interno '}
                <Money value={model.internalCost} currencyCode={model.currencyCode} />
              </span>
            ))}
          />
          <VersionList
            title="Requisitos de recurso"
            items={version.resourceRequirements.map(
              (item) =>
                `${item.resourceTypeCode} · ${vocabularyLabel(REQUIREMENT_LEVEL_LABELS, item.requirementLevel)} · quantidade mínima ${item.minQuantity}`,
            )}
          />
          <VersionList
            title="Requisitos de mão de obra"
            items={version.laborRequirements.map(
              (item) =>
                `${item.laborTypeCode} · ${vocabularyLabel(REQUIREMENT_LEVEL_LABELS, item.requirementLevel)} · quantidade mínima ${item.minQuantity}`,
            )}
          />
          <VersionList
            title="Requisitos de evidência"
            items={version.executionRequirements.map((item) => {
              const condition = formatEvidenceCondition(item);
              return [
                vocabularyLabel(EXECUTION_REQUIREMENT_TYPE_LABELS, item.requirementType),
                vocabularyLabel(REQUIREMENT_LEVEL_LABELS, item.requirementLevel),
                condition,
              ]
                .filter(Boolean)
                .join(' · ');
            })}
          />
        </div>
      </section>

      <p>
        <Link to={`/app/catalog/${definitionId}`}>Voltar à definição</Link>
      </p>

      <ConfirmDialog
        open={publishOpen}
        title={`Publicar versão v${version.version}`}
        description="A publicação é validada pelo backend. Versões publicadas tornam-se imutáveis."
        confirmLabel={publishing ? 'Publicando…' : 'Confirmar publicação'}
        confirmDisabled={publishing}
        onCancel={() => {
          if (!publishing) {
            setPublishOpen(false);
          }
        }}
        onConfirm={() => void handlePublish()}
      />
      </EnterpriseObjectPage>
    </ModulePage>
  );
}

function VersionList({ title, items }: { title: string; items: ReactNode[] }) {
  return (
    <section className="min-w-0 rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <h3 className="mt-0 mb-2 text-sm font-semibold text-gray-900">{title}</h3>
      {items.length === 0 ? (
        <p className="m-0 text-sm text-gray-500">—</p>
      ) : (
        <ul className="m-0 list-disc space-y-1 pl-5 text-sm text-gray-700">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
