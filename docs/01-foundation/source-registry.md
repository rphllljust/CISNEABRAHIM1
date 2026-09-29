# Source registry

| Campo        | Valor                                           |
| ------------ | ----------------------------------------------- |
| Document ID  | SRC-REG-001                                     |
| Last updated | 2026-09-29 (SRC-009: minuta de aceite operacional RC1 / amarra RC2, PENDING_SIGNATURE) |

## Como preencher

- Novo documento recebe o próximo `SRC-NNN` livre. Não reutilizar IDs.
- Não inventar `SOURCE-ID` para arquivo inexistente.
- Copiar estrutura de [`../templates/source-template.md`](../templates/source-template.md) na ingestão (Prompt 01+).
- SRC-000 **não** prova regra operacional.

## Fontes registradas

### SRC-000

| Campo                                 | Valor                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SOURCE-ID                             | SRC-000                                                                                                                                                            |
| Title                                 | Prompt 00 — Inicialização profissional do projeto CISNE RONDÔNIA                                                                                                   |
| Type                                  | GOVERNANÇA_DE_PROJETO                                                                                                                                              |
| Origin                                | Instrução de inicialização do repositório (responsável pelo projeto / sequência de prompts)                                                                        |
| Location                              | Este repositório (prompt de governança; não é Documento Mestre empresarial)                                                                                        |
| Date received                         | 2026-08-28                                                                                                                                                         |
| Status                                | REGISTERED                                                                                                                                                         |
| Classification                        | Fonte de governança do projeto                                                                                                                                     |
| May prove operational business rules? | **NO**                                                                                                                                                             |
| Notes                                 | Autoriza estrutura documental, protocolo, princípios de engenharia e restrições desta fase. O contexto empresarial citado no prompt é preliminar e não contratual. |

### SRC-001

| Campo                                                                               | Valor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SOURCE-ID                                                                           | SRC-001                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Title                                                                               | Contexto inicial informado pelo patrocinador                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Type                                                                                | Declaração inicial consolidada                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Origin                                                                              | Informações apresentadas pelo responsável pelo projeto durante o levantamento preliminar                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Location                                                                            | [`../inputs/SRC-001-contexto-inicial-patrocinador.md`](../inputs/SRC-001-contexto-inicial-patrocinador.md)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Date received / consolidation                                                       | 2026-08-28                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Reliability                                                                         | Média                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Status                                                                              | `PENDING_BUSINESS_VALIDATION`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Classification                                                                      | `SPONSOR_CONTEXT_RECONSTRUCTED` · `PENDING_BUSINESS_VALIDATION`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| May prove operational business rules in isolation?                                  | **NO**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Must be confronted with primary documents?                                          | **YES**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Substitutes primary sources?                                                        | **NO** — não substitui Documento Mestre, transcrições originais, proposta, contrato, PO, nota/fatura, documentação fiscal, contábil, ERP, nem confirmação formal da direção                                                                                                                                                                                                                                                                                                                                                            |
| Integrity                                                                           | Arquivo criado neste repositório no Prompt 00.1; consolidação reconstruída, não original primário                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Personal / sensitive data                                                           | Não identificado neste consolidado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Affected domains (candidatos de cobertura desta fonte; não são módulos confirmados) | Atividades empresariais citadas; solicitação de serviço; abertura e liberação de OS; conteúdo operacional da OS; equipamentos, veículos e máquinas; mão de obra; custo interno vs preço comercial; origem de cobrança e fases de item; cadeia comercial (proposta, pedido, PO, contrato, OS, execução, medição, faturamento, pagamento); documentos e versões; responsabilidade e handoff; gargalos e aging; integrações candidatas; preocupações de segurança; prioridade candidata (locação); decisões bloqueantes listadas na fonte |
| Atomic analysis                                                                     | **COMPLETE** (Prompt 01 — 84 evidências EV-001–EV-084 em [`../02-source-analysis/atomic-evidence-register.md`](../02-source-analysis/atomic-evidence-register.md))                                                                                                                                                                                                                                                                                                                                                                     |
| Analyzed in prompt                                                                  | **01** (2026-08-28)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Notes                                                                               | Fonte de contexto reconstruído. Nenhuma afirmação promovida a `CONFIRMED` no Prompt 01. Permanece `PENDING_BUSINESS_VALIDATION`. Complementado por SRC-002 (decisões Cliente) e SRC-003 (cadastro da operadora).                                                                                                                                                                                                                                                                                                                                                                    |

