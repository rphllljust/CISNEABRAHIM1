import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, ArrowUpRight, BookOpenText, Boxes, BriefcaseBusiness,
  CircleAlert, ClipboardList, GitBranch, RefreshCcw, ShieldCheck,
  WalletCards, Wrench, type LucideIcon,
} from 'lucide-react';
import { ModulePage } from '../../ui/module-layout';
import { SHELL_NAV_ITEMS } from '../../shell/nav-config';
import { isNavItemVisible, useNavAccess } from '../../shell/useNavAccess';
import {
  getWorkInbox, WORK_DOMAIN_LABELS, WORK_KIND_LABELS,
  type WorkDomain, type WorkInboxPage, type WorkKind,
} from '../../work-inbox/api/work-inbox-api';
import { DOMAIN_WORKSPACES, DOMAIN_WORKSPACE_PATHS } from '../domain-workspaces';

/**
 * The single enterprise launchpad. SAP Fiori: role-oriented business areas and process links.
 * Dynamics 365: live actionable work lists. ERPNext: end-to-end business navigation.
 *
 * Read models remain owned by GET /work-inbox; these cards never fabricate counts,
 * financial status, transaction states, or permissions. Every transaction remains in its
 * owning module, with record-level authorization enforced by the backend.
 */
const DOMAIN_ORDER: WorkDomain[] = [
  'OPERACOES', 'COMERCIAL', 'FINANCEIRO', 'SUPRIMENTOS', 'FISCAL', 'CONTABILIDADE',
];

const DOMAIN_ICON: Record<WorkDomain, LucideIcon> = {
  OPERACOES: Wrench,
  COMERCIAL: BriefcaseBusiness,
  FINANCEIRO: WalletCards,
  SUPRIMENTOS: Boxes,
  FISCAL: ClipboardList,
  CONTABILIDADE: BookOpenText,
};

const QUEUE_FILTERS: Array<{ id: 'ALL' | WorkKind; label: string }> = [
  { id: 'ALL', label: 'Tudo' },
  { id: 'BLOCKER', label: 'Bloqueios' },
  { id: 'APPROVAL', label: 'Aprovações' },
  { id: 'EXCEPTION', label: 'Exceções' },
  { id: 'OVERDUE', label: 'Vencidos' },
  { id: 'CONTINUITY', label: 'Continuidade' },
];

/** Real module routes; order is a navigation map, not an invented process status. */
const PROCESS_STAGES = [
  { label: 'Cliente', route: '/app/clients', domain: 'COMERCIAL' },
  { label: 'Solicitação', route: '/app/requests', domain: 'COMERCIAL' },
  { label: 'Proposta', route: '/app/proposals', domain: 'COMERCIAL' },
  { label: 'Contrato', route: '/app/contracts', domain: 'COMERCIAL' },
  { label: 'Ordem de serviço', route: '/app/service-orders', domain: 'OPERACOES' },
  { label: 'Medição pela OS', route: '/app/service-orders', domain: 'OPERACOES' },
  { label: 'Faturamento', route: '/app/billing', domain: 'FINANCEIRO' },
  { label: 'Recebíveis', route: '/app/finance/receivables', domain: 'FINANCEIRO' },
  { label: 'Conciliação', route: '/app/finance/reconciliation', domain: 'FINANCEIRO' },
  { label: 'Lançamentos', route: '/app/accounting/journals', domain: 'CONTABILIDADE' },
  { label: 'Fechamento', route: '/app/closing', domain: 'CONTABILIDADE' },
] as const;

type ReadState =
  | { phase: 'loading' }
  | { phase: 'denied' | 'error' }
  | { phase: 'ready'; page: WorkInboxPage };

function isDomain(value: string | null): value is WorkDomain {
  return DOMAIN_ORDER.some((domain) => domain === value);
}

function isKind(value: string | null): value is WorkKind {
  return QUEUE_FILTERS.some((filter) => filter.id === value && filter.id !== 'ALL');
}

