# OPS-READINESS-001 — Production readiness gate

| Campo       | Valor                    |
| ----------- | ------------------------ |
| Document ID | OPS-READINESS-001        |
| Prompt      | 92                       |
| Status      | **EVALUATED**            |
| Decisão     | **NO-GO**                |

**Estado atual (31 ago 2026):** a decisão permanece **NO-GO**. O gate ao vivo (`pnpm readiness:gate`) reporta engenharia READY e um único `productionBlocker`: `PILOT_OBSERVATION_WINDOW_NOT_COMPLETED`. UAT humano e sign-off empresarial estão PASSED/APPROVED em `readiness-evidence.json`. A matriz Prompt 92 abaixo é o registro histórico da avaliação inicial e **não foi reescrita**.

**Estado atual (3 set 2026):** a decisão permanece **NO-GO**. `PILOT_STATUS = OBSERVATION`. Datas `startedAt` / `observationEndsAt` inalteradas (saída prevista `2026-09-13T22:28:40.517Z`). Snapshot operacional anexado em `readiness-evidence.json` e detalhado em [`pilot-exit-readiness-snapshot-2026-09-03.md`](pilot-exit-readiness-snapshot-2026-09-03.md). Nenhum waiver de janela. Prompt 93 não executado.

## Objetivo

Último gate antes do go-live. **Não implementa feature** — consolida evidência de prompts anteriores e bloqueia liberação se qualquer blocker real estiver aberto.

**Fonte autorizada:** `docs/19-operations/readiness-evidence.json` (registro versionado único).

**Cadeia:** fonte autorizada → evidência registrada → validação técnica → readiness gate → env derivada (nunca o inverso).

**Classificação:** decisão de engenharia honesta; não alterada para cumprir cronograma.

---

## Decisão

```text
ENGINEERING READINESS: READY | NOT_READY
PRODUCTION READINESS: GO | NO-GO
```

**Regra:** `PRODUCTION NO-GO` bloqueia somente operações de produção/go-live. Desenvolvimento, testes e HML continuam quando `ENGINEERING READINESS = READY`.

```bash
pnpm readiness:engineering   # exit 0 quando engenharia READY
pnpm readiness:gate          # exit 1 quando produção NO-GO (checklist go-live)
```

### Blockers reais (produção)

| ID | Tipo | Evidência |
| -- | ---- | --------- |
| `BUSINESS_SIGN_OFF_MISSING` | Aceite empresarial | `readiness-evidence.json` → `businessSignOff.decision=PENDING` |
| `RPO_RTO_NOT_DEFINED (DDP-016)` | Continuidade | `readiness-evidence.json` → `rpoRto.decision=PENDING_APPROVAL` |
| `PILOT_NOT_STARTED` / `PILOT_OBSERVATION_WINDOW_NOT_COMPLETED` | Piloto | `readiness-evidence.json` → `pilot` |
| `MANUAL_UAT_NOT_COMPLETED` | UX/A11y manual | `readiness-evidence.json` → `manualUatUx.status=NOT_STARTED` |
| `READINESS_EVIDENCE_MISMATCH` | Integridade | env var aprova sem registro autorizado |
| `READINESS_RELEASE_EVIDENCE_MISMATCH` | Release binding | UAT/sign-off de RC diferente do candidato atual |

---

## Matriz de verificação

| Verificação | Status | Evidência |
| ----------- | ------ | --------- |
| CI PASS | **PASS** | `.github/workflows/ci.yml` |
| CD PASS | **PASS** | Prompt 87 — `cd-pipeline.spec.ts` |
| UAT APPROVED | **FAIL** | Engenharia APPROVED; patrocinador PENDING |
| Pilot APPROVED | **FAIL** | Fase ACTIVE ≠ EXIT_READY |
| Security PASS | **PASS** | Prompt 81 |
| Load tests PASS | **PASS** | Prompt 82 |
| Backup PASS | **PASS** | Prompt 84 |
| Restore PASS | **PASS** | Prompt 85 |
| DR PASS | **PASS** | Prompt 85 |
| Observability PASS | **PASS** | Prompt 79 |
| Alerts PASS | **PASS** | Prompt 80 |
| Rollback PASS | **PASS** | Prompt 91 |
| TLS PASS | **PASS** | Prompt 88 |
| Secrets PASS | **PASS** | Prompt 88/81 |
| Migrations PASS | **PASS** | Prompt 87 + `gate:database` |
| E2E PASS | **PASS** | CI + UAT 89 + vertical gate |
| Mobile PASS | **CONDITIONAL** | Shell responsivo web; app nativo DDP-025 OPEN |
| Accessibility acceptable | **CONDITIONAL** | Auto PASS; manual PENDING |
| No critical vulnerability | **PASS** | `pnpm audit:deps` high+ em CI |
| No blocker defect | **PASS** | Zero BLOCKER/CRITICAL aberto em UAT auto |

### Database

| Item | Status | Detalhe |
| ---- | ------ | ------- |
| Migration plan validado | **PASS** | expand/contract; breaking bloqueado |
| Backup pré-release | **PASS** | política CD + backup monitorado (84) |

### Storage

| Item | Status | Detalhe |
| ---- | ------ | ------- |
| Private | **PASS** | `prod-object-storage.ts` |
| Backup/recovery | **PASS** | Prompts 84/85 |

### External integrations

| Regra | Status |
| ----- | ------ |
| Somente adapters ACL confirmados ativos (não operação ao vivo) | **PASS** — ERP/tracking `ACL_UNCONFIGURED`; alertas suprimidos até `*_INTEGRATION_CONFIGURED` |
| Integração bloqueada não impede core | **PASS** — Prompt 69/70-A + `UnconfiguredErpProvider` |

---

## Suporte (definido)

| Papel | Definição |
| ----- | --------- |
| **Responsável técnico** | Principal SRE / Release Engineer — atribuição nominal via `PROD_TECHNICAL_OWNER` antes do GO |
| **Canal de incidente** | Alertas CRITICAL (`/api/v1/observability/alerts`) + canal humano `PROD_INCIDENT_CHANNEL` (definir antes do GO) |
| **Rollback authority** | Release Engineer + on-call SRE — aprovação dupla para produção (`release-rollback-strategy.md`) |
| **Escalation** | CRITICAL → on-call SRE → Release Engineer → patrocinador empresarial |

---

## Comandos

```bash
pnpm --filter @cisne/api test:readiness
pnpm readiness:gate
```

Para simular GO (somente após resolução real dos blockers):

```env
READINESS_BUSINESS_SIGN_OFF=APPROVED
READINESS_RPO_RTO_APPROVED=true
UAT_MANUAL_UX_COMPLETED=true
PILOT_PROGRAM_ENABLED=true
PILOT_STARTED_AT=<data início piloto>
PILOT_MIN_OBSERVATION_DAYS=14
```

**Atenção:** definir env vars sem resolver blockers reais viola governança.

---

## Próximo passo

| Condição | Prompt |
| -------- | ------ |
| `NO-GO` (atual) | Resolver blockers; **não** executar Prompt 93 |
| `GO` | Prompt 93 autorizado |

**Separação de validação técnica (29 out 2026):** o browser gate de release também reporta `runtimeVerified`, `releaseVerified` e evidência empresarial. `productionValidated=CONDITIONAL` significa somente runtime e release validados sem operação empresarial disponível para prova. Não modifica este gate, não satisfaz os blockers de piloto/sign-off/continuidade e não autoriza go-live. A decisão oficial continua **NO-GO** até que `readiness-evidence.json` e os critérios deste documento indiquem GO.
