# Traceability policy

| Campo       | Valor                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------ |
| Document ID | TRACE-POL-001                                                                                    |
| Source      | SRC-000                                                                                          |
| Matrix      | [`../01-foundation/requirements-traceability.md`](../01-foundation/requirements-traceability.md) |

## Cadeia obrigatória

```text
SOURCE
→ EVIDENCE
→ BUSINESS RULE
→ FUNCTIONAL REQUIREMENT
→ USE CASE
→ DOMAIN MODEL
→ ARCHITECTURE DECISION
→ IMPLEMENTATION
→ TEST
→ ACCEPTANCE
```

Nenhum elo posterior pode ser marcado como completo se o anterior exigido estiver `TBD` **e** o item for candidato a implementação.

## Regras

1. Toda regra `CONFIRMED` referencia pelo menos um `SOURCE-ID` existente no [`../01-foundation/source-registry.md`](../01-foundation/source-registry.md).
2. SRC-000 (este Prompt 00) é fonte de **governança**, não prova automática de regra operacional.
3. Colunas ainda não aplicáveis usam `TBD`. É proibido inventar IDs só para completar a matriz.
4. Evidência descreve trecho, página, data ou localizador estável da fonte. “Consta no documento” sem localizador é evidência fraca e deve ser marcada como tal.
5. Implementação (futura) referencia regra e requisito. Código sem rastreio não atende Definition of Done.
6. Teste (futuro) referencia o comportamento e o risco. Teste órfão não prova aceite.
7. Aceite é ato empresarial ou critério objetivo previamente acordado — não o julgamento isolado do implementador.

## Identificadores

| Artefato              | Prefixo        | Registro                          |
| --------------------- | -------------- | --------------------------------- |
| Fonte                 | SRC- / SOURCE- | source-registry.md                |
| Evidência             | EVD-           | na ingestão futura / matriz       |
| Regra                 | BR-            | business-rules-register.md        |
| Requisito funcional   | FR-            | TBD até Prompt 02                 |
| Caso de uso           | UC-            | TBD até Prompt 02                 |
| Decisão de domínio    | DDP-           | domain-decisions-pending.md       |
| Decisão de engenharia | ED-            | engineering-decisions-register.md |
| Risco                 | RISK-          | risk-register.md                  |
| Conflito              | SC-            | source-conflicts.md               |

Não reutilizar IDs. Itens inválidos recebem `REJECTED`, `DEPRECATED` ou `SUPERSEDED` e permanecem visíveis.

## Incerteza

Lacunas usam `UNKNOWN`, `NOT_PROVIDED`, `PENDING_VALIDATION` ou `TBD` conforme o registro. Não preencher com suposição.

## Bloqueio

Ausência de fonte para regra crítica ⇒ `NOT_READY_FOR_IMPLEMENTATION`.

## Evidência de release sem operação empresarial

Runtime, release e negócio são dimensões independentes. Ausência de operação empresarial
observável após leitura autoritativa deve ser registrada como
`BUSINESS_EVIDENCE_NOT_AVAILABLE`, com `businessEvidenceAvailable=false` e
`businessVerified=false`. Isso pode produzir `productionValidated=CONDITIONAL` quando
runtime e release forem verdadeiros; não equivale a PASS empresarial, sign-off ou GO de
produção. Operação existente sem cadeia completa é `BUSINESS_EVIDENCE_INCOMPLETE` ou
`BUSINESS_VALIDATION_FAILED` e reprova a validação empresarial. Somente evidência completa
e vinculada pode produzir `BUSINESS_VALIDATED`.
