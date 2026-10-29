# Quality gates

| Campo       | Valor   |
| ----------- | ------- |
| Document ID | QG-001  |
| Source      | SRC-000 |

Gates são evidência, não opinião. Um gate não marcado não pode ser assumido como passado.

## Prompt 00

O Prompt 00 somente recebe `PASS` se:

- [ ] o workspace foi inspecionado;
- [ ] o Git foi inicializado ou preservado;
- [ ] a estrutura documental obrigatória existe;
- [ ] nenhum arquivo obrigatório está vazio;
- [ ] nenhuma implementação empresarial foi criada;
- [ ] nenhuma tecnologia definitiva foi escolhida;
- [ ] nenhuma regra não comprovada virou `CONFIRMED`;
- [ ] as fontes ausentes estão explicitamente registradas;
- [ ] as decisões pendentes continuam abertas;
- [ ] os riscos iniciais estão registrados;
- [ ] existe política de rastreabilidade;
- [ ] existe Definition of Ready;
- [ ] existe Definition of Done;
- [ ] existe protocolo de execução;
- [ ] existe roadmap;
- [ ] existe registro do Prompt 00;
- [ ] o Prompt 01 não foi executado;
- [ ] o estado final do Git foi verificado.

Resultado desta execução: ver [`prompt-execution-log.md`](prompt-execution-log.md).

## Validação de produção: runtime, release e negócio

O browser gate publica dimensões independentes. `runtimeVerified` prova a interface e a
API autenticada; `releaseVerified` prova os pré-requisitos de release e as assertivas
técnicas; `businessVerified` exige a cadeia empresarial real. Nenhuma dimensão substitui
ou aprova outra.

| Evidência empresarial                                 | `businessVerified` | `productionBusinessValidated` | `productionValidated`                            |
| ----------------------------------------------------- | ------------------ | ----------------------------- | ------------------------------------------------ |
| Fonte autoritativa lida, nenhuma operação na unidade  | `false`            | `NOT_APPLICABLE`              | `CONDITIONAL` se runtime e release forem válidos |
| Operação iniciada, cadeia incompleta ou inválida      | `false`            | `false`                       | `false`                                          |
| Cadeia empresarial completa, incluindo Economic Trace | `true`             | `true`                        | `true` se runtime e release também forem válidos |
| Fontes não lidas ou resposta ambígua                  | `false`            | `UNKNOWN`                     | `false`                                          |

`N/A`, ausência de registros, resposta HTTP 200 e tela renderizada nunca são aprovação
empresarial. Uma validação `CONDITIONAL` não altera o readiness oficial de go-live nem
revoga o `NO-GO` do [`production-readiness-gate.md`](../19-operations/production-readiness-gate.md).

## Gates genéricos (prompts futuros)

Além dos gates específicos do prompt:

1. Inspeção registrada.
2. Escopo não ultrapassado.
3. Identificadores consistentes.
4. Sem regra `CONFIRMED` sem fonte.
5. Matriz sem invenção (`TBD` permitido).
6. `AGENTS.md` e registros históricos não apagados.
7. Relatório final no formato exigido.
8. Parada sem executar o próximo prompt.

## Falha

Se requisito obrigatório da etapa falhar:

```text
PROMPT NN RESULT: FAIL
```

Corrigir somente problemas da etapa atual e revalidar. Não “compensar” com trabalho do prompt seguinte.
