import { Children, Fragment, isValidElement, useId, type ReactNode } from 'react';
import { Breadcrumb } from '../ui/Breadcrumb';
import { EmptyState } from '../ui/EmptyState';
import { cn } from '../ui/utils/cn';
import { ModuleDeniedState, ModuleErrorState, ModuleLoadingState } from '../ui/module-layout';
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
      <ModuleLoadingState title={phaseTitle} message={phaseMessage ?? 'Carregando o registro…'} />
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

  const hasAside = Boolean(aside || nextAction || context);
  const sections = objectSections(children);

  return (
    <div className={cn('flex min-w-0 flex-col gap-0', className)} data-layout="object-workspace">
      {breadcrumb && breadcrumb.length > 0 ? (
        <Breadcrumb items={breadcrumb} className="pb-2" />
      ) : null}

      {header}
      {stateFlow}
      {relations}

      {/*
        MAIN / SUPPORT GOVERNADO — a coluna de trabalho domina; o contexto lateral tem largura
        declarada, nao proporcao elastica. Sem aside real, o corpo ocupa a largura inteira em vez
        de deixar um vazio decorativo.

        PROPORCAO DO CONTRATO: o trabalho ocupa 65-72% e o suporte 28-35%. A coluna era `19rem`
        (304px) cravada — em 1600px isso e 21% e em 1280px e 23%, ou seja, o suporte ficava menor
        que o piso do contrato nas duas larguras. Agora a faixa e 300-380px e a divisa e do
        SUporte, nao do trabalho: em monitor largo o suporte cresce, em monitor estreito ele
        encolhe, e o trabalho nunca perde a proporcao.

        `items-start` e obrigatorio: sem ele a grade estica a coluna lateral ate a altura do main,
        o que faria a superficie de contexto parecer um painel do tamanho do trabalho — a antiga
        cardification de volta, agora em coluna.
      */}
      <div
        className={cn(
          'grid items-start gap-4 pt-4',
          hasAside ? 'xl:grid-cols-[minmax(0,1fr)_19rem]' : '',
          sections.length > 1 &&
            (hasAside
              ? '2xl:grid-cols-[9rem_minmax(0,1fr)_19rem]'
              : 'xl:grid-cols-[9rem_minmax(0,1fr)]'),
        )}
        data-layout="object-body"
      >
        {sections.length > 1 ? (
          <nav
            aria-label="Seções do registro"
            className={cn(
              'sticky top-16 hidden border-r border-[var(--erp-border)] pr-3',
              hasAside ? '2xl:block' : 'xl:block',
            )}
          >
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--erp-text-muted)]">
              Neste registro
            </p>
            <ul className="m-0 list-none space-y-1 p-0">
              {sections.map((title) => (
                <li key={title}>
                  <a
                    className="block rounded px-2 py-2 text-xs font-medium text-[var(--erp-text-secondary)] no-underline hover:bg-brand-50 hover:text-brand-700"
                    href={`#${sectionId(title)}`}
                  >
                    {title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <div className="flex min-w-0 flex-col gap-4" data-layout="object-content">
          {children}
        </div>
        {hasAside ? (
          <aside
            className="sticky top-16 flex min-w-0 flex-col gap-4 border-t border-[var(--erp-border)] bg-[var(--erp-surface-support)] p-3 xl:border-t-0 xl:border-l"
            aria-label="Decisões e contexto do registro"
          >
            {nextAction}
            {context}
            {aside}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function sectionId(title: string): string {
  return `object-${title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}`;
}

function objectSections(children: ReactNode): string[] {
  return [
    ...new Set(
      Children.toArray(children).flatMap((child) => {
        if (!isValidElement<{ title?: string; children?: ReactNode }>(child)) return [];
        if (child.type === Fragment) return objectSections(child.props.children);
        return child.type === ObjectPanel && child.props.title ? [child.props.title] : [];
      }),
    ),
  ];
}

/**
 * BLOCO DE CONTEUDO — parte do trabalho, separado por DIVISOR, nao por caixa.
 *
 * O `ObjectPanel` era `rounded-lg bg-white shadow-sm ring-1`, exatamente a superficie que fazia a
 * object page virar uma pilha de cards no mesmo plano. Agora ele e uma secao da area de trabalho:
 * a hierarquia vem do titulo, da tipografia e do divisor estrutural.
 */
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
  /*
   * NOME ACESSÍVEL DERIVADO DO TÍTULO.
   *
   * A seção já era uma `<section>` com `<h2>`, mas o título NÃO estava ligado a ela: leitores de
   * tela e testes encontravam um cabeçalho solto sem região correspondente, e `getByLabelText`
   * não tinha como endereçar o painel. `aria-labelledby` apontando para o próprio título resolve
   * os dois casos sem alterar a aparência nem a hierarquia visual.
   */
  const titleId = useId();
  return (
    <section
      id={title ? sectionId(title) : undefined}
      className={cn('scroll-mt-20 border border-[var(--erp-border)] bg-white p-4', className)}
      aria-labelledby={title ? titleId : undefined}
    >
      {title ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id={titleId} className="cisne-section-title m-0">
            {title}
          </h2>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
