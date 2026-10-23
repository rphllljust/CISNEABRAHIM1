# Coolify immutable runtime

## Authority

GitHub Actions remains the release authority. Coolify is a runtime/deployment plane only.

```
GitHub main
  -> CI
  -> Release Ready
  -> immutable CI artifact
  -> provenance verification
  -> GHCR images by digest
  -> Coolify
  -> OVH VPS-1
```

A Coolify deployment must never rebuild `main` and must never use `:latest`.
The deployed API/Web image references must include `@sha256:<digest>`.

## Runtime resources

| Resource | Image / runtime | Port | Health |
| --- | --- | ---: | --- |
| cisne-api | immutable API image | 3000 | /api/v1/health/ready |
| cisne-worker | same immutable API image | none | process health |
| cisne-web | immutable NGINX image | 80 | /health |
| cisne-postgres | PostgreSQL production resource | internal | pg_isready |
| cisne-object-storage | S3-compatible resource | internal | provider health |

The worker command is `node apps/api/dist/worker/main.js`.

## Web runtime configuration

The Web image is immutable across environments. The container creates
`/runtime-config.js` at startup from `CISNE_PUBLIC_API_URL`, and the browser
prefers that value over the legacy build-time `VITE_API_BASE_URL`.

This removes the contradiction between a build-time API URL and
build-once/promote-many. The legacy Vite variable remains as a compatibility
fallback during migration.

Renderizado por `NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html`
(`docker/release/Dockerfile.web` + `runtime-config.js.template`): o arquivo e
regenerado a **cada start** do container, logo sobrevive a redeploy. Nao existe
passo manual no Coolify para ele.

### Contrato fail-closed (medido no incidente de 2026-10-23)

`/health/ready` verde **nao** significa browser funcional. A tela de login
respondia "Nao foi possivel conectar ao servidor" com API saudavel,
`database=up`, `restarts=0` e login por script retornando 200. Causas e
respectivas guardas:

| Falha | Efeito | Guarda |
| --- | --- | --- |
| `CISNE_PUBLIC_API_URL` em `https://` sem TLS valido | browser falha no handshake TLS | smoke exige coerencia entre `apiBaseUrl` e a API validada |
| `CORS_ORIGIN` ausente ou vazio | browser descarta a resposta | smoke exige `Access-Control-Allow-Origin` com `Origin` real |
| `runtime-config.js` cacheavel | browser mantem config antiga apos o deploy | `nginx.conf` envia `no-store`; smoke exige o cabecalho |
| variavel de ambiente ausente no Coolify | container sobe e nao serve | `requiredEnvironment` no payload + `verifyRequiredEnvironment` antes do deploy |
| `PROD_SMOKE_PASSWORD` divergente do perfil em producao | release falha com 401 depois do deploy | rodar o smoke localmente antes de mergear mudanca de credencial |
| `expires` + `add_header` no mesmo `location` | DOIS `Cache-Control` na resposta; leitor pega o primeiro e ve a diretiva errada | guarda recusa diretiva repetida, nao apenas ausencia de `no-store` |
| janela de log menor que a inicializacao | prova de migration existe mas fica fora da leitura; release recusado por engano | janela de 2000 linhas; erro reporta linhas lidas |

A linha do `PROD_SMOKE_PASSWORD` e erro de operacao, nao de arquitetura: ao rotacionar as
senhas dos perfis, o secret precisa ser atualizado na MESMA janela. O release de `632a129e`
falhou com `login smoke falhou: HTTP 401` exatamente por isso — o deploy havia concluido
(`status: finished` nos tres apps, com SHA e digest corretos) e a falha veio depois, no smoke.
O gate funcionou: barrou a promocao de um release cuja credencial de verificacao estava
obsoleta. Detalhe que custou outra iteracao: `echo senha | gh secret set` pelo PowerShell
inclui o `\n` no valor. Usar `gh secret set --body`.

A linha do `expires` e um caso de guarda que media o clima: a diretiva `no-cache` aparecia
duas vezes porque `expires -1` emite o proprio `Cache-Control` **alem** do `add_header`.
`headers.get` une os dois com `, `, e qualquer leitor que pegasse o primeiro via `no-cache`
em vez de `no-store`. Corrigido removendo `expires`; a guarda passou a recusar **diretiva
repetida**, que e a assinatura real da duplicata.

A linha da janela de log: `MIGRATIONS OK` e emitida na **linha 1** do log do container, e o
smoke lia `lines=200` de um log de 568 linhas. A prova existia e nao era vista. Uma janela
fixa e uma aposta no volume de log, e o volume cresce com o trafego.

`requiredEnvironment` e **executado**, nao apenas declarado: o deploy recusa
variavel ausente, vazia ou duplicada em producao. O Coolify guarda duas entradas
por variavel (`is_preview: true` / `false`); apenas a de producao conta.


## Current cutover constraints

O ambiente roda **HTTP**. Nenhuma configuracao pode anunciar `https://` enquanto
o Traefik nao tiver certificado valido — isso derruba o login no browser, nao
degrada: falha.

A public domain is still required before final production cutover so
`CISNE_PUBLIC_API_URL` and CORS can use the final HTTPS origin. When that
happens, both `CISNE_PUBLIC_API_URL` (Web) and `CORS_ORIGIN` (API) must be
updated together; the smoke reprova o deploy se divergirem.

Railway nao existe mais neste pipeline. A autoridade e
`GitHub -> GHCR -> Coolify -> OVH`.