### SRC-002

| Campo | Valor |
| ----- | ----- |
| SOURCE-ID | SRC-002 |
| Title | Confirmação de baseline empresarial — módulo Clientes e decisões correlatas |
| Type | `BUSINESS_DECISION` · `DOCUMENTARY_EVIDENCE` (parcial) |
| Origin | Questionário criado Prompt 28; decisões registradas Prompt 29-A corretivo (instrução empresarial autorizada) |
| Location | [`../inputs/SRC-002-business-baseline-confirmation.md`](../inputs/SRC-002-business-baseline-confirmation.md) |
| Date received | 2026-08-29 |
| Approval date | 2026-08-29 |
| Status | `APPROVED` |
| Classification | `BUSINESS_CONFIRMATION_APPROVED` |
| May prove operational business rules? | **YES** (escopo Cliente e DDP-028; aprovação formal registrada) |
| Signed by | Abrahim Jabour Junior |
| Signed role | Administrador |
| Business facts recorded | CISNE RONDÔNIA COMÉRCIO E SERVIÇOS LTDA; CNPJ 11.897.171/0001-81 (operadora, não Client); código externo 152888 (referência comercial, não PK) |
| Business decisions recorded | Q01–Q15; DDP-020 (CLIENT_SCOPE); DDP-028; DDP-041 |
| Technical decisions recorded | Autorização via Identity + Capability + Scope; sem hardcode de proprietários |
| Confirmed rules promoted | BR-025..BR-040 (`CONFIRMED`); BR-041 (`CONDITIONAL`) — ver `business-rules-register.md` |
| Conflicts resolved | MAP-001, MAP-002 |
| Analyzed in prompt | **29-A corretivo** (2026-08-29) |
| Approved in prompt | **29-A aprovação humana** (2026-08-29) |
| Notes | Gate `LIBERADO`; `mandatory_blockers_count: 0`. Histórico: AWAITING_RESPONSE → ANALYZED_BLOCKED → BLOCKED_BY_SIGNATURE_ONLY → APPROVED. Complementado por SRC-003 (porte EPP, abertura, situação, e-mail e telefone declarados). Q04 “ERP opcional futuro” substituído por SRC-004 (`SC-001`). |

### SRC-003

| Campo | Valor |
| ----- | ----- |
| SOURCE-ID | SRC-003 |
| Title | Dados cadastrais da empresa operadora |
| Type | `SPONSOR_DECLARED_CADASTRE` |
| Origin | Texto colado pelo responsável no chat de engenharia |
| Location | [`../inputs/SRC-003-dados-cadastrais-empresa.md`](../inputs/SRC-003-dados-cadastrais-empresa.md) |
| Date received | 2026-09-03 |
| Received at | 2026-09-03T01:08:00-04:00 |
| Status | `REGISTERED` · fatos cadastrais `CORROBORATED_BY_SRC-005_SRC-006` |
| Classification | Declaração cadastral; não é extrato RFB |
| Reliability | Média |
| Integrity | Declaração original sem hash; conteúdo confrontado com SRC-005 e SRC-006, ambos com hash do PDF recebido |
| Personal / sensitive data | **Sim** — e-mail `cisneltda@hotmail.com`; telefone `(69) 9976-7888` |
| May prove operational business rules? | **NO** — corrobora identidade da operadora já em SRC-002; não prova regra fiscal, tributária ou de emissão |
| Substitutes primary sources? | **NO** |
| Business facts recorded | Razão social declarada com sufixo EPP; CNPJ 11.897.171/0001-81; situação Ativa; abertura 05/05/2010; sede Porto Velho - RO; e-mail e telefone comerciais — corroborados por SRC-005 e/ou SRC-006 |
| Analyzed in prompt | Registro 2026-09-03 (sem análise atômica Prompt 01) |
| Notes | Não abre conflito com SRC-002 (mesmo CNPJ). SRC-005 confirma `EPP` como porte; SRC-006 registra `017-SIMPLES NACIONAL` como snapshot estadual, sem fornecer regras tributárias. Não autoriza gateway SEFAZ, `FEATURE_MODULE_FISCAL`, NF-e/NFS-e nem exit do piloto. |

### SRC-004

