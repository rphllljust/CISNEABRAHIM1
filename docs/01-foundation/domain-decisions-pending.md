# Domain decisions pending

| Campo             | Valor                                                   |
| ----------------- | ------------------------------------------------------- |
| Document ID       | DDP-REG-001                                             |
| Last updated      | 2026-10-01 (DDP-045 aberta: falhas de teste pré-existentes fora do escopo B3) |
| Status of answers | **PARTIAL** — DDP-014 (ERP), DDP-020, DDP-026 (fatia R1), DDP-028, DDP-041; DDP-043, DDP-044 e DDP-045 abertas; demais abertas |

Status típicos: `OPEN`, `BLOCKING`, `ANSWERED`, `SUPERSEDED`. Todas as entradas abaixo estão `OPEN` e `BLOCKING` para implementação do tema.

Não responder. Não inventar estados, cardinalidades, SLAs, RPO, RTO ou volumes.

Template: [`../templates/domain-decision-template.md`](../templates/domain-decision-template.md).

## DDP-045 — Correção das 4 falhas pré-existentes fora do escopo B3

Como tratar as 4 falhas de teste pré-existentes à sessão B3 (observabilidade)?

**Contexto:** a sessão B3 provou, por `git stash` das próprias alterações e re-execução no baseline
`82f72c6`, que as 4 falhas existiam **antes** dela. Não são regressão de B3. As 4 falhas, com causa
raiz verificada:

| # | Spec | Falha | Causa raiz verificada | Classificação |
| - | ---- | ----- | --------------------- | ------------- |
| 1 | `apps/api/src/test/ensure-migrations-journal-coverage.spec.ts` | `journal tags without a coverage block in ensure-migrations.ts: 0082_audit_trail_logs` | A migration `0082_audit_trail_logs` entrou no `_journal.json` sem o bloco de cobertura correspondente em `ensure-migrations.ts`. O gate recusa sincronizar o journal nessa condição. | GATE FALHO (gate correto; migration incompleta) |
| 2 | `apps/api/src/service-orders/domain/operational-eligibility.spec.ts` | `expected 'BLOCKED' to be 'REVIEW_REQUIRED'` | Linhas 60-63 omitem o parâmetro `asOf` (ao contrário do bloco irmão em 54-57), fazendo a avaliação usar o relógio real contra `nextDueAt: '2026-09-30'`. Em 2026-10-01 o vencimento já passou e o domínio decide `BLOCKED` — corretamente. | DATA-SENSÍVEL (time-bomb; domínio correto, teste apodreceu) |
| 3 | `apps/api/src/work-inbox/sources/finance.source.spec.ts` (×2) | `TypeError: Cannot read properties of undefined (reading 'map')` em `finance.source.ts:70` e `:88` | O commit `fd262dc` (2026-09-28, `fix(finance): paginate titles in SQL...`) mudou `list()` para devolver envelope paginado `{ items }`, mas não atualizou o spec (criado em `caffc18`, 2026-09-27), que ainda mocka `list` devolvendo array cru. `rows = page.items` vira `undefined`. | REGRESSÃO REAL (de `fd262dc`, não de B3) |

Detalhamento das 4 falhas (duas no spec 3):

- `ensure-migrations-journal-coverage.spec.ts` — 1 falha de 4 testes.
- `operational-eligibility.spec.ts` — 1 falha de 7 testes.
- `finance.source.spec.ts` — 2 falhas de 14 testes (as 2 que atravessam `collect()`; as outras 12
  exercitam funções puras e passam).

**Bloqueio de escopo reconhecido:** a correção de (2) exige `apps/api/src/service-orders/domain/`
e a de (3) exige `apps/api/**` — ambos fora do escopo autorizado da sessão B3-R. Nenhuma foi
tentada.

**Impacto no CI:** a suíte unitária da API fica em 1167 passed / 4 failed (1171), portanto o CI
**não fica verde**.

**Questão:** como tratar as 4 falhas pré-existentes?

**Opções consideradas:**

| Opção | Descrição |
| ----- | --------- |
| A | Corrigir em sessão dedicada, prioridade alta, antes de B4 |
| B | Corrigir em sessão dedicada, prioridade média, depois de B4 |
| C | Investigar origem (commits anteriores) antes de decidir |
| D | Aceitar como dívida de longo prazo, com waiver formal |

