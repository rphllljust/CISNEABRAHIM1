import { getApiBaseUrl, isNetworkError, refreshRequest } from '../api/auth-api';
import { tokenStore } from '../storage/token-store';

/**
 * CLIENTE HTTP COM RECUPERAÇÃO DE TOKEN EXPIRADO.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE MÓDULO CORRIGE
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * O access token vive SOMENTE em memória (`token-store.ts`) e expira em 15 minutos
 * (`JWT_ACCESS_TTL_SECONDS`, padrão 900). Os 50 módulos `*-api.ts` faziam `fetch` com o token,
 * recebiam 401 quando ele vencia, e traduziam o 401 em erro de negócio — `denied`, `not_found`,
 * o que cada um mapeava. Nenhum deles renovava o token: `refreshSession` do `AuthProvider`
 * aparecia em ZERO arquivos fora do próprio provider.
 *
 * O efeito no produto: depois de 15 minutos de uso, cada ação do operador falhava com "acesso
 * negado" até ele recarregar a página. Não era um erro de autorização — o usuário tinha todas as
 * permissões. Era o token vencido sendo lido como falta de permissão, que é o pior disfarce
 * possível para um problema de sessão: manda o operador abrir chamado com o administrador em vez
 * de relogar.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * O QUE ESTE MÓDULO FAZ, E O QUE ELE NÃO FAZ
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * Faz: no 401, troca o refresh token por um novo par e REPETE a requisição uma única vez.
 * Faz: serializa as renovações (`refreshInFlight`) para que N chamadas concorrentes que recebem
 *      401 ao mesmo tempo disparem UM refresh, não N. Sem isso, a primeira renovação rotacionaria
 *      o refresh token e as demais usariam um token já consumido — o servidor trata reuso como
 *      revogação (`REFRESH_REUSED`), e a sessão morreria justamente quando o mecanismo deveria
 *      salvá-la.
 * Faz: sinaliza sessão encerrada por um listener registrado uma vez, para que o app volte ao
 *      login em vez de mostrar erro em cada tela.
 *
 * NÃO faz: retry em 403. 403 é autorização, não sessão: o token é válido e o usuário não tem o
 *       grant. Renovar ali só esconderia a decisão real do servidor atrás de uma chamada extra.
 * NÃO autoriza nada. A decisão continua sendo do backend — este módulo só recupera credencial.
 */

type UnauthorizedListener = () => void;

let unauthorizedListener: UnauthorizedListener | null = null;

/**
 * Registra o handler de sessão encerrada. Chamado pelo `AuthProvider` no mount.
 * Retorna o cancelamento, para o provider poder desregistrar no unmount e não deixar um
 * listener apontando para estado desmontado.
 */
export function onSessionExpired(listener: UnauthorizedListener): () => void {
  unauthorizedListener = listener;
  return () => {
    if (unauthorizedListener === listener) {
      unauthorizedListener = null;
    }
  };
}

/** Renovação em voo, compartilhada por todas as chamadas que recebem 401 ao mesmo tempo. */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Renova o access token. Resolve `true` quando há novo token, `false` quando a sessão acabou
 * (sem refresh token, refresh recusado, ou refresh token reutilizado).
 *
 * Nunca lança: quem chama está no meio de uma requisição e só precisa saber se vale repetir.
 */
export function renewAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async (): Promise<boolean> => {
      const refreshToken = tokenStore.getRefreshToken();
      if (!refreshToken) {
        return false;
      }
      try {
        const tokens = await refreshRequest(refreshToken);
        tokenStore.setTokens(tokens.accessToken, tokens.refreshToken);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Apenas para testes: descarta o estado de módulo entre casos. */
export function resetSessionRecoveryForTests(): void {
  refreshInFlight = null;
  unauthorizedListener = null;
}

function buildHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  const accessToken = tokenStore.getAccessToken();
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return headers;
}

/**
 * Executa `fetch` com o token corrente e, no 401, renova e repete UMA vez.
 *
 * A URL base vem de `getApiBaseUrl()`, que é o mesmo resolvedor usado pelo login. Os candidatos
 * de fallback multi-host existem em `auth-api.ts`; aqui usa-se o resolvido, porque as APIs de
 * feature sempre operaram com um único host e misturar a fonte da URL base neste PR tornaria
 * ambíguo qual mudança causou uma regressão de conectividade.
 */
export async function fetchWithSession(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${getApiBaseUrl()}${path}`;
  const firstAttempt = await fetch(url, { ...init, headers: buildHeaders(init) });

  if (firstAttempt.status !== 401) {
    return firstAttempt;
  }

  const renewed = await renewAccessToken();
  if (!renewed) {
    tokenStore.clear();
    unauthorizedListener?.();
    return firstAttempt;
  }

  const retry = await fetch(url, { ...init, headers: buildHeaders(init) });
  if (retry.status === 401) {
    // O refresh "deu certo" mas o token novo também não serve: a sessão foi revogada no
    // servidor entre a renovação e a repetição. Insistir aqui viraria loop.
    tokenStore.clear();
    unauthorizedListener?.();
  }
  return retry;
}

/**
 * Atalho para `fetchWithSession` + parse de JSON, com a mesma classificação de erro de rede
 * que os módulos de API já usavam. Não substitui os erros de domínio de cada módulo: devolve
 * a `Response` crua para que cada `*-api.ts` continue mapeando status e código de erro do seu
 * próprio jeito.
 */
export async function fetchJsonWithSession<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchWithSession(path, init);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export { isNetworkError };