| Campo | Valor |
| ----- | ----- |
| SOURCE-ID | SRC-004 |
| Title | Sistema empresarial centralizado; rejeição de conexão com ERP |
| Type | `SPONSOR_DECLARED_ARCHITECTURE` · `BUSINESS_DECISION` |
| Origin | Observação do responsável no chat de engenharia |
| Location | [`../inputs/SRC-004-sistema-centralizado-sem-erp.md`](../inputs/SRC-004-sistema-centralizado-sem-erp.md) |
| Date received | 2026-09-03 |
| Received at | 2026-09-03T01:14:00-04:00 |
| Status | `REGISTERED` |
| Classification | Declaração de arquitetura empresarial; SoT centralizado no CISNE |
| Reliability | Alta para o recorte declarado (mesmo responsável que aprovou SRC-002) |
| Integrity | Texto digitado no chat; sem documento formal anexo |
| Personal / sensitive data | Não |
| May prove operational business rules? | **YES** — somente o recorte “sem conexão ERP” e “sistema centralizado” |
| Substitutes primary sources? | **NO** |
| Business facts recorded | Não haverá conexão com ERP externo; o SISTEMA CISNE RONDÔNIA é o sistema empresarial centralizado |
| Business decisions recorded | DDP-014 (recorte ERP `REJECTED`); DDP-020 reforçado; BR-042 `CONFIRMED` |
| Conflicts resolved | SC-001 — SRC-002 Q04 “ERP opcional futuro” substituído por SRC-004 |
| Analyzed in prompt | Registro 2026-09-03 (sem análise atômica Prompt 01) |
| Notes | Não fecha DDP-023 residual. SEFAZ/prefeitura/banco/rastreador/WhatsApp não são ERP e permanecem `OPEN` se já estavam. Não autoriza adapter ERP, `FEATURE_MODULE_FISCAL` em produção nem exit do piloto. |

### SRC-005

| Campo | Valor |
| ----- | ----- |
| SOURCE-ID | SRC-005 |
| Title | Comprovante de Inscrição e de Situação Cadastral — CNPJ |
| Type | `PUBLIC_REGISTRY_EXTRACT_COPY` · cadastro federal |
| Origin | Receita Federal do Brasil, conforme conteúdo do PDF fornecido pelo responsável |
| Location | [`../inputs/SRC-005-comprovante-cnpj-rfb.md`](../inputs/SRC-005-comprovante-cnpj-rfb.md) |
| Original filename | `monica cnpj.pdf` |
| Date received | 2026-09-03 |
| Received at | 2026-09-03T01:46:52-04:00 |
| Status | `ANALYZED` |
| Classification | Cópia de extrato cadastral público federal; autenticidade não reconsultada on-line |
| Reliability | Alta para os fatos cadastrais exibidos |
| Integrity | SHA-256 `BBCC3A6C7772C5568B55A6360D903BD6D096202482DD67517D6819CB7338C27B`; 156230 bytes; 3 páginas |
| Personal / sensitive data | **Sim** — e-mail e telefone comerciais; original não versionado enquanto DDP-019 estiver `OPEN` |
| May prove operational business rules? | **NO** — prova fatos cadastrais no snapshot, não regras operacionais/fiscais |
| Business facts recorded | CNPJ; nome empresarial; matriz; abertura; porte EPP; natureza jurídica; endereço; contatos; situação ATIVA; 1 CNAE principal + 48 secundários |
| Cross-validation | Corrobora SRC-002/SRC-003 e o conjunto legal de 49 CNAEs já usado no catálogo |
| Notes | Não contém regime tributário, IE/IM, certificado ou credencial fiscal. Não autoriza emissão oficial, feature fiscal nem go-live. |

### SRC-006

