import { useEffect, useState } from 'react';
import { checkClientDuplicates, ClientsApiError } from '../api/clients-api';
import type { ClientDuplicateCheck } from '../types/client.types';

/**
 * CONSULTA PRÉVIA DE DUPLICIDADE NO CADASTRO.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA LIGAÇÃO MUDA
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A API `GET /clients/duplicate-check` existia e estava validada, mas nenhuma tela a consumia: o
 * operador podia cadastrar dois registros da mesma empresa e só descobria pelo 409 de CNPJ — e
 * APENAS quando o documento era idêntico. Duplicidade com documento digitado errado passava em
 * silêncio.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * PROVA X SUSPEITA — E POR QUE A DISTINÇÃO GOVERNA O COMPORTAMENTO
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * O servidor classifica cada candidato:
 *
 *  - `certain: true`  — coincide DOCUMENTO ou REFERÊNCIA EXTERNA. É prova de que é o mesmo
 *    Cliente. A criação é BLOQUEADA aqui: insistir produziria um registro duplicado com dois
 *    históricos paralelos, que ninguém funde depois.
 *  - `certain: false` — coincide apenas o NOME. É SUSPEITA. NÃO bloqueia: duas empresas distintas
 *    podem ter o mesmo nome, e bloquear por semelhança ensinaria o operador a contornar o aviso.
 *    Ele vê os candidatos e DECIDE.
 *
 * A decisão de duplicidade é do SERVIDOR (normalização, sinais, força da evidência). Este hook
 * apenas transporta o veredito — não reimplementa comparação de nome, e não "melhora" a
 * classificação com heurística local.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * DISPARO: SÓ COM SINAL REAL, E NUNCA A CADA TECLA
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A consulta só parte quando há ALGO para comparar: CNPJ com 14 dígitos OU razão social com pelo
 * menos 3 caracteres. Disparar a cada tecla produziria uma requisição por caractere para comparar
 * contra uma base inteira, e o resultado chegaria fora de ordem. O debounce e a checagem de
 * obsolescência resolvem a corrida: a resposta de um termo antigo não sobrescreve a do atual.
 */

export const DUPLICATE_CHECK_DEBOUNCE_MS = 400;

/** Piso de razão social: abaixo disso o nome é ruído e não gera sinal útil. */
const MIN_NAME_LENGTH = 3;

const CNPJ_LENGTH = 14;

export type DuplicateCheckPhase = 'idle' | 'checking' | 'ready' | 'error';

export type DuplicateCheckState = {
  phase: DuplicateCheckPhase;
  result: ClientDuplicateCheck | null;
  /** `true` quando há coincidência PROVADA — a criação deve ser bloqueada. */
  blocking: boolean;
};

const IDLE: DuplicateCheckState = { phase: 'idle', result: null, blocking: false };

/** Há sinal suficiente para valer uma consulta? */
export function hasDuplicateSignal(input: { legalName: string; taxId: string }): boolean {
  const digits = input.taxId.replace(/\D/g, '');
  if (digits.length === CNPJ_LENGTH) {
    return true;
  }
  return input.legalName.trim().length >= MIN_NAME_LENGTH;
}

export function useClientDuplicateCheck(input: {
  legalName: string;
  tradeName: string;
  taxId: string;
  externalErpId: string;
  /** Desligado quando o formulário não está em criação (ex.: edição de um Cliente existente). */
  enabled: boolean;
}): DuplicateCheckState {
  const [state, setState] = useState<DuplicateCheckState>(IDLE);

  const { legalName, tradeName, taxId, externalErpId, enabled } = input;

  useEffect(() => {
    if (!enabled || !hasDuplicateSignal({ legalName, taxId })) {
      setState(IDLE);
      return;
    }

    const controller = new AbortController();
    // Marca de obsolescência: a resposta de um termo ANTIGO não pode sobrescrever a do atual.
    let superseded = false;
    setState((current) => ({ ...current, phase: 'checking' }));

    const timer = setTimeout(() => {
      void checkClientDuplicates(
        {
          legalName: legalName.trim() || undefined,
          tradeName: tradeName.trim() || undefined,
          taxId: taxId.replace(/\D/g, '') || undefined,
          externalErpId: externalErpId.trim() || undefined,
        },
        controller.signal,
      )
        .then((result) => {
          if (superseded || controller.signal.aborted) {
            return;
          }
          setState({
            phase: 'ready',
            result,
            // Bloqueia SOMENTE com prova. Suspeita é aviso, e o operador decide.
            blocking: result.certainCount > 0,
          });
        })
        .catch((error: unknown) => {
          if (superseded || controller.signal.aborted) {
            return;
          }
          /*
           * FALHA NA CONSULTA NÃO BLOQUEIA O CADASTRO.
           *
           * Sem permissão de lista (403) ou com a rede fora, a única coisa que a UI sabe é que NÃO
           * CONSULTOU. Bloquear aqui impediria um cadastro legítimo por causa de uma checagem
           * acessória; liberar e declarar a falha deixa a decisão com quem pode decidir. O servidor
           * continua barrando o CNPJ idêntico no INSERT (409).
           */
          setState({
            phase: 'error',
            result: null,
            blocking: false,
          });
          void error;
        });
    }, DUPLICATE_CHECK_DEBOUNCE_MS);

    return () => {
      superseded = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, legalName, tradeName, taxId, externalErpId]);

  return state;
}

/** Erro de duplicidade provada vindo do próprio INSERT (409), para o caso de corrida. */
export function isTaxIdConflict(error: unknown): boolean {
  return error instanceof ClientsApiError && error.kind === 'tax_id_conflict';
}
