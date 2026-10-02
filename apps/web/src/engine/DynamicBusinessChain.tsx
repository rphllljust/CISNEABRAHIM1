/**
 * BUSINESS CHAIN — linhagem de negócio, renderizada pela engine.
 *
 * CANÔNICA: `business-chain/BusinessChain.tsx` (a versão que modela a cadeia como DADO).
 * Descartada: `operator/business-chain/BusinessChain.tsx`, porque fixa os 11 degraus do domínio
 * (`CHAIN_STEPS`) dentro do componente — vocabulário de negócio dentro da engine, que é
 * exatamente o que esta camada existe para não ter.
 *
 * A engine não conhece degrau algum: recebe os NÓS e desenha. `kind` é rótulo opaco, `relation`
 * decide o destaque, `route` decide se é link. Uma cadeia de 3 ou de 30 nós funciona igual.
 *
 * REGRA DE HONESTIDADE herdada da implementação canônica: nó sem vínculo persistido NÃO é
 * afirmado — não aparece como "pendente" nem como "sem dados". Relação não inventada.
 */
export type ChainNode = {
  /** Natureza do nó, na linguagem do domínio (ex.: "OS", "Recebível"). Rótulo opaco. */
  kind: string;
  /** Identificador estável, para `key`. */
  id: string;
  /** Referência HUMANA (código/nome), nunca UUID cru quando houver código. */
  businessReference: string;
  /** Rota autorizada. Ausente = nó informativo, não link. */
  route?: string;
  /** Estado persistido, exibido cru quando a tela não traduz. */
  status?: string;
  /** Relação com o registro em foco: raiz ou derivado. */
  relation?: 'ROOT' | 'RESULT' | 'ORIGIN' | string;
  /** Resumo humano opcional. */
  summary?: string;
  /** Instante ISO do fato. */
  occurredAt?: string;
};

export type DynamicBusinessChainProps = {
  /** Nós JÁ ordenados pela tela — a engine não conhece a ordem do domínio. */
  nodes: ChainNode[];
  title?: string;
  /** Fase de carregamento, quando a tela busca a cadeia. Ausente = pronta. */
  phase?: 'idle' | 'loading' | 'denied' | 'error' | 'ready';
  message?: string | null;
  onRetry?: () => void;
};

export function DynamicBusinessChain({
  nodes,
  title = 'Cadeia de negócio',
  phase = 'ready',
  message = null,
  onRetry,
}: DynamicBusinessChainProps): React.ReactElement {
  if (phase === 'idle' || phase === 'loading') {
    return (
      <section data-testid="dynamic-business-chain" data-chain-phase="loading">
        <ChainHeader title={title} />
        <p className="text-sm text-gray-500" role="status" aria-busy="true">
          Carregando a linhagem deste registro…
        </p>
      </section>
    );
  }

  if (phase === 'denied') {
    // A cadeia inteira foi negada: não existe meia-verdade a apresentar.
    return (
      <section data-testid="dynamic-business-chain" data-chain-phase="denied">
        <ChainHeader title={title} />
        <p className="text-sm text-gray-500" role="status">
          Você não tem permissão para ver a linhagem deste registro.
        </p>
      </section>
    );
  }

  if (phase === 'error') {
    return (
      <section data-testid="dynamic-business-chain" data-chain-phase="error">
        <ChainHeader title={title} />
        <p className="text-sm text-gray-500" role="status">
          {message ?? 'Não foi possível carregar a cadeia deste registro.'}
        </p>
        {onRetry ? (
          <button type="button" className="mt-2 text-sm underline" onClick={onRetry}>
            Tentar novamente
          </button>
        ) : null}
      </section>
    );
  }

  /*
   * Cadeia de UM nó é um registro sem linhagem registrada — não é erro e não vira placeholder
   * com passos inventados.
   */
  if (nodes.length <= 1) {
    return (
      <section data-testid="dynamic-business-chain" data-chain-phase="single">
        <ChainHeader title={title} />
        <p className="text-sm text-gray-500" role="status">
          Este registro não tem linhagem registrada além dele mesmo.
        </p>
      </section>
    );
  }

  return (
    <section data-testid="dynamic-business-chain" data-chain-phase="ready">
      <ChainHeader title={title} />
      <ol className="m-0 flex list-none flex-col gap-1 p-0" aria-label={title}>
        {nodes.map((node) => (
          <li
            key={`${node.kind}:${node.id}`}
            data-testid="dynamic-chain-node"
            data-chain-phase={node.kind}
            data-chain-relation={node.relation ?? null}
            className={
              node.relation === 'ROOT'
                ? 'rounded border border-slate-300 bg-slate-50 p-2'
                : 'border-l-2 border-slate-200 py-1 pl-3'
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-slate-500">{node.kind}</span>
              {node.route ? (
                <a className="text-sm font-medium underline" href={node.route}>
                  {node.businessReference}
                </a>
              ) : (
                <span className="text-sm font-medium">{node.businessReference}</span>
              )}
              {node.status ? (
                <span
                  data-chain-status={node.status}
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]"
                >
                  {node.status}
                </span>
              ) : null}
              {node.relation && node.relation !== 'ROOT' ? (
                <span className="text-xs text-slate-500">{node.relation}</span>
              ) : null}
            </div>
            {node.summary || node.occurredAt ? (
              <p className="mt-0.5 text-xs text-slate-600">
                {node.summary ?? ''}
                {node.summary && node.occurredAt ? ' · ' : ''}
                {node.occurredAt ?? ''}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ChainHeader({ title }: { title: string }): React.ReactElement {
  return <h2 className="mb-2 text-sm font-semibold">{title}</h2>;
}

/**
 * Ordena os nós pela relação declarada.
 *
 * ROOT vem primeiro (é o registro em foco na linhagem); o resto mantém a ordem em que a TELA
 * os entregou — a engine não tem como saber a sequência do domínio e não a inventa.
 */
export function orderChainNodes(nodes: readonly ChainNode[]): ChainNode[] {
  const root = nodes.filter((node) => node.relation === 'ROOT');
  const rest = nodes.filter((node) => node.relation !== 'ROOT');
  return [...root, ...rest];
}