| Campo | Valor |
| ----- | ----- |
| SOURCE-ID | SRC-006 |
| Title | Consulta Pública à REDESIM de Rondônia |
| Type | `PUBLIC_STATE_TAX_REGISTRY_EXTRACT_COPY` |
| Origin | SEFIN/CRE — Portal do Contribuinte / SINTEGRA, conforme PDF fornecido pelo responsável |
| Location | [`../inputs/SRC-006-consulta-publica-sefin-redesim.md`](../inputs/SRC-006-consulta-publica-sefin-redesim.md) |
| Original filename | `Bem vindo ao Portal de Informações - SEFIN_CRE.pdf` |
| Date received | 2026-09-03 |
| Received at | 2026-09-03T01:46:52-04:00 |
| Status | `ANALYZED` |
| Classification | Cópia de consulta cadastral pública estadual; autenticidade não reconsultada on-line |
| Reliability | Alta para o snapshot cadastral exibido, com anomalias de renderização documentadas |
| Integrity | SHA-256 `BFF474E552B92289679E2D80641C60CDB174CA9770AEFD5A5486B864D10A8F30`; 122324 bytes; 2 páginas |
| Personal / sensitive data | **Sim** — contato comercial e identificação contábil mascarada; original não versionado enquanto DDP-019 estiver `OPEN` |
| May prove operational business rules? | **NO** — prova cadastro/status temporal; não define tributação ou emissão |
| Business facts recorded | CNPJ; IE 00000003050866; NIRE 11200541730; endereço; regime cadastral 017-SIMPLES NACIONAL; contribuinte ATIVO/HABILITADO; início estadual; CNAEs; NF-e NÃO CREDENCIADO no snapshot |
| Cross-validation | CNPJ, endereço, contato e 49 CNAEs coincidem com SRC-005; datas federal/estadual têm semânticas distintas |
| Notes | Campos vazios não foram lidos como ausência. `NÃO CREDENCIADO` é específico de NF-e e impede presumir gateway autorizado. Não autoriza feature fiscal nem go-live. Confrontado com SRC-007: transmissão permanece `BLOCKED` enquanto o credenciamento não for aprovado. |

### SRC-007

| Campo | Valor |
| ----- | ----- |
| SOURCE-ID | SRC-007 |
| Title | Gates de credenciamento, protocolo SEFAZ e legendas de validade fiscal |
| Type | `SPONSOR_DECLARED_FISCAL_POLICY` · `BUSINESS_DECISION` |
| Origin | Observação do responsável no chat de engenharia |
| Location | [`../inputs/SRC-007-nfe-authorization-danfe-gates.md`](../inputs/SRC-007-nfe-authorization-danfe-gates.md) |
| Date received | 2026-09-03 |
| Received at | 2026-09-03T01:51:00-04:00 |
| Status | `REGISTERED` |
| Classification | Política fiscal declarada; gates de transmissão, autorização e legendas |
| Reliability | Alta para o recorte declarado (mesmo responsável que aprovou SRC-002) |
| Integrity | Texto digitado no chat; sem documento formal anexo |
| Personal / sensitive data | Não |
| May prove operational business rules? | **YES** — somente o recorte de gates (credenciamento, protocolo SEFAZ, legendas DANFE) |
| Substitutes primary sources? | **NO** |
| Business facts recorded | Transmissão NF-e bloqueada sem credenciamento aprovado; `AUTHORIZED` e DANFE oficial exigem protocolo SEFAZ; legendas de rascunho e homologação; produção somente após autorização oficial |
| Business decisions recorded | BR-043, BR-044, BR-045 `CONFIRMED`; DDP-023 gates confirmados; residual tributário permanece `OPEN` |
| Conflicts resolved | Nenhum. Complementa SRC-006 (`NÃO CREDENCIADO` ⇒ transmissão `BLOCKED`) |
| Analyzed in prompt | Registro 2026-09-03 (sem análise atômica Prompt 01) |
| Notes | Não autoriza `FEATURE_MODULE_FISCAL`, gateway, certificado, alíquota, tipo legal NF-e/NFS-e nem exit do piloto. Não inverte o snapshot SRC-006. |

### SRC-008