**Impacto por opção:**

- **A** — bloqueia B4 por 1 sessão.
- **B** — dívida acumula, CI não fica verde.
- **C** — exige arqueologia de `git log` (parcialmente já feita nesta sessão para identificar as
  causas raiz acima; restaria a origem de (1)).
- **D** — governança aceita incerteza declarada.

**Status:** `OPEN` · **Classificação:** `PENDING_BUSINESS_DECISION` · **Bloqueia implementação:**
não para observabilidade (fechada); sim para declarar CI verde · **Data:** 2026-10-01

**Residual:** decisão de priorização. **Sem recomendação de engenharia** — as 4 opções acima são
registro, não escolha. Não implementar nenhuma opção até fonte.

## DDP-044 — Divisão entre audit_logs e security_audit_events

Onde registrar negações de ações de domínio (tentativa de executar comando em recurso fora do
escopo autorizado)?

**Contexto:** o PDP grava decisões de autorização em `audit.security_audit_events`. `audit.audit_logs`
(canal `AUDIT_TRAIL`) recebe apenas `CREATE` e `TRANSITION` de service-orders — negações **não**
aparecem nele. Não existe regra explícita sobre onde registrar negações de ações de domínio.

**Opções consideradas:**

| Opção | Descrição                                                              |
| ----- | ---------------------------------------------------------------------- |
| A     | Apenas em `security_audit_events` (comportamento atual)                |
| B     | Apenas em `audit_logs` (migrar a gravação do PDP)                      |
| C     | Ambos os canais, com `correlation_id` comum                            |

**Impacto:** A — "quem tentou cancelar a OS-42 e falhou?" não é respondível em `audit_logs`;
B — perde a semântica de decisão de autorização; C — dupla escrita, risco de divergência entre
canais, infla o banco.

**Status:** `OPEN` · **Classificação:** `PENDING_BUSINESS_DECISION` · **Bloqueia implementação:**
sim, para instrumentação de acesso negado · **Data:** 2026-10-01

Ver [`DDP-044-divisao-canais-auditoria.md`](./DDP-044-divisao-canais-auditoria.md).

## DDP-043 — Cobertura do canal AUDIT_TRAIL para writes sem correlação

O canal `AUDIT_TRAIL` (`audit.audit_logs`) deve cobrir apenas ações humanas rastreáveis
(originadas de requisição HTTP autenticada, com `correlationId`), ou também escritas
automáticas originadas de jobs, seeds, migrações e conversões internas?

**Contexto:** B1.5 vincula a gravação à presença de `correlationId`. Escritas internas **não**
geram linha em `audit_logs`. Ver `ADR-007` (auditoria transacional no repositório), que
registra esta limitação como consequência negativa aceita.

**Opções consideradas:**

| Opção | Descrição                                                                   |
| ----- | --------------------------------------------------------------------------- |
| A     | Manter como está — `AUDIT_TRAIL` = ação humana rastreável                    |
| B     | Instrumentar jobs/seeds com `correlationId` sintético (ex.: `job:<uuid>`)    |
| C     | Criar canal separado `SYSTEM_AUDIT` para escritas internas                   |

**Impacto por opção:**

- **A** — falta de rastreabilidade de operações em lote e jobs noturnos.
- **B** — uniformidade, mas mistura origem humana e origem sistema na mesma trilha.
- **C** — separação limpa, mas exige novo schema, nova política e nova migration.

**Status:** `OPEN` · **Bloqueia implementação:** não (o canal atual permanece consistente) ·
**Data:** 2026-10-01

**Residual:** decisão empresarial. Recomendação de engenharia seria a opção C, por separar
responsabilidades — mas **não** é decisão tomada. Não implementar nenhuma opção até fonte.

## DDP-001 — Tipos de OS

Quais tipos de Ordem de Serviço existem? Quem os define? Um tipo por atividade (transporte, locação, etc.) ou taxonomia distinta?

**Status:** `OPEN` · **Bloqueia implementação de OS:** sim

## DDP-002 — Fluxo de solicitação

Como uma solicitação nasce, quem pode criá-la, o que a torna válida, e se toda solicitação gera OS?

**Status:** `PARTIALLY_ANSWERED` (SRC-008, 2026-09-03)

