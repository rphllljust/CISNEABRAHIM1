import { useId, type ReactNode } from 'react';
import { cn } from './utils/cn';

export type FormSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /**
   * ESCONDE O TÍTULO VISÍVEL mantendo o nome acessível.
   *
   * Quando a superfície já anuncia a ação no próprio botão que a abre — caso do cadastro
   * embutido numa lista —, repetir o título cria duas linhas idênticas na primeira dobra. O
   * `aria-labelledby` continua apontando para o cabeçalho, agora `sr-only`: o leitor de tela não
   * perde a identidade do bloco, só a duplicação visual desaparece.
   */
  hideTitle?: boolean;
};

export function FormSection({
  title,
  description,
  children,
  className,
  hideTitle = false,
}: FormSectionProps) {
  const headingId = useId();

  return (
    <section
      /*
        SECAO SEMANTICA DO FORMULARIO — agrupamento por hierarquia, nao por caixa.

        Antes: `rounded-md border bg-white shadow-[...] p-4`. O formulario enterprise virava uma
        pilha de cards dentro do card da pagina, e o operador lia "caixa, caixa, caixa" em vez de
        "identificacao, condicoes comerciais, requisitos".

        Agora a secao e delimitada por DIVISOR ESTRUTURAL e pelo titulo governado; o agrupamento vem
        da tipografia e do espacamento. Nenhum campo, validacao ou comportamento foi alterado — muda
        a superficie, nao o dado.
      */
      className={cn('cisne-divider--section pb-3 last:border-b-0 last:pb-0', className)}
      aria-labelledby={headingId}
    >
      <header className={hideTitle ? 'sr-only' : 'mb-2'}>
        <h2 id={headingId} className="cisne-section-title m-0">
          {title}
        </h2>
        {description ? <p className="cisne-type-helper m-0 mt-0.5">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
