-- RATE LIMIT COMPARTILHADO ENTRE REPLICAS.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- POR QUE ESTA TABELA EXISTE
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- O rate limit de endpoint (`EndpointRateLimitService`) contava em um `Map` por processo.
-- `docs/19-operations/production-infrastructure.md` dimensiona `PROD_API_REPLICAS` em 1-2 para o
-- baseline inicial. Com duas replicas, um limite de 5 tentativas de login por minuto vira 10 na
-- pratica: o cliente alterna entre replicas e cada uma conta a metade. O controle deixa de
-- proteger o que existe para proteger (forca bruta de credencial), e nada no codigo sinalizava
-- isso — o `Map` era local por definicao.
--
-- Esta tabela e o contador compartilhado. O incremento e uma unica instrucao atomica
-- (`INSERT ... ON CONFLICT DO UPDATE`) em `PostgresRateLimitStore.consume`, para que duas
-- replicas concorrentes nao percam uma contagem.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- SEMANTICA
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- Janela FIXA, nao deslizante: `window_started_at` marca o inicio da janela corrente e `count`
-- conta os consumos dentro dela. Quando a janela expira, a proxima escrita reinicia o contador
-- em 1 sem precisar de job de limpeza — a linha e sobrescrita pela proxima tentativa da mesma
-- chave. Migrar para janela deslizante mudaria a semantica do limite no mesmo passo em que o
-- backend do contador muda, o que impediria saber qual das duas mudancas causou uma regressao.
--
-- `surface` replica `RateLimitSurface` de `security.config.ts` (login, refresh, search, upload,
-- webhook). A coluna e `text` e nao enum proprio de proposito: um enum exigiria migration a cada
-- nova superficie de limite, que e uma mudanca de configuracao, nao de esquema.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- OPERACAO
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- Linhas vivas ocupam poucos bytes e sao limitadas por (replicas x chaves distintas na janela).
-- Nao ha crescimento ilimitado por atacante: a chave e `clientKey` (IP + user agent) ou
-- `identityId`, e cada chave ocupa UMA linha reaproveitada, nao uma por tentativa.
--
-- Ainda assim, o conjunto de chaves distintas de um IP rotativo pode crescer. A poda e feita por
-- `security-rate-limit-prune.ts`, fora do caminho de requisicao, e nao e requisito do limite —
-- uma linha nao podada apenas ocupa espaco; ela expira logicamente no proximo acesso.

CREATE SCHEMA IF NOT EXISTS sec;

CREATE TABLE IF NOT EXISTS sec.rate_limit_bucket (
  surface text NOT NULL,
  bucket_key text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (surface, bucket_key)
);

-- Indice para a poda por idade. O caminho de requisicao usa a chave primaria; este indice existe
-- somente para o job de limpeza, que varre por `window_started_at`.
CREATE INDEX IF NOT EXISTS rate_limit_bucket_window_started_at_idx
  ON sec.rate_limit_bucket (window_started_at);
