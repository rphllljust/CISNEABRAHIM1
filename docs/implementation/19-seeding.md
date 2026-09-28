# Prompt 19 — Seed seguro e bootstrap controlado

| Campo  | Valor |
| ------ | ----- |
| Prompt | 19    |
| Escopo | Persistência técnica de identidade (Prompt 18) |

## Separação obrigatória

| Módulo | Localização | Uso |
| ------ | ----------- | --- |
| `DEVELOPMENT_SEED` | `packages/database/src/seed/development-seed.ts` | `NODE_ENV=development` apenas |
| `TEST_DATA_BUILDERS` | `packages/database/src/test-builders/` | Testes de integração |
| `PRODUCTION_BOOTSTRAP` | `packages/database/src/seed/production-bootstrap.ts` | CLI manual explícita |

## DEVELOPMENT_SEED

- Login fictício fixo: `dev-operator@cisne-rondonia.invalid` (RFC 2606 `.invalid`)
- Senha: `DEV_SEED_PASSWORD` (`.env` local) **ou** gerada em runtime
- **Nunca** commitada em código
- Idempotente: segunda execução retorna `already_exists`
- Resultado JSON: `outcome`, `login`, `identityId`, `message` — **sem** senha/hash

```powershell
# Após migrations
$env:NODE_ENV='development'
$env:DEV_SEED_PASSWORD='Dev-Only-1!Synthetic'  # opcional
pnpm db:seed:dev
```

## STATIC_DEV_PROFILES (logins estáticos de desenvolvimento) — 2026-09-25

Requisito do responsável: os logins de desenvolvimento abaixo são **estáticos** — precisam
funcionar sempre com exatamente estas credenciais, sem geração em runtime e sem override por
variável de ambiente.

| Perfil | Login | Senha (origem) | Papel | Escopo | Acesso |
| ------ | ----- | -------------- | ----- | ------ | ------ |
| Dono | `abrahim@cisne-rondonia.invalid` | `DEV_PROFILE_OWNER_PASSWORD` | `OWNER` | GLOBAL | Amplo (263 capabilities) |
| Dono | `monica@cisne-rondonia.invalid` | `DEV_PROFILE_MONICA_PASSWORD` | `OWNER` | GLOBAL | Amplo (263 capabilities) |
| Desenvolvedor | `rafael@cisne-rondonia.invalid` | `DEV_PROFILE_DEVELOPER_PASSWORD` | `DEVELOPER` | GLOBAL | Amplo (263 capabilities) |
| Empregado operacional | `empregado@cisne-rondonia.invalid` | `DEV_PROFILE_EMPLOYEE_PASSWORD` | `EMPREGADO` | GLOBAL + ASSIGNED | Mínimo (0 financeiro/contábil/fiscal) |

**Redação de segredo (2026-09-27).** O valor literal destas senhas foi **removido do
repositório**: credencial de homologação em texto plano vaza em qualquer clone. O requisito
original permanece — estes logins precisam funcionar sempre com exatamente estes valores —,
por isso a origem passa a ser o ambiente local (`.env`, gitignored; ver `.env.example`) e
**não** existe default silencioso: sem a variável, `seed-profiles.mjs` e
`repair-dev-login.mjs` falham alto em vez de semear um login diferente do esperado. A
limpeza do histórico Git **não** faz parte desta redação.

**Decisão registrada (2026-09-25).** `rafael@` é o **desenvolvedor com acesso global**, não o
empregado operacional. Antes desta decisão o mesmo login era definido como "Desenvolvedor com
acesso global de desenvolvimento" (`repair-dev-login.mjs`) e como "empregado operacional, somente
ASSIGNED" (`operational-profiles.ts`) — um conflito de fonte, não resolvido por conveniência.
O empregado operacional passou a ter login próprio, `empregado@`, com o perfil mínimo. O membro
operacional `EMP-DEV-001` (`UN-DEV-001`) aponta para `empregado@`.

