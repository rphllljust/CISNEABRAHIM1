# RC-R1-003 — Congelamento do release candidate da fatia R1

| Campo | Valor |
|---|---|
| Document ID | RC-R1-003 |
| Status | **FROZEN** — artefato construído, evidência NÃO reemitida |
| Data | 2026-11-12 |
| Fonte de escopo | `docs/01-foundation/release-1-closed-scope.md` (R1-SCOPE-001) |
| Aceite empresarial | `docs/inputs/SRC-009-aceite-processo-operacional-rc1-e-delta-rc2.md` |
| Continuidade | DDP-016 (`rpoRto.decision=APPROVED`) |

## Artefato congelado

| Campo | Valor |
|---|---|
| commitSha | `6ffacd1f425b63428bd0b95d122daf4534c06a09` |
| version | `0.0.0+6ffacd1f` |
| artifactDigest | `sha256:2ed465b784e6d7d4358b09bfdf4c4bb6b686e5e2642429a8f9006db8f9699502` |
| buildRunId | `local-6ffacd1f-1794526443144` |
| Arquivos | 3013 |
| Segredos no artefato | 0 (verificado por `release/package.mjs`) |
| SBOM | 746 pacotes, 7 containers |
| Node / pnpm | 24.14.0 / 10.34.7 |

## Como o escopo R1 é aplicado

O recorte da Release 1 **não é um commit nem um subconjunto de código**: é um conjunto de flags
`FEATURE_MODULE_*` fail-closed, aplicadas em runtime pelo `ReleaseScopeGuard` (`APP_GUARD` global).

Consequência direta, e ela é o motivo de o RC poder conter todos os módulos:

- módulo fora do escopo **existe** no artefato, porém **não é exposto** sem a flag em `true`;
- flag ausente = desligado, sem depender de default escrito em lugar nenhum;
- `release-1-scope` tem 26 testes cobrindo isolamento de ambiente, rota não-gated e contaminação
  por variável herdada do shell.

Portanto "congelar um RC excluindo módulos sem aceite" se cumpre **na configuração de deploy**, não
cortando código. Cortar os módulos do build seria pior: o artefato deixaria de ser o mesmo que a CI
validou em `main`.

## Por que a evidência de readiness NÃO foi reemitida

`readiness-evidence.json` tem `releaseCandidate.commitSha = 2c8fdfca` (RC2, 2026-09-26) propagado em
`businessSignOff.releaseCandidate`, `manualUatUx.releaseCandidate` e `pilot.releaseCandidate`.

Reemitir para `6ffacd1f` exigiria mover o aceite SRC-009 para um commit que entrou **1.381 commits**
depois dele. O próprio `businessSignOff.decisionStatement` delimita o aceito:

> "A fatia operacional da Release 1 (SRC-009, opções 1-A e 2-A) permanece o processo empresarial
> acordado neste release candidate. O núcleo complementar atrás de `FEATURE_MODULE_*` não está
> aceito como operação oficial por este termo."

Mover o vínculo sem novo aceite violaria a regra explícita de não transferir aceite entre RCs.
A instrução de serviço também proíbe: *"Não transfira o aceite do RC2 para funcionalidades
posteriores sem aprovação correspondente."*

**Estado correto:** artefato congelado e provado; vínculo de aceite ainda pendente de decisão
empresarial.

## O que o RC herda e o que ele NÃO herda

| Item | Situação |
|---|---|
| Fatia operacional R1 (autenticação, clientes, solicitações, propostas/PO, catálogo, ativos, OS, planejamento, execução, medição, faturamento interno) | **Herdado** — é o objeto do SRC-009, sem alteração de escopo |
| RPO/RTO DDP-016 (24h/4h, tier conservative) | **Válido** — decisão de continuidade, não vinculada a RC |
| Núcleo complementar (financeiro, fiscal, contábil, estoque, folha, suprimentos, fornecedores, contratos, pessoas, verticais, alertas, relatórios) | **NÃO herdado** — permanece atrás de `FEATURE_MODULE_*`, desligado |
| UAT/UX manual | **NÃO herdado** — `manualUatUx.status=NOT_STARTED` para este RC |
| Piloto | **NÃO herdado** — `pilot.phase=NOT_STARTED`, exige start event novo |

## Gates medidos neste artefato

Ver relatório de execução. Resumo:

- `tsc -b` API e web: exit 0
- `eslint` API e web: exit 0
- unit API: 1929 testes (3 falhas pré-existentes de fixture, corrigidas e re-medidas)
- unit web: 1484/1484
- integração auth: 11/11 · concorrência: 24/24 · UAT business: 5/5 · réplica: 7/7
- `gate:database`: PASS (fresh + incremental N-1 → N)
- backup/DR: 19/19
- escopo R1: 26/26
- readiness gate: **Engineering READY / Production NO-GO**

## Bloqueio remanescente

`MANUAL_UAT_NOT_COMPLETED`, `PILOT_NOT_STARTED` — ambos exigem evento humano e, no caso do piloto,
janela de 14 dias de observação. Não são resolvíveis por engenharia.
