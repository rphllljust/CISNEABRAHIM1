# Pacote ERP-N - CISNE como ERP nativo (sem ERP externo)

| Campo | Valor |
| ----- | ----- |
| Document ID | PACK-ERP-N-001 |
| Status | NOT_STARTED - nenhum prompt deste pacote foi executado por este arquivo |
| Origem | Pedido do responsavel (2026-10-02): um prompt executavel e a sequencia |
| Fontes de recorte | SRC-004 / BR-042; R1-SCOPE-001 / ED-005; SRC-009 opcao 2-A; DDP-023 residual; SRC-006/SRC-007 |
| Classificacao | Pacote de engenharia. Nao e aceite empresarial, nao liga FEATURE_MODULE_*, nao autoriza go-live nem Prompt 93/94 |

Como usar: copiar o bloco PROMPT PARA O AGENTE do prompt atual no chat. Um prompt por vez. Parar. So o responsavel autoriza o seguinte.

Este pacote nao conecta ERP externo (SRC-004: REJECTED). O alvo e o CISNE ser o sistema empresarial centralizado, com nucleo nativo aceito.

---

## Sequencia (obrigatoria)

| ID | Titulo | Codigo funcional | Pre-condicao |
| -- | ------ | ---------------- | ------------ |
| ERP-N-00 | Inventario honesto do nucleo | NAO | Ordem explicita |
| ERP-N-01 | DDP-045 - CI unitario da API verde | SIM (so os 4 casos) | ERP-N-00 PASS ou PASS_WITH_RESTRICTIONS |
| ERP-N-02 | Politica de exposicao HML vs producao | NAO | ERP-N-00 |
| ERP-N-03 | Ingestao de fontes do nucleo | NAO | ERP-N-00 |
| ERP-N-04 | Finance - prova fail-closed + paridade em teste | SIM se DoR do recorte | ERP-N-00; N-03 se tocar regra de pagamento |
| ERP-N-05 | Accounting - plano e custeio sem inventar | NAO ate fonte | ERP-N-03 |
| ERP-N-06 | Fiscal - gates SRC-007; sem emissao | SIM so teste/gate existente | SRC-006/007 |
| ERP-N-07 | Inventory - decisao de custeio, sem FIFO inventado | NAO | ERP-N-03 |
| ERP-N-08 | Payroll - lacuna legal, sem eSocial inventado | NAO | ERP-N-03 |
| ERP-N-09 | Catalogo UAT do delta (cenarios, nao sessao humana) | NAO (docs/JSON) | ERP-N-00..N-02 |
| ERP-N-10 | Ativacao de flag em HML por modulo | SIM env HML, nunca producao | N-00..N-09 aplicaveis PASS; ordem escrita por modulo |

Prompts 93 e 94 (go-live / hypercare) nao entram neste pacote. Producao permanece NO-GO ate o gate oficial.

---

## Regras comuns (todos os ERP-N-*)

O agente deve:

1. Ler AGENTS.md, README.md, docs/README.md, prompt-execution-log.md, execution-protocol.md, traceability-policy.md, este arquivo, release-1-closed-scope.md, SRC-004, SRC-009.
2. Inspecionar Git; nao apagar historico; nao commitar sem ordem.
3. Executar somente o ID pedido. NEXT_PROMPT_EXECUTED: NO.
4. Classificar fato / requisito / desejo / hipotese / interpretacao / DDP / conflito.
5. Nao marcar BR como CONFIRMED sem fonte no source-registry.md.
6. Nao ligar FEATURE_MODULE_* em producao. Em teste, ligar so no harness e restaurar.
7. Nao inventar aliquota, CFOP, NCM, ISS, ICMS, FIFO, LIFO, media, INSS, FGTS, IRRF, eSocial, credenciamento SEFAZ, protocolo, certificado.
8. Frontend nao e boundary. Regras criticas no backend.
9. Quality gates do prompt; append no prompt-execution-log.md; relatorio; parar.
10. Trabalho temporario em C:\CISNEABRAHIM\tmp\ — nunca no perfil do Windows.

Bloqueio: NOT_READY_FOR_IMPLEMENTATION, conflito de fonte nao resolvido, DDP bloqueante aberto para o recorte, quality gate FAIL implica BLOCKED ou FAIL, nao PASS.


