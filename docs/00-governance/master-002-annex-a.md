# MASTER 002 — ANEXO A
## MATRIZ DEFINITIVA DE CRITÉRIOS DE ACEITE DOS 16 MÓDULOS DO CISNE ENTERPRISE TIER 1

**Repositório:** `rphllljust/CISNEABRAHIM1`  
**Branch:** `erp-tier1-full-delivery`  
**Arquitetura:** React + TypeScript + NestJS + PostgreSQL  
**Entrega:** Única, integrada, auditável e comprovada  
**Meta:** 100% dos critérios obrigatórios atendidos  
**Publicação:** GHCR + Coolify

---

# 1. REGRA UNIVERSAL DE ACEITE

Nenhum módulo poderá ser declarado concluído apenas por possuir:

- Uma rota funcional.
- Uma tela de listagem.
- Um formulário de cadastro.
- Uma API que responde HTTP 200.
- Uma tabela no PostgreSQL.
- Um dashboard com indicadores.
- Um commit.
- Um build aprovado.
- Documentação.
- Testes exclusivamente com mocks.

Para ser considerado **HOMOLOGADO**, cada módulo deve atender simultaneamente às seis dimensões:

| Dimensão | Exigência |
|---|---|
| D1 — Experiência empresarial | Interface funcional, contextual e responsiva |
| D2 — Domínio e backend | Regras, comandos, consultas e validações autoritativas |
| D3 — Persistência | Dados corretos e transações consistentes no PostgreSQL |
| D4 — Integração | Relacionamentos reais com os módulos responsáveis |
| D5 — Segurança e auditoria | Permissões, isolamento, concorrência e rastreabilidade |
| D6 — Testes e homologação | Cenários positivos, negativos e evidências verificáveis |

As seis dimensões são obrigatórias em todos os módulos.

## 1.1. Estados permitidos

Cada critério poderá assumir somente:

- **NÃO INICIADO:** capacidade não implementada.
- **EM IMPLEMENTAÇÃO:** existe trabalho em desenvolvimento, ainda não validado.
- **IMPLEMENTADO:** código funcional disponível, sem comprovação integral.
- **TESTADO:** testes obrigatórios executados e aprovados.
- **HOMOLOGADO:** comportamento empresarial comprovado no ambiente de homologação.
- **BLOQUEADO:** existe impedimento concreto, identificado e documentado.

Um módulo com critério obrigatório bloqueado não está 100% concluído.

Um módulo implementado não é automaticamente homologado.

---

# 2. CENTRAL EMPRESARIAL — P0

**Objetivo:** transformar a Central no ambiente principal de execução de trabalho do ERP, seguindo o conceito de Operational Workspace do Dynamics 365.

### Critérios obrigatórios

**CE-01 — Workspace por função:** usuários de Operações, Comercial, Financeiro, Fiscal, Contabilidade e Suprimentos visualizam filas e informações compatíveis com suas permissões.

**CE-02 — Filas reais:** as tarefas exibidas devem ser provenientes de consultas autoritativas aos módulos responsáveis. Não utilizar listas artificiais.

**CE-03 — Priorização:** pendências devem poder ser filtradas e ordenadas por situação, criticidade, responsável e prazo, quando esses atributos existirem no contrato empresarial.

**CE-04 — Indicadores consistentes:** as contagens apresentadas na Central devem corresponder aos registros consultáveis com o mesmo escopo e filtros.

**CE-05 — Ações autorizadas:** cada tarefa deve oferecer apenas operações permitidas pelo backend.

**CE-06 — Navegação contextual:** abrir uma pendência deve direcionar ao objeto empresarial correto, preservando contexto e filtros relevantes.

**CE-07 — Atualização transacional:** após uma operação bem-sucedida, tarefa, contagem e situação devem ser atualizadas.

**CE-08 — Exceções empresariais:** bloqueadores e erros de processo devem ser apresentados com a origem e o encaminhamento aplicável.

**CE-09 — Visões salvas:** filtros e configurações de trabalho devem poder ser recuperados pelo usuário autorizado.

**CE-10 — Resiliência:** erro em um painel não pode ser apresentado como ausência de pendências nem inutilizar os demais painéis independentes.

### Prova obrigatória

Executar uma operação real a partir da Central, comprovar a persistência no domínio responsável e verificar a atualização da Work Inbox e das contagens.

**Reprovação:** dashboard decorativo, KPI fictício, ação sem efeito ou fila que não reconcilia com o backend.

---

# 3. CLIENTES 360° — P0

**Objetivo:** disponibilizar uma visão empresarial unificada do cliente.

### Critérios obrigatórios

**CL-01 — Identidade:** cada cliente possui identificação única, situação, unidade autorizada e dados cadastrais consistentes.

**CL-02 — Página 360°:** a página consolida informações cadastrais, comerciais, contratuais, operacionais, documentais e financeiras aplicáveis.

