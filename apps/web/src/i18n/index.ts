import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import PT_BR from './pt-BR.json';
import EN_US from './en-US.json';

/**
 * i18n DO CISNE — provider, `t()` e `useLanguage()`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRATO EXPORTADO (Track 1 e Track 3 consomem; NÃO renomear nem remover):
 *
 *   export function t(key: string, fallback?: string): string
 *   export function useLanguage(): { current: string; set: (l: string) => void }
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Duas formas de leitura, e a razão de cada uma:
 *
 *   - `t()` é uma função LIVRE (não um hook) porque a engine a chama de dentro de
 *     `map`/`useMemo`/helpers que não são componentes — `DynamicList` traduz no rodapé e no
 *     `renderCell`. Um hook ali quebraria as regras de hooks. `t()` lê o idioma do MÓDULO,
 *     sincronizado pelo provider.
 *   - `useLanguage()` é um hook porque TROCAR de idioma precisa re-renderizar. Ele lê o
 *     estado do contexto, que é o que dispara o re-render.
 *
 * A troca de idioma NÃO recarrega a página: `set()` atualiza o estado do React e publica o
 * idioma no módulo. É por isso que a prova de browser consegue exigir "sem reload".
 *
 * O idioma escolhido PERSISTE em `localStorage` sob `cisne.language`, para sobreviver à
 * sessão. A leitura inicial tolera `localStorage` indisponível (modo privado, SSR): nesse
 * caso o idioma é o padrão, em memória, e nada quebra.
 */

export type Language = 'pt-BR' | 'en-US';

/** Idiomas suportados, na ordem em que a interface os oferece. */
export const SUPPORTED_LANGUAGES: readonly Language[] = ['pt-BR', 'en-US'] as const;

/** Idioma padrão do produto: o CISNE é operado em português do Brasil. */
export const DEFAULT_LANGUAGE: Language = 'pt-BR';

/** Chave de persistência da preferência de idioma. */
export const LANGUAGE_STORAGE_KEY = 'cisne.language';

/** Nome de cada idioma NA PRÓPRIA LÍNGUA — um seletor não traduz o nome do idioma. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  'pt-BR': 'Português (Brasil)',
  'en-US': 'English (US)',
};

type Catalog = Record<string, string>;

const CATALOGS: Record<Language, Catalog> = {
  'pt-BR': PT_BR,
  'en-US': EN_US,
};

/** `true` para um valor que é um dos idiomas suportados. */
export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Idioma corrente do MÓDULO.
 *
 * Existe para que `t()` funcione fora de componente. O provider é o único que escreve
 * aqui, e escreve junto com o estado do React — as duas leituras nunca divergem.
 */
let currentLanguage: Language = DEFAULT_LANGUAGE;

/** Normaliza `localStorage`/navegador num idioma suportado. */
function normalizeLanguage(value: string | null | undefined): Language | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (isLanguage(trimmed)) {
    return trimmed;
  }
  /*
   * Aceita a forma CURTA (`pt`, `en`) porque é o que um navegador manda em
   * `navigator.language`. Sem isto, um navegador que mandasse `pt` cairia no padrão por
   * acidente e a detecção pareceria não funcionar.
   */
  const base = trimmed.toLowerCase().split('-')[0];
  if (base === 'pt') {
    return 'pt-BR';
  }
  if (base === 'en') {
    return 'en-US';
  }
  return null;
}

/** Lê o idioma persistido, tolerando `localStorage` indisponível. */
export function readStoredLanguage(): Language | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Persiste o idioma, tolerando `localStorage` indisponível. */
export function writeStoredLanguage(language: Language): void {
  try {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    /* Preferência não persistida é degradação aceitável; quebrar a tela não é. */
  }
}

/**
 * Idioma INICIAL: preferência salva → idioma do navegador → padrão.
 *
 * A ordem importa. A preferência explícita do operador vence o palpite do navegador; o
 * padrão do produto é o último recurso, não o primeiro.
 */