---

## ERP-N-00 - Inventario honesto do nucleo

### Objetivo

Registrar, com evidencia de disco, o que ja e operacao R1, o que e codigo gated, o que e estrutura sem regra legal, e o que falta para o CISNE ser ERP nativo. Sem implementar produto.

### Fora de escopo

Qualquer feature, migration, flag true em env de app, correcao DDP-045, Prompt 93, UI nova, engine V2.

### Entregaveis

1. docs/01-foundation/erp-native-gap-register.md (novo) - uma linha por modulo gated + R1, com: flag, caminhos API/web, testes, UAT, DDP/BR, classificacao (IN_R1 / CODED_GATED / STRUCTURE_UNDECIDED / NOT_IN_SCOPE).
2. Atualizar docs/01-foundation/requirements-traceability.md com secao interpretacao de engenharia (sem BR nova CONFIRMED).
3. Append no prompt-execution-log.md.

### Quality gates

- Nenhum FEATURE_MODULE_* alterado em env de producao ou HML compartilhado
- FUNCTIONAL_CODE_CREATED: NO
- Celula de codigo cita path real; se nao achar, NOT_FOUND
- DDP-023, DDP-012, FIFO, folha legal permanecem OPEN/UNDECIDED se ja estavam
- SRC-009 2-A citado: nucleo complementar nao e operacao oficial
- Prompt seguinte nao executado

### Relatorio final exigido

Tabela: modulo | estado | evidencia | o que bloqueia ser ERP | proximo ERP-N que trata.

### PROMPT PARA O AGENTE - ERP-N-00

    EXECUTE SOMENTE ERP-N-00. NAO execute ERP-N-01 nem nenhum outro prompt.

    Voce e agente neste repositorio (C:/CISNEABRAHIM). Siga AGENTS.md e
    docs/00-governance/prompt-pack-erp-nativo.md.

    TAREFA: inventario honesto do nucleo empresarial nativo (CISNE como SoT,
    sem ERP externo - SRC-004 / BR-042).

    FAZER:
    1. Inspecao Git e leitura obrigatoria (AGENTS.md, README, docs/README,
       execution log, protocol, R1-SCOPE-001, SRC-004, SRC-009, DDP-023).
    2. Criar docs/01-foundation/erp-native-gap-register.md com uma linha por
       modulo R1 e por GATED_MODULE_IDS em
       apps/api/src/platform/release-scope/release-1-scope.ts.
       Colunas: modulo, flag, IN_R1?, codigo (paths), testes, UAT,
       DDP/BR, classificacao, o que falta para operacao oficial.
    3. Nao inventar arquivo que nao existir: escrever NOT_FOUND.
    4. Atualizar rastreabilidade (secao interpretacao de engenharia).
    5. Append prompt-execution-log.md (template). NEXT_PROMPT_EXECUTED: NO.
    6. Relatorio no formato do pack. PARAR.

    PROIBIDO:
    - codigo de produto, migration, ligar FEATURE_MODULE_*, inventar aliquota/
      FIFO/folha, fechar DDP, marcar BR CONFIRMED, Prompt 93/94, commit se
      eu nao pedir, encadear ERP-N-01.

    QUALITY_GATE: FUNCTIONAL_CODE_CREATED deve ser NO.
    PASTA TEMP: somente C:/CISNEABRAHIM/tmp/

---

## ERP-N-01 - DDP-045 (CI unitario da API)

### Objetivo

Corrigir somente as 4 falhas ja descritas em DDP-045, para a suite unitaria da API ficar verde. Nao e feature de ERP; e pre-condicao de honestidade do CI.

### Recorte ja registrado (nao reabrir causa)

1. ensure-migrations-journal-coverage.spec.ts - journal 0082 sem bloco em ensure-migrations.ts
2. operational-eligibility.spec.ts - teste data-sensivel (asOf omitido)
3. finance.source.spec.ts - mock de list() ainda array; codigo devolve envelope items (2 falhas)

### Fora de escopo

Domain rules novas; ligar flags. Se 0083 falhar no mesmo spec, registrar restricao; so corrigir se for o mesmo gate de cobertura.

### Quality gates

