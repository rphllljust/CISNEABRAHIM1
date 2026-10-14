import { useId, type ReactNode } from 'react';
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
    <div className={cn('flex flex-col gap-0', className)}>
      {breadcrumb && breadcrumb.length > 0 ? (
        <Breadcrumb items={breadcrumb} className="pb-2" />
      ) : null}

      {header}
      {stateFlow}
      {nextAction}
      {relations}
      {context}

      {/*
        MAIN / ASIDE GOVERNADO — a coluna de trabalho domina; o contexto lateral tem largura
        declarada, nao proporcao elastica. Sem aside real, o corpo ocupa a largura inteira em vez
        de deixar um vazio decorativo.

        `items-start` e obrigatorio: sem ele a grade estica a coluna lateral ate a altura do main,
        o que faria a superficie de contexto parecer um painel do tamanho do trabalho — a antiga
        cardification de volta, agora em coluna.
      */}
      <div
        className={cn(
          'grid items-start gap-0 pt-0',
          hasAside && 'lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-x-8',
        )}
      >
        <div className="flex min-w-0 flex-col gap-0 pt-4">{children}</div>
        {hasAside ? (
          <aside className="flex min-w-0 flex-col gap-0 border-t border-gray-200 pt-4 lg:border-t-0 lg:border-l lg:border-gray-200 lg:pl-8">
            {aside}
          </aside>
        ) : null}
      </div>
    </div>
  );
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
      className={cn('cisne-divider pb-3 last:border-b-0 last:pb-0', className)}
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