Definição canônica: `packages/database/src/seed/operational-profiles.ts` (identificadores, papéis,
grants dos perfis de negócio). Aplicação: `packages/database/scripts/seed-profiles.mjs`
(`pnpm --filter @cisne/database seed:profiles`, perfis de negócio) e `scripts/repair-dev-login.mjs`
(`pnpm auth:repair:dev-login`, que repara credencial, reativa identidade desabilitada, aplica o
acesso amplo dos três perfis de dev e aplica o seed canônico aditivo). O desenvolvedor com acesso
global fica no `repair-dev-login.mjs` porque o conjunto completo (263 actions) vem do catálogo da
API, que `packages/database` não importa.

| Garantia | Como |
| -------- | ---- |
| Senha estática | Literal no script de seed — **sem** override por `CISNE_*_PASSWORD` |
| Idempotente | Reexecução não altera contagem de capabilities nem de grants, nem cria duplicata |
| Empregado com menor privilégio | `empregado@` não recebe o conjunto GLOBAL completo: papel `EMPREGADO` com 17 capabilities e **0** financeiro/contábil/fiscal; grants 7 GLOBAL + 10 ASSIGNED, **0** sensíveis |
| Acesso amplo é explícito | Só os perfis marcados com `broadDevAccess` recebem as 263 actions — como grant direto **e** como capability de papel |
| Proibido em produção | `runOperationalProfilesSeed` chama `assertDevelopmentOnly` |

**Autorização tem dois caminhos — os dois precisam da guarda.** O PDP concede por grant direto e
por capability de papel (`apps/api/src/authorization/services/policy-decision-point.service.ts`,
`findRoleDerivedActionRows`). A correção registrada em 2026-09-25 revogou os grants GLOBAL diretos
do antigo login do empregado, mas o papel dele continuou com as 263 actions — e o sobre-privilégio
seguia **efetivo**: em 2026-09-25 aquele login respondia `200` em `/api/v1/authz/access-admin/*`.
Corrigir apenas a tabela `grants` não basta; este é o invariante que `applyBroadDevAccess` protege.

```powershell
pnpm --filter @cisne/database seed:profiles   # perfis de negócio (abrahim, monica, empregado)
pnpm auth:repair:dev-login                    # os 4 logins estáticos em cisne_local_dev e cisne_runtime
```

Verificação usada (logins e permissão efetiva, não só a tabela de grants): login HTTP dos 4 perfis
e sondagem de `/api/v1/authz/access-admin/identities`, `/api/v1/finance/payables`,
`/api/v1/service-orders` por perfil. `empregado@` recebe `403` no console de acesso e `200` em
ordens de serviço; `rafael@` recebe `200` em ambos, por decisão.

**Exceção registrada (conflito com a regra histórica "Sem senha em código").** A regra da seção
*Segurança* permanece válida para todo o resto: senhas reais, de produção e de homologação nunca
entram no código, e `PRODUCTION_BOOTSTRAP` continua exigindo variáveis de ambiente e confirmação
explícita. A exceção é estritamente: identidades **sintéticas de desenvolvimento**, em domínio
reservado RFC 2606 (`cisne-rondonia.invalid`), que nunca existem em HML nem em produção, e que o
responsável exige como valor fixo. Não reutilizar esses valores fora de desenvolvimento.

Identidades antigas de desenvolvimento que **permanecem no banco** (`controle@`,
`controle-financeiro@`, `dev-operator@`) não fazem parte dos logins estáticos. A última carrega 263
grants GLOBAL diretos e nenhum papel. Não foram removidas (preservação de histórico); se o banco
dev for recriado, elas não voltam.

## SYNTHETIC_BUSINESS_SEED (development / homologation)

Massa sintética determinística para telas, filtros e fluxo vertical. **Proibido em produção.**

Pré-condições:

- `NODE_ENV=development` e `DATABASE_URL` apontando a `cisne_local_dev` em host local
- `DEVELOPMENT_SYNTHETIC_SEED_CONFIRM=I_UNDERSTAND`
- Operador DEV existente (`pnpm auth:repair:dev-login`)