- Os 4 casos do DDP-045 passam
- Nenhuma BR CONFIRMED nova
- DDP-045: atualizar status so com evidencia de testes
- NEXT_PROMPT_EXECUTED: NO

### PROMPT PARA O AGENTE - ERP-N-01

    EXECUTE SOMENTE ERP-N-01. Pre-condicao: ERP-N-00 PASS ou PASS_WITH_RESTRICTIONS.

    Corrigir as 4 falhas do DDP-045 (docs/01-foundation/domain-decisions-pending.md).
    Nao ligar FEATURE_MODULE_*. Nao inventar regra fiscal/custeio/folha.
    Nao alterar domain da OS alem do que o spec 2 exigir (asOf no teste, nao
    mudar a regra BLOCKED).

    Provar com a suite unitaria afetada. Atualizar DDP-045 e execution log.
    PARAR. Nao iniciar ERP-N-02.

---

## ERP-N-02 - Politica de exposicao (docs)

### Objetivo

Documento: o que pode ser true em teste, HML e producao, por flag. Nenhuma alteracao de env real.
Entregavel: docs/19-operations/feature-flag-exposure-policy.md alinhado a R1-SCOPE-001, SRC-009 2-A, fail-closed da API.

### PROMPT PARA O AGENTE - ERP-N-02

    EXECUTE SOMENTE ERP-N-02.
    Escrever docs/19-operations/feature-flag-exposure-policy.md:
    por cada FEATURE_MODULE_*, valores permitidos em unit/e2e, HML e producao.
    Producao: default fail-closed. Ligar flag nao e CONFIRMED e nao e go-live.
    Nao alterar .env reais. FUNCTIONAL_CODE_CREATED: NO. PARAR.

---

## ERP-N-03 - Ingestao de fontes do nucleo

### Objetivo

Listar fontes necessarias e registrar as que existirem em docs/inputs/ + source-registry.md. O que nao existir: NOT_PROVIDED, DDP permanece aberto.

Pacote minimo (nao inventar conteudo): tributacao (DDP-023); pagamento/conciliacao (DDP-012); plano de contas/custeio; folha/eSocial.
Se zero fontes novas: PASS_WITH_RESTRICTIONS ou BLOCKED para prompts de implementacao legal (N-05..N-08 codigo de regra).

### PROMPT PARA O AGENTE - ERP-N-03

    EXECUTE SOMENTE ERP-N-03.
    Inspecionar docs/inputs/ e source-registry.md. NAO inventar SRC.
    Para fiscal, custeio, folha, plano de contas, banco: ou registrar fonte
    real nova (template + SOURCE-ID novo) ou NOT_PROVIDED explicito.
    Nao CONFIRMED sem evidencia. Sem codigo de produto. PARAR.

---

## ERP-N-04 - Finance (prova, flag so em teste)

### Objetivo

Provar AR/AP/tesouraria ja existentes: API recusa sem flag; com flag no harness, paridade critica UI/API sem recalcular dinheiro no browser. Nao ativar em HML/producao.
Se o recorte exigir regra de conciliacao ainda OPEN, nao implementar a regra - so mapear gap.

### PROMPT PARA O AGENTE - ERP-N-04

    EXECUTE SOMENTE ERP-N-04.
    Provar FEATURE_MODULE_FINANCE fail-closed (403 FEATURE_DISABLED) e, so no
    harness de teste, um caminho Billing->Receivable / Payable->Treasury que ja
    exista. Nao inventar DDP-012. Nao parser OFX/CNAB novo. Nao env de HML.
    Testes + log. PARAR.

---

## ERP-N-05 - Accounting (sem inventar plano)

### Objetivo

Registro: o que o ledger ja faz (partida dobrada, POSTED imutavel) vs o que falta (plano oficial, fechamento usado pela empresa). Codigo de regra de custeio proibido sem fonte.
Se N-03 NOT_PROVIDED para plano/custeio: este prompt e so docs.

### PROMPT PARA O AGENTE - ERP-N-05

    EXECUTE SOMENTE ERP-N-05.
    Documentar lacuna ACCOUNTING vs ERP. Nao inventar plano de contas nem
    FIFO. Se nao houver fonte em N-03, FUNCTIONAL_CODE_CREATED: NO e
    STATUS pode ser PASS_WITH_RESTRICTIONS (inventario) - nunca PASS fingindo
    contabilidade oficial. PARAR.

