# SISTEMA CISNE RONDÔNIA

Repositório de governança e engenharia do **SISTEMA CISNE RONDÔNIA**, sistema a ser desenvolvido para empresa privada sediada em Porto Velho, Rondônia.

## Estágio atual

```text
PROJECT PHASE: IMPLEMENTATION (pré-produção / engenharia)
FUNCTIONAL CODE: STARTED — domínio operacional implementado (API + web)
ENGINEERING READINESS: READY (suítes automatizadas, UAT vertical, backup/DR, readiness gate)
PRODUCTION READINESS: NO-GO — único blocker oficial: PILOT_OBSERVATION_WINDOW_NOT_COMPLETED
GO-LIVE / HYPERCARE: BLOCKED (Prompts 93 e 94) até EXIT_READY do piloto (janela 14d; saída 13 set 2026)
```

O monorepo contém backend NestJS (`@cisne/api`) e frontend React (`@cisne/web`) com módulos empresariais reais: clientes, solicitações, propostas, pedidos de compra, ordens de serviço, execução, medições, faturamento, documentos, autorização, auditoria e notificações. O SISTEMA CISNE RONDÔNIA é o sistema empresarial centralizado (SRC-004 / BR-042): não haverá conexão com ERP; ACL de ERP permanece desligada. Rastreio e demais canais não-ERP seguem desligados até confirmação.

**Não** equivale a go-live em produção. Sign-off empresarial, RPO/RTO (DDP-016) e UAT humano (dois administradores) estão registrados em `readiness-evidence.json`. O gate de produção permanece **NO-GO** enquanto o piloto não completar a janela de observação e não houver autorização de exit.

Documentação de execução local: [`docs/17-bootstrap/local-development.md`](docs/17-bootstrap/local-development.md).

PostgreSQL local e migrations: [`docs/18-database-foundation/README.md`](docs/18-database-foundation/README.md).

Readiness e gates: [`docs/19-operations/production-readiness-gate.md`](docs/19-operations/production-readiness-gate.md).

## Objetivo geral

Estabelecer uma baseline documental segura para descoberta, rastreabilidade e implementação futura de um sistema transacional crítico de gestão operacional, **somente após** requisitos mínimos, fontes empresariais e decisões bloqueantes estarem tratados.

O contexto empresarial preliminar inclui atividades como representação comercial, logística, transportes, locações e gestão de serviços com veículos, equipamentos e mão de obra. Esse contexto **não** é escopo contratado, MVP ou lista de módulos do primeiro release.

## Aviso

Este repositório contém código funcional de domínio em desenvolvimento e validação de engenharia. **Produção/go-live permanece NO-GO** até blockers de governança resolvidos (ver `readiness-evidence.json`). Afirmar que o sistema está “em produção” ou “pronto para operação real” sem evidência autorizada é incorreto.

O processo de prompts incrementais **não promete ausência total de erros**. Ele reduz risco por validação, rastreabilidade, classificação explícita de incerteza, testes futuros proporcionais ao risco e quality gates. Erros, omissões e conflitos devem permanecer visíveis.

## Princípios do desenvolvimento incremental

- Documentação e proveniência antes de código.
- Fato, hipótese, desejo, interpretação e decisão pendente não se misturam.
- Regras empresariais não são confirmadas sem fonte.
- Commits pequenos e rastreáveis, quando o Git permitir.
- Implementação bloqueada enquanto faltar informação crítica (`NOT_READY_FOR_IMPLEMENTATION`).

Detalhes: [`docs/00-governance/engineering-principles.md`](docs/00-governance/engineering-principles.md), [`docs/00-governance/execution-protocol.md`](docs/00-governance/execution-protocol.md).

## Estrutura do repositório

Monorepo único (pnpm + Turbo). Front, API e banco ficam neste Git; não há três repositórios-fonte.

