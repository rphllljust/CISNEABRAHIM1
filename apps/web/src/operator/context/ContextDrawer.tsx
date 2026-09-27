import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Drawer } from '../../ui/Drawer';

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
};

export type ContextDrawerProps = {
  open: boolean;
  title: string;
  preview: ContextPreviewBody | null;
  onClose: () => void;
};

export function ContextDrawer({ open, title, preview, onClose }: ContextDrawerProps) {
  return (
    <Drawer open={open} title={title} onClose={onClose} side="right">
      {preview ? (
        <div className="flex flex-col gap-4 text-sm">
          <header className="border-b border-gray-100 pb-3">
            <p className="text-sm font-semibold text-gray-900">{preview.identifier}</p>
            {preview.subtitle ? (
              <p className="mt-0.5 text-xs text-gray-500">{preview.subtitle}</p>
            ) : null}
            {preview.status ? <div className="mt-2">{preview.status}</div> : null}
          </header>

          {preview.facts.length > 0 ? (
            <dl className="m-0 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-2">
              {preview.facts.map((field) => (
                <div key={field.label} className="col-span-2 grid grid-cols-subgrid">
                  <dt className="text-xs text-gray-500">{field.label}</dt>
                  <dd
                    className={
                      field.emphasis
                        ? 'm-0 text-[13px] font-semibold text-gray-900 tabular-nums'
                        : 'm-0 text-[13px] text-gray-800'
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

          <section className="mt-auto flex flex-col gap-2 border-t border-gray-100 pt-3">
            {preview.nextAction ? (
              preview.nextAction.href ? (
                <Link
                  className="inline-flex items-center justify-center rounded-md border border-brand-600 bg-brand-600 px-3 py-2 text-xs font-semibold text-white no-underline hover:bg-brand-700"
                  to={preview.nextAction.href}
                >
                  {preview.nextAction.label}
                </Link>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-md border border-brand-600 bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700"
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
      )}
    </Drawer>
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
