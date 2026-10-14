import type { ReactNode } from 'react';
import { cn } from '../ui/utils/cn';

/**
 * CAPACIDADE NAO PUBLICADA — a declaracao honesta de profundidade ausente.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O DEFEITO QUE ISTO EXISTE PARA IMPEDIR
 *
 * Uma object page profunda (Cliente 360, Contrato 360, OS 360) promete uma leitura: identidade,
 * situacao, contexto, relacoes, processo, comandos. Quando uma dessas camadas NAO tem fonte real no
 * servidor, existem tres caminhos e so um e honesto:
 *
 *   1. INVENTAR — derivar "OS relacionadas" filtrando por cliente e chamar de vinculo do contrato.
 *      Isto e dado empresarial falso, e o operador decide em cima dele.
 *   2. ESCONDER — apagar a secao. O operador nao sabe se o contrato nao tem OS ou se o produto nao
 *      sabe responder; ele conclui a primeira, que e a leitura errada e cara.
 *   3. DECLARAR — dizer que a camada existe no vocabulario do dominio e que a leitura NAO esta
 *      publicada, nomeando o que falta.
 *
 * Este primitivo implementa (3). Ele nao e um placeholder cinza decorativo: ele e uma AFIRMACAO
 * VERDADEIRA sobre o contrato de leitura, e o `reason` diz exatamente por que a camada nao aparece.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ELE NAO E UM `EmptyState`
 *
 * `EmptyState` significa "o conjunto existe e esta vazio" — uma resposta sobre o NEGOCIO. Aqui a
 * resposta e sobre a LEITURA: o dado pode existir no banco e nao estar publicado nesta superficie.
 * Confundir os dois faz o operador procurar um cadastro que ja existe.
 *
 * A regra do contrato de arquitetura: se o banco possui o fato, o backend publica; se nao existe,
 * o frontend DECLARA indisponivel. Este componente e o segundo caso, e ele nunca vira um "0".
 */

export type UnavailableCapabilityProps = {
  /** O nome da camada no vocabulario do dominio ("Ordens de serviço relacionadas"). */
  title: string;
  /**
   * POR QUE a camada nao esta publicada. Deve nomear o fato ausente — nao usar "indisponível" solto,
   * que nao ajuda o operador nem quem for fechar a lacuna depois.
   */
  reason: string;
  /** O que fazer enquanto isso. Opcional: um caminho real, nunca uma promessa. */
  children?: ReactNode;
  /** Tom mais discreto quando a ausencia e estrutural (nao um erro de leitura). */
  className?: string;
};

export function UnavailableCapability({
  title,
  reason,
  children,
  className,
}: UnavailableCapabilityProps) {
  return (
    <section
      aria-label={`${title} — não publicada`}
      className={cn(
        'rounded-[3px] border border-dashed border-[color:var(--color-border-strong)]',
        'bg-[color:var(--color-surface-muted)] px-3 py-2.5',
        className,
      )}
      data-capability="unavailable"
    >
      <h3 className="cisne-meta-label m-0">{title}</h3>
      <p className="m-0 mt-1 text-[12px] text-[color:var(--color-text-secondary)]">{reason}</p>
      {children ? <div className="mt-1.5 text-[12px]">{children}</div> : null}
    </section>
  );
}
