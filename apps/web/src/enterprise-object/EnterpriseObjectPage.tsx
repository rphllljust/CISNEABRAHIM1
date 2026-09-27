import type { ReactNode } from 'react';
import { Breadcrumb } from '../ui/Breadcrumb';
import { EmptyState } from '../ui/EmptyState';
import { cn } from '../ui/utils/cn';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
} from '../ui/module-layout';
import type { EnterpriseObjectPageProps } from './types';

/**
 * CISNE — ENTERPRISE OBJECT PAGE
 *
 * Moldura unica das object pages. Ela existe para que "cliente", "proposta" e "ordem de
 * servico" tenham a MESMA gramatica de leitura:
 *
 *   breadcrumb -> header -> fluxo -> proxima acao -> relacoes -> [conteudo | historico]
 *
 * 8 — DENIED / ERROR / EMPTY COERENTES
 * Os quatro estados de pagina (loading, denied, error, empty) sao resolvidos AQUI, uma
 * unica vez. Nenhuma object page inventa o proprio estado vazio, e nenhuma delas mascara
 * falha de autorizacao como lista vazia: negacao nao e ausencia de dado.
 *
 * DENSIDADE: a coluna lateral so existe quando ha conteudo real. Sem conteudo lateral, o
 * corpo ocupa a largura inteira em vez de deixar um vazio decorativo.
 */

export function EnterpriseObjectPage({
  breadcrumb,
  header,
  stateFlow,
  nextAction,
  context,
  relations,
  children,
  aside,
  phase = 'ready',
  phaseTitle = 'Registro',
  phaseMessage,
  onRetry,
  className,
}: EnterpriseObjectPageProps) {
  if (phase === 'loading') {
    return (
      <ModuleLoadingState
        title={phaseTitle}
        message={phaseMessage ?? 'Carregando o registro…'}
      />
    );
  }

  if (phase === 'denied') {
    return (
      <ModuleDeniedState
        title={phaseTitle}
        message={phaseMessage ?? 'Você não tem permissão para acessar este registro.'}
      />
    );
  }

  if (phase === 'error') {
    return (
      <ModuleErrorState
        title={phaseTitle}
        message={phaseMessage ?? 'Não foi possível carregar o registro.'}
        retryable={onRetry !== undefined}
        onRetry={onRetry}
      />
    );
  }

  if (phase === 'empty') {
    return (
      <>
        {breadcrumb && breadcrumb.length > 0 ? (
          <Breadcrumb items={breadcrumb} className="mb-2" />
        ) : null}
        <EmptyState
          title={phaseTitle}
          description={phaseMessage ?? 'Este registro não está mais disponível.'}
        />
      </>
    );
  }

  const hasAside = aside !== null && aside !== undefined;

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {breadcrumb && breadcrumb.length > 0 ? <Breadcrumb items={breadcrumb} /> : null}

      {header}
      {stateFlow}
      {nextAction}
      {relations}
      {context}

      <div className={cn('grid gap-2.5', hasAside && 'lg:grid-cols-[minmax(0,1fr)_20rem]')}>
        <div className="flex min-w-0 flex-col gap-2.5">{children}</div>
        {hasAside ? <aside className="flex min-w-0 flex-col gap-2.5">{aside}</aside> : null}
      </div>
    </div>
  );
}

/** Bloco de conteudo do corpo/coluna lateral, na mesma densidade da moldura. */
export function ObjectPanel({
  title,
  children,
  className,
  actions,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={cn('rounded-lg bg-white px-4 py-3 shadow-sm ring-1 ring-gray-900/5', className)}>
      {title ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="m-0 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">{title}</h2>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
