import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetNavAccessCacheForTests } from '../shell/useNavAccess';

/**
 * Orcamento de espera assincrona do suite.
 *
 * Vários testes de UI renderizam a aplicação inteira (`<App />`) e esperam por uma cadeia
 * longa de efeitos assincronos (bootstrap de sessao -> sonda de autorizacao -> consulta do
 * modulo). Com o orcamento padrao (1000 ms) esses testes passam isolados e falham dentro da
 * suite completa por contencao de CPU — um falso negativo de gate que nao indica defeito de
 * produto. O orcamento foi ampliado de forma sistemica (uma unica configuracao, valida para
 * todo `waitFor`/`findBy*`), sem afrouxar nenhuma assercao: as verificacoes continuam exatas.
 *
 * AMPLIACAO EM B5 (5s -> 10s): o bootstrap autenticado passou a hidratar `/me` e
 * `/command-catalog` no `SessionMetaProvider`, alem das chamadas que cada tela ja fazia. Em
 * teste o `fetch` e o duble do caso, mas a cadeia de promessas + re-render continua custando
 * ciclos reais de CPU, e os casos que mudam de estado (prepare/release/reopen) passaram a
 * esperar tambem a RECARGA de `available-actions`. O orcamento de 5s ficou exatamente no
 * limite do timeout de caso (5s), produzindo falso negativo por contencao — o mesmo defeito
 * que a ampliacao anterior ja havia documentado. As assercoes seguem identicas.
 */
configure({ asyncUtilTimeout: 10_000 });

afterEach(() => {
  vi.unstubAllGlobals();
  /**
   * ISOLAMENTO DO CACHE DE ACESSO DE NAVEGACAO.
   *
   * `useNavAccess` guarda o mapa de acesso resolvido (memoria + `sessionStorage`) para nao
   * repetir a bateria de sondas a cada navegacao. Em teste, esse cache atravessa casos: um
   * teste que concede acesso deixaria o proximo — que espera NEGACAO — enxergar o menu do
   * anterior e falhar por contaminacao, nao por defeito. O cache e comportamento de SESSAO
   * REAL; cada caso comeca com a sessao limpa, como um operador novo.
   */
  resetNavAccessCacheForTests();
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