**CL-03 — Propostas:** apresentar propostas vinculadas ao cliente, incluindo situação, versão e navegação para o registro original.

**CL-04 — Contratos:** apresentar contratos vigentes, encerrados e demais estados suportados, com vigência e referências corretas.

**CL-05 — OS:** apresentar Ordens de Serviço relacionadas e seus estados autoritativos.

**CL-06 — Histórico:** disponibilizar histórico de eventos e mudanças rastreáveis.

**CL-07 — Faturamento:** apresentar documentos ou operações de faturamento relacionadas por contratos públicos do domínio responsável.

**CL-08 — Recebíveis:** apresentar títulos e situação financeira autorizada, sem misturar valores previstos, faturados e recebidos.

**CL-09 — Relacionamentos:** permitir navegação bidirecional entre cliente e objetos relacionados.

**CL-10 — Segurança:** um usuário sem permissão não pode acessar dados do cliente por alteração direta de URL ou identificador.

### Prova obrigatória

Criar ou utilizar um cliente autorizado que possua proposta, contrato, OS e transação financeira relacionada. Abrir o Cliente 360° e comprovar que cada vínculo apresenta o registro correto, sem duplicações.

**Reprovação:** página que apresenta apenas cadastro, contatos e cartões sem integração real.

---

# 4. SOLICITAÇÕES — P1

**Objetivo:** estabelecer rastreabilidade desde a entrada de uma demanda até seu resultado empresarial.

### Critérios obrigatórios

**SO-01 — Abertura:** uma solicitação válida pode ser registrada com cliente, tipo, contexto e responsável conforme regras existentes.

**SO-02 — Triagem:** a solicitação pode avançar por estados suportados pelo domínio, com validação de transições.

**SO-03 — Responsabilidade:** alterações de responsável são persistidas e auditadas.

**SO-04 — Prioridade:** a prioridade é armazenada e utilizada nas filas, sem cálculo arbitrário no frontend.

**SO-05 — SLA:** quando aplicável, prazos são derivados de regras configuradas e utilizados para identificar vencimentos.

**SO-06 — Aprovação:** operações de aprovação ou rejeição respeitam capacidades, regras e justificativas.

**SO-07 — Conversão:** quando autorizada, a conversão para proposta ou OS cria o objeto correto e preserva a origem.

**SO-08 — Idempotência:** solicitações repetidas de conversão não criam registros empresariais duplicados.

**SO-09 — Histórico:** cada decisão e mudança de estado pode ser rastreada.

**SO-10 — Exceções:** erros de validação e bloqueadores devem ser exibidos sem alterar indevidamente o estado original.

### Prova obrigatória

Executar abertura → triagem → designação → decisão → conversão e verificar persistência e vínculos nos objetos de destino.

**Reprovação:** conversão que apenas redireciona para um formulário sem preservar a origem.

---

# 5. PROPOSTAS E CONTRATOS — P1

**Objetivo:** transformar o processo comercial em um ciclo versionado, contratual e operacionalmente integrado.

### Critérios obrigatórios

**PC-01 — Versionamento:** revisões de propostas mantêm histórico e identidade da versão.

**PC-02 — Integridade:** versões emitidas ou aceitas não podem ser alteradas indevidamente como se fossem rascunhos.

**PC-03 — Ciclo de vida:** emissão, revisão, aceite, rejeição, expiração e cancelamento respeitam as transições suportadas.

**PC-04 — Aprovação:** decisões exigem autorização e deixam evidência auditável.

**PC-05 — Condições econômicas:** valores, moedas, itens e quantidades são persistidos sem perda de precisão.

**PC-06 — Contratualização:** a criação ou associação de contrato mantém referência à proposta ou origem comercial correspondente.

**PC-07 — Vigência:** períodos e estados contratuais são validados corretamente.

**PC-08 — Execução:** contratos apresentam as OS, serviços e medições relacionados.

**PC-09 — Compromissos:** obrigações econômicas são obtidas de regras e contratos existentes, não de valores presumidos.

**PC-10 — Documentos:** versões contratuais e anexos possuem vínculos e permissões corretos.

### Prova obrigatória

Executar revisão e aceite de proposta, vincular o contrato correspondente e demonstrar uma operação originada desse contrato.

**Reprovação:** alteração retroativa indevida de uma versão aceita ou perda de rastreabilidade entre proposta, contrato e OS.

---

# 6. ORDENS DE SERVIÇO — P0

**Objetivo:** consolidar a OS como objeto empresarial central da operação do CISNE.

### Critérios obrigatórios

**OS-01 — Origem:** a OS mantém referência à origem comercial, cliente, contrato e serviço quando aplicável.

**OS-02 — Catálogo:** a OS preserva a identidade ou versão do serviço utilizada.