function safeTarget(route: string): string | null {
  return /^\/app(?:\/|$)/.test(route) && !route.includes('//') ? route : null;
}

function dateLabel(value: string | null): string {
  if (!value) return 'Sem prazo';
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? 'Sem prazo' : time.toLocaleDateString('pt-BR');
}

function phaseFromError(error: unknown): 'denied' | 'error' {
  return error instanceof Error && 'kind' in error && error.kind === 'denied'
    ? 'denied'
    : 'error';
}

/** Deliberately never converts an unavailable domain into a zero-count domain. */
export function workspaceDomainCount(
  page: WorkInboxPage | null,
  domain: WorkDomain,
): number | null {
  if (!page || page.unavailableDomains.includes(domain)) return null;
  const count = page.byDomain[domain];
  return typeof count === 'number' && Number.isFinite(count) && count >= 0
    ? count
    : null;
}

export function WorkspacesIndexPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const domain = isDomain(searchParams.get('domain')) ? searchParams.get('domain') as WorkDomain : 'OPERACOES';
  const kind = isKind(searchParams.get('kind')) ? searchParams.get('kind') as WorkKind : null;
  const [revision, setRevision] = useState(0);
  const [overview, setOverview] = useState<ReadState>({ phase: 'loading' });
  const [work, setWork] = useState<ReadState>({ phase: 'loading' });
  const { access, loading: navLoading } = useNavAccess();

  useEffect(() => {
    const controller = new AbortController();
    setOverview({ phase: 'loading' });
    void getWorkInbox({ limit: 1, offset: 0 }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setOverview({ phase: 'ready', page });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setOverview({ phase: phaseFromError(error) });
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const controller = new AbortController();
    setWork({ phase: 'loading' });
    void getWorkInbox({ domain, kind: kind ?? undefined, limit: 8, offset: 0 }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setWork({ phase: 'ready', page });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setWork({ phase: phaseFromError(error) });
      });
    return () => controller.abort();
  }, [domain, kind, revision]);

  const page = overview.phase === 'ready' ? overview.page : null;
  const workPage = work.phase === 'ready' ? work.page : null;
  const selectedIncomplete = (workPage?.unavailableDomains.includes(domain) ?? false) ||
    (page?.unavailableDomains.includes(domain) ?? false);
  const incomplete = page?.unavailableDomains.length ?? 0;
  const navigationReady = !navLoading;
  const allowedRoute = (path: string): boolean => {
    if (!navigationReady) return false;
    const navItem = SHELL_NAV_ITEMS.find((item) => item.path === path);
    return navItem ? isNavItemVisible(navItem.id, access, false) : false;
  };
  const selectDomain = (next: WorkDomain) => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.set('domain', next);
      params.delete('kind');
      return params;
    });
  };
  const selectKind = (next: 'ALL' | WorkKind) => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === 'ALL') params.delete('kind');
      else params.set('kind', next);
      return params;
    });
  };

  return (
    <ModulePage layout="workspace">
      <div className="min-w-0 space-y-4 pb-6" data-layout="tier1-enterprise-launchpad">
        <header className="overflow-hidden rounded-lg border border-[#1C3450] bg-[#0C1F35] text-white">
          <div className="grid gap-5 px-5 py-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(17rem,1fr)] xl:items-end">
            <div className="space-y-3">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.23em] text-[#B8CBE3]">
                CISNE / ENTERPRISE OPERATIONS
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/20 bg-white/10">
                  <GitBranch className="h-6 w-6 text-[#E8C88F]" aria-hidden="true" />
                </div>
                <div>
                  <h1 className="m-0 text-[25px] font-bold leading-tight tracking-tight text-white">
                    Central empresarial
                  </h1>
                  <p className="m-0 mt-1 text-[12px] text-[#B8CBE3]">
                    Um posto de trabalho para decisões, processos e continuidade entre áreas.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/app/work-inbox"
                  className="inline-flex items-center gap-2 rounded-md bg-[#E6C88F] px-3 py-2 text-[12px] font-bold text-[#0C1F35] no-underline hover:bg-[#F3D7A8]"
                >
                  Abrir fila corporativa <ArrowUpRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link
                  to="/app"
                  className="inline-flex items-center gap-2 rounded-md border border-white/25 px-3 py-2 text-[12px] font-semibold text-white no-underline hover:bg-white/10"
                >
                  Painel operacional
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2" aria-label="Situação da operação">
              <div className="rounded-md border border-white/15 bg-white/10 p-3">
                <p className="m-0 text-[10px] uppercase tracking-wide text-[#B8CBE3]">Trabalho autorizado</p>
                <p className="m-0 mt-2 text-3xl font-semibold tabular-nums">
                  {page ? page.total : '—'}
                </p>
                <p className="m-0 mt-1 text-[11px] text-[#B8CBE3]">
                  {page ? 'Itens no conjunto publicado' : 'Aguardando leitura'}
                </p>
              </div>
              <div className="rounded-md border border-white/15 bg-white/10 p-3">
                <p className="m-0 text-[10px] uppercase tracking-wide text-[#B8CBE3]">Fontes indisponíveis</p>
                <p className="m-0 mt-2 text-3xl font-semibold tabular-nums">
                  {page ? incomplete : '—'}
                </p>
                <p className="m-0 mt-1 text-[11px] text-[#B8CBE3]">
                  {page ? 'Domínios sem leitura completa' : 'Não inferir zero'}
                </p>
              </div>
            </div>
          </div>
        </header>

        {overview.phase === 'denied' ? (
          <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            A leitura empresarial não está autorizada para esta sessão. Nenhuma contagem foi exibida.
          </div>
        ) : null}
        {overview.phase === 'error' ? (
          <div role="alert" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            A leitura da operação falhou. As contagens não estão disponíveis.
          </div>
        ) : null}
        {page && incomplete > 0 ? (
          <div role="status" className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
            Leitura parcial: {page.unavailableDomains.join(', ')}. Domínios indisponíveis não são considerados zerados.
          </div>
        ) : null}

        <section aria-labelledby="enterprise-areas-heading" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="enterprise-areas-heading" className="m-0 text-[15px] font-semibold text-[var(--color-text-primary)]">
                Áreas de trabalho
              </h2>
              <p className="m-0 text-xs text-[var(--color-text-muted)]">
                Selecione uma área para operar a fila. Abra o workspace para ver o contexto completo.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRevision((value) => value + 1)}
              className="inline-flex items-center gap-2 rounded border border-[var(--erp-border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--erp-text-secondary)]"
            >
              <RefreshCcw className="h-4 w-4" aria-hidden /> Atualizar dados
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" role="group" aria-label="Seis áreas empresariais">
            {DOMAIN_ORDER.map((item) => {
              const Icon = DOMAIN_ICON[item];
              const total = workspaceDomainCount(page, item);
              const active = item === domain;
              return (
                <article
                  key={item}
                  className={
                    'min-w-0 rounded-md border bg-white p-3 transition-colors ' +
                    (active
                      ? 'border-[#2B66B1] bg-[#EFF5FD] shadow-[inset_3px_0_0_#2B66B1]'
                      : 'border-[var(--erp-border)] hover:border-[#A7BBD2]')
                  }
                  data-domain={item}
                  data-active={active ? 'true' : 'false'}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[#EEF2F8] text-[#244870]">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <Link
                          to={DOMAIN_WORKSPACE_PATHS[item]}
                          className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#173B64] no-underline hover:underline"
                          aria-label={WORK_DOMAIN_LABELS[item] + ' — abrir workspace'}
                        >
                          {WORK_DOMAIN_LABELS[item]}
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                        <p className="m-0 text-[11px] text-[var(--color-text-muted)]">
                          {total === null ? 'Leitura indisponível' : total === 1 ? '1 pendência' : total + ' pendências'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => selectDomain(item)}
                      aria-pressed={active}
                      aria-label={'Ver pendências de ' + WORK_DOMAIN_LABELS[item]}
                      className={
                        'shrink-0 rounded px-2 py-1.5 text-[11px] font-semibold ' +
                        (active ? 'bg-[#1D4F88] text-white' : 'border border-[#D9E0E8] text-[#315C87]')
                      }
                    >
                      {active ? 'Selecionado' : 'Ver fila'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,1fr)]">
          <section aria-label="Bancada de trabalho do domínio" className="min-w-0 overflow-hidden rounded-md border border-[var(--erp-border)] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--erp-border)] px-4 py-3">
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Workspace ativo
                </p>
                <h2 className="m-0 mt-1 text-lg font-bold text-[#143451]">
                  {WORK_DOMAIN_LABELS[domain]}
                </h2>
                <p className="m-0 mt-1 text-[11px] text-[var(--color-text-secondary)]">
                  {DOMAIN_WORKSPACES[domain].purpose}
                </p>
              </div>
              <Link to={DOMAIN_WORKSPACE_PATHS[domain]}
                className="inline-flex items-center gap-1.5 rounded bg-[#225B99] px-3 py-2 text-xs font-semibold text-white no-underline hover:bg-[#164875]">
                Abrir workspace <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
            <div className="flex flex-wrap gap-1.5 border-b border-[var(--erp-border)] bg-[#F8FAFD] p-3" role="group" aria-label="Filtro de pendências do domínio">
              {QUEUE_FILTERS.map((filter) => {
                const active = (kind ?? 'ALL') === filter.id;
                return (
                  <button key={filter.id} type="button" onClick={() => selectKind(filter.id)}
                    aria-pressed={active}
                    className={
                      'rounded px-2.5 py-1.5 text-[11px] font-semibold ' +
                      (active ? 'bg-[#244F7F] text-white' : 'border border-[#DCE3EB] bg-white text-[#42617F]')
                    }>
                    {filter.label}
                  </button>
                );
              })}
            </div>
            {work.phase === 'loading' ? (
              <p role="status" className="p-4 text-sm text-[var(--color-text-secondary)]">
                Consultando trabalho autorizado…
              </p>
            ) : null}
            {work.phase === 'denied' ? (
              <p role="alert" className="p-4 text-sm text-red-800">
                Acesso à fila deste domínio não autorizado.
              </p>
            ) : null}
            {work.phase === 'error' ? (
              <p role="alert" className="p-4 text-sm text-amber-900">
                Falha ao consultar pendências. Use Atualizar dados para tentar novamente.
              </p>
            ) : null}
            {selectedIncomplete ? (
              <p role="status" className="border-b border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Domínio indisponível nesta leitura. A lista pode estar incompleta.
              </p>
            ) : null}
            {workPage && workPage.items.length === 0 ? (
              <p className="p-4 text-sm text-[var(--color-text-secondary)]">
                {selectedIncomplete
                  ? 'Não foi possível comprovar a ausência de pendências.'
                  : 'Nenhum item neste recorte autorizado.'}
              </p>
            ) : null}
            {workPage && workPage.items.length > 0 ? (
              <ul className="m-0 list-none divide-y divide-[var(--erp-border)] p-0" aria-label="Itens da fila autorizada">
                {workPage.items.map((item) => {
                  const target = safeTarget(item.targetRoute);
                  return (
                    <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-[#F8FAFC]">
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-[#56718C]">
                          {WORK_KIND_LABELS[item.kind]} · {item.businessReference}
                        </p>
                        <p className="m-0 mt-1 break-words text-[13px] font-semibold text-[#152D48]">{item.title}</p>
                        <p className="m-0 mt-1 break-words text-[11px] text-[#62758A]">
                          {item.reason} · {dateLabel(item.dueAt)}
                        </p>
                      </div>
                      {target ? (
                        <Link to={target}
                          className="inline-flex shrink-0 items-center gap-1 rounded border border-[#BCD1E7] px-2.5 py-2 text-xs font-semibold text-[#1E5A95] no-underline hover:bg-[#E9F2FD]">
                          {item.actionLabel} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                      ) : (
                        <span className="text-xs text-[#66778A]">Ação indisponível</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {workPage ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--erp-border)] bg-[#F7F9FC] px-4 py-3 text-[11px] text-[#5B7088]">
                <span>
                  {workPage.items.length} de {workPage.total} itens do recorte publicado
                  {selectedIncomplete ? ' · leitura parcial' : ''}
                </span>
                <Link
                  className="font-semibold text-[#215C98] no-underline hover:underline"
                  to={'/app/work-inbox?domain=' + domain + (kind ? '&kind=' + kind : '')}>
                  Ver fila completa <ArrowRight className="inline h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            ) : null}
            <div className="border-t border-[var(--erp-border)] px-4 py-3">
              <p className="m-0 text-[11px] font-semibold text-[#61758B]">Continuar no módulo</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {DOMAIN_WORKSPACES[domain].shortcuts.filter((item) => allowedRoute(item.to)).map((shortcut) => (
                  <Link key={shortcut.to} to={shortcut.to}
                    className="rounded border border-[#DBE4ED] px-2.5 py-1.5 text-xs font-medium text-[#275785] no-underline hover:bg-[#EEF4FC]">
                    {shortcut.label}
                  </Link>
                ))}
                {!navigationReady ? <span className="text-xs text-[#67768B]">Validando acessos…</span> : null}
              </div>
            </div>
          </section>

          <section aria-label="Jornada empresarial" className="min-w-0 overflow-hidden rounded-md border border-[var(--erp-border)] bg-white">
            <div className="border-b border-[var(--erp-border)] bg-[#F5F8FC] px-4 py-3">
              <div className="flex items-center gap-2 text-[#244F79]">
                <GitBranch className="h-4 w-4" aria-hidden />
                <h2 className="m-0 text-sm font-bold">Processo empresarial integrado</h2>
              </div>
              <p className="m-0 mt-1 text-[11px] text-[#62768B]">
                Cliente → operação → faturamento → recebimento → contabilidade.
                Navegação real; a etapa não indica transação concluída.
              </p>
            </div>
            <ol className="m-0 list-none divide-y divide-[#EDF0F4] p-0" aria-label="Etapas Service-to-Cash">
              {PROCESS_STAGES.map((stage, index) => {
                const allowed = allowedRoute(stage.route);
                const active = stage.domain === domain;
                return (
                  <li key={stage.label} className={
                    'flex items-center gap-3 px-4 py-2 ' + (active ? 'bg-[#F2F7FD]' : '')
                  }>
                    <span className={
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ' +
                      (active ? 'bg-[#245A93] text-white' : 'bg-[#E8EDF4] text-[#5C6D7F]')
                    }>
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      {allowed ? (
                        <Link to={stage.route}
                          className="text-[12px] font-semibold text-[#204F80] no-underline hover:underline">
                          {stage.label}
                        </Link>
                      ) : (
                        <span className="text-[12px] text-[#7B8796]">{stage.label}</span>
                      )}
                      <p className="m-0 text-[10px] text-[#778698]">
                        {WORK_DOMAIN_LABELS[stage.domain]}
                      </p>
                    </div>
                    {allowed ? <ArrowUpRight className="h-4 w-4 text-[#557B9E]" aria-hidden /> :
                      <ShieldCheck className="h-4 w-4 text-[#B2BFCD]" aria-label="Acesso não disponível" />}
                  </li>
                );
              })}
            </ol>
            <div className="flex items-start gap-2 border-t border-[var(--erp-border)] bg-[#FAFBFD] px-4 py-3">
              <CircleAlert className="h-4 w-4 shrink-0 text-[#7089A4]" aria-hidden />
              <p className="m-0 text-[11px] leading-relaxed text-[#62768B]">
                Esta trilha organiza os módulos existentes. Situação, aceite, saldo e escrituração só
                podem ser confirmados nos respectivos objetos e transações autorizadas.
              </p>
            </div>
          </section>
        </div>
      </div>
    </ModulePage>
  );
}