**Respondido:** solicitação e OS são entidades distintas. Nem toda solicitação gera OS. Conversão em uma ou mais OS somente pela autoridade operacional máxima. Solicitação pode ser recebida, analisada, recusada ou arquivada. WhatsApp, se usado, é origem — não SoT.

**Residual `OPEN`:** quem além da autoridade máxima pode *criar* a ficha de solicitação (ver DDP-028); campos mínimos de validade além dos já implementados.

**Bloqueia implementação de solicitação/OS:** não para o recorte já respondido.

## DDP-003 — Liberação da OS

Existe liberação? Por quem? Com base em quê (crédito, PO, agenda, frota)? O que ocorre se não houver liberação?

**Status:** `PARTIALLY_ANSWERED` (SRC-008, 2026-09-03)

**Respondido:** existe liberação. Somente a autoridade operacional máxima libera OS para execução. A mesma pessoa pode criar e liberar. Sem liberação, a OS não entra em execução. PO pode ser exigido antes da execução se a configuração do cliente/contrato/catálogo assim determinar.

**Residual `OPEN`:** crédito, agenda e frota como critérios adicionais de liberação.

**Bloqueia implementação de OS:** não para quem libera e para PO configurável.

## DDP-004 — Cancelamento

Quem cancela solicitação, OS, PO, medição ou fatura? Quais efeitos colaterais (alocação, documentos, financeiro)?

**Status:** `PARTIALLY_ANSWERED` (SRC-008, 2026-09-03)

**Respondido para OS:** somente a autoridade operacional máxima cancela OS. Cancelamento nunca apaga o registro; permanece auditado.

**Residual `OPEN`:** cancelamento de PO, medição (recusa ≠ cancelamento) e fatura; efeitos colaterais de alocação/financeiro além da trilha da OS.

**Bloqueia implementação dos cancelamentos:** não para cancelamento de OS.

## DDP-005 — Reabertura

Reabertura é permitida? De quais artefatos? Com quais restrições de auditoria e financeiro?

**Status:** `PARTIALLY_ANSWERED` (SRC-008, 2026-09-03)

**Respondido para OS:** reabertura é excepcional, exclusiva da autoridade máxima, exige justificativa obrigatória e registra estado anterior, novo estado, usuário, data/hora e motivo.

**Residual `OPEN`:** reabertura de medição, PO ou fatura; efeitos financeiros além da trilha da OS.

## DDP-006 — Mão de obra

Como pessoas são identificadas, alocadas, substituídas e apuradas? Existe folha, terceiros, diária, hora?

**Status:** `OPEN`

## DDP-007 — Equipamentos

Quais equipamentos entram no sistema? Alocação exclusiva? Manutenção? Locação própria vs de terceiro?

**Status:** `OPEN`

## DDP-008 — Veículos

Controle de frota própria, agregados, rastreador, jornada, documentos do veículo?

**Status:** `OPEN`

## DDP-009 — Purchase Order (PO)

O PO é obrigatório? Origem (cliente interno vs cliente externo)? Um PO para N OS ou N PO para uma OS? Estouro de saldo?

**Status:** `PARTIALLY_ANSWERED` (SRC-008, 2026-09-03)

**Respondido:** PO não é obrigatório globalmente. Obrigatoriedade configurável por cliente, contrato ou regra comercial (antes da execução, antes do faturamento, ou não exigido). Relação preferencial 1 PO → N OS, sem impedir alocações futuras mais complexas. Estouro bloqueado por padrão; override administrativo com justificativa, auditoria e excedente explícito; nunca silencioso.

**Residual `OPEN`:** origem interna vs externa do PO.

**Bloqueia implementação de PO e de OS ligada a PO:** não para o recorte respondido.

## DDP-010 — Medição

O que é medido, quem mede, com qual evidência, e quando a medição é recusada?

**Status:** `PARTIALLY_ANSWERED` (SRC-008, 2026-09-03)

**Respondido:** medição = executado real, não cópia da proposta. Unidades conforme o serviço. Na R1 a autoridade máxima registra, envia, aprova ou recusa; a mesma pessoa pode registrar e aprovar. Recusa não apaga; permite correção/reenvio.

**Residual `OPEN`:** evidência mínima por tipo de serviço.

## DDP-011 — Faturamento

O que gera direito a faturar? Relação com medição, contrato, NF-e e outros documentos fiscais (regras fiscais **não** inventadas)?

