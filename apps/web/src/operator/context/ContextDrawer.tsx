import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useWorkspaceContextDock } from '../../ui/workspace-frame';
import { X } from 'lucide-react';
import { Drawer } from '../../ui/Drawer';
import { cn } from '../../ui/utils/cn';

/**
 * CONTEXT DRAWER — painel lateral contextual para listas maduras.
 *
 * Consome SOMENTE o payload que a lista ja possui (mesma fonte autorizada que
 * abasteceu a linha). Este componente nao busca, nao hidrata e nao amplia dado:
 * se um campo nao esta no payload, ele nao aparece. Se o detalhe completo exigir
 * API nova, o painel apenas oferece o atalho para a pagina de detalhe.
 *
 * Nao duplica regra de dominio — apenas apresenta fatos recebidos.
 */

export type ContextField = {
  label: string;
  value: ReactNode;
  /** Destaque para o campo que decide a proxima acao. */
  emphasis?: boolean;
};

export type ContextRelation = {
  label: string;
  value: string;
  href?: string;
};

export type ContextDrawerAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  /** Acoes sensiveis sao apenas sinalizadas; a autorizacao real e do backend. */
  kind?: 'primary' | 'secondary';
};

export type ContextPreviewBody = {
  /** Identificacao humana do registro — nunca apenas um UUID. */
  identifier: string;
  subtitle?: string | null;
  status?: ReactNode;
  facts: ContextField[];
  relations?: ContextRelation[];
  nextAction?: ContextDrawerAction | null;
  /** Atalho para a pagina de detalhe completa. */
  detailHref?: string;
  detailLabel?: string;
  /**
   * CONTEXTO AMPLIADO — o que o objeto publica alem dos fatos da linha.
   *
   * Existe porque algumas superficies precisam mostrar uma RELACAO VIVA do objeto (a cadeia de
   * negocio, por exemplo), que exige leitura propria e nao cabe num par rotulo/valor. O painel
   * continua sendo UM so: `body` acrescenta conteudo dentro dele, e nao um segundo drawer.
   *
   * O contrato original segue intacto — painel que nao precisa de contexto ampliado nao o declara,
   * e o drawer nao busca, nao hidrata e nao amplia dado por conta propria.
   */
  body?: ReactNode;
};

export type ContextDrawerProps = {
  open: boolean;
  title: string;
  preview: ContextPreviewBody | null;
  onClose: () => void;
  /**
   * MODO DE ENQUADRAMENTO.
   *
   * `overlay` (padrao) — o painel flutua sobre a area de trabalho com scrim. E o modo correto para
   * listas de pagina inteira, onde nao existe coluna reservada para o contexto.
   *
   * `inline` — o painel e uma COLUNA REAL do layout do chamador: sem scrim, sem `position: fixed`,
   * com `border-left`, e a altura e governada pelo container. E o modo dos workspaces em que o
   * contexto deve conviver com a worklist na MESMA dobra, sem que abrir contexto destrua filtro,
   * selecao, paginacao ou posicao de scroll.
   *
   * O conteudo e o MESMO nos dois modos: o que muda e apenas o enquadramento.
   */
  variant?: 'overlay' | 'inline';
  /** Classe do container no modo `inline` (largura e altura vem do chamador). */
  className?: string;
};