export function resolveInitialLanguage(): Language {
  const stored = readStoredLanguage();
  if (stored) {
    return stored;
  }
  try {
    if (typeof navigator !== 'undefined') {
      return normalizeLanguage(navigator.language) ?? DEFAULT_LANGUAGE;
    }
  } catch {
    /* `navigator` indisponível: cai no padrão. */
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Traduz uma chave, caindo no `fallback` quando não há entrada.
 *
 * A ordem de resolução é CATÁLOGO DO IDIOMA ATUAL → catálogo pt-BR → fallback → chave.
 * O pt-BR entra como segunda tentativa porque é o idioma-fonte do produto: uma chave que
 * ainda não foi traduzida mostra português (legível) em vez de um identificador técnico.
 *
 * O fallback NUNCA é a chave crua: um metadado sem tradução deve mostrar o rótulo que o
 * administrador escreveu, não `service-orders.order_number`.
 */
export function t(key: string, fallback?: string): string {
  const catalog = CATALOGS[currentLanguage];
  const direct = catalog[key];
  if (direct !== undefined) {
    return direct;
  }
  const source = CATALOGS[DEFAULT_LANGUAGE][key];
  if (source !== undefined) {
    return source;
  }
  if (fallback !== undefined && fallback.trim() !== '') {
    return fallback;
  }
  return key;
}

/** Todas as chaves de um catálogo — usado pela prova de paridade entre idiomas. */
export function catalogKeys(language: Language): string[] {
  return Object.keys(CATALOGS[language]);
}

/** O catálogo inteiro de um idioma. */
export function catalog(language: Language): Catalog {
  return CATALOGS[language];
}

/** Chave do rótulo de uma entidade. Formato: `meta.<entidade>.label`. */
export function entityLabelKey(entity: string): string {
  return `meta.${entity}.label`;
}

/** Chave do rótulo de um campo. Formato: `meta.<entidade>.<campo>.label`. */
export function fieldLabelKey(entity: string, field: string): string {
  return `meta.${entity}.${field}.label`;
}

/** Chave da opção de um campo `select`: `meta.<entidade>.<campo>.<valor>`. */
export function fieldOptionKey(entity: string, field: string, value: string): string {
  return `meta.${entity}.${field}.${value}`;
}

/** Chave de uma ação/comando: `action.<verbo>`. */
export function actionKey(verb: string): string {
  return `action.${verb}`;
}

/** Chave de um erro: `error.<codigo>`. */
export function errorKey(code: string): string {
  return `error.${code}`;
}

/** Traduz o rótulo de uma entidade, preferindo o metadado quando não há tradução. */
export function entityLabel(entity: string, fallback?: string): string {
  return t(entityLabelKey(entity), fallback);
}

/** Traduz o rótulo de um campo, preferindo o metadado quando não há tradução. */
export function fieldLabel(entity: string, field: string, fallback?: string): string {
  return t(fieldLabelKey(entity, field), fallback);
}

/**
 * Traduz um RÓTULO DE METADADO em TEMPO DE RENDER.
 *
 * O metadata store guarda o rótulo em português. A resolução tenta, nesta ordem:
 *
 *   1. `meta.<entidade>.<campo>.label` — quando a tela conhece o nome técnico do campo;
 *   2. `meta.<entidade>.label`         — quando conhece a entidade;
 *   3. casamento pelo TEXTO do rótulo (`label.<texto>`), que cobre os campos que o
 *      administrador criou pelo metadata store e que o catálogo não conhece por nome.
 *
 * Sem correspondência, o rótulo original volta intacto — nunca a chave crua.
 */
export function translateMetaLabel(
  label: string | null | undefined,
  context?: { entity?: string; field?: string },
): string {
  if (!label) {
    return '';
  }
  if (context?.entity && context.field) {
    const byKey = t(fieldLabelKey(context.entity, context.field), '');
    if (byKey !== '') {
      return byKey;
    }
  }
  if (context?.entity) {
    const byEntity = t(entityLabelKey(context.entity), '');
    if (byEntity !== '') {
      return byEntity;
    }
  }
  return t(`label.${label}`, label);
}

export type LanguageContextValue = {
  current: string;
  set: (language: string) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export type LanguageProviderProps = {
  children: ReactNode;
  /** Idioma inicial explícito. Ausente = `resolveInitialLanguage()`. */
  initialLanguage?: Language;
};

/**
 * PROVIDER DE IDIOMA.
 *
 * Mantém o idioma escolhido no estado do React (para re-render sem reload) e espelha no
 * módulo (para que `t()` funcione fora de componente).
 */
export function LanguageProvider({ children, initialLanguage }: LanguageProviderProps) {
  const [language, setLanguageState] = useState<Language>(
    () => initialLanguage ?? resolveInitialLanguage(),
  );

  /*
   * Espelha no MÓDULO durante o render, não num efeito: um `t()` chamado no primeiro
   * render de um filho já precisa enxergar o idioma certo. Sem isto, o primeiro frame
   * sairia no idioma padrão e só o segundo acertaria.
   */
  currentLanguage = language;

  useEffect(() => {
    currentLanguage = language;
  }, [language]);

  const set = useCallback((next: string) => {
    const normalized = normalizeLanguage(next);
    if (!normalized) {
      return;
    }
    currentLanguage = normalized;
    setLanguageState(normalized);
    writeStoredLanguage(normalized);
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({ current: language, set }), [language, set]);

  return createElement(LanguageContext.Provider, { value }, children);
}

/** O provider sob o nome do arquivo de origem, para quem lê a pasta `i18n/`. */
export const I18nProvider = LanguageProvider;

/**
 * Idioma corrente + troca de idioma.
 *
 * Fora de um `LanguageProvider` o hook ainda responde — com o idioma do módulo e um `set`
 * funcional. Devolver `null` ou lançar transformaria "esqueci o provider" num crash de tela
 * inteira; a degradação é o idioma padrão, que é o que o usuário veria de qualquer forma.
 */
export function useLanguage(): { current: string; set: (l: string) => void } {
  const context = useContext(LanguageContext);
  const fallbackSet = useCallback((next: string) => {
    const normalized = normalizeLanguage(next);
    if (normalized) {
      currentLanguage = normalized;
      writeStoredLanguage(normalized);
    }
  }, []);

  if (context) {
    return { current: context.current, set: context.set };
  }
  return { current: currentLanguage, set: fallbackSet };
}

/** Idioma corrente do módulo, sem hook. Útil em testes e fora de componente. */
export function getCurrentLanguage(): string {
  return currentLanguage;
}