**OS-03 — Ciclo de vida:** transições seguem regras do backend, sem estados inventados pelo frontend.

**OS-04 — Pré-condições:** comandos como PREPARE e RELEASE somente aparecem como disponíveis quando suas condições são satisfeitas.

**OS-05 — Planejamento:** recursos, pessoas, ativos, materiais e períodos são registrados por contratos de domínio válidos.

**OS-06 — Disponibilidade:** alocações não podem ignorar conflitos de recurso ou restrições existentes.

**OS-07 — Execução:** eventos operacionais e apontamentos possuem origem, responsável e histórico.

**OS-08 — Custos:** distinguir custos previstos, comprometidos, realizados e grandezas físicas, conforme semântica do domínio.

**OS-09 — Consumo:** consumo de materiais e recursos deve refletir movimentações e lançamentos reais quando aplicável.

**OS-10 — Medição:** quantidades medidas devem possuir origem operacional, unidade e regra válida.

**OS-11 — Aceite:** aprovação ou rejeição de medição deve preservar responsabilidade, justificativa e auditoria.

**OS-12 — Evidências:** anexos e registros documentais devem ser relacionados às operações corretas.

**OS-13 — Faturamento:** operações elegíveis devem originar faturamento sem duplicações.

**OS-14 — Concorrência:** comandos com `rowVersion` desatualizado devem produzir conflito controlado, sem persistência incorreta.

**OS-15 — Sincronização:** Worklist, Kanban, OS 360°, Workbench e Work Inbox devem apresentar estado consistente após comandos.

**OS-16 — Resultado econômico:** informações financeiras exibidas devem preservar diferença entre custo, receita, faturamento, recebimento e contabilização.

### Prova obrigatória

Executar o percurso operacional suportado: criação → planejamento → preparação → liberação → execução → medição → aceite → faturamento, com persistência, auditoria e integração comprovadas em cada transição.

**Reprovação:** uma OS que funciona somente como cadastro, um comando que retorna 409 apesar de aparecer habilitado, ou dados econômicos calculados incorretamente.

---

# 7. PESSOAS — P1

**Objetivo:** integrar pessoas aos processos operacionais e econômicos sem duplicação de cadastro.

### Critérios obrigatórios

**PE-01 — Identidade:** cada pessoa possui identificador único e dados mestres consistentes.

**PE-02 — Qualificações:** qualificações e habilitações podem ser consultadas e validadas quando exigidas pela operação.

**PE-03 — Disponibilidade:** a disponibilidade considera alocações, períodos e restrições documentadas no domínio.

**PE-04 — Alocação:** uma pessoa elegível pode ser vinculada a uma OS autorizada.

**PE-05 — Conflitos:** alocações incompatíveis devem ser impedidas ou tratadas conforme regra explícita.

**PE-06 — Histórico:** apresentar operações, alocações e situações históricas relacionadas.

**PE-07 — Custos:** custos de pessoal, quando disponíveis, devem vir das fontes autorizadas.

**PE-08 — Documentos:** documentos pessoais e profissionais exigem permissões adequadas.

**PE-09 — Integração:** as relações com OS e Folha devem utilizar identificadores e contratos existentes.

**PE-10 — Privacidade:** a interface não pode revelar informações pessoais sensíveis a usuários sem autorização.

### Prova obrigatória

Vincular pessoa elegível à OS, verificar disponibilidade e histórico, testar conflito de alocação e acesso negado.

**Reprovação:** cadastro de pessoas sem vínculo com planejamento operacional.

---

# 8. ATIVOS E FROTA — P1

**Objetivo:** disponibilizar controle operacional de recursos físicos e veículos.

### Critérios obrigatórios

**AF-01 — Cadastro mestre:** Frota reutiliza a identidade dos ativos físicos pertinentes, sem criar veículos duplicados.

**AF-02 — Classificação:** apresentar tipo, situação e unidade operacional corretos.

**AF-03 — Disponibilidade:** indicar capacidade de utilização com base no estado e nas alocações existentes.

**AF-04 — Alocação:** ativos elegíveis podem ser vinculados a operações autorizadas.

**AF-05 — Conflitos:** impedir utilização simultânea incompatível do mesmo recurso.

**AF-06 — Motoristas:** vínculos entre motorista, veículo e operação devem ser rastreáveis, quando aplicável.

**AF-07 — Manutenção:** indisponibilidades relacionadas à manutenção devem ser respeitadas quando houver regras e registros autoritativos.

**AF-08 — Custos:** custos operacionais devem ser vinculados ao recurso e à operação correspondente.

**AF-09 — Histórico:** apresentar utilização e OS relacionadas.

**AF-10 — Documentação:** documentos e restrições relevantes devem respeitar vigência e autorização, quando aplicável.

### Prova obrigatória

Alocar um veículo autorizado a uma operação, testar conflito de disponibilidade e verificar o histórico em Frota, Ativos e OS.