| Papel | Caminho | Pacote |
| ----- | ------- | ------ |
| Frontend | [`apps/web/`](apps/web/) | `@cisne/web` (React) |
| Backend / API | [`apps/api/`](apps/api/) | `@cisne/api` (NestJS) |
| Banco de dados | [`packages/database/`](packages/database/) | `@cisne/database` (schema Drizzle, migrations SQL, seeds) |
| PostgreSQL local / HML | [`docker/`](docker/) | Compose (não é um terceiro app) |

`cisne-backend/`, `cisne-frontend/` e `cisne-infra/` na raiz, se existirem no disco, são **cópias exportadas** (`scripts/split-repos`). Estão no `.gitignore` e **não sobem no GitHub**. A fonte de verdade é `apps/` + `packages/`.

## Estrutura documental

| Caminho                                      | Função                                                          |
| -------------------------------------------- | --------------------------------------------------------------- |
| [`AGENTS.md`](AGENTS.md)                     | Instruções vinculantes para agentes                             |
| [`docs/README.md`](docs/README.md)           | Índice da documentação                                          |
| [`docs/00-governance/`](docs/00-governance/) | Carta, protocolo, DoR, DoD, gates, roadmap                      |
| [`docs/01-foundation/`](docs/01-foundation/) | Fontes, escopo, regras, decisões, riscos, rastreabilidade       |
| [`docs/inputs/`](docs/inputs/)               | Área segura para fontes empresariais futuras                    |
| [`docs/templates/`](docs/templates/)         | Modelos de registro                                             |
| [`apps/`](apps/)                             | API NestJS + web React — domínio operacional (Prompts 16+)      |
| [`packages/`](packages/)                     | Tooling compartilhado (`tsconfig`, `eslint-config`, `database`) |
| [`docker/`](docker/)                         | Compose PostgreSQL local (Prompt 17)                            |

`apps/` e `packages/` contêm implementação funcional de domínio, testes de integração e pipelines de readiness. Governança de produção: [`docs/19-operations/`](docs/19-operations/).

## Como adicionar fontes empresariais

1. Depositar originais ou cópias de trabalho em `docs/inputs/`, seguindo [`docs/inputs/README.md`](docs/inputs/README.md).
2. Registrar a fonte em [`docs/01-foundation/source-registry.md`](docs/01-foundation/source-registry.md) com identificador novo (não reutilizar IDs).
3. Preencher o template [`docs/templates/source-template.md`](docs/templates/source-template.md) quando a ingestão for autorizada (Prompt 01 ou posterior).
4. Não tratar arquivo não registrado como evidência.
5. Não inventar `SOURCE-ID` para documento inexistente.

Enquanto as fontes não forem fornecidas, o registro permanece `NOT_PROVIDED`.

## Como executar a sequência de prompts

1. Ler `AGENTS.md`, este `README.md` e `docs/README.md`.
2. Consultar [`docs/00-governance/prompt-execution-log.md`](docs/00-governance/prompt-execution-log.md) e [`docs/00-governance/prompt-roadmap.md`](docs/00-governance/prompt-roadmap.md).
3. Confirmar pré-condições do protocolo em [`docs/00-governance/execution-protocol.md`](docs/00-governance/execution-protocol.md).
4. Executar **somente** o prompt solicitado.
5. Validar quality gates em [`docs/00-governance/quality-gates.md`](docs/00-governance/quality-gates.md).
6. Atualizar rastreabilidade e o registro de execução.
7. Parar. Aguardar revisão antes do próximo prompt.

### Regra de um prompt por vez

É proibido encadear Prompt N+1 ao concluir Prompt N, salvo ordem explícita nova do responsável pelo projeto.

### Regra de revisão antes do próximo prompt

O próximo prompt só deve iniciar após revisão do relatório, do registro de execução e dos gates. Status `PASS_WITH_RESTRICTIONS`, `FAIL` ou `BLOCKED` impede avanço até tratamento documentado.

## Referências de prontidão

- Definition of Ready: [`docs/00-governance/definition-of-ready.md`](docs/00-governance/definition-of-ready.md)
- Definition of Done: [`docs/00-governance/definition-of-done.md`](docs/00-governance/definition-of-done.md)
- Carta do projeto: [`docs/00-governance/project-charter.md`](docs/00-governance/project-charter.md)
