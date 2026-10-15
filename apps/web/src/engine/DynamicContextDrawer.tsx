import { useEffect, useRef } from 'react';
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
  const panelRef = useRef<HTMLDivElement>(null);

  /*
   * SAIDA PELO TECLADO — o painel declara `aria-modal="true"`, e a declaracao precisa ser VERDADEIRA.
   *
   * Defeito medido no gate de Propostas: o unico caminho de saida era um botao rotulado "Acoes"
   * (`t('common.actions')`, chave errada para um controle de FECHAR) e a tecla Escape nao fazia
   * nada. Em `role="dialog" aria-modal="true"` isso prende o operador de teclado: sem backdrop e
   * sem Escape, sair dependia de achar um "×" com nome que nao diz o que faz.
   *
   * Duas correcoes MINIMAS, sem tocar em desenho: rotulo de fechar correto e Escape ligado. O
   * listener guarda `onClose` em ref porque as telas passam closure nova a cada render — depender de
   * `onClose` religaria o efeito a cada tecla e o foco voltaria para o painel no meio da digitacao.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  /* FOCO ENTRA NO PAINEL ao abrir — `aria-modal` so e honesto se o foco estiver dentro dele. */
  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      data-testid="dynamic-context-drawer"
      data-cross-ref-count={crossReferences.length}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      /*
        CONTEXTO EMPRESARIAL — nao modal lateral generico.

        Antes: `bg-white shadow-xl` com borda, isto e, a MESMA assinatura visual do resto do produto,
        aberta por cima. Nada dizia ao operador "isto e contexto do registro que voce esta operando".

        Agora o painel e uma SUPERFICIE DE CONTEXTO: tom distinto da area de trabalho (para o olho
        separar contexto de trabalho sem precisar ler), regua de acento na borda que encosta no
        conteudo e divisor estrutural no cabecalho. A sombra permanece porque AQUI ela e necessaria —
        e a unica superficie realmente elevada sobre a work area, que e exatamente o "elevated
        surface somente quando necessaria".
      */
      className="cisne-context-surface fixed inset-y-0 right-0 z-40 flex w-full max-w-[380px] flex-col border-l border-l-[color:var(--erp-border-strong)] shadow-[var(--shadow-dialog)]"
    >
      <header className="cisne-divider--section flex items-center justify-between gap-2 bg-[color:var(--color-surface-context-strong)] px-3 py-2">
        <h2 className="cisne-type-workspace m-0 truncate text-[color:var(--erp-text)]">{title}</h2>
        <button
          type="button"
          data-testid="dynamic-context-drawer-close"
          aria-label={t('common.close')}
          className="inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {crossReferences.length === 0 ? (
          <p className="cisne-type-helper m-0" data-testid="dynamic-context-drawer-empty">
            Nenhuma referência cruzada para este registro.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0 p-0">
            {crossReferences.map((reference) => (
              <li
                key={reference.label}
                data-testid="dynamic-cross-ref"
                data-cross-ref={reference.label}
                data-cross-ref-count={reference.count ?? null}
                className="cisne-divider py-1.5 last:border-b-0"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="cisne-type-body font-medium">{reference.label}</span>
                  {reference.count !== undefined ? (
                    <span className="cisne-type-meta font-semibold tabular-nums">
                      {reference.count}
                    </span>
                  ) : null}
                </div>
                {reference.detail ? (
                  <p className="cisne-type-helper m-0 mt-0.5">{reference.detail}</p>
                ) : null}
                {reference.href ? (
                  <a
                    className="cisne-type-action mt-0.5 inline-block text-brand-700 no-underline hover:text-brand-800 hover:underline"
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

        {children ? <div className="mt-2">{children}</div> : null}
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
