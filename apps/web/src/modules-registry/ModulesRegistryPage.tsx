import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchModuleRegistryDetail, fetchModulesRegistry, RegistryApiError } from './api';
import {
  EMPTY_REGISTRY_FILTERS,
  MODULE_STATUS_COPY,
  describeModuleReason,
  filterRegistrySummaries,
  listRegistryDomains,
  sortRegistrySummaries,
  summarizeRegistrySummaries,
  type RegistryFilters,
  type RegistryStatusFilter,
} from './governance';
import type { ModuleRegistryDetail, ModuleRegistryStatus, ModuleRegistrySummary } from './types';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState, type ErrorStateKind } from '../ui/ErrorState';
import { Input } from '../ui/Input';
import { KpiCard } from '../ui/KpiCard';
import { LoadingState } from '../ui/LoadingState';
import { PageHeader } from '../ui/PageHeader';
import { ModulePage } from '../ui/module-layout';
import { Select } from '../ui/Select';
import { Skeleton } from '../ui/Skeleton';
import { StatusBadge } from '../ui/StatusBadge';

type LoadPhase = 'loading' | 'ready' | 'error';

type DetailDrawerState =
  | { status: 'closed' }
  | { status: 'loading'; module: ModuleRegistrySummary }
  | { status: 'ready'; module: ModuleRegistrySummary; detail: ModuleRegistryDetail }
  | { status: 'denied'; module: ModuleRegistrySummary }
  | { status: 'failed'; module: ModuleRegistrySummary; kind: 'network' | 'not_found' | 'unknown' };

type LoadFailureCopy = {
  kind: ErrorStateKind;
  title: string;
  message: string;
};

function describeLoadFailure(kind: RegistryApiError['kind']): LoadFailureCopy {
  switch (kind) {
    case 'unauthenticated':
      return {
        kind: 'denied',
        title: 'Sessão não autenticada',
        message: 'Sua sessão expirou. Entre novamente para consultar o registry de módulos.',
      };
    case 'denied':
      return {
        kind: 'denied',
        title: 'Acesso negado',
        message: 'O servidor negou a consulta do registry de módulos.',
      };
    case 'network':
      return {
        kind: 'unavailable',
        title: 'Sem conexão com o servidor',
        message: 'Não foi possível consultar o registry. Verifique sua conexão e tente novamente.',
      };
    default:
      return {
        kind: 'generic',
        title: 'Falha ao carregar o registry',
        message: 'Ocorreu um erro inesperado ao consultar o registry de módulos.',
      };
  }
}

function statusTone(status: ModuleRegistryStatus): 'success' | 'info' | 'neutral' {
  return MODULE_STATUS_COPY[status].tone;
}

function GovernanceKpis({ items }: { items: ModuleRegistrySummary[] }) {
  const summary = useMemo(() => summarizeRegistrySummaries(items), [items]);

  const kpis = [
    {
      label: 'Módulos no registry',
      value: summary.total,
      context: `${summary.domainCount} ${summary.domainCount === 1 ? 'domínio' : 'domínios'} de negócio`,
      tone: 'default' as const,
    },
    {
      label: 'Disponíveis',
      value: summary.available,
      context: 'Sem gate de release',
      tone: 'success' as const,
    },
    {
      label: 'Habilitados',
      value: summary.enabled,
      context: 'Flag de release ativa',
      tone: 'primary' as const,
    },
    {
      label: 'Não liberados',
      value: summary.notReleased,
      context: 'Fora do release-scope',
      tone: 'warning' as const,
    },
  ];

  return (
    <section aria-label="Resumo de governança do registry" className="mb-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            context={kpi.context}
            tone={kpi.tone}
            ariaLabel={`${kpi.label}: ${kpi.value}. ${kpi.context}`}
          />
        ))}
      </div>
    </section>
  );
}

