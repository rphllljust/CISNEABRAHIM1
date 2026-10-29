# Engineering decisions register

| Campo       | Valor      |
| ----------- | ---------- |
| Document ID | ED-REG-001 |
| Source      | SRC-000    |

Decisões de governança ED-001..004 estão `ACCEPTED`. ED-005 (Release 1 fail-closed) `ACCEPTED` em 2026-09-02. ED-006 (SOD crítica por role/capability/scope/matriz) `ACCEPTED` em 2026-09-03. Stack tecnológica documentada em ADR-TECH (Prompt 10).

Template: [`../templates/engineering-decision-template.md`](../templates/engineering-decision-template.md).

Status: `PROPOSED`, `ACCEPTED`, `DEPRECATED`, `SUPERSEDED`, `REJECTED`.

## ED-001 — Documentação antes do código

| Campo        | Valor                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------- |
| ID           | ED-001                                                                                            |
| Status       | `ACCEPTED`                                                                                        |
| Decision     | A baseline documental e a proveniência antecedem código funcional, schema e escolha de framework. |
| Why          | Projeto transacional crítico; SRC-000 proíbe implementação nesta fase.                            |
| Consequences | Repositório inicia sem `package.json`, apps ou banco.                                             |
| Date         | 2026-08-28                                                                                        |

## ED-002 — Um prompt por vez

| Campo    | Valor                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| ID       | ED-002                                                                                                     |
| Status   | `ACCEPTED`                                                                                                 |
| Decision | Executar somente o prompt atual; não encadear o seguinte automaticamente; exigir revisão antes de avançar. |
| Why      | Controlar escopo, evidência e rollback intelectual.                                                        |
| Date     | 2026-08-28                                                                                                 |

## ED-003 — Rastreabilidade obrigatória

| Campo    | Valor                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| ID       | ED-003                                                                                                                                         |
| Status   | `ACCEPTED`                                                                                                                                     |
| Decision | Artefatos de requisito, regra, decisão, implementação futura e teste seguem a cadeia SOURCE → … → ACCEPTANCE. Lacunas = `TBD`, nunca invenção. |
| Policy   | [`../00-governance/traceability-policy.md`](../00-governance/traceability-policy.md)                                                           |
| Date     | 2026-08-28                                                                                                                                     |

## ED-004 — Stack documentada; implementação não iniciada

| Campo                   | Valor                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID                      | ED-004                                                                                                                                                                                                                  |
| Status                  | `ACCEPTED` (atualizado Prompt 10)                                                                                                                                                                                       |
| Decision                | Stack tecnológica **documentada** em ADR-TECH-001..007 (`docs/11-technology/`). Código, `package.json`, dependências instaladas e infra provisionada permanecem **NOT STARTED** até prompt de implementação autorizado. |
| Why                     | Prompt 10 seleciona e justifica; não instala. Cloud provider continua não escolhido.                                                                                                                                    |
| Supersedes parcialmente | Texto original ED-004 que remetia stack ao Prompt 10 sem decisão                                                                                                                                                        |
| Date                    | 2026-08-28 (atualização)                                                                                                                                                                                                |

## ADRs tecnológicos (Prompt 10)

Ver [`../11-technology/adr/`](../11-technology/adr/) — ADR-TECH-001..007, todos `ACCEPTED`.

## ED-005 — Feature flags fail-closed para módulos fora da Release 1

| Campo                 | Valor                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID                    | ED-005                                                                                                                                                         |
| Title                 | Feature flags fail-closed para superfície fora da Release 1                                                                                                    |
| Status                | `ACCEPTED`                                                                                                                                                     |
| Decision              | Módulos `OUT_OF_RELEASE_1` só são expostos se a flag de ambiente for exatamente `true`. Ausência, vazio ou qualquer outro valor = desligado. A API é o boundary; navegação e rotas web não autorizam acesso. |
| Why                   | Impedir uso operacional de financeiro, fiscal oficial, contábil e demais módulos incompletos sem expandir o escopo da Release 1.                               |
| Consequences          | 403 `FEATURE_DISABLED` nas rotas HTTP do módulo; item de navegação e deep-link removidos/bloqueados; `.env.example` não liga flags.                            |
| Alternatives rejected | Fail-open; esconder só no frontend; apagar código dos módulos incompletos.                                                                                     |
| SOURCE / prompt       | Prompt autorizado 2026-09-02; R1-SCOPE-001; DDP-026; DDP-023                                                                                                   |
| Date                  | 2026-09-02                                                                                                                                                     |
| Revisit when          | Autorização explícita de um módulo posterior com fonte e flag nomeada.                                                                                         |

