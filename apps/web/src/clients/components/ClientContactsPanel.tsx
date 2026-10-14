import { useCallback, useId, useState } from 'react';
import {
  addClientContact,
  deactivateClientContact,
  reactivateClientContact,
  removeClientContact,
  setClientContactRole,
  setClientPrimaryContact,
} from '../api/clients-api';
import type { Client, ClientContact, ContactPurpose, ContactRole } from '../types/client.types';
import { CONTACT_PURPOSES, CONTACT_ROLES } from '../types/client.types';
import {
  contactPurposeLabel,
  contactRoleLabel,
  formatContactChannel,
  groupClientContacts,
} from '../utils/client-360-presentation';
import { ObjectPanel } from '../../enterprise-object';
import { Button } from '../../ui/Button';
import { StatusBadge } from '../../ui/StatusBadge';
import { cn } from '../../ui/utils/cn';

/**
 * CONTATOS DO CLIENTE — MÚLTIPLOS, COM PAPEL E PRINCIPAL.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE PAINEL SUBSTITUI
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Antes, a ficha do Cliente listava contatos como TEXTO: nome, finalidade e canais, sem nenhuma
 * ação. O operador que descobria um telefone errado precisava sair da ficha, abrir o formulário
 * inteiro do cadastro, reenviar a coleção COMPLETA de contatos e torcer para não colidir com a
 * edição de outro operador.
 *
 * Agora cada intenção é um COMANDO PRÓPRIO, com payload mínimo e concorrência otimista própria:
 * adicionar, atribuir papel, marcar como principal, inativar, reativar e remover. O servidor
 * continua sendo o boundary — toda ação aqui é uma chamada que ele pode recusar.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * REGRAS DE HONESTIDADE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * 1. PAPEL NÃO DECLARADO NÃO VIRA RÓTULO. `role: null` significa exatamente isso, e o painel
 *    simplesmente não mostra a linha — não escreve "não informado".
 * 2. CONTATO INATIVO CONTINUA VISÍVEL. A inativação preserva o histórico do relacionamento; o
 *    painel o mostra agrupado e esmaecido, com o comando de reativar. Escondê-lo faria a
 *    organização do Cliente parecer mais pobre do que é.
 * 3. NENHUM COMANDO É OFERECIDO SEM CAPABILITY. Sem `canManageContacts` a coleção é somente
 *    leitura — e o painel não finge oferecer o que o servidor vai negar.
 * 4. O PRIMEIRO CONTATO NÃO VIRA PRINCIPAL SOZINHO. "Principal" é uma AFIRMAÇÃO do operador sobre
 *    quem a empresa deve procurar primeiro; deduzi-la da ordem de cadastro inventaria organização.
 */

export type ClientContactsPanelProps = {
  client: Client;
  canManage: boolean;
  /** Recebe o Cliente ATUALIZADO (com a versão nova) para a ficha continuar coerente. */
  onUpdated: (client: Client) => void;
  /** Mensagem de erro já traduzida, exibida no próprio painel. */
  onError: (message: string) => void;
};

const ROLE_OPTIONS = Object.values(CONTACT_ROLES);
const PURPOSE_OPTIONS = Object.values(CONTACT_PURPOSES);