Homologação: `CISNE_ENV=hml`, database `cisne_hml`, `HML_SYNTHETIC_SEED_CONFIRM=I_UNDERSTAND`. O processo de seed pode ter `NODE_ENV=production` (imagem HML) desde que o banco seja `cisne_hml`. Operador: `HML_SMOKE_LOGIN` / `BOOTSTRAP_ADMIN_LOGIN`. Comando: `pnpm --filter @cisne/api seed:synthetic` (Nest build; não usar `tsx` no runner). O fluxo parcial de locação envia janela operacional no `planResource` (mesmo recorte do UAT).

HML 2026-09-03: 15/15 cenários presentes (`medicao-pendente` created; demais already_present).

```powershell
$env:DEVELOPMENT_SYNTHETIC_SEED_CONFIRM='I_UNDERSTAND'
$env:SEED_REFERENCE_DATE='2026-08-01T12:00:00-04:00'  # opcional
pnpm db:seed:synthetic
```

Namespace: `cisne-synthetic-dev-v1` via `external_erp_id` e prefixo `TESTE —` nos nomes.

Idempotente: reexecução retorna `already_present` por cenário.

## TEST_DATA_BUILDERS

`IdentityTestBuilders` produz dados `@cisne.invalid` isolados:

| Builder | Resultado |
| ------- | --------- |
| `activeIdentity()` | Identidade ativa + credencial |
| `disabledIdentity()` | Status `disabled` + `disabled_at` |
| `validCredential()` | Identidade + credencial válida |
| `validSession()` | Sessão ativa |
| `expiredSession()` | Sessão `expired` |
| `revokedSession()` | Sessão `revoked` |

Sem CPF, CNPJ, e-mail ou telefone reais.

## PRODUCTION_BOOTSTRAP

- **Não** roda no startup da API
- **Não** cria conta padrão
- Exige variáveis explícitas + confirmação
- Rejeita senha fraca (`validatePasswordStrength`)
- Rejeita se já existir qualquer identidade no banco
- Sem roles/permissões empresariais

```powershell
$env:BOOTSTRAP_ADMIN_LOGIN='admin@example.invalid'
$env:BOOTSTRAP_ADMIN_PASSWORD='Str0ng!Bootstrap-99'
$env:BOOTSTRAP_CONFIRM='I_UNDERSTAND'
pnpm bootstrap:first-identity
```

## Variáveis

| Variável | Obrigatória | Contexto |
| -------- | ----------- | -------- |
| `DEV_SEED_PASSWORD` | Não | Dev seed (local `.env`) |
| `BOOTSTRAP_ADMIN_LOGIN` | Sim (bootstrap) | Produção manual |
| `BOOTSTRAP_ADMIN_PASSWORD` | Sim (bootstrap) | Produção manual |
| `BOOTSTRAP_CONFIRM` | Sim (bootstrap) | Deve ser `I_UNDERSTAND` |
| `DATABASE_URL` | Sim | Conexão PG |

Ver `.env.example` — nomes apenas, sem valores secretos.

## Segurança

| Regra | Implementação |
| ----- | ------------- |
| Sem senha em código | Hash via `scrypt` em runtime. **Exceção registrada 2026-09-25:** senhas literais apenas dos `STATIC_DEV_PROFILES` (sintéticos, `.invalid`, dev-only) — ver seção acima |
| Sem hash em resposta | `SafeSeedResult` tipado |
| Seed proibido em produção | `assertDevelopmentOnly` |
| Bootstrap manual | CLI `bootstrap:first-identity` |
| Política de senha | ≥12 chars, classes mistas, padrões fracos bloqueados |

## Testes

| Suite | Arquivo | Cobertura |
| ----- | ------- | --------- |
| Unit | `seed/password-policy.spec.ts` | Senha fraca/forte |
| Integração | `seed.bootstrap.integration.spec.ts` | Idempotência, isolamento, bootstrap, vazamento |

Comandos:

```powershell
pnpm test
pnpm test:integration
```

## Limitações

- Hash `scrypt` custom — não bcrypt/argon2 (Prompt 20 pode alinhar com IdP)
- Bootstrap produção não valida e-mail real vs fictício (operador responsável)
- Sem seed automático no `pnpm dev`
- Sem papéis empresariais (Prompt 21+)

## Comandos de validação

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```
