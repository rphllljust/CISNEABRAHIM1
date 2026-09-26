import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Orcamento de espera assincrona do suite.
 *
 * Vários testes de UI renderizam a aplicação inteira (`<App />`) e esperam por uma cadeia
 * longa de efeitos assincronos (bootstrap de sessao -> sonda de autorizacao -> consulta do
 * modulo). Com o orcamento padrao (1000 ms) esses testes passam isolados e falham dentro da
 * suite completa por contencao de CPU — um falso negativo de gate que nao indica defeito de
 * produto. O orcamento foi ampliado de forma sistemica (uma unica configuracao, valida para
 * todo `waitFor`/`findBy*`), sem afrouxar nenhuma assercao: as verificacoes continuam exatas.
 */
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  vi.unstubAllGlobals();
});

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}

if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  }
}