export function ClientContactsPanel({
  client,
  canManage,
  onUpdated,
  onError,
}: ClientContactsPanelProps) {
  /*
   * AUSÊNCIA DA COLEÇÃO = COLEÇÃO VAZIA. `contacts` sempre existiu, mas tratá-la como opcional
   * custa uma linha e evita que uma resposta parcial derrube a ficha inteira — o mesmo cuidado
   * aplicado a `units`, que foi acrescentada depois.
   */
  const contacts = client.contacts ?? [];
  const groups = groupClientContacts(contacts);
  const [busyContactId, setBusyContactId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  /**
   * EXECUTA UM COMANDO DE CONTATO.
   *
   * `busyContactId` isola o estado de espera POR CONTATO: uma ação em um contato não bloqueia os
   * demais, e o operador continua trabalhando no resto da coleção enquanto a requisição corre.
   */
  const run = useCallback(
    async (contactId: string, command: () => Promise<Client>) => {
      setBusyContactId(contactId);
      try {
        onUpdated(await command());
      } catch (error) {
        onError(
          error instanceof Error && error.message
            ? 'Não foi possível concluir a ação no contato.'
            : 'Não foi possível concluir a ação no contato.',
        );
      } finally {
        setBusyContactId(null);
      }
    },
    [onError, onUpdated],
  );

  return (
    <ObjectPanel
      title={`Contatos${contacts.length > 0 ? ` · ${contacts.length}` : ''}`}
      actions={
        canManage ? (
          <button
            type="button"
            data-testid="client-contact-add-toggle"
            className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            onClick={() => setAdding((current) => !current)}
          >
            {adding ? 'Cancelar' : 'Adicionar'}
          </button>
        ) : null
      }
    >
      {adding && canManage ? (
        <AddContactForm
          client={client}
          onCancel={() => setAdding(false)}
          onCreated={(updated) => {
            setAdding(false);
            onUpdated(updated);
          }}
          onError={onError}
        />
      ) : null}

      {contacts.length === 0 && !adding ? (
        <p className="cisne-type-body m-0 text-gray-500">Nenhum contato cadastrado.</p>
      ) : null}

      <ContactGroup
        title="Ativos"
        contacts={groups.active}
        client={client}
        canManage={canManage}
        busyContactId={busyContactId}
        run={run}
      />

      {/*
        INATIVOS EM GRUPO PRÓPRIO, e só quando existem: um cabeçalho "Inativos · 0" afirmaria uma
        coleção vazia que não é informação nenhuma.
      */}
      {groups.inactive.length > 0 ? (
        <ContactGroup
          title="Inativos"
          contacts={groups.inactive}
          client={client}
          canManage={canManage}
          busyContactId={busyContactId}
          run={run}
        />
      ) : null}
    </ObjectPanel>
  );
}

function ContactGroup({
  title,
  contacts,
  client,
  canManage,
  busyContactId,
  run,
}: {
  title: string;
  contacts: ClientContact[];
  client: Client;
  canManage: boolean;
  busyContactId: string | null;
  run: (contactId: string, command: () => Promise<Client>) => Promise<void>;
}) {
  if (contacts.length === 0) {
    return null;
  }
  return (
    <div className="mb-2 last:mb-0">
      <h3 className="cisne-meta-label m-0 mb-1">{title}</h3>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {contacts.map((contact) => (
          <ContactRow
            key={contact.id ?? `${contact.name}-${contact.purpose}`}
            contact={contact}
            client={client}
            canManage={canManage}
            busy={busyContactId === contact.id}
            run={run}
          />
        ))}
      </ul>
    </div>
  );
}

function ContactRow({
  contact,
  client,
  canManage,
  busy,
  run,
}: {
  contact: ClientContact;
  client: Client;
  canManage: boolean;
  busy: boolean;
  run: (contactId: string, command: () => Promise<Client>) => Promise<void>;
}) {
  const roleId = useId();
  const roleLabel = contactRoleLabel(contact.role);
  const purposeLabel = contactPurposeLabel(contact.purpose);
  const channels = formatContactChannel(contact);
  const isInactive = Boolean(contact.deactivatedAt);
  const contactId = contact.id;

  return (
    <li
      className={cn(
        'border-b border-gray-100 pb-1.5 last:border-b-0 last:pb-0',
        isInactive && 'opacity-60',
      )}
      data-testid="client-contact-row"
      data-contact-primary={contact.isPrimary === true}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <strong className="cisne-type-primary min-w-0 truncate">{contact.name}</strong>
        {/*
          PRINCIPAL É SELO, porque é a informação que decide para quem ligar. O PAPEL é texto: é
          contexto, não exceção — pintar sete papéis diferentes daria o mesmo peso visual a tudo.
        */}
        {contact.isPrimary ? <StatusBadge label="Principal" tone="info" /> : null}
        {roleLabel ? <span className="cisne-type-meta">{roleLabel}</span> : null}
        {purposeLabel ? <span className="cisne-type-helper">{purposeLabel}</span> : null}
      </div>

      {channels.length > 0 ? (
        <p className="cisne-type-helper m-0 truncate">{channels.join(' · ')}</p>
      ) : null}

      {canManage && contactId ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {/*
            PAPEL — `value=""` REMOVE a atribuição (envia `null`). A opção vazia é rotulada
            explicitamente para que "remover" seja uma escolha declarada, e não um placeholder.
          */}
          <label className="flex items-center gap-1">
            <span className="cisne-meta-label">Papel</span>
            <select
              id={roleId}
              data-testid="client-contact-role"
              className="cisne-type-helper min-h-[var(--control-height)] rounded-md border border-gray-300 bg-white px-1"
              value={contact.role ?? ''}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value;
                void run(contactId, () =>
                  setClientContactRole(
                    client.id,
                    contactId,
                    next === '' ? null : (next as ContactRole),
                    client.version,
                  ),
                );
              }}
            >
              <option value="">Não declarado</option>
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {contactRoleLabel(role)}
                </option>
              ))}
            </select>
          </label>

          {!contact.isPrimary && !isInactive ? (
            <button
              type="button"
              data-testid="client-contact-set-primary"
              className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-1.5 text-brand-700 hover:bg-brand-50"
              disabled={busy}
              onClick={() =>
                void run(contactId, () =>
                  setClientPrimaryContact(client.id, contactId, client.version),
                )
              }
            >
              Tornar principal
            </button>
          ) : null}

          {isInactive ? (
            <button
              type="button"
              data-testid="client-contact-reactivate"
              className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-1.5 text-brand-700 hover:bg-brand-50"
              disabled={busy}
              onClick={() =>
                void run(contactId, () =>
                  reactivateClientContact(client.id, contactId, client.version),
                )
              }
            >
              Reativar
            </button>
          ) : (
            <button
              type="button"
              data-testid="client-contact-deactivate"
              className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-1.5 text-gray-600 hover:bg-gray-100"
              disabled={busy}
              onClick={() =>
                void run(contactId, () =>
                  deactivateClientContact(client.id, contactId, client.version),
                )
              }
            >
              Inativar
            </button>
          )}

          {/*
            REMOÇÃO DEFINITIVA fica atrás de uma confirmação obrigatória: a inativação é o caminho
            normal, e apagar é a exceção deliberada. Sem a confirmação, o operador perderia o
            histórico de relacionamento por um clique ao lado de "Inativar".
          */}
          <button
            type="button"
            data-testid="client-contact-remove"
            className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-1.5 text-red-700 hover:bg-red-50"
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  `Remover definitivamente o contato "${contact.name}"? A inativação preserva o histórico; a remoção não.`,
                )
              ) {
                return;
              }
              void run(contactId, () => removeClientContact(client.id, contactId, client.version));
            }}
          >
            Remover
          </button>

          {busy ? <span className="cisne-type-helper">executando…</span> : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * ADICIONAR CONTATO — formulário MÍNIMO.
 *
 * Só o que o servidor exige: nome, finalidade e um canal (e-mail ou telefone). Papel é opcional
 * porque "não declarado" é um estado legítimo, e exigi-lo aqui inventaria organização que o
 * operador não tem como afirmar no momento do cadastro.
 */
function AddContactForm({
  client,
  onCancel,
  onCreated,
  onError,
}: {
  client: Client;
  onCancel: () => void;
  onCreated: (client: Client) => void;
  onError: (message: string) => void;
}) {
  const nameId = useId();
  const purposeId = useId();
  const roleId = useId();
  const emailId = useId();
  const phoneId = useId();
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState<ContactPurpose>(CONTACT_PURPOSES.Operational);
  const [role, setRole] = useState<string>('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && (email.trim().length > 0 || phone.trim().length > 0);

  async function submit() {
    if (!canSubmit || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      const updated = await addClientContact(client.id, {
        version: client.version,
        name: name.trim(),
        purpose,
        role: role === '' ? null : (role as ContactRole),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      onCreated(updated);
    } catch {
      onError('Não foi possível adicionar o contato.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid="client-contact-add-form"
      className="mb-2 flex flex-col gap-1.5 border border-gray-200 bg-gray-50/60 p-2"
    >
      <div className="grid gap-1.5 sm:grid-cols-2">
        <label className="flex flex-col gap-0.5">
          <span className="cisne-meta-label">Nome</span>
          <input
            id={nameId}
            data-testid="client-contact-name"
            className="cisne-type-body min-h-[var(--control-height)] rounded-md border border-gray-300 bg-white px-2"
            value={name}
            disabled={submitting}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="cisne-meta-label">Finalidade</span>
          <select
            id={purposeId}
            data-testid="client-contact-purpose"
            className="cisne-type-body min-h-[var(--control-height)] rounded-md border border-gray-300 bg-white px-2"
            value={purpose}
            disabled={submitting}
            onChange={(event) => setPurpose(event.target.value as ContactPurpose)}
          >
            {PURPOSE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {contactPurposeLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="cisne-meta-label">Papel (opcional)</span>
          <select
            id={roleId}
            data-testid="client-contact-role-new"
            className="cisne-type-body min-h-[var(--control-height)] rounded-md border border-gray-300 bg-white px-2"
            value={role}
            disabled={submitting}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="">Não declarado</option>
            {ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {contactRoleLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="cisne-meta-label">E-mail</span>
          <input
            id={emailId}
            type="email"
            data-testid="client-contact-email"
            className="cisne-type-body min-h-[var(--control-height)] rounded-md border border-gray-300 bg-white px-2"
            value={email}
            disabled={submitting}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="cisne-meta-label">Telefone</span>
          <input
            id={phoneId}
            type="tel"
            data-testid="client-contact-phone"
            className="cisne-type-body min-h-[var(--control-height)] rounded-md border border-gray-300 bg-white px-2"
            value={phone}
            disabled={submitting}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>
      </div>

      <p className="cisne-type-helper m-0">Informe pelo menos e-mail ou telefone.</p>

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="primary"
          loading={submitting}
          loadingText="Adicionando…"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          Adicionar contato
        </Button>
        <button
          type="button"
          className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100"
          disabled={submitting}
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