---

## ERP-N-06 - Fiscal (gates; sem emissao)

### Objetivo

Reafirmar BR-043..045 no codigo ja existente: transmissao BLOCKED sem credenciamento; AUTHORIZED/DANFE sem protocolo. Nao ligar FEATURE_MODULE_FISCAL. Nao cadastrar aliquota.

### PROMPT PARA O AGENTE - ERP-N-06

    EXECUTE SOMENTE ERP-N-06.
    Auditoria dos gates SRC-006/SRC-007 no codigo fiscal. Testes que ja
    provam BLOCKED. Proibido: aliquota, certificado, gateway SEFAZ real,
    FEATURE_MODULE_FISCAL=true fora de teste, DANFE oficial. PARAR.

---

## ERP-N-07 - Inventory (decisao, nao algoritmo)

### Objetivo

Abrir ou atualizar DDP de metodo de custeio (FIFO/media/outro) como PENDING_BUSINESS_DECISION. Nao implementar camada.

### PROMPT PARA O AGENTE - ERP-N-07

    EXECUTE SOMENTE ERP-N-07.
    DDP de custeio de estoque: opcoes, impacto, status OPEN.
    Nao implementar FIFO/media. Sem FEATURE_MODULE_INVENTORY em HML. PARAR.

---

## ERP-N-08 - Payroll (lacuna legal)

### Objetivo

Registrar o que o modulo folha nao e (eSocial, ponto, formulas oficiais). Sem inventar INSS/FGTS/IRRF.

### PROMPT PARA O AGENTE - ERP-N-08

    EXECUTE SOMENTE ERP-N-08.
    Inventario PAYROLL vs folha legal. Formulas UNDECIDED permanecem.
    FUNCTIONAL_CODE_CREATED: NO salvo correcao de teste orfao ja quebrado
    e documentado. PARAR.

---

## ERP-N-09 - Catalogo UAT do delta

### Objetivo

Estender docs/16-testing/uat-ux-scenarios.json (ou anexo) com cenarios do nucleo complementar. Nao executar sessao humana. Nao gravar manualUatUx.status = PASSED.

### PROMPT PARA O AGENTE - ERP-N-09

    EXECUTE SOMENTE ERP-N-09.
    Criar/estender catalogo de UAT do delta (finance, fiscal de tela,
    accounting, inventory, payroll, procurement) como NOT_STARTED.
    Nao alterar readiness-evidence.json para PASSED. Nao Prompt 93. PARAR.

---

## ERP-N-10 - Flag em HML (um modulo por execucao)

### Objetivo

So com ordem explicita nomeando a flag. Exemplo: FEATURE_MODULE_FINANCE=true somente no env HML documentado. Producao intocada. Sign-off SRC-009 nao cobre isso.
Pre-condicao extra: N-02 publicado; UAT humano do delta ou restricao explicita HML_WITHOUT_DELTA_UAT no log (nao esconder).

### PROMPT PARA O AGENTE - ERP-N-10

    NAO execute ERP-N-10 sem eu nomear a flag e o ambiente.
    Quando autorizado: um unico FEATURE_MODULE_* em HML, evidencia no
    readiness/ops, API e web com o MESMO conjunto de flags (R1 paridade).
    Producao: nao tocar. Go-live: nao. PARAR apos UMA flag.

---

## Ordem de fala para o responsavel

1. execute ERP-N-00 (bloco deste arquivo)
2. Revisar o gap register
3. execute ERP-N-01 (CI)
4. execute ERP-N-02 (politica)
5. execute ERP-N-03 (fontes - se nao houver documentos, os legais param aqui)
6. N-04..N-08 conforme o registro, um a um
7. N-09 catalogo UAT
8. N-10 so com flag nomeada
9. Go-live continua no gate de producao (piloto RC2 + Prompt 93), fora deste pacote

---

## Historico deste arquivo

| Data | Evento |
| ---- | ------ |
| 2026-10-02 | Criacao. Todos os IDs NOT_STARTED. Nenhuma execucao. |