**Reprovação:** disponibilidades contraditórias entre os módulos.

---

# 9. LOCAÇÕES E TRANSPORTE — P1

**Objetivo:** oferecer operação especializada sem criar um segundo domínio de Ordens de Serviço.

### Critérios obrigatórios

**LT-01 — Domínio único:** operações utilizam o ciclo de vida autoritativo de OS quando essa for sua origem.

**LT-02 — Listagens:** apresentar filtros, paginação, ordenação e contagens corretas no servidor.

**LT-03 — Concorrência de consultas:** respostas antigas não podem substituir dados de uma busca mais recente.

**LT-04 — Programação:** períodos, recursos e responsabilidades devem ser persistidos.

**LT-05 — Despacho:** comandos de despacho e liberação seguem estados e capacidades existentes.

**LT-06 — Recursos:** veículos, motoristas e ativos devem ser obtidos dos respectivos cadastros mestres.

**LT-07 — Execução:** registrar eventos operacionais e ocorrências quando suportados.

**LT-08 — Medição:** quantidades e períodos executados devem preservar unidade, origem e regra contratual.

**LT-09 — Custos:** custos relacionados devem ser rastreáveis até o domínio responsável.

**LT-10 — Cobrança:** operações elegíveis devem integrar o faturamento sem duplicidade.

**LT-11 — Navegação:** permitir ir da lista especializada à OS 360° e retornar preservando filtros.

**LT-12 — Consistência:** a situação apresentada em Transporte, Locações e OS deve ser coerente.

### Prova obrigatória

Executar uma operação de Transporte e outra de Locação, verificar vínculos com OS, recursos, medição e efeitos econômicos aplicáveis.

**Reprovação:** listas que utilizam estados inventados, dados desatualizados ou contratos próprios inconsistentes com OS.

---

# 10. CATÁLOGO DE SERVIÇOS — P1

**Objetivo:** manter definições de serviços versionadas e historicamente consistentes.

### Critérios obrigatórios

**CA-01 — Identidade:** serviço e versão possuem identificadores estáveis.

**CA-02 — Rascunho:** alterações de serviço ocorrem em estados editáveis permitidos.

**CA-03 — Publicação:** publicação valida requisitos e autorização.

**CA-04 — Imutabilidade:** versões publicadas não podem ser modificadas retroativamente de forma indevida.

**CA-05 — Requisitos:** materiais, qualificações, recursos e unidades de medida utilizam estruturas persistidas quando aplicáveis.

**CA-06 — Ordenação:** o contrato de `sortOrder` deve aceitar e preservar corretamente valores válidos, inclusive zero quando definido como 0-based.

**CA-07 — Relação com OS:** a OS utiliza serviço e versão identificáveis.

**CA-08 — Histórico:** versões anteriores continuam consultáveis conforme autorização.

**CA-09 — Comparação:** alterações entre versões podem ser identificadas.

**CA-10 — Validação:** definições incompletas não podem ser publicadas quando desrespeitarem requisitos obrigatórios.

### Prova obrigatória

Publicar uma versão de serviço, utilizá-la em OS, criar versão posterior e comprovar que a operação anterior mantém sua definição histórica.

**Reprovação:** atualização de catálogo que altera indevidamente a configuração de OS anteriores.

---

# 11. GED — P1

**Objetivo:** implementar gestão documental transversal, versionada e controlada por autorização.

### Critérios obrigatórios

**GD-01 — Captura:** arquivo válido pode ser recebido e vinculado a uma identidade documental.

**GD-02 — Metadados:** tipo, classificação, proprietário, unidade e referências são persistidos conforme o modelo.

**GD-03 — Versões:** alterações documentais preservam histórico e identidade das versões.

**GD-04 — Relacionamentos:** documentos podem ser associados a Cliente, Contrato, OS, Pessoa ou Ativo quando autorizado.

**GD-05 — Pesquisa:** localizar documentos por filtros e metadados disponíveis, respeitando escopo de acesso.

**GD-06 — Visualização:** usuário autorizado pode consultar ou pré-visualizar documentos suportados.

**GD-07 — Download:** downloads individuais exigem autorização no backend.

**GD-08 — Download em lote:** a operação deve filtrar permissões por documento e impedir exposição de arquivos indevidos.

**GD-09 — Auditoria:** operações de alteração, versão e acesso relevante devem ser rastreáveis conforme política de auditoria.

**GD-10 — Segurança:** impedir acesso direto não autorizado a objetos armazenados.

**GD-11 — Integridade:** arquivos, versões e referências não podem ficar inconsistentes após falhas de upload ou download.

**GD-12 — OCR:** quando disponível, o OCR permanece complementar e não substitui o gerenciamento documental.

### Prova obrigatória

Carregar documento, versionar, vincular a uma OS, recuperar versões e executar download em lote com usuário autorizado e usuário sem permissão.

