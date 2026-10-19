import { useId, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  createServiceOrder,
  listServiceOrderOperationalUnits,
  SERVICE_ORDER_ORIGINS,
  ServiceOrdersApiError,
  type CreateServiceOrderPayload,
  type ServiceOrderOrigin,
} from '../api/service-orders-api';
import { useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import { HumanLookupField } from '../../financial-ui/HumanLookupField';
import { Button, Field, Input, ModulePage, ModulePageHeader, Textarea } from '../../ui';
import { cn } from '../../ui/utils/cn';
import {
  searchClientsForLookup,
  searchProposalsForLookup,
  searchPurchaseOrdersForLookup,
} from '../utils/service-order-relation-lookup';

/**
 * NOVA ORDEM DE SERVIÇO — SUPERFÍCIE DE CRIAÇÃO GOVERNADA.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA TELA SUBSTITUI
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Antes, "Nova OS" abria um `DynamicCreateForm` INLINE sobre a worklist, e o envio era recusado
 * pela própria tela com a mensagem "a ordem nasce de uma solicitação aprovada ou proposta aceita.
 * Abra a origem e converta." — ou seja, o formulário existia para não funcionar.
 *
 * O CONTRATO DO SERVIDOR DIZ OUTRA COISA. Lendo `validateCreateServiceOrderInput`:
 *
 *   - `SERVICE_REQUEST` é REJEITADA na criação (só existe por conversão) — e por isso não é
 *     oferecida como opção aqui;
 *   - `PROPOSAL` exige `proposalId`; `PURCHASE_ORDER` exige `purchaseOrderId`;
 *   - `AUTHORIZED_DIRECT` + `unitId` é uma criação VÁLIDA E COMPLETA.
 *
 * A mensagem anterior estava errada, e a criação direta autorizada sempre foi possível. Esta tela
 * passa a exercer o contrato real em vez de recusar por conta própria.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * RELAÇÕES SÃO LOOKUPS, NÃO TEXTO LIVRE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Unidade vem do `useOperationalUnits`, que lê as unidades AUTORIZADAS do ator — o servidor recorta
 * o escopo, e a tela não oferece o que ele negaria. Quando a origem exige proposta ou pedido, o
 * campo correspondente é OBRIGATÓRIO e identificado por UUID: o servidor valida o formato e o
 * vínculo, e inventar um seletor sem fonte autoritativa seria pior que pedir o identificador.
 *
 * A ORIGEM DIRETA NÃO É "A ORDEM SEM VÍNCULO". É a criação autorizada, que é operação real do
 * domínio e tem registro próprio de auditoria.
 */

/** Origens OFERECIDAS na criação. `SERVICE_REQUEST` fica de fora: o servidor a recusa. */
const CREATABLE_ORIGINS: Array<{ value: ServiceOrderOrigin; label: string; hint: string }> = [
  {
    value: SERVICE_ORDER_ORIGINS.AuthorizedDirect,
    label: 'Criação direta autorizada',
    hint: 'Ordem aberta por decisão operacional, sem documento de origem.',
  },
  {
    value: SERVICE_ORDER_ORIGINS.Proposal,
    label: 'Proposta aceita',
    hint: 'Exige o identificador da proposta de origem.',
  },
  {
    value: SERVICE_ORDER_ORIGINS.PurchaseOrder,
    label: 'Pedido de compra',
    hint: 'Exige o identificador do pedido de compra de origem.',
  },
];

type FieldErrors = {
  unitId?: string;
  proposalId?: string;
  purchaseOrderId?: string;
  clientId?: string;
};

export function ServiceOrderCreatePage() {
  const navigate = useNavigate();
  const [urlParams] = useSearchParams();
  const {
    options: unitOptions,
    unitId: defaultUnitId,
    status: unitsStatus,
    error: unitsError,
    reload: reloadUnits,
  } = useOperationalUnits(listServiceOrderOperationalUnits);
  const unitsDenied =
    unitsError instanceof ServiceOrdersApiError && unitsError.kind === 'denied';

  const originId = useId();
  const unitId_ = useId();
  const clientId_ = useId();
  const proposalFieldId = useId();
  const purchaseOrderFieldId = useId();
  const descriptionId = useId();
  const notesId = useId();
  const rcId = useId();

  const [origin, setOrigin] = useState<ServiceOrderOrigin>(
    SERVICE_ORDER_ORIGINS.AuthorizedDirect,
  );
  const [unitId, setUnitId] = useState('');
  /*
   * CONTEXTO RECEBIDO DA OBJECT PAGE DO CLIENTE.
   *
   * Chegando por `/app/service-orders/new?clientId=…` o cliente já vem escolhido, e o operador
   * não precisa voltar à lista para buscá-lo de novo. É apenas o valor INICIAL: o backend segue
   * validando existência, autorização e escopo no POST.
   */
  const [clientId, setClientId] = useState(() => urlParams.get('clientId')?.trim() ?? '');
  /*
   * UM ESTADO POR VÍNCULO — e não um `linkId` compartilhado.
   *
   * O campo era único e reaproveitado pelas duas origens: escolher uma proposta e depois trocar a
   * origem para "Pedido de compra" deixava o identificador da PROPOSTA no campo do PEDIDO, e a tela
   * enviava o vínculo errado. Separar os estados elimina a contaminação entre os dois e permite que o
   * valor escolhido em cada origem sobreviva à troca de volta.
   */
  const [proposalId, setProposalId] = useState('');
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [description, setDescription] = useState('');
  const [operationalNotes, setOperationalNotes] = useState('');
  const [rcNumber, setRcNumber] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /*
   * UNIDADE PADRAO — a PRIMEIRA unidade AUTORIZADA, nao um texto de exemplo.
   *
   * `useOperationalUnits` resolve depois do primeiro render (leitura de rede), entao o valor
   * inicial chega tarde. Derivar na hora de renderizar, em vez de sincronizar por efeito, evita
   * um estado que diverge do que o controle mostra.
   */
  const effectiveUnitId = unitId || defaultUnitId;

  const requiresProposal = origin === SERVICE_ORDER_ORIGINS.Proposal;
  const requiresPurchaseOrder = origin === SERVICE_ORDER_ORIGINS.PurchaseOrder;

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!effectiveUnitId) {
      errors.unitId = 'Selecione a unidade da ordem.';
    }
    /*
     * As duas exigências por origem são do SERVIDOR; a tela as antecipa para dar causa legível em
     * vez de um 400 genérico. A mensagem deixou de falar em "identificador": o operador escolhe da
     * lista, então o que falta é a SELEÇÃO, não um código digitado.
     */
    if (requiresProposal && !proposalId.trim()) {
      errors.proposalId = 'Selecione a proposta de origem.';
    }
    if (requiresPurchaseOrder && !purchaseOrderId.trim()) {
      errors.purchaseOrderId = 'Selecione o pedido de compra de origem.';
    }
    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(true);

    const payload: CreateServiceOrderPayload = { origin, unitId: effectiveUnitId };
    if (clientId.trim()) {
      payload.clientId = clientId.trim();
    }
    if (requiresProposal) {
      payload.proposalId = proposalId.trim();
    }
    if (requiresPurchaseOrder) {
      payload.purchaseOrderId = purchaseOrderId.trim();
    }
    if (description.trim()) {
      payload.description = description.trim();
    }
    if (operationalNotes.trim()) {
      payload.operationalNotes = operationalNotes.trim();
    }
    if (rcNumber.trim()) {
      payload.rcNumber = rcNumber.trim();
    }

    try {
      /*
       * O ID VEM DO SERVIDOR. `createServiceOrder` devolve o registro persistido, e a navegação
       * usa o id REAL — sem ele, "criar" seria apenas um estado local que um refresh apagaria.
       */
      const created = await createServiceOrder(payload);
      void navigate(`/app/service-orders/${created.id}`, { replace: true });
    } catch (error) {
      setSubmitError(mapCreateError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModulePage>
      <ModulePageHeader title="Nova ordem de serviço" />

      {/*
        WORKFLOW GOVERNADO — formulário em largura controlada e coluna de apoio.

        Os campos NÃO atravessam a área de conteúdo inteira: um input de 1300px para um
        identificador obriga o olho a varrer demais entre rótulo e valor. A coluna de apoio
        declara o que a ordem exige, para que a regra do domínio seja lida antes do envio em vez
        de descoberta por mensagem de erro.
      */}
      <form
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
        className="grid items-start gap-x-6 gap-y-3 xl:grid-cols-[minmax(0,44rem)_minmax(0,20rem)]"
      >
        <div className="flex min-w-0 flex-col gap-3">
          {submitError ? (
            <p
              role="alert"
              className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
            >
              {submitError}
            </p>
          ) : null}

          <section className="cisne-panel flex flex-col gap-3 px-3 py-3">
            <h2 className="cisne-section-title m-0">Dados da ordem</h2>

            {/*
              SEM UNIDADE AUTORIZADA, A ORDEM NÃO PODE SER CRIADA — E A TELA DIZ ISSO.
              
              O servidor exige `unitId` e recusa qualquer unidade fora do escopo do ator
              (`assertUnitRegistered`). Quando `operational-units` volta vazio, NÃO existe valor
              que o operador possa digitar para satisfazer a regra: o `<select>` mostra
              "Nenhuma unidade autorizada" e o botão fica desabilitado, sem explicar a causa.
              
              Este bloco nomeia o bloqueio e o caminho real. Ele NÃO oferece campo livre para
              unidade: aceitar texto arbitrário só trocaria um bloqueio honesto por um 400 — e
              pior, sugeriria que a unidade é escolha do operador, quando ela é ESCOPO concedido.
            */}
            {unitsStatus === 'loading' ? (
              <p className="cisne-type-helper m-0" role="status" aria-live="polite">
                Carregando unidades autorizadas para criação…
              </p>
            ) : null}

            {unitsStatus === 'error' ? (
              <div
                data-testid="so-create-unit-error"
                role="alert"
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-500/20 ring-inset"
              >
                <span>
                  {unitsDenied
                    ? 'Você não tem permissão para criar ordens de serviço.'
                    : 'Não foi possível carregar as unidades autorizadas para criação.'}
                </span>
                {!unitsDenied ? (
                  <Button type="button" variant="secondary" onClick={reloadUnits}>
                    Tentar novamente
                  </Button>
                ) : null}
              </div>
            ) : null}

            {unitsStatus === 'ready' && unitOptions.length === 0 ? (
              <p
                data-testid="so-create-no-unit"
                role="alert"
                className="m-0 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-500/30 ring-inset"
              >
                <strong className="block">Nenhuma unidade autorizada para criar esta OS.</strong>
                O servidor não publicou nenhuma unidade registrada compatível com seu escopo de
                criação. A unidade continua governada pela autorização — não é um campo livre.
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Origem" htmlFor={originId} required>
                <select
                  id={originId}
                  data-testid="so-create-origin"
                  className="cisne-type-body min-h-[var(--control-height)] w-full rounded-md border border-gray-300 bg-white px-2"
                  value={origin}
                  disabled={submitting}
                  onChange={(event) => {
                    /*
                     * TROCAR A ORIGEM LIMPA O VÍNCULO DA ORIGEM ABANDONADA — e só dela.
                     *
                     * Proposta e pedido são vínculos DIFERENTES, com estados próprios. Antes havia um
                     * único `linkId` compartilhado: escolher uma proposta e mudar para "Pedido de
                     * compra" deixava o id da PROPOSTA no campo do PEDIDO, e a tela enviava o vínculo
                     * errado. Limpar só o lado que sai evita a contaminação sem descartar a escolha
                     * feita no lado que o operador pode querer retomar.
                     */
                    const nextOrigin = event.target.value as ServiceOrderOrigin;
                    if (origin === SERVICE_ORDER_ORIGINS.Proposal && nextOrigin !== origin) {
                      setProposalId('');
                    }
                    if (origin === SERVICE_ORDER_ORIGINS.PurchaseOrder && nextOrigin !== origin) {
                      setPurchaseOrderId('');
                    }
                    setOrigin(nextOrigin);
                    setFieldErrors({});
                  }}
                >
                  {CREATABLE_ORIGINS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Unidade"
                htmlFor={unitId_}
                required
                error={fieldErrors.unitId}
              >
                <select
                  id={unitId_}
                  data-testid="so-create-unit"
                  className="cisne-type-body min-h-[var(--control-height)] w-full rounded-md border border-gray-300 bg-white px-2"
                  value={effectiveUnitId}
                  disabled={submitting || unitsStatus !== 'ready'}
                  onChange={(event) => setUnitId(event.target.value)}
                >
                  {unitsStatus === 'loading' ? <option value="">Carregando unidades…</option> : null}
                  {unitsStatus === 'error' ? <option value="">Unidades indisponíveis</option> : null}
                  {unitsStatus === 'ready' && unitOptions.length === 0 ? (
                    <option value="">Nenhuma unidade autorizada</option>
                  ) : null}
                  {unitOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              {/*
                VÍNCULO POR ORIGEM — obrigatório só quando o SERVIDOR exige.
                Com origem direta autorizada o campo não aparece: pedir um vínculo que a criação
                não usa faria o operador procurar um dado inexistente.

                LOOKUP REAL, NÃO CAMPO DE UUID. O operador busca pelo CÓDIGO que ele conhece
                ("PROP-2026-0031", "PO-2026-0088") e escolhe da lista que o servidor devolveu. O
                identificador técnico circula apenas dentro do `value` da opção e do payload de
                criação — nunca é digitado nem exibido.
              */}
              {requiresProposal ? (
                <HumanLookupField
                  label="Proposta de origem"
                  htmlFor={proposalFieldId}
                  required
                  error={fieldErrors.proposalId}
                  selectTestId="so-create-proposal-select"
                  hint="Busque pelo código da proposta e escolha na lista devolvida pelo servidor."
                  placeholder="Buscar por código ou título da proposta"
                  search={searchProposalsForLookup}
                  value={proposalId}
                  onChange={setProposalId}
                  emptyMessage="Nenhuma proposta encontrada para esta busca."
                />
              ) : null}

              {requiresPurchaseOrder ? (
                <HumanLookupField
                  label="Pedido de compra de origem"
                  htmlFor={purchaseOrderFieldId}
                  required
                  error={fieldErrors.purchaseOrderId}
                  selectTestId="so-create-purchase-order-select"
                  hint="Busque pelo número do pedido e escolha na lista devolvida pelo servidor."
                  placeholder="Buscar por número do pedido"
                  search={searchPurchaseOrdersForLookup}
                  value={purchaseOrderId}
                  onChange={setPurchaseOrderId}
                  emptyMessage="Nenhum pedido de compra encontrado para esta busca."
                />
              ) : null}

              <HumanLookupField
                label="Cliente (opcional)"
                htmlFor={clientId_}
                hint="Vínculo opcional. Busque pelo nome ou documento do cliente."
                placeholder="Buscar por nome ou documento do cliente"
                search={searchClientsForLookup}
                value={clientId}
                onChange={setClientId}
                emptyMessage="Nenhum cliente encontrado para esta busca."
              />

              <Field label="RC (opcional)" htmlFor={rcId}>
                <Input
                  id={rcId}
                  data-testid="so-create-rc"
                  value={rcNumber}
                  disabled={submitting}
                  onChange={(event) => setRcNumber(event.target.value)}
                />
              </Field>
            </div>

            <Field label="Descrição (opcional)" htmlFor={descriptionId}>
              <Textarea
                id={descriptionId}
                data-testid="so-create-description"
                rows={2}
                value={description}
                disabled={submitting}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>

            <Field label="Observações operacionais (opcional)" htmlFor={notesId}>
              <Textarea
                id={notesId}
                data-testid="so-create-notes"
                rows={2}
                value={operationalNotes}
                disabled={submitting}
                onChange={(event) => setOperationalNotes(event.target.value)}
              />
            </Field>
          </section>

          {/*
            STICKY ACTION BAR — estado à esquerda, comandos à direita.
            O comando primário é "Criar OS"; a saída é secundária e nunca compete com ele.
          */}
          <div className="cisne-command-surface sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-white py-2">
            <p className="cisne-type-helper m-0">
              {submitting ? 'Criando a ordem…' : 'A ordem é criada no servidor e aberta na ficha.'}
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="secondary"
                disabled={submitting}
                onClick={() => void navigate('/app/service-orders')}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                data-testid="so-create-submit"
                loading={submitting}
                loadingText="Criando…"
                disabled={unitsStatus !== 'ready' || !effectiveUnitId}
              >
                Criar OS
              </Button>
            </div>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-3" data-region="create-support">
          <section className="cisne-panel px-3 py-2.5">
            <h2 className="cisne-meta-label m-0">Regras de criação</h2>
            <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
              {CREATABLE_ORIGINS.map((option) => (
                <li
                  key={option.value}
                  className={cn(
                    'border-l-[3px] pl-2',
                    option.value === origin ? 'border-l-brand-600' : 'border-l-gray-300',
                  )}
                >
                  <p className="cisne-type-meta m-0 font-semibold">{option.label}</p>
                  <p className="cisne-type-helper m-0">{option.hint}</p>
                </li>
              ))}
            </ul>
          </section>

          {/*
            A REGRA QUE A TELA ANTIGA ESCONDIA.

            O formulário anterior dizia que a criação era impossível e mandava o operador a outro
            módulo. A criação direta autorizada SEMPRE foi válida no domínio — este painel declara
            o que de fato acontece, incluindo o que NÃO é oferecido aqui e por quê.
          */}
          <section className="cisne-panel px-3 py-2.5">
            <h2 className="cisne-meta-label m-0">Ordem vinda de solicitação</h2>
            <p className="cisne-type-helper m-0 mt-1.5">
              Uma ordem nascida de solicitação é criada pela <strong>conversão</strong> da
              solicitação aprovada, que carrega o vínculo. Por isso essa origem não aparece na
              lista acima: o servidor a recusa na criação direta.
            </p>
          </section>
        </aside>
      </form>
    </ModulePage>
  );
}

/**
 * TRADUÇÃO DO ERRO DE CRIAÇÃO — sem vazar código interno.
 *
 * Cada modo de falha tem uma causa diferente, e "erro ao criar" mandaria o operador tentar de novo
 * sem mudar nada. Os códigos vêm do contrato de erro do módulo; o que não é reconhecido cai numa
 * mensagem que ao menos declara a possibilidade de nova tentativa.
 */
function mapCreateError(error: unknown): string {
  if (error instanceof ServiceOrdersApiError) {
    switch (error.code) {
      case 'SERVICE_ORDERS_VALIDATION_FAILED':
        return 'Os dados informados não foram aceitos. Confira a origem, a unidade e o vínculo.';
      case 'SERVICE_ORDERS_DENIED':
        return 'Você não tem permissão para criar ordens de serviço.';
      case 'SERVICE_ORDERS_UNIT_NOT_FOUND':
        return 'A unidade selecionada não está no seu escopo de acesso.';
      case 'SERVICE_ORDERS_INVALID_STATE':
        return 'A origem informada não permite criar a ordem neste estado.';
      default:
        return 'Não foi possível criar a ordem de serviço. Tente novamente.';
    }
  }
  return 'Não foi possível criar a ordem de serviço. Verifique a conexão e tente novamente.';
}