**Status:** `PARTIALLY_ANSWERED` (SRC-008, 2026-09-03)

**Respondido:** direito a faturar, faturamento interno e emissão fiscal são fatos distintos. Política `MEASUREMENT_APPROVED`: só medição aprovada gera direito a faturar; execução concluída isoladamente não basta. Políticas `FIXED_PRICE` / `PERIODIC` / `MILESTONE`: faturabilidade contratual sem medição quantitativa artificial.

**Residual `OPEN`:** tipo legal NF-e/NFS-e, alíquotas e emissão oficial (DDP-023).

## DDP-012 — Pagamento

Como se registra pagamento? Conciliação? Falha do meio de pagamento?

**Status:** `OPEN`

## DDP-013 — Documentos

Quais documentos lógicos existem, obrigatoriedade, versões, validade, e quem é o emissor?

**Status:** `OPEN`

## DDP-014 — Integrações

Quais sistemas externos existem (ERP, fiscal, rastreamento, bancos)? Quem é Source of Truth por dado?

**Status:** `PARTIALLY_ANSWERED` (SRC-004, 2026-09-03)

**ERP:** conexão `REJECTED`. Não haverá ERP externo. O SISTEMA CISNE RONDÔNIA é o sistema empresarial centralizado.

**Demais sistemas (ainda OPEN):** fiscal/SEFAZ/prefeitura, rastreamento, bancos, WhatsApp. SRC-004 não decide esses canais — não são ERP.

**Source of Truth:** ver DDP-020 + SRC-004 + BR-042.

## DDP-015 — Permissões

Quais funções, segregações e incompatibilidades (maker-checker) existem? Sem inventar papéis.

**Status:** `PARTIALLY_ANSWERED` (SRC-008, 2026-09-03)

**Respondido:** capabilities explícitas (criar/liberar/cancelar/reabrir OS, converter solicitação, aprovar medição, autorizar excedente de PO, preparar faturamento interno). Na R1, atribuídas somente às duas autoridades máximas equivalentes. Não há maker-checker obrigatório entre elas. Campos de auditoria separados permitem SoD futura.

**Residual `OPEN`:** demais funções operacionais (não inventar organograma). Perfis UAT `executor`/`finance` são mapeamento de engenharia, não papéis empresariais novos.

**Bloqueia implementação de autorização de negócio:** não para o recorte da autoridade máxima.

## DDP-016 — RPO e RTO

| Campo | Valor |
| ----- | ----- |
| Status | **APPROVED** (tier conservadora — 24h RPO / 4h RTO) |
| Proposta técnica | `docs/19-operations/ddp-016-rpo-rto-proposal.json` |
| Evidência implementação | Prompt 84 (backup), 85 (DR), `ddp-016-proposal.ts` |

**Classificação:** proposta técnica fundamentada na arquitetura as-built (pg_dump lógico, sem WAL/PITR). Valores da tier conservadora **aprovados** em `readiness-evidence.json` (Abrahim Jabour Junior, 2026-08-30): RPO 24h / RTO 4h.

### Capacidade técnica atual (as-built)

| Item | Valor |
| ---- | ----- |
| Método backup PG | `pg_dump -Fc` lógico |
| WAL/PITR | **Não implementado** |
| Réplica/failover PG | **Não implementado** |
| RPO alcançável (diário) | **24h** (intervalo entre backups) |
| RTO alcançável (manual) | **~4h** (runbook); drill isolado mediu **~4,3s** (automático, não representa produção) |

**Última validação DR (isolada, `cisne_local_test`):** correção aplicada — `hydrateObjectStorageForDr` copia objetos referenciados no DB do storage canônico (`OBJECT_STORAGE_ROOT` / `DR_OBJECT_STORAGE_SOURCE`) para o root isolado antes do backup; elimina falha `document_object_integrity` por seed fora do storage do drill. Evidência anterior (FAIL): `apps/api/.backup/dr-drill-validate/status/latest.json`. Reexecutar `pnpm dr:drill` com `pg_dump` disponível para novo PASS.

### Alternativas para decisão