**Reprovação:** arquivos acessíveis apenas pela URL, sem verificação do vínculo e das permissões.

---

# 12. COMPRAS E ESTOQUE — P0

**Objetivo:** completar a cadeia de aquisição, recebimento e consumo, integrada à operação e ao financeiro.

### Critérios obrigatórios

**CO-01 — Requisição:** registrar necessidade com origem, itens, quantidades e responsáveis.

**CO-02 — Aprovação:** aplicar regras de autorização e estado.

**CO-03 — Pedido:** gerar ou registrar pedido com fornecedor, valores, moeda e condições consistentes.

**CO-04 — Rastreabilidade:** preservar vínculo entre requisição e pedido quando aplicável.

**CO-05 — Recebimento:** registrar quantidades recebidas e diferenças em relação ao pedido.

**CO-06 — Conferência:** divergências de item, quantidade ou valor devem ser identificadas conforme os contratos disponíveis.

**CO-07 — Estoque:** entradas e saídas devem gerar movimentações persistidas.

**CO-08 — Reserva:** materiais podem ser reservados para OS sem duplicar saldo.

**CO-09 — Consumo:** consumo operacional reduz ou movimenta disponibilidade conforme regras do estoque.

**CO-10 — Saldo:** saldo apresentado deve reconciliar com movimentos e reservas.

**CO-11 — Financeiro:** obrigações a pagar devem preservar referência ao documento de origem.

**CO-12 — Contabilidade:** eventos econômicos devem ser encaminhados ao subledger ou mecanismo contábil aplicável.

**CO-13 — Concorrência:** movimentos simultâneos não podem provocar inconsistência ou consumo indevido.

**CO-14 — Estornos:** correções de movimentos devem preservar o histórico e respeitar regras de reversão.

### Prova obrigatória

Executar requisição → pedido → recebimento → entrada de estoque → reserva para OS → consumo, verificando saldos e obrigações financeiras correspondentes.

**Reprovação:** estoque calculado apenas no frontend, consumo sem movimento ou obrigação financeira sem origem.

---

# 13. FINANCEIRO — P0

**Objetivo:** garantir controle transacional de recebíveis, pagáveis, tesouraria e conciliação.

### Critérios obrigatórios

**FI-01 — Recebíveis:** títulos originados de faturamento devem preservar referências e valores corretos.

**FI-02 — Pagáveis:** obrigações originadas de compras, despesas e outros processos suportados devem manter rastreabilidade.

**FI-03 — Vencimentos:** situações de vencimento são derivadas de datas e regras autoritativas.

**FI-04 — Recebimento:** registrar liquidação parcial ou integral conforme regras disponíveis.

**FI-05 — Pagamento:** impedir liquidações duplicadas ou sem autorização.

**FI-06 — Tesouraria:** movimentações devem preservar origem, conta e valor.

**FI-07 — Conciliação:** conciliar movimentos com registros bancários ou financeiros conforme os contratos existentes.

**FI-08 — Moedas:** preservar moeda original, valores decimais e conversões quando aplicáveis, sem arredondamento inadequado.

**FI-09 — Fluxo de caixa:** distinguir previsão de movimento efetivamente realizado.

**FI-10 — Indicadores:** saldos e totais devem ser calculados no escopo adequado e reconciliar com as fontes.

**FI-11 — Exceções:** divergências e títulos pendentes devem poder ser investigados até sua origem.

**FI-12 — Segurança:** aplicar segregação de funções a operações sensíveis.

**FI-13 — Auditoria:** pagamentos, recebimentos, conciliações e reversões devem preservar responsáveis e histórico.

**FI-14 — Contabilidade:** eventos financeiros com efeito contábil devem produzir as integrações previstas.

### Prova obrigatória

Gerar recebível a partir de faturamento e pagável a partir de compra, executar operações de liquidação autorizadas e verificar tesouraria, conciliação e efeitos contábeis aplicáveis.

**Reprovação:** títulos duplicados, saldo incoerente ou valores monetários derivados de quantidades físicas.

---

# 14. FISCAL — P0

**Objetivo:** manter documentos e obrigações fiscais coerentes com os fatos econômicos e regras efetivamente suportadas.

### Critérios obrigatórios

**FS-01 — Origem:** documento fiscal mantém vínculo com a operação empresarial que o originou.

**FS-02 — Situação:** estados fiscais devem ser autoritativos, inclusive quando dependerem de integração externa.

**FS-03 — Emissão:** emissão é permitida somente quando os requisitos fiscais suportados forem satisfeitos.

**FS-04 — Retornos:** respostas de provedores fiscais devem ser tratadas corretamente, inclusive falhas e rejeições.

**FS-05 — Cancelamento:** cancelamentos preservam regras, situação e histórico.

**FS-06 — Competência:** documentos e apurações possuem período fiscal consistente.

