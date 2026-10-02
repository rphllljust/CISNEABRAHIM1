# Prompt roadmap (preliminary)

| Campo       | Valor                                                                     |
| ----------- | ------------------------------------------------------------------------- |
| Document ID | ROAD-001                                                                  |
| Source      | SRC-000                                                                   |
| Status      | PRELIMINARY — pode ser ajustado por decisões futuras                      |
| Execution   | **Nenhuma etapa além do Prompt 00 deve ser executada por este documento** |

Este roadmap **não** autoriza implementação. Ordem e conteúdo podem mudar após ingestão de fontes (Prompt 01+) e ADRs.

## Sequência preliminar

| Prompt | Título                                                       | Estado            |
| ------ | ------------------------------------------------------------ | ----------------- |
| 00     | Fundação e governança do repositório                         | ver execution log |
| 01     | Ingestão e análise atômica das fontes                        | `NOT_STARTED`     |
| 02     | Requisitos funcionais e casos de uso                         | `NOT_STARTED`     |
| 03     | Requisitos não funcionais e atributos de qualidade           | `NOT_STARTED`     |
| 04     | Glossário e linguagem ubíqua                                 | `NOT_STARTED`     |
| 05     | Domínios, subdomínios e bounded contexts                     | `NOT_STARTED`     |
| 06     | Invariantes, comandos e eventos                              | `NOT_STARTED`     |
| 07     | Máquinas de estados empresariais                             | `NOT_STARTED`     |
| 08     | Modelo de autorização e segregação de funções                | `NOT_STARTED`     |
| 09     | Arquitetura lógica e ADRs                                    | `NOT_STARTED`     |
| 10     | Escolha e validação da stack                                 | `NOT_STARTED`     |
| 11     | Modelo conceitual de dados                                   | `NOT_STARTED`     |
| 12     | Modelo lógico e constraints                                  | `NOT_STARTED`     |
| 13     | Estratégia de transações, concorrência e idempotência        | `NOT_STARTED`     |
| 14     | Segurança e threat model                                     | `NOT_STARTED`     |
| 15     | Estratégia de testes                                         | `NOT_STARTED`     |
| 16     | Bootstrap técnico do monorepo                                | `NOT_STARTED`     |
| 17     | Banco de dados — provisionamento e isolamento                | `NOT_STARTED`     |
| 18     | Estratégia de migrations                                     | `NOT_STARTED`     |
| 19     | Estratégia de seed (não produção como verdade)               | `NOT_STARTED`     |
| 20     | Autenticação (sem inventar IdP)                              | `NOT_STARTED`     |
| 21     | Autorização técnica alinhada ao Prompt 08                    | `NOT_STARTED`     |
| 22     | Escopo de acesso e isolamento de dados                       | `NOT_STARTED`     |
| 23     | Layout protegido / shell autenticado                         | `NOT_STARTED`     |
| 24     | Módulos empresariais — fatia autorizada somente              | `NOT_STARTED`     |
| 25     | Gestão documental (lógico × versão × arquivo)                | `NOT_STARTED`     |
| 26     | Integrações e contratos anti-corrupção                       | `NOT_STARTED`     |
| 27     | Observabilidade                                              | `NOT_STARTED`     |
| 28     | Backup, restore testado e continuidade                       | `NOT_STARTED`     |
| 29     | CI/CD                                                        | `NOT_STARTED`     |
| 30     | Homologação                                                  | `NOT_STARTED`     |
| 31     | Implantação                                                  | `NOT_STARTED`     |
| 32     | Operação (runbooks)                                          | `NOT_STARTED`     |
| 33     | Recuperação (incidentes e DR)                                | `NOT_STARTED`     |
| 34     | Auditoria final de rastreabilidade e conformidade do release | `NOT_STARTED`     |

Números 17–34 são **agrupamentos preliminares**. Podem ser divididos, reunidos ou reordenados. Não constituem cronograma nem compromisso de MVP.

## Regras

- Um prompt por vez.
- Revisão antes do seguinte.
- Prompt 01 **não** é iniciado por este arquivo.

## Pacote ERP-N (2026-10-02)

Sequencia adicional, **nao iniciada**. Nao substitui Prompts 00-94 nem autoriza go-live.

Registro normativo e blocos copiaveis: [`prompt-pack-erp-nativo.md`](prompt-pack-erp-nativo.md).

| Prompt | Titulo | Estado |
| ------ | ------ | ------ |
| ERP-N-00 | Inventario honesto do nucleo | `NOT_STARTED` |
| ERP-N-01 | DDP-045 CI unitario API | `NOT_STARTED` |
| ERP-N-02 | Politica de exposicao de flags | `NOT_STARTED` |
| ERP-N-03 | Ingestao de fontes do nucleo | `NOT_STARTED` |
| ERP-N-04 | Finance prova fail-closed | `NOT_STARTED` |
| ERP-N-05 | Accounting sem inventar plano | `NOT_STARTED` |
| ERP-N-06 | Fiscal gates SRC-007 | `NOT_STARTED` |
| ERP-N-07 | Inventory DDP de custeio | `NOT_STARTED` |
| ERP-N-08 | Payroll lacuna legal | `NOT_STARTED` |
| ERP-N-09 | Catalogo UAT do delta | `NOT_STARTED` |
| ERP-N-10 | Uma flag em HML (ordem nominada) | `NOT_STARTED` |

Este apendice **nao** executa ERP-N-00.
