import { TECHNICAL_ALERT_TYPES, type TechnicalAlertRunbook } from './technical-alert.types';

export const TECHNICAL_ALERT_RUNBOOKS: Partial<
  Record<(typeof TECHNICAL_ALERT_TYPES)[keyof typeof TECHNICAL_ALERT_TYPES], TechnicalAlertRunbook>
> = {
  [TECHNICAL_ALERT_TYPES.HighErrorRate]: {
    meaning: 'Taxa de erro HTTP acima do limiar sustentado.',
    possibleCauses: ['Deploy recente com regressão', 'Dependência indisponível', 'Pico de carga'],
    firstChecks: ['Verificar logs estruturados por errorCode', 'Checar readiness do banco', 'Revisar deploy recente'],
    safeAction: 'Escalar réplicas se carga; reverter deploy se regressão confirmada.',
    escalation: 'Acionar engenharia se erro >10% por >5 min.',
  },
  [TECHNICAL_ALERT_TYPES.HighLatencyP99]: {
    meaning: 'Latência p99 HTTP degradada de forma sustentada.',
    possibleCauses: ['Queries lentas', 'Pool DB saturado', 'Integração externa lenta'],
    firstChecks: ['Verificar métricas DB latency', 'Checar pool waiting', 'Identificar endpoints mais lentos nos logs'],
    safeAction: 'Reduzir carga não crítica; investigar queries sem matar processos.',
    escalation: 'DBA/SRE se p99 >3x baseline por >5 min.',
  },
  [TECHNICAL_ALERT_TYPES.DbConnectionSaturation]: {
    meaning: 'Conexões aguardando no pool PostgreSQL.',
    possibleCauses: ['Pool pequeno', 'Queries longas', 'Leak de conexão'],
    firstChecks: ['pool.waiting e pool.idle', 'pg_stat_activity', 'Deploy recente'],
    safeAction: 'Não reiniciar API em massa; reduzir workers concorrentes se necessário.',
    escalation: 'DBA se waiting persiste >2 min.',
  },
  [TECHNICAL_ALERT_TYPES.WorkerStalled]: {
    meaning: 'Fila de jobs cresce sem processamento.',
    possibleCauses: ['Worker parado', 'Jobs travados', 'Lease expirado sem recovery'],
    firstChecks: ['Processo worker ativo', 'plt.background_jobs pendentes', 'Logs do worker'],
    safeAction: 'Reiniciar worker; não limpar fila sem análise.',
    escalation: 'Plataforma se backlog >1h sem consumo.',
  },
  [TECHNICAL_ALERT_TYPES.BillingReceivableHandoffFailure]: {
    meaning: 'Falha na integridade do Service-to-Cash: Nota Fatura finalizada sem recebível, ou job financeiro sem recuperação automática.',
    possibleCauses: ['Port financeiro indisponível', 'Worker parado ou dead-letter', 'Documento legado sem job de recuperação'],
    firstChecks: ['Consultar GET /observability/metrics (diagnóstico autorizado)', 'Consultar plt.background_jobs por billing receivable handoff e status', 'Conferir Nota Fatura e título pelo comando autorizado'],
    safeAction: 'Não emitir outra Nota Fatura nem criar título manualmente. Investigar e reexecutar o job com a mesma chave idempotente sob procedimento autorizado.',
    escalation: 'Financeiro + engenharia imediatamente, com documento e correlationId.',
  },
  [TECHNICAL_ALERT_TYPES.OutboxBacklog]: {
    meaning: 'Eventos outbox acumulados além do limiar.',
    possibleCauses: ['Publisher parado', 'Falhas de publicação', 'DB lento'],
    firstChecks: ['Worker outbox', 'evt.outbox_events pendentes', 'last_error nos eventos'],
    safeAction: 'Reiniciar publisher worker; investigar falhas antes de reprocessar em massa.',
    escalation: 'Plataforma se backlog impacta integrações.',
  },
  [TECHNICAL_ALERT_TYPES.StorageFailure]: {
    meaning: 'Falhas ao ler/gravar objetos no storage.',
    possibleCauses: ['Disco cheio', 'Permissões', 'Path inválido'],
    firstChecks: ['OBJECT_STORAGE_ROOT', 'Espaço em disco', 'Logs storage failure'],
    safeAction: 'Liberar espaço; não apagar objetos sem backup.',
    escalation: 'Infra imediata se uploads críticos bloqueados.',
  },
  [TECHNICAL_ALERT_TYPES.ErpFailures]: {
    meaning: 'Mensagens ERP na inbox em estado FAILED.',
    possibleCauses: ['ERP indisponível', 'Credencial expirada', 'Payload inválido'],
    firstChecks: ['int.integration_inbox FAILED por provider ERP', 'Circuit breaker', 'Logs ACL'],
    safeAction: 'Pausar reprocessamento em massa; corrigir credencial.',
    escalation: 'Integrações + negócio se faturamento bloqueado.',
  },
  [TECHNICAL_ALERT_TYPES.BackupFailure]: {
    meaning: 'Último status de backup reportado como falha.',
    possibleCauses: ['Job de backup falhou', 'Destino indisponível', 'Credencial expirada'],
    firstChecks: ['TECH_BACKUP_LAST_STATUS', 'Logs do job de backup', 'Espaço no destino'],
    safeAction: 'Disparar backup manual após corrigir causa; não sobrescrever último backup bom.',
    escalation: 'Infra + DBA imediato — risco de perda de dados.',
  },
  [TECHNICAL_ALERT_TYPES.DiskResourceExhaustion]: {
    meaning: 'Uso de disco no volume de storage acima do limiar.',
    possibleCauses: ['Crescimento de documentos', 'Logs locais', 'Backups no mesmo volume'],
    firstChecks: ['df no host', 'OBJECT_STORAGE_ROOT', 'Crescimento recente'],
    safeAction: 'Liberar espaço seguro; expandir volume se planejado.',
    escalation: 'Infra antes de atingir 100%.',
  },
};