**FS-07 — Cálculo:** tributos devem utilizar regras versionadas e parâmetros fundamentados.

**FS-08 — Validação:** cálculos ou obrigações sem suporte normativo e implementação válida não podem ser apresentados como corretos.

**FS-09 — Apuração:** totais devem reconciliar com documentos elegíveis e respectivas regras.

**FS-10 — Contabilidade:** eventos com efeito contábil devem preservar referências para integração autorizada.

**FS-11 — Auditoria:** manter evidências e histórico de eventos fiscais.

**FS-12 — Segurança:** impedir operações não autorizadas sobre documentos e competências.

### Prova obrigatória

Executar os fluxos fiscais efetivamente suportados, verificar estados, competências, documentos de origem, cálculo aplicável e integração contábil.

**Reprovação:** documento apresentado como autorizado sem confirmação correspondente, ou cálculo fiscal presumido.

---

# 15. CONTABILIDADE — P0

**Objetivo:** implementar uma contabilidade empresarial reconciliável com fatos econômicos reais.

### Critérios obrigatórios

**CT-01 — Plano de contas:** contas possuem identidade, classificação e situação válidas.

**CT-02 — Subledger:** eventos econômicos utilizam contratos públicos dos módulos de origem.

**CT-03 — Regras versionadas:** a contabilização respeita regras válidas para a competência e o evento.

**CT-04 — Partidas dobradas:** lançamentos contabilizados devem estar balanceados segundo as regras monetárias aplicáveis.

**CT-05 — Diário:** lançamentos devem possuir identidade, data, referência e histórico.

**CT-06 — Razão:** saldos por conta devem reconciliar com lançamentos válidos.

**CT-07 — Balancete:** totais devem reconciliar com o razão no mesmo escopo e período.

**CT-08 — DRE:** valores devem ser derivados de lançamentos e classificações contábeis pertinentes.

**CT-09 — Balanço:** saldos devem refletir as contas e competências configuradas.

**CT-10 — Competências:** períodos devem possuir estados e regras explícitas.

**CT-11 — Fechamento:** impedir fechamento quando bloqueadores obrigatórios não estiverem resolvidos.

**CT-12 — Bloqueio:** lançamentos indevidos em competências fechadas devem ser rejeitados.

**CT-13 — Reversões:** correções devem preservar rastreabilidade, evitando exclusão silenciosa de lançamentos contabilizados.

**CT-14 — Idempotência:** reprocessamento de eventos não deve gerar contabilização duplicada.

**CT-15 — Origem:** deve ser possível navegar do lançamento até seu fato econômico original.

**CT-16 — Segurança:** operações de fechamento e contabilização exigem autorização específica.

### Prova obrigatória

Gerar eventos econômicos de fluxos comerciais, operacionais e financeiros suportados, contabilizá-los, reconciliar diário, razão e balancete e executar teste de fechamento de competência.

**Reprovação:** DRE com números fixos, partidas desbalanceadas, fechamento fictício ou lançamentos sem origem verificável.

---

# 16. FOLHA — P1

**Objetivo:** integrar competências e eventos de pessoal à gestão econômica da organização.

### Critérios obrigatórios

**FL-01 — Competências:** períodos de Folha possuem identidade e estado persistidos.

**FL-02 — Colaboradores:** vínculos devem utilizar cadastros autorizados, sem duplicar pessoas desnecessariamente.

**FL-03 — Eventos:** eventos de Folha devem possuir natureza, referência, competência e valores consistentes.

**FL-04 — Cálculo:** somente regras trabalhistas e contratuais implementadas e fundamentadas podem gerar valores definitivos.

**FL-05 — Processamento:** transições seguem o ciclo de vida definido pelo domínio.

**FL-06 — Aprovação:** decisões de aprovação e fechamento respeitam permissões e pré-condições.

**FL-07 — Histórico:** alterações, processamentos e reversões deixam rastreabilidade.

**FL-08 — Alocação:** custos podem ser vinculados às operações quando houver base e contrato econômico válidos.

**FL-09 — Financeiro:** obrigações originadas da Folha mantêm referência aos processamentos correspondentes.

**FL-10 — Contabilidade:** efeitos contábeis utilizam eventos autorizados e regras versionadas.

**FL-11 — Confidencialidade:** informações remuneratórias e pessoais somente aparecem a usuários autorizados.

**FL-12 — Consistência:** o mesmo processamento não pode gerar obrigações duplicadas.

### Prova obrigatória

Processar uma competência com regras suportadas, verificar histórico, obrigações financeiras, efeitos contábeis aplicáveis e restrições de acesso.

**Reprovação:** cálculo trabalhista presumido ou exposição indevida de dados remuneratórios.

---

# 17. RELATÓRIOS E BI — P1

**Objetivo:** fornecer análise empresarial baseada em dados autoritativos, com capacidade de investigação.