export function ContextDrawer({
  open,
  title,
  preview,
  onClose,
  variant = 'overlay',
  className,
}: ContextDrawerProps) {
  const dock = useWorkspaceContextDock(open && variant === 'overlay');
  const body = preview ? (
    <div className="flex flex-col gap-3.5 text-sm">
      {/*
            CABECALHO DA ENTIDADE — identificador em 22px/750 navy. E a identidade do OBJETO, nao um
            titulo de secao: precisa dominar o painel para que o operador saiba, sem ler nada mais,
            de que registro ele esta olhando.
          */}
      <header className="border-b border-[color:var(--erp-border)] pb-2">
        <p className="text-[18px] leading-tight font-bold tracking-tight text-[color:var(--erp-text)]">
          {preview.identifier}
        </p>
        {preview.subtitle ? (
          <p className="mt-0.5 text-[12px] text-[color:var(--erp-text-secondary)]">
            {preview.subtitle}
          </p>
        ) : null}
        {preview.status ? <div className="mt-2">{preview.status}</div> : null}
      </header>

      {preview.facts.length > 0 ? (
        <dl className="m-0 grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          {preview.facts.map((field) => (
            <div
              key={field.label}
              className="col-span-2 grid grid-cols-subgrid border-b border-[color:var(--erp-border)] pb-1 last:border-b-0"
            >
              <dt className="text-[10px] font-semibold tracking-wide text-[color:var(--erp-text-muted)] uppercase">
                {field.label}
              </dt>
              <dd
                className={
                  field.emphasis
                    ? 'm-0 text-[12px] font-bold text-[color:var(--erp-critical)] tabular-nums'
                    : 'm-0 text-[12px] font-medium text-[color:var(--erp-text)]'
                }
              >
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {preview.relations && preview.relations.length > 0 ? (
        <section aria-label="Relacionamentos">
          <h3 className="mb-2 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
            Relacionamentos
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {preview.relations.map((relation) => (
              <li key={`${relation.label}:${relation.value}`} className="text-[13px] text-gray-700">
                <span className="text-xs text-gray-500">{relation.label}: </span>
                {relation.href ? (
                  <Link className="text-brand-700 underline" to={relation.href}>
                    {relation.value}
                  </Link>
                ) : (
                  relation.value
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Contexto ampliado do objeto: a superficie decide o que cabe aqui. */}
      {preview.body ?? null}

      <section className="mt-auto flex flex-col gap-2 border-t border-gray-100 pt-3">
        {preview.nextAction ? (
          preview.nextAction.href ? (
            <Link
              className="inline-flex items-center justify-center rounded-md border border-cisne-action bg-cisne-action px-3 py-2 text-xs font-semibold text-white no-underline hover:bg-cisne-action-hover"
              to={preview.nextAction.href}
            >
              {preview.nextAction.label}
            </Link>
          ) : (
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md border border-cisne-action bg-cisne-action px-3 py-2 text-xs font-semibold text-white hover:bg-cisne-action-hover"
              onClick={preview.nextAction.onClick}
            >
              {preview.nextAction.label}
            </button>
          )
        ) : null}
        {preview.detailHref ? (
          <Link
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 no-underline hover:bg-gray-50"
            to={preview.detailHref}
          >
            {preview.detailLabel ?? 'Abrir detalhe completo'}
          </Link>
        ) : null}
      </section>
    </div>
  ) : (
    <p className="text-sm text-gray-500">Selecione um registro na lista.</p>
  );

  if (variant === 'inline') {
    return (
      <InlineContextPanel open={open} title={title} onClose={onClose} className={className}>
        {body}
      </InlineContextPanel>
    );
  }

  if (dock) {
    return createPortal(
      <InlineContextPanel open={open} title={title} onClose={onClose}>
        {body}
      </InlineContextPanel>,
      dock,
    );
  }

  return (
    <Drawer open={open} title={title} onClose={onClose} side="right">
      {body}
    </Drawer>
  );
}

/**
 * PAINEL DE CONTEXTO ANCORADO — a coluna, nao o modal.
 *
 * Ele NAO usa o `Drawer` por um motivo de comportamento, nao de estilo: o `Drawer` prende o foco
 * na `aside` (`role="dialog"`), o que esta certo para um modal e errado para uma coluna de
 * trabalho — o operador precisa alternar entre a linha da fila e o contexto sem sair do painel a
 * cada clique. Aqui a coluna e um `complementary` navegavel: o foco entra por Tab, o `Escape`
 * fecha, e a worklist ao lado continua operavel.
 *
 * O cabecalho carrega titulo, botao de fechar e o atalho para a tela de origem quando existe.
 */
function InlineContextPanel({
  open,
  title,
  onClose,
  className,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <section
      className={cn('flex min-h-0 flex-col bg-[color:var(--erp-surface-support)]', className)}
      aria-labelledby={titleId}
    >
      <header className="flex items-center justify-between gap-2 border-b border-[color:var(--erp-border-strong)] bg-[color:var(--color-surface-context-strong)] px-3 py-2">
        <h2 id={titleId} className="cisne-type-workspace m-0 truncate">
          {title}
        </h2>
        <button
          type="button"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[color:var(--erp-text-secondary)] transition-colors hover:bg-[color:var(--color-surface-hover)] hover:text-[color:var(--erp-text)]"
          onClick={onClose}
          aria-label="Fechar contexto"
        >
          <X className="size-4" strokeWidth={2.4} aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">{children}</div>
    </section>
  );
}

/** Estado de foco da lista — uma linha por vez, sem re-render desnecessario. */
export function useContextPreview<Row>() {
  const [previewRow, setPreviewRow] = useState<Row | null>(null);
  const titleId = useId();

  const openPreview = useCallback((row: Row) => setPreviewRow(row), []);
  const closePreview = useCallback(() => setPreviewRow(null), []);

  return useMemo(
    () => ({ previewRow, openPreview, closePreview, titleId }),
    [previewRow, openPreview, closePreview, titleId],
  );
}
