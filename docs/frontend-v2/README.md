# CISNE Frontend V2 — auditoria de integração inicial

**Estado:** `SOURCE_IMPORTED_ONLY` / não integrado / não liberado para produção.
**Escopo:** nova interface em paralelo; nenhuma alteração ao CISNE existente.
**Origem visual:** `Kiranism/next-shadcn-dashboard-starter` em `47da494b89e330d884a0f9b5c37a605fbabb3987` (licença MIT preservada).
**Fonte dos fatos:** código inspecionado em `main` e no template fixado, 2026-11-06.

## Fatos verificados

| Tema | Atual CISNE | Template importado |
| --- | --- | --- |
| Aplicação web | `apps/web` com Vite, React, TypeScript | `frontend-v2` com Next.js 16, React e TypeScript |
| Login | `apps/web/src/auth/context/AuthProvider.tsx` | `@clerk/nextjs`, middleware no `src/proxy.ts` |
| Sessão | `auth-api.ts` envia login, refresh e sessão à API CISNE | `auth.protect()` no `src/app/dashboard/layout.tsx` |
| Estado de token | `tokenStore` do CISNE lido pelo AuthProvider | Identidade Clerk; **não é identidade CISNE** |
| Backend autoritativo | `apps/api/src/auth/auth.controller.ts` | Template sem autorização CISNE |
| Banco de negócio | `packages/database` PostgreSQL | Nenhuma integração CISNE |
| Workspace | `apps/*`, `packages/*` | `frontend-v2/` fora do workspace para isolamento |

## Bloqueio crítico: autenticação

Não remover `@clerk/nextjs` à força sem substituir as proteções.
O CISNE autentica por endpoints `auth/login`, `auth/refresh`,
`auth/session`, `auth/logout` e `auth/logout-all`, com JWT
validado por `JwtAuthGuard`. O frontend antigo guarda tokens em um
`tokenStore` e opera principalmente em contexto cliente. O template usa
proteção no servidor Next.js e identidade Clerk.

Uma troca cega de `auth.protect()` por layout sem guarda exporia
páginas protegidas. A integração só pode liberar páginas de negócio
depois que a autenticação e autorização forem verificadas contra
a API do CISNE.

## Integração exigida

1. **BFF ou sessão segura Next.js:** projetar sessão HTTP-only,
   `Secure` em HTTPS, `SameSite` apropriado, rotação/revogação de
   credenciais e defesa CSRF das operações mutáveis. Manter o CISNE como
   única autoridade de identidade e permissões; não usar Clerk Org/Billing.
2. **Proteção server-side e API-side:** verificar sessão real, tratar
   401/403/429 indisponibilidade e expiração; jamais liberar
   `dashboard` ou API proxy por autenticação de aparência.
3. **Clientes (primeiro módulo piloto):** confirmar rotas reais, conectar
   listagem/paginação/filtros sem dados simulados; preservar escopo de
   empresa/unidade e capacidades.
4. **Ordens de Serviço:** somente depois validar lista, detalhe e
   comandos permitidos pelo backend. Não criar fluxos de status paralelos.
5. **Comparação e evidência:** teste funcional (antigo x novo),
   autorização entre empresas, integração API/PostgreSQL,
   mobile, acessibilidade, Playwright e Visual Full independente.
6. **Cutover controlado:** CI e HML aprovados, revisão, rollback e
   autorização explícita. Somente então avaliar incluir o app no
   workspace e promover rota de produção.

## Estado de aceite

- `PASS`: branch isolada; importação completa; licença preservada;
  workflow de bootstrap executado com sucesso; `apps/web` preservado.
- `PENDING`: instalação de dependências, lint, typecheck, build e
  testes do novo template no runtime do CISNE.
- `BLOCKED`: integração real de autenticação/Clerk; módulos conectados
  à API; migração de tráfego e deploy do frontend novo.
- **Não confundir importação com integração, build aprovado ou aplicação homologada.**
