import { useId } from 'react';
import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  isLanguage,
  useLanguage,
} from './index';

/**
 * SELETOR DE IDIOMA — troca o idioma da interface SEM recarregar a página.
 *
 * O elemento é um `<select>` nativo, e isso é uma decisão, não uma economia:
 *
 *   - funciona com teclado e leitor de tela sem código de acessibilidade próprio;
 *   - no mobile abre a bandeja nativa do sistema, que é o seletor que o usuário conhece;
 *   - sobrevive ao teste de browser sem `data-testid` em cada opção — o próprio `select` é
 *     o contrato, e `selectOption` é a forma canônica de dirigi-lo no Playwright.
 *
 * `data-testid="language-switcher"` é o gancho estável para a prova de browser. O rótulo
 * acessível vem de `<label>`, não de `aria-label`, para que o campo seja anunciado com o
 * nome visível.
 *
 * A troca é IMEDIATA: `set()` atualiza o estado do React, o provider re-renderiza a árvore
 * e o idioma é gravado em `localStorage`. Nenhum `window.location.reload()` aqui — se
 * houvesse, a prova de "sem reload" não teria o que provar.
 */
export type LanguageSwitcherProps = {
  /** Classes adicionais do contêiner, para encaixar no topbar sem CSS novo. */
  className?: string;
};

export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const selectId = useId();
  const { current, set } = useLanguage();

  return (
    <div className={['flex items-center gap-1.5', className].filter(Boolean).join(' ')}>
      <label htmlFor={selectId} className="sr-only">
        {LANGUAGE_LABELS[isLanguage(current) ? current : 'pt-BR']}
      </label>
      <select
        id={selectId}
        data-testid="language-switcher"
        data-current-language={current}
        aria-label="Language"
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        value={current}
        onChange={(event) => set(event.target.value)}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {/*
              O nome do idioma aparece NA PRÓPRIA LÍNGUA ("Português (Brasil)", "English
              (US)") e nunca é traduzido: quem não lê o idioma corrente precisa reconhecer
              o seu pelo nome original.
            */}
            {LANGUAGE_LABELS[language]}
          </option>
        ))}
      </select>
    </div>
  );
}

export default LanguageSwitcher;