| Campo | Valor |
| ----- | ----- |
| SOURCE-ID | SRC-008 |
| Title | Autoridade operacional máxima, OS, medição, PO e faturamento interno |
| Type | `SPONSOR_DECLARED_OPERATIONAL_POLICY` · `BUSINESS_DECISION` |
| Origin | Instrução normativa do responsável no chat de engenharia |
| Location | [`../inputs/SRC-008-autoridade-operacional-os-medicao-po-faturamento.md`](../inputs/SRC-008-autoridade-operacional-os-medicao-po-faturamento.md) |
| Date received | 2026-09-03 |
| Received at | 2026-09-03T02:22:00-04:00 |
| Status | `REGISTERED` |
| Classification | Política operacional declarada: autoridade máxima equivalente, solicitação≠OS, PO configurável, medição real, desacoplamento fiscal |
| Reliability | Alta para o recorte declarado (mesmo responsável que aprovou SRC-002) |
| Integrity | Texto digitado no chat; sem documento formal anexo |
| Personal / sensitive data | Sim — identifica os dois administradores máximos |
| May prove operational business rules? | **YES** — recorte de autoridade, OS, solicitação, PO, medição e faturamento interno |
| Substitutes primary sources? | **NO** |
| Business facts recorded | Duas autoridades máximas equivalentes; backend como boundary; solicitação≠OS; reabertura excepcional; PO não globalmente obrigatório; medição = executado; direito a faturar ≠ emissão fiscal; WhatsApp = origem |
| Business decisions recorded | BR-046..BR-051 `CONFIRMED`; DDP-022 `ANSWERED`; DDP-002/003/004/005/009/010/011/015/021 `PARTIALLY_ANSWERED`; DDP-023 residual permanece `OPEN` |
| Conflicts resolved | Nenhum |
| Analyzed in prompt | Registro 2026-09-03 (sem análise atômica Prompt 01) |
| Notes | Não hardcodar nomes no PDP. Não autoriza `FEATURE_MODULE_FISCAL` nem exit do piloto. |

### SRC-009

| Campo | Valor |
| ----- | ----- |
| SOURCE-ID | SRC-009 |
| Title | Termo de aceite do processo operacional (RC1) e vínculo com o candidato atual |
| Type | `BUSINESS_PROCESS_ACCEPTANCE` · `RELEASE_BINDING_PROPOSAL` |
| Origin | Minuta elaborada a pedido do responsável (2026-09-29) para assinatura dos dois administradores |
| Location | [`../inputs/SRC-009-aceite-processo-operacional-rc1-e-delta-rc2.md`](../inputs/SRC-009-aceite-processo-operacional-rc1-e-delta-rc2.md) |
| Date received | 2026-09-29 (elaboração; assinatura pendente) |
| Status | `PENDING_SIGNATURE` |
| Classification | Reafirmação do UAT RC1 e proposta de amarra do RC2; não é go-live |
| Reliability | Nula até as duas assinaturas; após assinatura, alta para o recorte marcado |
| Integrity | Minuta em markdown; PDF assinado a anexar no mesmo SOURCE-ID |
| Personal / sensitive data | Sim — identifica os dois administradores |
| May prove operational business rules? | **NO** enquanto `PENDING_SIGNATURE`. **YES** após as duas assinaturas — somente cláusulas 1 e 2 conforme marcadas |
| Substitutes primary sources? | **NO** — não substitui UAT-UX-001/002 nem SRC-008 |
| Notes | Não atualiza `readiness-evidence.json` sozinho. Não autoriza `FEATURE_MODULE_FISCAL`, Prompt 93 nem EXIT_READY. |

## Fontes ainda não fornecidas

Status uniforme: `NOT_PROVIDED`. Nenhum `SOURCE-ID` foi atribuído a estes artefatos (atribuir somente quando o original existir). **SRC-001 não preenche e não substitui** esta lista.

| Artefato esperado            | Status         |
| ---------------------------- | -------------- |
| Documento Mestre             | `NOT_PROVIDED` |
| Regras de negócio            | `NOT_PROVIDED` como Documento Mestre; SRC-008 cobre o recorte operacional de autoridade/OS/PO/medição/faturamento interno |
| Transcrições                 | `NOT_PROVIDED` |
| Propostas                    | `NOT_PROVIDED` |
| Contratos                    | `NOT_PROVIDED` |
| Purchase Orders              | `NOT_PROVIDED` |
| Notas / faturas              | `NOT_PROVIDED` |
| Planilhas                    | `NOT_PROVIDED` |
| Formulários                  | `NOT_PROVIDED` |
| Documentos operacionais      | `NOT_PROVIDED` |
| Documentação de ERP          | `NOT_PROVIDED` — SRC-004 rejeita conexão; artefato não é esperado |
| Documentação de rastreamento | `NOT_PROVIDED` |
| Requisitos fiscais           | `NOT_PROVIDED` — SRC-007 cobre só gates de transmissão/autorização/legendas; alíquota, CFOP, NCM, certificado e tipo legal permanecem ausentes |
| Requisitos jurídicos         | `NOT_PROVIDED` |
| Requisitos de infraestrutura | `NOT_PROVIDED` |

Área de depósito futuro: [`../inputs/README.md`](../inputs/README.md).