| Tier | RPO | RTO | Alcançabilidade |
| ---- | --- | --- | --------------- |
| Conservadora | 24h | 4h | **ACHIEVABLE_NOW** |
| Recomendada | 6h | 2h | REQUIRES_OPERATIONAL_CHANGE (agendamento 6h) |
| Alta disponibilidade | 15min | 1h | NOT_ACHIEVABLE_WITH_CURRENT_ARCHITECTURE |

**Decisão humana:** tier conservadora registrada em `readiness-evidence.json` (`approvedBy` Abrahim Jabour Junior, 2026-08-30). Não reabrir como `PENDING`.

**Status anterior:** `OPEN` → atualizado 2026-08-30 após análise técnica.

## DDP-017 — Volume

Ordens, usuários, documentos, picos? `UNKNOWN`.

**Status:** `OPEN`

## DDP-018 — Operação offline

Há exigência de operação sem rede? Em quais papéis e com quais conflitos de sincronização?

**Status:** `OPEN`

## DDP-019 — Retenção

Prazos legais e empresariais de guarda de dados e documentos? `NOT_PROVIDED`.

**Status:** `OPEN`

## DDP-020 — Source of Truth

Para cada conceito crítico (OS, saldo de PO, medição, fatura, pagamento, cadastro), qual sistema é autoritativo?

**Status:** `ANSWERED` (realinhamento arquitetural 2026-09-01; evidência empresarial SRC-004 em 2026-09-03)

**Decisão empresarial:** CISNE é o **sistema empresarial centralizado**. Não haverá conexão com ERP externo (SRC-004). Não haverá ERP externo como autoridade para financeiro, fiscal ou contabilidade. Módulos nativos (FINANCE, FISCAL, ACCOUNTING, INVENTORY, PAYROLL) serão implementados no próprio monolito modular, sem SoT híbrido com ERP.

**Escopo operacional já implementado:** CISNE = SoT de Cliente, OS, PO, medição, preparação de faturamento (BillingDocument interno), documentos, execução, alocação e custos operacionais. `externalErpId` permanece campo defensivo opcional, nunca PK (BR-031); não é pré-requisito de cadastro nem canal de integração.

**Integrações externas:** adapter/ACL de ERP permanece desligado e **não** será ativado (SRC-004). Gateways de SEFAZ/prefeitura, banco e rastreio — quando existirem — não são ERP e continuam opcionais, nunca como pré-requisito de autoridade.

**Pendências residuais (não bloqueiam fronteira):** detalhes de legislação fiscal/tributária (DDP-023), regras de pagamento/conciliação (DDP-012). Canal WhatsApp: origem da solicitação (DDP-021 / SRC-008); Cisne permanece SoT do processo após o registro.

**Evidência:** [`source-of-truth-by-context.md`](../06-domain-boundaries/source-of-truth-by-context.md), `apps/api/src/platform/bounded-contexts/`.

**Bloqueia implementação de Clientes:** não · **Bloqueia fronteiras futuras:** não (BOUNDARY_READY)

## DDP-021 — Canal WhatsApp

WhatsApp continuará sendo canal oficial de solicitação? O sistema substituirá ou apenas registrará conversas? Qual o Source of Truth da mensagem?

**Status:** `PARTIALLY_ANSWERED` (SRC-008, 2026-09-03) · **Fonte:** SRC-001 EV-027, EV-032, EV-033; SRC-008 · **Risco:** RISK-018

**Respondido:** WhatsApp pode continuar como canal real de entrada na R1, tratado como **origem** da solicitação, não como fonte oficial do workflow. Após registro no Cisne (origem, cliente, solicitante, data/hora, descrição e anexos quando necessário), o Cisne é a fonte oficial do processo.

**Residual `OPEN`:** integração API/WhatsApp Business; SoT da mensagem bruta no aplicativo de mensagens.

## DDP-022 — Criar vs liberar OS (mesma pessoa)

A mesma pessoa pode criar rascunho e liberar OS? Existe segregação maker-checker obrigatória?

**Status:** `ANSWERED` (SRC-008, 2026-09-03)

**Resposta:** sim, a mesma pessoa pode criar rascunho e liberar a própria OS. Não há segregação maker-checker obrigatória entre as duas autoridades máximas equivalentes. Os campos de auditoria permanecem separados.

**Bloqueia:** não · **Fonte:** SRC-008 · **Risco residual:** RISK-022 (confusão operacional, não vedação de SoD)

## DDP-023 — Modo de emissão fiscal