function StatusLegend() {
  const entries = (Object.keys(MODULE_STATUS_COPY) as ModuleRegistryStatus[]).map((status) => ({
    status,
    copy: MODULE_STATUS_COPY[status],
  }));
  return (
    <section
      aria-label="Legenda de status de módulos"
      className="mb-6 rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-gray-900/5"
    >
      <h2 className="text-sm font-semibold tracking-tight text-gray-900">Significado dos status</h2>
      <ul className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
        {entries.map(({ status, copy }) => (
          <li key={status} className="rounded-lg bg-gray-50 p-3">
            <StatusBadge label={copy.label} tone={statusTone(status)} description={copy.hint} />
            <p className="mt-2 text-xs leading-relaxed text-gray-600">{copy.meaning}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RegistryFiltersBar({
  filters,
  domains,
  resultCount,
  totalCount,
  onChange,
  onClear,
}: {
  filters: RegistryFilters;
  domains: string[];
  resultCount: number;
  totalCount: number;
  onChange: (next: RegistryFilters) => void;
  onClear: () => void;
}) {
  const statusOptions: Array<{ value: RegistryStatusFilter; label: string }> = [
    { value: 'all', label: 'Todos os status' },
    { value: 'available', label: MODULE_STATUS_COPY.available.label },
    { value: 'enabled', label: MODULE_STATUS_COPY.enabled.label },
    { value: 'not_released', label: MODULE_STATUS_COPY.not_released.label },
  ];

  const hasActiveFilters =
    filters.query.trim().length > 0 || filters.status !== 'all' || filters.domain !== 'all';

  return (
    <section aria-label="Filtros de módulos" className="mb-6 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-900/5 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="modules-search" className="mb-1.5 block text-xs font-semibold text-gray-700">
            Buscar módulo
          </label>
          <Input
            id="modules-search"
            type="search"
            placeholder="Nome, descrição ou domínio"
            autoComplete="off"
            value={filters.query}
            onChange={(event) => onChange({ ...filters, query: event.target.value })}
          />
        </div>
        <div className="w-full sm:w-56">
          <label htmlFor="modules-status-filter" className="mb-1.5 block text-xs font-semibold text-gray-700">
            Status
          </label>
          <Select
            id="modules-status-filter"
            value={filters.status}
            onChange={(event) =>
              onChange({ ...filters, status: event.target.value as RegistryStatusFilter })
            }
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-56">
          <label htmlFor="modules-domain-filter" className="mb-1.5 block text-xs font-semibold text-gray-700">
            Domínio
          </label>
          <Select
            id="modules-domain-filter"
            value={filters.domain}
            onChange={(event) => onChange({ ...filters, domain: event.target.value })}
          >
            <option value="all">Todos os domínios</option>
            {domains.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </Select>
        </div>
        {hasActiveFilters ? (
          <Button type="button" variant="ghost" onClick={onClear}>
            Limpar filtros
          </Button>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="mt-3 text-xs text-gray-500">
        Exibindo {resultCount} de {totalCount} módulos.
      </p>
    </section>
  );
}

function ModuleCard({
  module,
  onOpenDetail,
}: {
  module: ModuleRegistrySummary;
  onOpenDetail: (module: ModuleRegistrySummary) => void;
}) {
  const copy = MODULE_STATUS_COPY[module.status];
  return (
    <article
      aria-label={`${module.name} — ${copy.label}`}
      className="flex flex-col rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-900/5"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{module.domain}</p>
        <StatusBadge label={copy.label} tone={statusTone(module.status)} description={copy.hint} />
      </div>
      <h2 className="mt-2 text-base font-semibold tracking-tight text-gray-900">{module.name}</h2>
      <p className="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-gray-600">{module.description}</p>
      <p className="mt-3 text-xs text-gray-400">{copy.hint}</p>
      {module.dependencies.length > 0 ? (
        <p className="mt-1 text-xs text-gray-500">
          Depende de {module.dependencies.length}{' '}
          {module.dependencies.length === 1 ? 'módulo' : 'módulos'}.
        </p>
      ) : null}
      <div className="mt-4 flex justify-end border-t border-gray-100 pt-3">
        <Button
          type="button"
          variant="secondary"
          aria-haspopup="dialog"
          onClick={() => onOpenDetail(module)}
        >
          Ver detalhes
        </Button>
      </div>
    </article>
  );
}

function DetailList({ title, items, emptyText }: { title: string; items: string[]; emptyText: string }) {
  return (
    <section aria-label={title} className="border-t border-gray-100 pt-4">
      <h3 className="text-sm font-semibold text-gray-900">
        {title} <span className="font-normal text-gray-400">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">{emptyText}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => (
            <li key={item} className="text-sm text-gray-700">
              <code className="break-all font-mono text-xs text-gray-600">{item}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReleaseStateSection({ module, detail }: { module: ModuleRegistrySummary; detail: ModuleRegistryDetail | null }) {
  const copy = MODULE_STATUS_COPY[module.status];
  return (
    <section aria-label="Situação de liberação" className="border-t border-gray-100 pt-4">
      <h3 className="text-sm font-semibold text-gray-900">Situação de liberação</h3>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge label={copy.label} tone={statusTone(module.status)} description={copy.hint} />
        <Badge tone={module.availability ? 'success' : 'neutral'}>
          {module.availability ? 'Disponível para operação' : 'Ainda não disponível'}
        </Badge>
      </div>
      {module.reasons.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {module.reasons.map((reason) => {
            const copyReason = describeModuleReason(reason);
            return (
              <li key={reason}>
                <p className="text-sm font-medium text-gray-800">
                  {copyReason.label} <span className="font-normal text-gray-400">· {reason}</span>
                </p>
                <p className="text-xs text-gray-500">{copyReason.detail}</p>
              </li>
            );
          })}
        </ul>
      ) : null}
      {detail && detail.featureFlag ? (
        <p className="mt-3 text-sm text-gray-600">
          Controle de release:{' '}
          <code className="break-all rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700">
            {detail.featureFlag}
          </code>
        </p>
      ) : null}
    </section>
  );
}

function ModuleDetailDrawerContent({
  state,
  domainModules,
  onRetry,
  onClose,
}: {
  state: Exclude<DetailDrawerState, { status: 'closed' }>;
  domainModules: Map<string, ModuleRegistrySummary>;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { module } = state;
  const copy = MODULE_STATUS_COPY[module.status];
  const moduleDomain = module.domain;

  if (state.status === 'loading') {
    return (
      <div aria-busy="true" aria-label={`Carregando detalhes de ${module.name}`} className="space-y-4">
        <Skeleton lines={2} />
        <Skeleton lines={3} />
        <Skeleton lines={2} />
      </div>
    );
  }

  if (state.status === 'denied') {
    return (
      <div className="space-y-4">
        <Alert tone="warning" title="Detalhes técnicos restritos">
          Os detalhes técnicos deste módulo exigem permissão específica de leitura técnica do registry
          (separada do console de administração de acesso). Solicite acesso ao administrador da
          plataforma. O resumo de governança permanece disponível abaixo.
        </Alert>
        <div className="rounded-lg bg-gray-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{module.name}</h3>
              <p className="text-xs text-gray-500">{moduleDomain}</p>
            </div>
            <StatusBadge label={copy.label} tone={statusTone(module.status)} description={copy.hint} />
          </div>
          <p className="mt-2 text-sm text-gray-600">{module.description}</p>
        </div>
      </div>
    );
  }

  if (state.status === 'failed') {
    const failure =
      state.kind === 'not_found'
        ? {
            title: 'Módulo não encontrado',
            message: 'O registry não retornou detalhes para este módulo.',
          }
        : state.kind === 'network'
          ? {
              title: 'Sem conexão com o servidor',
              message: 'Não foi possível carregar os detalhes técnicos. Verifique sua conexão.',
            }
          : {
              title: 'Falha ao carregar detalhes',
              message: 'Ocorreu um erro inesperado ao consultar os detalhes do módulo.',
            };
    return (
      <ErrorState
        kind={state.kind === 'not_found' ? 'not_found' : 'unavailable'}
        title={failure.title}
        message={failure.message}
        retryLabel="Tentar novamente"
        onRetry={onRetry}
        action={
          <Button type="button" variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        }
      />
    );
  }

  const detail = state.detail;
  const dependencyNames = detail.dependencies.map((code) => domainModules.get(code)?.name ?? code);

  return (
    <div className="space-y-4">
      <section aria-label="Identificação do módulo">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">{module.name}</h3>
            <p className="mt-1 text-xs text-gray-500">
              Identificador:{' '}
              <code className="break-all font-mono text-xs text-gray-600">{module.moduleCode}</code>
            </p>
            <p className="mt-0.5 text-xs text-gray-500">Domínio: {moduleDomain}</p>
          </div>
          <StatusBadge label={copy.label} tone={statusTone(module.status)} description={copy.hint} />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">{module.description}</p>
      </section>

      <ReleaseStateSection module={module} detail={detail} />

      <DetailList
        title="Capabilities"
        items={detail.capabilities}
        emptyText="Nenhuma capability mapeada para este módulo."
      />

      <DetailList
        title="Recursos protegidos"
        items={detail.resources}
        emptyText="Nenhum recurso protegido mapeado para este módulo."
      />

      <DetailList title="Rotas expostas" items={detail.routes} emptyText="Nenhuma rota exposta." />

      <section aria-label="Dependências" className="border-t border-gray-100 pt-4">
        <h3 className="text-sm font-semibold text-gray-900">
          Dependências <span className="font-normal text-gray-400">({dependencyNames.length})</span>
        </h3>
        {dependencyNames.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Nenhuma dependência declarada.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {dependencyNames.map((name) => (
              <Badge key={name} tone="neutral">
                {name}
              </Badge>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function ModulesRegistryPage() {
  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [failureKind, setFailureKind] = useState<RegistryApiError['kind']>('unknown');
  const [summaries, setSummaries] = useState<ModuleRegistrySummary[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [filters, setFilters] = useState<RegistryFilters>(EMPTY_REGISTRY_FILTERS);
  const [drawer, setDrawer] = useState<DetailDrawerState>({ status: 'closed' });

  useEffect(() => {
    let active = true;
    setPhase('loading');
    fetchModulesRegistry()
      .then((data) => {
        if (!active) return;
        setSummaries(data);
        setPhase('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof RegistryApiError) {
          setFailureKind(error.kind);
        } else {
          setFailureKind('unknown');
        }
        setPhase('error');
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const domains = useMemo(() => listRegistryDomains(summaries), [summaries]);
  const effectiveDomain = domains.includes(filters.domain) ? filters.domain : 'all';
  const effectiveFilters = { ...filters, domain: effectiveDomain };
  const visibleModules = useMemo(
    () => sortRegistrySummaries(filterRegistrySummaries(summaries, effectiveFilters)),
    [summaries, effectiveFilters],
  );
  const moduleByName = useMemo(
    () => new Map(summaries.map((item) => [item.moduleCode, item])),
    [summaries],
  );

  const retry = useCallback(() => {
    setFilters(EMPTY_REGISTRY_FILTERS);
    setReloadToken((token) => token + 1);
  }, []);

  const openDetail = useCallback((module: ModuleRegistrySummary) => {
    setDrawer({ status: 'loading', module });
    fetchModuleRegistryDetail(module.moduleCode)
      .then((detail) => {
        setDrawer((current) =>
          current.status === 'loading' && current.module.moduleCode === module.moduleCode
            ? { status: 'ready', module, detail }
            : current,
        );
      })
      .catch((error: unknown) => {
        setDrawer((current) => {
          if (current.status !== 'loading' || current.module.moduleCode !== module.moduleCode) {
            return current;
          }
          if (error instanceof RegistryApiError) {
            if (error.kind === 'denied') return { status: 'denied', module };
            if (error.kind === 'not_found') return { status: 'failed', module, kind: 'not_found' };
            if (error.kind === 'network') return { status: 'failed', module, kind: 'network' };
          }
          return { status: 'failed', module, kind: 'unknown' };
        });
      });
  }, []);

  const retryDetail = useCallback(() => {
    // Guard: só existe ação de retry no estado falho do drawer.
    if (drawer.status !== 'failed') return;
    openDetail(drawer.module);
  }, [drawer, openDetail]);

  const closeDetail = useCallback(() => setDrawer({ status: 'closed' }), []);
  const clearFilters = useCallback(() => setFilters(EMPTY_REGISTRY_FILTERS), []);

  const loading = phase === 'loading';

  return (
    <ModulePage className="w-full">
      <PageHeader
        eyebrow="Sistema"
        title="Módulos do sistema"
        description="Central de governança dos módulos registrados no servidor. O estado de liberação é derivado do registry e das flags de release — o frontend apenas apresenta. Detalhes técnicos ficam restritos a administradores de acesso."
      />

      {loading ? (
        <div aria-busy="true" aria-label="Carregando módulos">
          <div className="mb-5">
            <LoadingState label="Carregando módulos do registry…" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
                <Skeleton className="mb-3 w-2/3" />
                <Skeleton className="mb-2 w-1/3" />
                <Skeleton className="w-3/4" />
              </div>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-900/5">
                <Skeleton className="mb-4 w-1/4" />
                <Skeleton className="mb-2 w-1/2" />
                <Skeleton lines={2} className="mb-4" />
                <Skeleton className="w-2/5" />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {phase === 'error' ? (
        <ErrorState
          kind={describeLoadFailure(failureKind).kind}
          title={describeLoadFailure(failureKind).title}
          message={describeLoadFailure(failureKind).message}
          retryLabel="Tentar novamente"
          onRetry={retry}
        />
      ) : null}

      {phase === 'ready' ? (
        <>
          <GovernanceKpis items={summaries} />
          <StatusLegend />
          <RegistryFiltersBar
            filters={effectiveFilters}
            domains={domains}
            resultCount={visibleModules.length}
            totalCount={summaries.length}
            onChange={setFilters}
            onClear={clearFilters}
          />

          {visibleModules.length === 0 ? (
            <EmptyState
              title="Nenhum módulo encontrado"
              description="Nenhum módulo corresponde aos filtros atuais. Ajuste a busca ou limpe os filtros para ver o registry completo."
              action={
                <Button type="button" variant="secondary" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <section aria-label="Módulos registrados">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleModules.map((module) => (
                  <ModuleCard key={module.moduleCode} module={module} onOpenDetail={openDetail} />
                ))}
              </div>
            </section>
          )}
        </>
      ) : null}

      {drawer.status !== 'closed' ? (
        <Drawer open title={drawer.module.name} onClose={closeDetail}>
          <ModuleDetailDrawerContent
            state={drawer}
            domainModules={moduleByName}
            onRetry={retryDetail}
            onClose={closeDetail}
          />
        </Drawer>
      ) : null}
    </ModulePage>
  );
}
