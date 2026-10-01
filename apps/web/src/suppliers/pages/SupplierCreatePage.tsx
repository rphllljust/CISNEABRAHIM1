import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Field, Input } from '../../ui';
import { ModulePage } from '../../ui/module-layout';
import { WorklistHeader } from '../../ui/enterprise-list';
import { CreateRecordForm } from '../../financial-ui/VersionedActionForm';
import { mapSupplierErrorToMessage } from '../api/supplier-error-messages';
import { createSupplier } from '../api/suppliers-api';

/**
 * CADASTRO DE FORNECEDOR — mesma cabeça compacta das demais superfícies da família. O formulário
 * continua sendo o mesmo `CreateRecordForm` com os mesmos campos e o mesmo tratamento de erro; o
 * que muda é a moldura, que deixa de ser um cabeçalho solto seguido de formulário.
 */
export function SupplierCreatePage() {
  const navigate = useNavigate();
  const [legalName, setLegalName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  return (
    <ModulePage>
      <WorklistHeader
        title="Novo fornecedor"
        context="CNPJ e contato operacional são validados pelo servidor. O cadastro nasce inativo e a ativação exige checker distinto."
        action={
          <Link
            to="/app/suppliers"
            className="text-[13px] font-semibold text-brand-700 no-underline hover:text-brand-800"
          >
            ← Voltar para fornecedores
          </Link>
        }
      />
      <CreateRecordForm
        title="Cadastrar fornecedor"
        description="O fornecedor é criado e aberto no detalhe para ativação."
        submitLabel="Cadastrar"
        mapError={mapSupplierErrorToMessage}
        onSubmit={async () => {
          const created = await createSupplier({
            legalName: legalName.trim(),
            taxId: taxId.trim(),
            tradeName: tradeName.trim() || undefined,
            paymentTerms: paymentTerms.trim() || undefined,
            contacts: [
              {
                name: contactName.trim(),
                purpose: 'operational',
                email: contactEmail.trim() || undefined,
                phone: contactPhone.trim() || undefined,
              },
            ],
          });
          void navigate(`/app/suppliers/${created.id}`);
        }}
      >
        <Field label="Razão social" htmlFor="supplier-legal" required className="md:col-span-2">
          <Input id="supplier-legal" value={legalName} onChange={(event) => setLegalName(event.target.value)} required />
        </Field>
        <Field label="CNPJ" htmlFor="supplier-tax" required>
          <Input id="supplier-tax" value={taxId} onChange={(event) => setTaxId(event.target.value)} required />
        </Field>
        <Field label="Nome fantasia" htmlFor="supplier-trade">
          <Input id="supplier-trade" value={tradeName} onChange={(event) => setTradeName(event.target.value)} />
        </Field>
        <Field label="Condição de pagamento" htmlFor="supplier-terms">
          <Input
            id="supplier-terms"
            value={paymentTerms}
            onChange={(event) => setPaymentTerms(event.target.value)}
            placeholder="Ex.: 30 DDL"
          />
        </Field>
        <Field label="Contato operacional" htmlFor="supplier-contact" required>
          <Input
            id="supplier-contact"
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
            required
          />
        </Field>
        <Field label="E-mail" htmlFor="supplier-email">
          <Input
            id="supplier-email"
            type="email"
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
          />
        </Field>
        <Field label="Telefone" htmlFor="supplier-phone">
          <Input id="supplier-phone" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} />
        </Field>
      </CreateRecordForm>
      <p className="mt-2 text-xs text-gray-500">
        Informe e-mail ou telefone do contato operacional: o servidor recusa contato sem canal.
      </p>
    </ModulePage>
  );
}