O Sistema Cisne emitirá documento fiscal oficial, registrará documento externo, integrará ERP/fiscal/municipal ou apenas fatura/recibo não fiscal?

**Status:** `PARTIALLY_ANSWERED` (prompts FISCAL CORE e TAX ENGINE FOUNDATION, 2026-09-01; Release 1 closed scope 2026-09-02; SRC-007 gates, 2026-09-03) — CISNE é SoT do `FiscalDocument` oficial; SEFAZ/prefeitura apenas autorizam/transmitem via port; `BillingDocument` interno ≠ documento fiscal. A Release 1 expõe somente faturamento interno; o módulo fiscal permanece fail-closed (`FEATURE_MODULE_FISCAL`). Estrutura versionada `TaxRule`/`TaxRuleVersion`/`TaxCalculation` existe em `fis.*` sem alíquota oficial cadastrada. Tributação substantiva (alíquota legal, CFOP, NCM, código de serviço, ISS, ICMS, retenções) e tipo legal NF-e/NFS-e permanecem `OPEN` sem fonte normativa. SRC-005 (RFB) e SRC-006 (SEFIN, 2026-09-03) corroboram cadastro, IE, CNAEs e o regime exibido no snapshot estadual, mas não fornecem regras de cálculo, certificado ou credenciais. SRC-006 registra NF-e `NÃO CREDENCIADO`, evidência temporal contrária a qualquer ativação presumida de gateway NF-e. SRC-007 confirma os gates: transmissão NF-e `BLOCKED` sem credenciamento aprovado (BR-043); `fiscalStatus` ≠ `AUTHORIZED` e DANFE oficial `BLOCKED` sem protocolo SEFAZ (BR-044); legendas de rascunho/homologação e produção somente após autorização oficial (BR-045). SRC-004 rejeita conexão com ERP e **não** fecha o residual: SEFAZ/prefeitura não são ERP.

**Bloqueia:** emissão legal específica, gateway, DANFE oficial e preenchimento de alíquota oficial · **Não bloqueia:** núcleo de documento/eventos/imutabilidade nem estrutura do motor versionado · **Fonte:** EV-064, EV-065, EV-066; SRC-005; SRC-006 página 1; SRC-007 · **Risco:** RISK-012, RISK-025

## DDP-024 — Faixas de aging

Quais faixas de tempo definem solicitação/OS/medição/nota/pagamento “parados”? Valores atuais: nenhum confirmado — **proibido inventar** (EV-076).

**Status:** `OPEN` · **Fonte:** EV-074–EV-076

## DDP-025 — PWA

Existe exigência de Progressive Web App ou experiência mobile instalável?

**Status:** `OPEN` · **Fonte:** SRC-001 §22

## DDP-026 — Escopo do primeiro release

Quais verticais (locação citada como prioridade candidata em §21) entram no primeiro release? Confirmação formal da direção necessária.

**Status:** `ANSWERED` (fatia operacional da Release 1, 2026-09-02) — superfície fechada: autenticação, clientes PJ (SRC-002 Q01), solicitações, propostas/PO de cliente, catálogo, ativos/frota, OS, planejamento, execução, medição e faturamento interno. Verticais dedicadas de locação e transporte **não** entram como módulos da Release 1 (`OUT_OF_RELEASE_1`; prioridade econômica candidata EV-080 permanece `FUTURE_SCOPE_CANDIDATE`). Registro: [`release-1-closed-scope.md`](release-1-closed-scope.md).

**Bloqueia:** expansão de produto além da lista · **Não bloqueia:** operação da fatia listada · **Fonte:** EV-003, EV-080–EV-082, SRC-002, prompt autorizado 2026-09-02 · **Risco:** RISK-021

## DDP-027 — Chassi — exibição vs armazenamento

Como tratar chassi e dados sensíveis de veículo (máscara em tela vs armazenamento completo)?

**Status:** `OPEN` · **Fonte:** EV-052

## DDP-028 — Quem pode solicitar serviço

Quem pode solicitar? Solicitante interno ou externo? Lista de perfis?

