import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import {
  CatalogApiError,
  getServiceDefinition,
  getServiceDefinitionVersion,
} from '../api/service-catalog-api';
import { mapCatalogErrorToMessage } from '../api/catalog-error-messages';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
} from '../../ui/module-layout';
import { VersionStatusBadge } from '../components/VersionStatusBadge';
import { ARCHETYPE_LABELS } from '../constants/catalog-vocabulary';
import { VERSION_STATUSES, type ServiceDefinitionVersion } from '../types/service-catalog.types';

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

export function ServiceDefinitionVersionDetailPage() {
  const { definitionId = '', versionNumber = '' } = useParams();
  const parsedVersion = Number(versionNumber);
  const [state, setState] = useState<VersionDetailState>({ phase: 'loading' });

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

  return (
    <ModulePage>
      <ModulePageHeader
        title={`${version.code} — v${version.version}`}
        action={
          <>
            <VersionStatusBadge status={version.status} />
            {!isPublished && version.status === VERSION_STATUSES.Draft ? (
              <Link
                to={`/app/catalog/${definitionId}/versions/${version.version}/edit`}
                className="button-link button-secondary"
              >
                Editar rascunho
              </Link>
            ) : null}
            {isPublished ? (
              <Link
                to={`/app/catalog/${definitionId}/versions/new`}
                className="button-link"
              >
                Criar nova versão
              </Link>
            ) : null}
          </>
        }
      />

      {isPublished ? (
        <p className="form-notice" role="note">
          Esta versão está publicada e é imutável. Para evoluir o serviço, crie uma nova versão em rascunho.
        </p>
      ) : null}

      <section className="catalog-section">
        <dl className="catalog-details">
          <div>
            <dt>Nome</dt>
            <dd>{version.name}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <VersionStatusBadge status={version.status} />
            </dd>
          </div>
          <div>
            <dt>Publicada em</dt>
            <dd>{formatDateTime(version.publishedAt)}</dd>
          </div>
          <div>
            <dt>Arquétipo</dt>
            <dd>{ARCHETYPE_LABELS[version.archetype] ?? version.archetype}</dd>
          </div>
          <div>
            <dt>Medição</dt>
            <dd>
              {version.measurementMode} / {version.measurementBasis}
            </dd>
          </div>
          <div>
            <dt>Descrição</dt>
            <dd>{version.description ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="catalog-section">
        <h2>Configuração estruturada</h2>
        <h3>Unidades permitidas</h3>
        <ul>
          {version.allowedUnits.map((unit) => (
            <li key={unit.unitCode}>
              {unit.unitCode}
              {unit.isDefault ? ' (padrão)' : ''}
            </li>
          ))}
        </ul>
        <h3>Modelos de preço</h3>
        <ul>
          {version.pricingModels.map((model, index) => (
            <li key={`${model.modelCode}-${index}`}>
              {model.modelCode}
              {model.unitCode ? ` / ${model.unitCode}` : ''}
              {model.salePrice ? ` — venda ${model.salePrice}` : ''}
            </li>
          ))}
        </ul>
        <h3>Requisitos de recurso</h3>
        {version.resourceRequirements.length === 0 ? (
          <p>—</p>
        ) : (
          <ul>
            {version.resourceRequirements.map((item, index) => (
              <li key={`${item.resourceTypeCode}-${index}`}>
                {item.resourceTypeCode} ({item.requirementLevel})
              </li>
            ))}
          </ul>
        )}
        <h3>Requisitos de mão de obra</h3>
        {version.laborRequirements.length === 0 ? (
          <p>—</p>
        ) : (
          <ul>
            {version.laborRequirements.map((item, index) => (
              <li key={`${item.laborTypeCode}-${index}`}>
                {item.laborTypeCode} ({item.requirementLevel})
              </li>
            ))}
          </ul>
        )}
        <h3>Requisitos de evidência</h3>
        {version.executionRequirements.length === 0 ? (
          <p>—</p>
        ) : (
          <ul>
            {version.executionRequirements.map((item, index) => (
              <li key={`${item.requirementType}-${index}`}>
                {item.requirementType} ({item.requirementLevel})
              </li>
            ))}
          </ul>
        )}
      </section>

      <p>
        <Link to={`/app/catalog/${definitionId}`}>Voltar à definição</Link>
      </p>
    </ModulePage>
  );
}
