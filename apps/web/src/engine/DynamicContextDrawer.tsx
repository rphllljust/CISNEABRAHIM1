import { t } from '../i18n';

/**
 * CONTEXT DRAWER — painel lateral com cross-references do registro.
 *
 * Abre ao clicar numa LINHA da lista. O conteúdo são as referências cruzadas que a TELA
 * fornece: a engine não conhece relação de domínio e não faz chamada de rede própria.
 *
 * AUSÊNCIA NÃO É ERRO. Um registro sem referências declara isso e o painel continua abrindo —
 * um painel que não abre faria o operador achar que o clique falhou. É a diferença entre
 * "não há relação" e "não consegui carregar".
 */
export type CrossReference = {
  /** Nome da relação, na linguagem da tela (ex.: "Medições", "Documentos"). */
  label: string;
  /** Quantidade, quando a tela já a conhece. Ausente = não exibida, nunca "0" inventado. */
  count?: number;
  /** Rota autorizada. Ausente = item informativo, não link. */
  href?: string;
  /** Detalhe humano opcional (ex.: referência, status). */
  detail?: string;
};

export type DynamicContextDrawerProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  crossReferences: CrossReference[];
  /** Linha que abriu o painel, para a tela decidir o que mostrar. */
  children?: React.ReactNode;
};

export function DynamicContextDrawer({
  open,
  title,
  onClose,
  crossReferences,
  children,
}: DynamicContextDrawerProps): React.ReactElement | null {
  if (!open) {
    return null;
  }

  return (
    <div
      data-testid="dynamic-context-drawer"
      data-cross-ref-count={crossReferences.length}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-xl"
    >
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          type="button"
          data-testid="dynamic-context-drawer-close"
          aria-label={t('common.actions')}
          className="rounded border border-slate-300 px-2 py-0.5 text-xs"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {crossReferences.length === 0 ? (
          <p className="text-sm text-gray-500" data-testid="dynamic-context-drawer-empty">
            Nenhuma referência cruzada para este registro.
          </p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {crossReferences.map((reference) => (
              <li
                key={reference.label}
                data-testid="dynamic-cross-ref"
                data-cross-ref={reference.label}
                data-cross-ref-count={reference.count ?? null}
                className="rounded border border-gray-200 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{reference.label}</span>
                  {reference.count !== undefined ? (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums">
                      {reference.count}
                    </span>
                  ) : null}
                </div>
                {reference.detail ? (
                  <p className="mt-0.5 text-xs text-gray-500">{reference.detail}</p>
                ) : null}
                {reference.href ? (
                  <a
                    className="mt-1 inline-block text-xs underline"
                    href={reference.href}
                    onClick={(event) => event.stopPropagation()}
                  >
                    Abrir
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {children ? <div className="mt-4">{children}</div> : null}
      </div>
    </div>
  );
}

/**
 * Liga o drawer à seleção de linha de uma lista.
 *
 * Recebe o registro selecionado e devolve o que o drawer precisa. A engine não decide QUAIS
 * referências existem: quem monta a lista é a tela, a partir do payload que já tem.
 */
export type DrawerSelection<Row> = {
  row: Row | null;
  open: boolean;
};

export function drawerSelection<Row>(
  row: Row | null,
): DrawerSelection<Row> {
  return { row, open: row !== null };
}
