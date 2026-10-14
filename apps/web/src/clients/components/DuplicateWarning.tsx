import { Link } from 'react-router-dom';
import {
  CLIENT_DUPLICATE_REASONS,
  type ClientDuplicateCheck,
  type ClientDuplicateMatch,
  type ClientDuplicateReason,
} from '../types/client.types';
import { formatCnpjDisplay } from '../utils/format-cnpj';
import { StatusBadge } from '../../ui/StatusBadge';
import type { DuplicateCheckState } from '../hooks/useClientDuplicateCheck';

/**
 * AVISO DE DUPLICIDADE NO CADASTRO.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * DUAS SITUAÇÕES, DUAS POSTURAS
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * PROVÁVEL DUPLICIDADE (`certain`) — documento ou referência externa coincidem. O cadastro é
 * BLOQUEADO e o caminho oferecido é ABRIR o Cliente existente. Criar um segundo registro da mesma
 * empresa produziria dois históricos paralelos que ninguém funde depois: contratos, títulos e
 * atendimento ficariam divididos entre duas identidades.
 *
 * POSSÍVEL DUPLICIDADE (suspeita) — apenas o nome coincide. É AVISO, não bloqueio: empresas
 * distintas podem legitimamente ter o mesmo nome, e bloquear por semelhança ensinaria o operador a
 * contornar o aviso. Ele vê os candidatos e decide.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * NUNCA HÁ FUNDIÇÃO AUTOMÁTICA
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Nenhum caminho aqui mescla registros. Fundir dois cadastros move contratos, títulos e histórico
 * entre identidades — operação irreversível que precisa de decisão humana explícita e de um comando
 * próprio, que esta tela não possui nem inventa.
 *
 * O CNPJ dos candidatos é exibido FORMATADO e vindo do servidor: a tela não recalcula nem
 * "completa" documento a partir do que o operador digitou.
 */

/** Rótulo humano da razão do sinal — o código do servidor nunca aparece na tela. */
function duplicateReasonLabel(reason: ClientDuplicateReason): string {
  switch (reason) {
    case CLIENT_DUPLICATE_REASONS.TaxIdMatch:
      return 'mesmo CNPJ';
    case CLIENT_DUPLICATE_REASONS.ExternalReferenceMatch:
      return 'mesma referência externa';
    case CLIENT_DUPLICATE_REASONS.LegalNameMatch:
      return 'mesma razão social';
    case CLIENT_DUPLICATE_REASONS.TradeNameMatch:
      return 'mesmo nome fantasia';
    default:
      return reason;
  }
}

function reasonSummary(match: ClientDuplicateMatch): string {
  return match.reasons.map(duplicateReasonLabel).join(', ');
}

export type DuplicateWarningProps = {
  state: DuplicateCheckState;
  /** Abrir o Cliente existente é permitido? Sem `ClientRead`, o link não é oferecido. */
  canRead: boolean;
};

export function DuplicateWarning({ state, canRead }: DuplicateWarningProps) {
  if (state.phase === 'idle' || state.phase === 'checking') {
    return null;
  }

  /*
   * FALHA NA CONSULTA É DECLARADA, NÃO SILENCIADA.
   *
   * A ausência de aviso seria indistinguível de "consultei e não há duplicidade". O operador
   * precisa saber que a checagem NÃO rodou para decidir com mais cuidado — e o servidor continua
   * barrando o CNPJ idêntico no INSERT.
   */
  if (state.phase === 'error') {
    return (
      <p
        className="cisne-type-helper m-0"
        role="status"
        data-testid="duplicate-check-unavailable"
      >
        Não foi possível verificar duplicidade agora. O cadastro continua permitido, e o servidor
        ainda recusa um CNPJ já existente.
      </p>
    );
  }

  const result: ClientDuplicateCheck | null = state.result;
  if (!result || result.matches.length === 0) {
    return null;
  }

  const certain = result.matches.filter((match) => match.certain);
  const suspected = result.matches.filter((match) => !match.certain);

  return (
    <div className="flex flex-col gap-2" data-testid="duplicate-warning">
      {certain.length > 0 ? (
        <section
          role="alert"
          data-testid="duplicate-certain"
          className="border-l-[3px] border-l-red-500 bg-red-50/60 px-3 py-2"
        >
          <p className="cisne-type-primary m-0">Cliente já existente</p>
          <p className="cisne-type-helper m-0 mt-0.5">
            {certain.length === 1
              ? 'Há um cadastro com o mesmo documento ou a mesma referência externa.'
              : `Há ${certain.length} cadastros com o mesmo documento ou a mesma referência externa.`}{' '}
            Cadastrar novamente dividiria contratos, títulos e atendimento entre duas identidades.
          </p>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
            {certain.map((match) => (
              <DuplicateMatchRow key={match.id} match={match} canRead={canRead} />
            ))}
          </ul>
        </section>
      ) : null}

      {suspected.length > 0 ? (
        <section
          data-testid="duplicate-suspected"
          className="border-l-[3px] border-l-amber-500 bg-amber-50/60 px-3 py-2"
        >
          <p className="cisne-type-primary m-0">Possível cliente já cadastrado</p>
          <p className="cisne-type-helper m-0 mt-0.5">
            {suspected.length === 1
              ? 'Há um cadastro parecido. Confira antes de continuar — se não for o mesmo, o cadastro é permitido.'
              : `Há ${suspected.length} cadastros parecidos. Confira antes de continuar — se não forem o mesmo, o cadastro é permitido.`}
          </p>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
            {suspected.map((match) => (
              <DuplicateMatchRow key={match.id} match={match} canRead={canRead} />
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        A REGRA É DITA UMA VEZ, EM TEXTO, E NÃO DEDUZIDA DA COR. Quem usa leitor de tela precisa
        saber que houve aviso e qual é o efeito dele sobre o cadastro.
      */}
      <p className="cisne-type-helper m-0">
        {state.blocking
          ? 'O cadastro está bloqueado enquanto houver coincidência de documento.'
          : 'Você pode continuar o cadastro se nenhum candidato for o mesmo cliente.'}
      </p>
    </div>
  );
}

function DuplicateMatchRow({
  match,
  canRead,
}: {
  match: ClientDuplicateMatch;
  canRead: boolean;
}) {
  return (
    <li
      data-testid="duplicate-candidate"
      data-candidate-certain={match.certain}
      className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-white/70 pb-1 last:border-b-0 last:pb-0"
    >
      <span className="cisne-type-meta min-w-0 font-semibold break-words">{match.legalName}</span>
      <span className="cisne-type-helper font-mono tabular-nums">
        {formatCnpjDisplay(match.normalizedTaxId)}
      </span>
      {match.status === 'INACTIVE' ? <StatusBadge label="Inativo" tone="error" /> : null}
      <span className="cisne-type-helper w-full">
        Sinal: {reasonSummary(match)} · {match.certain ? 'coincidência provada' : 'suspeita'}
      </span>
      {canRead ? (
        <Link
          to={`/app/clients/${match.id}`}
          className="cisne-type-action text-brand-700 no-underline hover:underline"
        >
          Abrir cliente
        </Link>
      ) : null}
    </li>
  );
}