**Status:** `ANSWERED` (SRC-002, Prompt 29-A corretivo) — Origem da demanda pode ser externa (cliente, contato, WhatsApp, PO, contrato, proposta, etc.). No Release 1, registro transacional da Solicitação é por usuário interno autorizado. Solicitante externo não cria/libera OS nem altera custo/preço/faturamento. Separar `REQUEST_ORIGIN` de `SYSTEM_ACTOR` e `AUTHORIZED_APPROVER`.

**Fonte:** EV-029, SRC-002 · **Bloqueia implementação de Solicitação (escopo R1):** não

## DDP-029 — Prontidão para liberação da OS

Quais condições tornam a OS pronta para liberação (crédito, PO, agenda, frota)?

**Status:** `OPEN` · **Bloqueia:** liberação · **Fonte:** EV-044

## DDP-030 — Visibilidade e alteração de custo, margem e preço

Quem visualiza custo e margem? Quem altera preço? Unidades de cobrança de mão de obra?

**Status:** `OPEN` · **Fonte:** EV-057, EV-060

## DDP-031 — Modelo de preço

Preço global, por item ou híbrido? Descontos e adicionais?

**Status:** `OPEN` · **Fonte:** EV-061

## DDP-032 — Estados de responsabilidade e handoff

Classificação de ASSIGNED, VIEWED, etc. como evento, estado ou auditoria. OS concluída pode receber novos itens?

**Status:** `OPEN` · **Fonte:** EV-083–EV-061, SRC-001 §6

## DDP-033 — Documentos críticos e controle

Quais tipos de documentos são críticos? Quem controla substituição e aprovação (gestão — nomes TBD)?

**Status:** `OPEN` · **Fonte:** EV-080, EV-081

## DDP-034 — Campos obrigatórios de equipamento/veículo

Placa, prefixo, chassi, RENAVAM, quilometragem, horímetro — quais são obrigatórios por tipo de serviço?

**Status:** `OPEN` · **Fonte:** EV-052

## DDP-035 — Composição da OS por tipo de serviço

Quais campos da OS são obrigatórios para cada tipo de serviço?

**Status:** `OPEN` · **Fonte:** EV-047, EV-048

## DDP-036 — Targets de performance por classe de operação

Quais classes de operação (consulta, transação, relatório, upload, integração) terão metas de tempo de resposta e quais valores a empresa autoriza?

**Status:** `OPEN` · **Bloqueia dimensionamento:** sim · **Fonte:** Prompt 03 / EV-074, EV-075

## DDP-037 — Política de concorrência e idempotência por operação

Para cada operação crítica (criar solicitação, converter, liberar, alocar, medição, faturamento, documento), qual política de concorrência e repetição a empresa exige — sem escolher tecnologia nesta etapa?

**Status:** `OPEN` · **Bloqueia implementação transacional:** sim · **Fonte:** Prompt 03 / EV-079, EV-028

## DDP-038 — Observabilidade mínima operacional

Quais eventos de negócio, métricas, traces e alertas são obrigatórios para operação e auditoria? Como separar AUDIT_TRAIL de TECHNICAL_LOG?

**Status:** `OPEN` · **Fonte:** Prompt 03 / EV-074, EV-078

## DDP-039 — Classificação de dados pessoais no domínio

Quais campos do sistema contêm dados pessoais, qual finalidade, minimização aplicável e validação legal necessária?

**Status:** `OPEN` · **Bloqueia política de privacidade:** sim · **Fonte:** Prompt 03 / EV-029, EV-030 · **Nota:** PENDING_LEGAL_VALIDATION

## DDP-040 — Nível de disponibilidade aceitável

Qual disponibilidade mínima em horário operacional, tolerância a manutenção planejada e requisitos para integrações críticas?

**Status:** `OPEN` · **Fonte:** Prompt 03 / EV-005 · **Targets:** TARGET_PENDING

## DDP-041 — Campos mínimos do Cliente PJ

Quais campos são obrigatórios e opcionais no cadastro de Cliente PJ no Release 1?

**Status:** `ANSWERED` (SRC-002 Q06, Prompt 29-A corretivo) — Obrigatórios: razão social, CNPJ, pelo menos um contato operacional utilizável. Opcionais quando suportados: nome fantasia, código externo/ERP, telefone, e-mail, endereços, observações estritamente necessárias. Sem campos CRM/fiscais avançados não aprovados.

**Fonte:** SRC-002 Q06 · **Bloqueia implementação de Clientes:** não

## Próximo ID

`DDP-046`.
