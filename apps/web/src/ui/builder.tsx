import { useId, useState, type ReactNode } from 'react';
import { cn } from './utils/cn';

/**
 * STRUCTURED BUILDER — moldura unica para telas que editam uma ESTRUTURA empresarial
 * complexa (catalogo de servicos, modelos de preco, requisitos, evidencias, composicoes).
 *
 * Nao e um formulario CRUD com cards: e um editor com RESUMO do que esta sendo configurado,
 * SECOES com hierarquia e acao propria, REPETIDORES com padrao unico e BARRA DE ACAO que
 * nao se perde no fim de uma pagina longa.
 *
 * Headers de secao, raios, bordas, tipografia e cores sao os mesmos das object pages: um
 * builder do CISNE nao pode parecer feito por outra equipe.
 */

export type BuilderSummaryProps = {
  /** Pares rotulo/valor do RESUMO DA PROPRIA EDICAO. Nunca KPI inventado. */
  items: Array<{ label: string; value: ReactNode }>;
  className?: string;
};

export function BuilderSummary({ items, className }: BuilderSummaryProps) {
  const visible = items.filter((item) => item.value !== null && item.value !== undefined);
  if (visible.length === 0) {
    return null;
  }

  return (
    <dl
      className={cn(
        'm-0 flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-lg bg-white px-4 py-2.5 shadow-sm ring-1 ring-gray-900/5',
        className,
      )}
      aria-label="Resumo da configuração"
    >
      {visible.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
            {item.label}
          </dt>
          <dd className="m-0 text-sm font-semibold text-gray-900 tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type BuilderSectionProps = {
  title: string;
  description?: string;
  /** Acao DA SECAO (ex.: "+ Adicionar modelo"). Nunca "Adicionar" solto no meio do card. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Conteudo auxiliar no rodape da secao (avisos, contagem, legenda). */
  footer?: ReactNode;
};

export function BuilderSection({
  title,
  description,
  action,
  children,
  className,
  footer,
}: BuilderSectionProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={cn('rounded-lg bg-white px-4 py-3 shadow-sm ring-1 ring-gray-900/5', className)}
    >
      <header className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="m-0 text-sm font-semibold text-gray-900">
            {title}
          </h2>
          {description ? <p className="m-0 text-xs text-gray-500">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </header>
      {children}
      {footer ? <div className="mt-2 text-[11px] text-gray-500">{footer}</div> : null}
    </section>
  );
}

export type CollectionEditorProps<T> = {
  items: T[];
  getKey: (item: T, index: number) => string;
  /** Titulo compacto do item (ex.: "DAILY · Dia"). */
  itemTitle: (item: T, index: number) => ReactNode;
  /** Contexto secundario do item (ex.: "modelo 1 de 2"). */
  itemSubtitle?: (item: T, index: number) => ReactNode;
  renderItem: (item: T, index: number) => ReactNode;
  onChange: (index: number, item: T) => void;
  onRemove: (index: number) => void;
  /**
   * Acao de adicionar DENTRO do repetidor. Opcional de proposito: quando a secao ja oferece
   * "+ Adicionar …" no cabecalho, o botao de rodape duplicaria a mesma acao e criaria dois
   * controles diferentes para o mesmo efeito.
   */
  onAdd?: () => void;
  addLabel?: string;
  removeLabel: string;
  emptyMessage: string;
  /** Rotulo do botao de remover por item (accessible name explicito). */
  removeAriaLabel?: (item: T, index: number) => string;
  /** Quando verdadeiro, remover pede confirmacao inline antes de executar. */
  confirmRemove?: boolean;
  disabled?: boolean;
  className?: string;
};

/**
 * COLLECTION EDITOR — repetidor unico do CISNE.
 *
 * Cada item tem header compacto, campos alinhados e remocao DISCRETA (acao secundaria com
 * nome acessivel, nunca um botao azul grande "Remover modelo"). Quando o item carrega dado
 * sensivel, quem decide mostrar e a pagina — o editor nao recebe o que nao pode exibir.
 */
export function CollectionEditor<T>({
  items,
  getKey,
  itemTitle,
  itemSubtitle,
  renderItem,
  onRemove,
  onAdd,
  addLabel,
  removeLabel,
  emptyMessage,
  removeAriaLabel,
  confirmRemove = false,
  disabled = false,
  className,
}: CollectionEditorProps<T>) {
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {items.length === 0 ? (
        <p className="m-0 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">{emptyMessage}</p>
      ) : null}

      {items.map((item, index) => {
        const key = getKey(item, index);
        const isPending = pendingRemoval === key;
        return (
          <div
            key={key}
            className="rounded-md border border-gray-200 bg-white px-3 py-2"
            data-collection-item={key}
          >
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 truncate text-[13px] font-semibold text-gray-800">
                  {itemTitle(item, index)}
                </p>
                {itemSubtitle ? (
                  <p className="m-0 truncate text-[11px] text-gray-500">{itemSubtitle(item, index)}</p>
                ) : null}
              </div>

              {isPending ? (
                <span className="flex items-center gap-2 text-[11px]">
                  <span className="text-gray-600">Remover este item?</span>
                  <button
                    type="button"
                    onClick={() => {
                      onRemove(index);
                      setPendingRemoval(null);
                    }}
                    className="font-semibold text-red-700 hover:text-red-800"
                  >
                    Confirmar remoção
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingRemoval(null)}
                    className="text-gray-600 hover:text-gray-800"
                  >
                    Cancelar remoção
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={
                    removeAriaLabel
                      ? removeAriaLabel(item, index)
                      : `Remover item ${index + 1}`
                  }
                  onClick={() => {
                    if (confirmRemove) {
                      setPendingRemoval(key);
                      return;
                    }
                    onRemove(index);
                  }}
                  className="shrink-0 text-[11px] font-medium text-gray-500 underline-offset-2 hover:text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {removeLabel}
                </button>
              )}
            </div>

            {renderItem(item, index)}
          </div>
        );
      })}

      {onAdd && addLabel ? (
        <div>
          <button
            type="button"
            disabled={disabled}
            onClick={onAdd}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {addLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export type StickyActionBarProps = {
  children: ReactNode;
  /** Explicacao curta do que a acao principal fara. */
  note?: ReactNode;
  className?: string;
};

/**
 * STICKY ACTION BAR — a acao principal nao fica perdida no fim de uma pagina longa.
 */
export function StickyActionBar({ children, note, className }: StickyActionBarProps) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 -mx-4 mt-1 border-t border-gray-200 bg-white/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[11px] text-gray-500">{note}</div>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </div>
  );
}
