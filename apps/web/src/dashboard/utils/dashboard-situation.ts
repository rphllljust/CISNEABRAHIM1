import type { ExecutiveAttentionItem, ExecutiveDashboardSnapshot } from '../types/dashboard.types';
import { attentionLabelFor, sortAttentionBySeverity, type ScopedAttention } from './dashboard-semantics';

/**
 * SITUATION HANDLING — o estado operacional do recorte, com a ORIGEM da afirmacao.
 *
 * Esta camada existe para eliminar uma mentira de apresentacao que estava na tela: um banner verde
 * dizendo "Operação sem exceções críticas" era renderizado sempre que a LISTA de excecoes vinha
 * vazia — inclusive quando o servidor simplesmente NAO publicou aquela excecao para o periodo.
 * Lista vazia de uma fonte ausente nao e operacao normal.
 *
 * QUATRO ESTADOS, e a diferenca entre eles e o ponto:
 *
 *   `critical`  o servidor publicou excecao critica dentro do recorte;
 *   `warning`   o servidor publicou excecao de atencao, sem nenhuma critica;
 *   `normal`    o servidor AVALIOU o recorte e publicou ZERO excecoes;
 *   `unknown`   o servidor NAO publicou avaliacao para (parte de) o recorte. Nunca e "normal".
 *
 * `unknown` e o estado que faltava. Ele nao e um erro e nao e um alarme: e a declaracao honesta de
 * que a tela nao tem base para concluir nada sobre aquele recorte.
 *
 * REGRA DE ESCOPO DO VERDE: `normal` exige um recorte em que TODAS as fontes de excecao aplicaveis
 * tenham sido publicadas. No recorte sem filtro ("Tudo"), a base de avaliacao e o proprio conjunto
 * de excecoes publicado pelo servidor — vazio ali significa que o executor nao publicou nenhuma
 * excecao, e a tela diz exatamente isso, sem generalizar para "a operacao esta normal".
 */

export type SituationLevel = 'critical' | 'warning' | 'normal' | 'unknown';

export type OperationalSituation = {
  level: SituationLevel;
  /** Titulo curto — o fato, em uma linha. */
  title: string;
  /** Frase de contexto: de onde vem a conclusao (ou por que ela nao existe). */
  detail: string;
  /** Numero de excecoes criticas publicadas no recorte. */
  criticalCount: number;
  /** Numero de excecoes de atencao publicadas no recorte. */
  warningCount: number;
  /** Excecoes criticas publicadas — usadas como acao direta do bloco. */
  criticalItems: ExecutiveAttentionItem[];
};

/** Quantas excecoes o recorte alcanca mas o snapshot nao publicou. */
function unknownReason(notEvaluated: string[]): string {
  return notEvaluated.map(attentionLabelFor).join(', ');
}

export function buildOperationalSituation(
  snapshot: ExecutiveDashboardSnapshot,
  scope: ScopedAttention,
): OperationalSituation {
  const ordered = sortAttentionBySeverity(scope.items);
  const criticalItems = ordered.filter((item) => item.severity === 'critical');
  const warningCount = ordered.filter((item) => item.severity === 'warning').length;
  const criticalCount = criticalItems.length;

  if (criticalCount > 0) {
    return {
      level: 'critical',
      title:
        criticalCount === 1
          ? '1 exceção crítica exige decisão agora'
          : `${criticalCount} exceções críticas exigem decisão agora`,
      detail: 'Publicadas pelo servidor para o escopo e o período autorizados. Mais urgente primeiro.',
      criticalCount,
      warningCount,
      criticalItems,
    };
  }

  if (warningCount > 0) {
    /*
     * ATENCAO NAO ESCONDE A AUSENCIA. Quando existe pendencia publicada E fonte nao avaliada, o
     * nivel e `warning` (o fato conhecido tem precedencia sobre a lacuna), mas o texto DIZ as duas
     * coisas: declarar so a pendencia faria o operador acreditar que o quadro esta completo.
     */
    const gaps =
      scope.notEvaluated.length > 0
        ? ` O servidor também não publicou avaliação para ${unknownReason(scope.notEvaluated)}.`
        : '';
    return {
      level: 'warning',
      title:
        warningCount === 1
          ? '1 ponto de atenção no recorte'
          : `${warningCount} pontos de atenção no recorte`,
      detail: `Nenhuma exceção crítica publicada; há pendências de acompanhamento.${gaps}`,
      criticalCount,
      warningCount,
      criticalItems,
    };
  }

  if (scope.notEvaluated.length > 0) {
    return {
      level: 'unknown',
      title: 'Situação parcialmente indisponível',
      detail:
        `O servidor não publicou avaliação para ${unknownReason(scope.notEvaluated)} neste recorte. ` +
        'Ausência de publicação não é ausência de pendência — trate como desconhecido.',
      criticalCount,
      warningCount,
      criticalItems,
    };
  }

  return {
    level: 'normal',
    title: 'Nenhuma exceção crítica publicada',
    detail:
      'O servidor avaliou as fontes de exceção deste recorte e não publicou pendência crítica ' +
      'para o período e o escopo autorizados.',
    criticalCount,
    warningCount,
    criticalItems,
  };
}

/**
 * FRASE DE SITUACAO CURTA — para a faixa compacta do cabecalho.
 *
 * Ela responde "como esta o recorte" em uma expressao, e nunca promete mais do que o estado
 * `unknown` permite: quando o estado e `unknown`, a faixa diz "situação parcial".
 */
export function situationBadgeLabel(situation: OperationalSituation): string {
  switch (situation.level) {
    case 'critical':
      return 'Ação imediata';
    case 'warning':
      return 'Atenção';
    case 'unknown':
      return 'Situação parcial';
    default:
      return 'Sem exceções críticas';
  }
}
