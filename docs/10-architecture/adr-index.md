# ADR-INDEX-001

| Campo       | Valor                                                           |
| ----------- | --------------------------------------------------------------- |
| Document ID | Índice de Architecture Decision Records                         |
| Total       | 7 (ADR-001..007)                                                |
| Prompt      | 09 (ADR-001..006) · B1.5 (ADR-007)                              |
| Política    | Novos ADRs numeram sequencialmente; superseded mantém histórico |

| ADR                                              | Título                                          | Status   | Data       |
| ------------------------------------------------ | ----------------------------------------------- | -------- | ---------- |
| [ADR-001](./adr/ADR-001-architecture-style.md)   | Estilo arquitetural inicial: modular monolith   | PROPOSED | 2026-08-28 |
| [ADR-002](./adr/ADR-002-domain-boundaries.md)    | Organização por bounded contexts candidatos     | ACCEPTED | 2026-08-28 |
| [ADR-003](./adr/ADR-003-data-ownership.md)       | Single write owner por agregado lógico          | ACCEPTED | 2026-08-28 |
| [ADR-004](./adr/ADR-004-consistency-approach.md) | Consistência forte local + eventual na borda    | PROPOSED | 2026-08-28 |
| [ADR-005](./adr/ADR-005-integration-approach.md) | Integração via ACL (BC-CAND-018)                | PROPOSED | 2026-08-28 |
| [ADR-006](./adr/ADR-006-deployment-baseline.md)  | Baseline: app única/API + FE separado candidato | PROPOSED | 2026-08-28 |
| [ADR-007](./adr/ADR-007-auditoria-no-repository.md) | Auditoria transacional vive no repositório   | ACCEPTED | 2026-10-01 |

## Status aceitos neste prompt

| Status              | Count                                               |
| ------------------- | --------------------------------------------------- |
| ACCEPTED            | 3                                                   |
| PROPOSED            | 4                                                   |
| REJECTED            | 0 (microservices como estilo inicial — ver ADR-001) |
| PENDING_INFORMATION | 0 (uso implícito em ARCH-DDP)                       |

## Relação ED/ADR

ED-001..004 permanecem ACCEPTED (governança). ADR-001..006 são decisões arquiteturais de domínio/sistema. ADR-007 é decisão de arquitetura de implementação (canal AUDIT_TRAIL), originada em B1.5.

## Próximos ADRs esperados (não criados)

ADR-008+ cobertura de auditoria para writes internos — **bloqueado por DDP-027** até decisão empresarial.
