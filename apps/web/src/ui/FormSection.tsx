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
      className={cn(
        'rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5',
        className,
      )}
      aria-labelledby={headingId}
    >
      <header className={hideTitle ? 'sr-only' : 'mb-3'}>
        <h2 id={headingId} className="cisne-type-section-title">
          {title}
        </h2>
        {description ? <p className="cisne-type-caption mt-1">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