### Critérios obrigatórios

**BI-01 — Origem:** cada KPI possui fonte, regra, escopo e semântica identificáveis.

**BI-02 — Consistência:** os números devem reconciliar com consultas autorizadas aos domínios responsáveis.

**BI-03 — Paginação:** totais globais não podem ser derivados apenas da quantidade de linhas carregadas na página.

**BI-04 — Filtros:** filtros por período, unidade, situação e demais dimensões suportadas devem funcionar no backend.

**BI-05 — Drilldown:** indicadores navegáveis devem apresentar os registros que compõem o valor, respeitando escopo e autorização.

**BI-06 — Gráficos:** visualizações devem utilizar dados verdadeiros e unidades corretas.

**BI-07 — Comparações:** períodos precisam ser comparados segundo critérios consistentes.

**BI-08 — Atualização:** quando aplicável, mostrar data de referência ou atualização dos dados.

**BI-09 — Exportação:** exportar somente os registros e campos que o usuário pode consultar.

**BI-10 — Desempenho:** consultas analíticas devem usar paginação, índices ou projeções adequadas ao volume.

**BI-11 — Estados:** ausência de dados, erro de consulta e falta de autorização devem ser diferenciados.

**BI-12 — Visões salvas:** filtros e configurações persistentes devem ser recuperáveis conforme escopo.

**BI-13 — Rastreabilidade:** relatórios financeiros e contábeis devem preservar suas origens e definições.

**BI-14 — Responsividade:** gráficos, tabelas e filtros devem permanecer operáveis em desktop e mobile.

### Prova obrigatória

Selecionar um KPI, aplicar filtros, abrir o drilldown, confrontar o resultado com os registros originais e exportar o mesmo conjunto autorizado.

**Reprovação:** KPIs sem fonte, contagens de página exibidas como totais ou gráficos desconectados das transações.

---

# 18. CENÁRIOS DE TESTE OBRIGATÓRIOS PARA TODOS OS MÓDULOS

Os critérios anteriores deverão ser verificados também pelos seguintes cenários transversais.

| Cenário | Resultado obrigatório |
|---|---|
| Registro válido | Operação persiste corretamente |
| Dados inválidos | Backend rejeita sem mutação indevida |
| Usuário autorizado | Operação permitida |
| Usuário não autorizado | Acesso negado sem exposição de dados |
| Unidade não autorizada | Isolamento preservado |
| Consulta sem registros | Estado vazio correto |
| Consulta com filtros sem resultado | Estado vazio filtrado |
| Falha de API | Erro explícito, sem simular lista vazia |
| Resposta de busca desatualizada | Não substitui resultado recente |
| Conflito de versão | Retorno controlado e dados preservados |
| Operação repetida | Idempotência quando exigida |
| Atualização após comando | UI reflete estado persistido |
| Navegação entre módulos | Identidade e contexto preservados |
| Operação auditável | Histórico consistente |
| Consulta paginada | Total e páginas corretos |
| Uso em mobile | Ações e informações acessíveis |

Os cenários de concorrência e idempotência deverão ser aplicados às operações que possuam esses requisitos. Quando um cenário não se aplicar a determinado módulo, registrar justificativa técnica verificável.

---

# 19. ACEITE DAS JORNADAS TRANSVERSAIS

## JT-01 — SERVICE-TO-CASH

Comprovar a cadeia empresarial suportada:

Solicitação → Proposta → Contrato → OS → Planejamento → Execução → Medição → Aceite → Faturamento → Fiscal → Recebível → Tesouraria → Contabilidade.

**Critérios:** preservar referências, não duplicar transações, validar estados, reconciliar valores e permitir navegação entre objetos.

## JT-02 — PROCURE-TO-PAY

Comprovar:

Requisição → Aprovação → Pedido → Recebimento → Estoque/Despesa → Pagável → Pagamento → Contabilidade.

**Critérios:** preservar quantidades, valores, saldos, obrigações e referências econômicas.

## JT-03 — RESOURCE-TO-SERVICE

Comprovar:

Pessoa/Ativo/Frota → Disponibilidade → Alocação → OS → Execução → Custo → Histórico.

**Critérios:** verificar elegibilidade, conflitos, vínculo, utilização e custos autorizados.

## JT-04 — DOCUMENT-TO-EVIDENCE

Comprovar:

Documento → Versão → Associação → Operação empresarial → Evidência → Auditoria.

**Critérios:** preservar integridade, identidade, permissões e histórico.

## JT-05 — RECORD-TO-REPORT

Comprovar:

Transação → Persistência → Projeção → KPI → Relatório → Drilldown → Registro original.

**Critérios:** consistência numérica, filtros, autorização e rastreabilidade.

Cada jornada deverá possuir testes automatizados e evidência de homologação.

Uma jornada não será considerada aprovada somente porque seus endpoints existem.