## ED-006 — Segregation of Duties crítica no backend (role + capability + scope + matriz)

| Campo                 | Valor |
| --------------------- | ----- |
| ID                    | ED-006 |
| Title                 | SOD crítica no backend via role, capability, scope e matriz de aprovação |
| Status                | `ACCEPTED` |
| Decision              | Operações críticas de fornecedor, compra, despesa, pagamento, tesouraria (transferência/estorno), baixa, conciliação, ajuste contábil, reabertura de período, fiscal e folha exigem atores distintos (criar/aprovar, solicitar/pagar, preparar/confirmar, lançar/aprovar ajuste). A autoridade é o backend. A política usa código de papel, capability, escopo e matriz publicada — nunca nomes de pessoas. |
| Why                   | Pedido autorizado de endurecimento SOD; SEC-REQ de autorização no backend; Prompt 08 SOD-001..012 permanece CANDIDATE/PENDING e não vira CONFIRMED. SRC-008 / BR-046 / BR-050: as duas autoridades operacionais equivalentes podem criar/liberar a própria OS e aprovar a própria medição — esses pares ficam fora do catálogo SOD. |
| Consequences          | `SodEnforcementService` fail-closed; autoaprovação e checker de outro unit scope são 403; posting/close/finalize idempotentes não substituem o checker no ato efetivo. Ajuste fiscal não auto-finaliza no mesmo comando. |
| Alternatives rejected | Hardcode de usuários; SOD só no frontend; aplicar SOD aos pares SRC-008 de OS/medição. |
| SOURCE / prompt       | Pedido autorizado 2026-09-03 (SOD HARDENING); Prompt 08 AUTHZ-SOD-001 CANDIDATE; SRC-008 BR-046/BR-050 CONFIRMED (exceção operacional). |
| Date                  | 2026-09-03 |
| Revisit when          | Fonte empresarial confirmar SOD operacional OS/medição, ou alçadas distintas por papel além de FINANCIAL_CONTROLLER. |

## Não decidido (exemplos explícitos)

Cloud provider, IdP, object storage, message broker, CI platform: **não decidido** — ver TECH-DDP em [`../11-technology/technology-decisions-pending.md`](../11-technology/technology-decisions-pending.md).

## ED-007 — Estados independentes para validação de runtime, release e negócio

| Campo | Valor |
| --- | --- |
| ID | ED-007 |
| Title | Contrato fail-closed de validação técnica e evidência empresarial em produção |
| Status | `ACCEPTED` |
| Decision | Runtime e release são avaliados independentemente da disponibilidade de operação empresarial. Sem evidência empresarial após leitura autoritativa, `businessEvidenceAvailable=false`, `businessVerified=false`, `productionBusinessValidated=NOT_APPLICABLE` e `productionValidated=CONDITIONAL`, desde que runtime e release estejam verificados. Evidência existente incompleta ou inválida reprova o gate. Evidência completa somente aprova com cliente, contrato, OS concluída, execução/evidência, medição aprovada e comercialmente válida, aceite, billing elegível/documentado e Economic Trace completo. |
| Why | Ordem explícita do responsável em 2026-10-29 para eliminar ambiguidade entre os gates técnico, de release e empresarial sem fabricar fatos nem alterar regras de negócio. |
| Consequences | Browser gate e workflow publicam os estados separados. `CONDITIONAL` não altera o NO-GO oficial de go-live. O workbench atual não prova Economic Trace completo; ausência desse vínculo mantém negócio não validado. |
| Alternatives rejected | Tratar `N/A` ou ausência como PASS; tratar ausência de negócio como falha de infraestrutura; promover readiness oficial a GO. |
| SOURCE / prompt | Ordem executiva do responsável recebida em 2026-10-29; sem promoção de regra empresarial. |
| Date | 2026-10-29 |
| Revisit when | Workbench autoritativo publicar vínculos verificáveis de billing/documento e Economic Trace, ou o contrato de validação mudar por decisão autorizada. |
