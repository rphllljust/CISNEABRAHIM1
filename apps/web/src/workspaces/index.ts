/**
 * CISNE — WORKSPACES DE DOMINIO
 *
 * Superficies de decisao por dominio empresarial, montadas sobre a MESMA fila de trabalho
 * (`GET /work-inbox`) que abastece a Central de trabalho. Nenhum numero nasce aqui: a zona AGORA
 * le `byDomain[domain]` do read model e a zona ATENCAO le o mesmo read model recortado por
 * natureza (BLOCKER/EXCEPTION).
 *
 * Limites deliberados:
 * - Nao existe contador paralelo: contar itens no browser seria a segunda verdade da mesma fila.
 * - Nao existe urgencia inventada: sem score, sem estimativa, sem gradiente.
 * - Dominio indisponivel, negado ou com falha de rede e DITO — nunca convertido em zero.
 */

export { DomainWorkZones } from './components/DomainWorkZones';
export { WorkspaceZone } from './components/WorkspaceZone';
export { DomainWorkspacePage } from './pages/DomainWorkspacePage';
export { WorkspacesIndexPage } from './pages/WorkspacesIndexPage';
export {
  DOMAIN_WORKSPACES,
  DOMAIN_WORKSPACE_PATHS,
  type DomainWorkspaceConfig,
  type WorkspaceShortcut,
} from './domain-workspaces';
export {
  useDomainWork,
  type AttentionGap,
  type DomainWorkState,
  type WorkZonePhase,
} from './api/use-domain-work';