---

# 20. CRITÉRIOS DE ACEITE VISUAL ERP TIER 1

Todo módulo deverá aplicar os padrões empresariais relevantes.

**SAP Fiori**

- List Reports.
- Object Pages.
- Hierarquia informacional.
- Tabelas empresariais.
- Filtragem.
- Ações de objeto.
- Navegação contextual.

**Dynamics 365**

- Workspaces orientados a funções.
- Filas acionáveis.
- Contagens consistentes.
- Visões salvas.
- Contexto operacional.
- Produtividade sem navegação excessiva.

**Oracle Redwood**

- Ações contextuais.
- Jornadas orientadas.
- Pré-condições explicativas.
- Interfaces adaptativas.
- Acessibilidade.

Não é obrigatório que cada módulo tenha todos os quatro tipos de página.

É obrigatório que cada fluxo utilize o padrão adequado e que a experiência seja consistente entre módulos.

Nenhum módulo poderá ser homologado com botões fictícios, indicadores sem fonte ou funcionalidades inacessíveis.

---

# 21. REGRAS DE COMPROVAÇÃO

Para cada critério de cada módulo, registrar obrigatoriamente:

**ID do critério:** por exemplo, OS-14.

**Implementação:** arquivo, função, endpoint ou contrato responsável.

**Persistência:** tabela ou entidade de domínio relacionada, quando houver.

**Teste:** nome do teste automatizado ou evidência de homologação.

**Resultado:** PASS, FAIL, BLOCKED ou NOT RUN.

**Referência:** commit, execução de CI ou evidência acessível.

**Observação:** somente quando necessária para descrever limitação ou dependência.

Não utilizar uma captura de tela como prova de integridade transacional.

Não utilizar teste unitário como prova de deploy em produção.

Não utilizar PR criado como prova de que o código foi integrado.

Não utilizar deploy concluído como prova de homologação funcional.

---

# 22. REGRA MATEMÁTICA DO ACEITE

A conclusão deve ser calculada por critérios obrigatórios, e não por estimativa subjetiva.

Para cada módulo:

**Cobertura implementada = critérios implementados ÷ critérios aplicáveis × 100.**

**Cobertura homologada = critérios homologados ÷ critérios aplicáveis × 100.**

Critérios não aplicáveis somente podem ser excluídos do denominador mediante justificativa técnica fundamentada e verificável.

Critérios bloqueados, não executados ou não comprovados não contam como aprovados.

Um módulo somente poderá receber a situação **100% HOMOLOGADO** quando:

1. Todos os seus critérios obrigatórios estiverem homologados.
2. As seis dimensões universais estiverem atendidas.
3. Seus testes transversais aplicáveis estiverem aprovados.
4. Seus vínculos com as jornadas empresariais estiverem comprovados.
5. Não existirem bloqueadores críticos.

**ACEITE GLOBAL DO MASTER 002:**

- Os 16 módulos homologados.
- As cinco jornadas transversais homologadas.
- Testes e gates obrigatórios aprovados.
- Um único PR integrado e incorporado.
- Release publicado por GHCR + Coolify.
- Validação autenticada em produção aprovada.

Não considerar o projeto integralmente concluído antes desses resultados.

---

# 23. ORDEM EXECUTIVA DE APLICAÇÃO

**ESTE ANEXO INTEGRA O MASTER 002 E PASSA A SER SEU CONTRATO DE ACEITE FUNCIONAL.**

A partir de agora:

1. Avalie cada módulo conforme seus critérios identificados.
2. Reutilize capacidades existentes comprovadamente corretas.
3. Implemente os critérios ainda não atendidos.
4. Corrija os critérios implementados de forma incorreta.
5. Integre as operações entre módulos.
6. Execute os testes.
7. Registre evidências objetivas.
8. Avance automaticamente para as demais lacunas durante a sessão ativa.
9. Não trate módulos isolados como entregas finais.
10. Não declare conclusão sem o aceite global.

**NÃO SUBSTITUA ESTA MATRIZ POR RESUMOS GENÉRICOS.**

**NÃO REDUZA OS CRITÉRIOS PARA FACILITAR A APROVAÇÃO.**

**NÃO APRESENTE DOCUMENTAÇÃO COMO FUNCIONALIDADE IMPLEMENTADA.**

**NÃO UTILIZE PERCENTUAIS PRESUMIDOS.**

**NÃO CONFUNDA CÓDIGO ESCRITO COM SISTEMA HOMOLOGADO.**

A responsabilidade técnica é produzir uma solução integrada e demonstrar, com evidências verificáveis, que cada critério obrigatório foi atendido.

**ORDEM FINAL: EXECUTE O MASTER 002 UTILIZANDO ESTA MATRIZ COMO CONDIÇÃO FORMAL DE ACEITE DOS 16 MÓDULOS.**
