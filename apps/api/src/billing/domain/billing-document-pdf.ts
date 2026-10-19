import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import type { BillingDocumentPdfSnapshot } from './billing-document';

/**
 * NOTA FATURA — representacao impressa/PDF.
 *
 * ESCOPO DESTE ARQUIVO: forma. Nenhuma regra de negocio, valor, estado ou persistencia vive aqui.
 * O resultado do faturamento e a soma dos itens sao decididos no dominio e no banco; este arquivo
 * apenas compoe o que ja foi decidido.
 *
 * IDENTIDADE: documento comercial empresarial do CISNE, sobrio e denso como um documento fiscal
 * real — e deliberadamente NAO se passa por documento fiscal eletronico. Nao ha brasao publico,
 * nao ha titulo NFS-e/NF-e, nao ha chave de acesso, nao ha protocolo de autorizacao e nao ha QR de
 * autenticacao. Um rodape discreto declara o que o documento e. Fabricar qualquer um desses
 * elementos seria afirmar conformidade fiscal que nao existe.
 *
 * AUSENCIA: campo sem valor imprime travessao. Omitir seria ambiguo (o leitor nao distingue "nao
 * se aplica" de "esqueceram"), e preencher com suposicao seria mentira.
 */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const COLORS = {
  ink: '#111827',
  subtle: '#6B7280',
  rule: '#D1D5DB',
  ruleStrong: '#111827',
  band: '#F3F4F6',
} as const;

/** Sumidouro de texto ausente. Nunca inventa: o travessao diz "nao ha dado". */
const ABSENT = '—';

function present(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function orAbsent(value: string | null | undefined): string {
  return present(value) ?? ABSENT;
}

function formatTaxId(value: string | null): string {
  if (!value) {
    return ABSENT;
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return value;
}

function formatMoney(amount: string, currencyCode: string): string {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return amount;
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

function formatQuantity(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(numeric);
}

function formatAddress(address: Record<string, unknown>): string {
  const street = present(address.street as string | null);
  const number = present(address.number as string | null);
  const complement = present(address.complement as string | null);
  const district = present(address.district as string | null);
  const city = present(address.city as string | null);
  const state = present(address.state as string | null);
  const postalCode = present(address.postalCode as string | null);

  const line1 = [street, number].filter(Boolean).join(', ');
  const withComplement = [line1, complement].filter(Boolean).join(' - ');
  const line2 = [district, city && state ? `${city}/${state}` : city ?? state]
    .filter(Boolean)
    .join(' - ');
  const withCep = [line2, postalCode ? `CEP ${postalCode}` : null].filter(Boolean).join(' - ');

  const composed = [withComplement, withCep].filter((part) => part.length > 0).join(' · ');
  return composed.length > 0 ? composed : ABSENT;
}

function formatDate(iso: string | null | undefined): string {
  const value = present(iso ?? null);
  if (!value) {
    return ABSENT;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatDateTime(iso: string | null | undefined): string {
  const value = present(iso ?? null);
  if (!value) {
    return ABSENT;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Status do documento em portugues. Nao traduz o que nao conhece: devolve o token cru. */
function statusLabel(status: string): string {
  const known: Record<string, string> = {
    FINALIZED: 'Emitida',
    CANCELLED: 'Cancelada',
  };
  return known[status] ?? status;
}

type Field = { label: string; value: string; strong?: boolean };

/**
 * `line_label` do faturamento e um PLACEHOLDER gerado na preparacao
 * (`billing-access.service.ts`: `` `Linha ${item.line_number}` ``). Ele nao descreve o servico —
 * apenas repete o numero da linha, que ja tem coluna propria.
 *
 * Regra da descricao: usa o `lineLabel` quando ele tem conteudo real (ex.: "Faturamento
 * contratual"); quando e apenas "Linha N", cai para o nome do servico congelado no snapshot da
 * OS. Se nenhum dos dois existir, imprime ausencia. Nada e inventado.
 */
const PLACEHOLDER_LINE_LABEL = /^Linha\s+\d+$/i;

function resolveItemDescription(
  lineLabel: string | null | undefined,
  serviceName: string | null,
): string {
  const label = present(lineLabel);
  if (label && !PLACEHOLDER_LINE_LABEL.test(label)) {
    return label;
  }
  return serviceName ?? ABSENT;
}

/**
 * MARCA CISNE — silhueta vetorial de um cisne em perfil, glidando sobre a linha d'agua.
 *
 * Monocromatica, discreta e institucional. NAO e brasao publico, nao e simbolo de orgao fiscal e
 * nao imita selo de autenticacao — e a identidade da propria empresa emissora no papel.
 *
 * Desenhada num viewBox 24x24 e escalada no ponto de uso. O mesmo `d` existe no frontend
 * (`apps/web/src/billing/components/NotaFaturaBrandMark.tsx`); os dois devem permanecer iguais
 * para que a previa na tela e o PDF impresso mostrem a mesma marca.
 */
const CISNE_MARK_VIEWBOX = 24;
const CISNE_SWAN_PATH = [
  'M 4.6 8.7',
  'C 4.2 8.2 4.6 7.2 5.6 7.0',
  'C 6.6 6.8 7.5 7.4 7.7 8.3',
  'C 7.9 9.2 7.6 9.9 7.0 10.1',
  'C 6.5 10.3 6.0 10.6 5.9 11.2',
  'C 5.8 12.4 6.5 13.8 8.0 14.9',
  'C 10.3 16.5 13.5 17.1 16.2 16.3',
  'C 18.6 15.6 20.2 14.0 20.4 12.2',
  'C 20.6 10.6 19.6 9.3 17.8 8.7',
  'C 16.2 8.2 14.4 8.3 13.0 9.0',
  'C 12.0 9.4 14.0 9.2 15.6 9.6',
  'C 17.2 10.0 21.0 10.0 21.0 13.5',
  'C 21.0 15.6 19.3 17.1 16.8 17.5',
  'C 13.9 17.9 10.3 17.1 7.8 15.5',
  'C 5.9 14.2 5.0 12.5 4.9 11.0',
  'C 4.8 9.5 5.0 9.2 4.6 8.7',
  'Z',
].join(' ');

function drawCisneMark(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const scale = size / CISNE_MARK_VIEWBOX;
  doc.save();
  doc.translate(x, y);
  doc.scale(scale, scale);

  doc.path(CISNE_SWAN_PATH).fillColor(color).fill();

  // Agua: traco curto sob o corpo, mais largo que o bico — ancora a leitura de "cisne".
  doc
    .moveTo(5.6, 18.4)
    .lineTo(19.4, 18.4)
    .lineWidth(1.2)
    .lineCap('round')
    .strokeColor(color)
    .stroke();

  doc.restore();
  // `restore` devolve a matriz, mas nao o estado de cor: reafirma a tinta do documento.
  doc.fillColor(COLORS.ink).strokeColor(COLORS.ink);
}

function renderPdf(snapshot: BillingDocumentPdfSnapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN + 34, left: MARGIN, right: MARGIN },
      autoFirstPage: true,
      bufferPages: true,
      /*
       * `compress: false` de proposito.
       *
       * O conteudo textual do documento passa a ser legivel no proprio artefato, o que permite
       * VERIFICAR o que foi impresso (e provar que nao ha chave fiscal, protocolo ou titulo
       * NFS-e fabricado) em vez de confiar no codigo. O PDF e maior em bytes, mas continua
       * deterministico — o hash e calculado sobre o buffer final, nao sobre a compressao.
       */
      compress: false,
      info: {
        Title: `${snapshot.documentCategory} ${snapshot.documentNumber}`,
        Author: snapshot.emitterLegalName,
        Subject: snapshot.documentCategory,
        CreationDate: new Date(snapshot.issuedAt),
      },
    });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const rule = (y: number, weight = 0.6, color: string = COLORS.rule) => {
      doc
        .moveTo(MARGIN, y)
        .lineTo(PAGE_WIDTH - MARGIN, y)
        .lineWidth(weight)
        .strokeColor(color)
        .stroke();
      doc.strokeColor(COLORS.ink);
    };

    const band = (y: number, height: number) => {
      doc.save();
      doc.rect(MARGIN, y, CONTENT_WIDTH, height).fillColor(COLORS.band).fill();
      doc.restore();
      doc.fillColor(COLORS.ink);
    };

    /**
     * Bloco rotulado: rotulo pequeno em caixa alta sobre o valor. E a celula basica do
     * documento — o mesmo padrao de densidade dos campos de um documento fiscal.
     */
    const field = (x: number, y: number, width: number, item: Field) => {
      doc
        .font('Helvetica')
        .fontSize(6.6)
        .fillColor(COLORS.subtle)
        .text(item.label.toUpperCase(), x, y, { width, characterSpacing: 0.3 });
      doc
        .font(item.strong ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8.6)
        .fillColor(COLORS.ink)
        .text(item.value, x, y + 8.5, { width, lineBreak: true });
      return doc.y;
    };

    const sectionTitle = (text: string) => {
      doc.font('Helvetica-Bold').fontSize(7.4).fillColor(COLORS.ink);
      doc.text(text, MARGIN, doc.y, { width: CONTENT_WIDTH, characterSpacing: 0.6 });
      const y = doc.y + 3;
      rule(y, 0.6);
      doc.y = y + 7;
    };

    // ---------------------------------------------------------------- CABECALHO
    // Canto superior ESQUERDO: marca do cisne + "CISNE" + razao social em corpo menor.
    // Canto superior DIREITO: identificacao do documento (NOTA FATURA / numero / status).
    // A marca e propria da empresa emissora; nao ha brasao publico nem selo fiscal.
    const headerTop = MARGIN;
    const boxX = PAGE_WIDTH - MARGIN - 178;
    const boxW = 178;

    const markSize = 21;
    const brandTextX = MARGIN + markSize + 7;
    // A coluna de identidade termina antes da caixa do documento.
    const brandColW = boxX - brandTextX - 14;

    drawCisneMark(doc, MARGIN, headerTop - 1, markSize, COLORS.ink);

    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(COLORS.ink)
      .text('CISNE', brandTextX, headerTop, { width: brandColW, characterSpacing: 1.8 });

    doc.font('Helvetica').fontSize(7.2).fillColor(COLORS.subtle);
    doc.text(snapshot.emitterLegalName, brandTextX, doc.y + 1.5, { width: brandColW });
    doc.text(`CNPJ ${formatTaxId(snapshot.emitterTaxId)}`, brandTextX, doc.y + 1, {
      width: brandColW,
    });
    doc.text(formatAddress(snapshot.emitterAddress), brandTextX, doc.y + 1, {
      width: brandColW,
      lineBreak: true,
    });

    doc.save();
    doc.rect(boxX, headerTop - 4, boxW, 62).lineWidth(0.8).strokeColor(COLORS.ruleStrong).stroke();
    doc.restore();
    doc.strokeColor(COLORS.ink);

    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(COLORS.ink)
      .text(snapshot.documentCategory, boxX + 8, headerTop + 2, { width: boxW - 16 });
    doc
      .font('Helvetica')
      .fontSize(6.6)
      .fillColor(COLORS.subtle)
      .text('NÚMERO', boxX + 8, headerTop + 17, { width: boxW - 16, characterSpacing: 0.3 });
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor(COLORS.ink)
      .text(snapshot.documentNumber, boxX + 8, headerTop + 25, { width: boxW - 16 });
    doc
      .font('Helvetica')
      .fontSize(6.6)
      .fillColor(COLORS.subtle)
      .text(`STATUS  ${statusLabel(snapshot.status)}`, boxX + 8, headerTop + 42, {
        width: boxW - 16,
      });

    doc.y = Math.max(doc.y, headerTop + 70);
    rule(doc.y, 1.1, COLORS.ruleStrong);
    doc.y += 14;

    // --------------------------------------------------------------- PARTES
    // Emitente ja nomeado no cabecalho; aqui entra o DESTINATARIO, que e quem o documento cobra.
    sectionTitle('DADOS DO CLIENTE');
    const clientTop = doc.y;
    /*
     * Duas colunas com fronteira explicita. Antes o nome era escrito com largura 300 enquanto o
     * endereco comecava em MARGIN+185 — as duas areas se sobrepunham e o nome do cliente
     * invadia o rotulo do endereco. A largura de cada coluna agora respeita a da outra.
     */
    const clientLeftW = 246;
    const clientGap = 14;
    const clientRightX = MARGIN + clientLeftW + clientGap;
    const clientRightW = CONTENT_WIDTH - clientLeftW - clientGap;

    doc.font('Helvetica-Bold').fontSize(9.2).fillColor(COLORS.ink);
    doc.text(snapshot.clientLegalName, MARGIN, clientTop, { width: clientLeftW });
    const afterClientName = doc.y;

    field(MARGIN, afterClientName + 2, clientLeftW, {
      label: 'CNPJ / CPF',
      value: formatTaxId(snapshot.clientTaxId),
      strong: true,
    });
    const clientAddrY = doc.y + 2;
    field(clientRightX, clientTop, clientRightW, {
      label: 'Endereço de cobrança',
      value: formatAddress(snapshot.billingAddress),
    });
    doc.y = Math.max(clientAddrY, doc.y) + 10;

    // ------------------------------------------------- IDENTIFICACAO DO DOCUMENTO
    sectionTitle('IDENTIFICAÇÃO');

    const servicePeriod = snapshot.servicePeriod;
    const periodLabel =
      servicePeriod && (servicePeriod.startedAt || servicePeriod.completedAt)
        ? `${formatDate(servicePeriod.startedAt)} a ${formatDate(servicePeriod.completedAt)}`
        : ABSENT;

    const identRow1: Field[] = [
      { label: 'Documento', value: snapshot.documentNumber, strong: true },
      { label: 'Status', value: statusLabel(snapshot.status), strong: true },
      { label: 'Emissão', value: formatDateTime(snapshot.issuedAt), strong: true },
      { label: 'Vencimento', value: formatDate(snapshot.dueDate) },
    ];
    /*
     * A linha 2 traz a LINHAGEM OPERACIONAL do documento. Antes havia aqui um campo
     * "Nota fatura (origem)" que repetia o proprio numero do documento — informacao circular,
     * que ocupa espaco sem dizer nada. Saiu, e "Proposta" subiu para o lugar dela.
     */
    const identRow2: Field[] = [
      { label: 'Ordem de serviço', value: orAbsent(snapshot.serviceOrderNumber) },
      { label: 'Medição', value: orAbsent(snapshot.measurementNumber) },
      { label: 'Período de execução', value: periodLabel },
      { label: 'Proposta', value: orAbsent(snapshot.proposalNumber) },
    ];
    const identRow3: Field[] = [
      // PEDIDO DO CLIENTE e PEDIDO INTERNO sao fatos distintos e ficam em colunas distintas.
      // Somá-los num rotulo "PO/RC" faria o leitor achar que o numero do cliente e o nosso.
      { label: 'Pedido do cliente', value: orAbsent(snapshot.customerPurchaseOrderNumber), strong: true },
      /*
       * Rotulo CRU. A governanca do CISNE registra RC como `UNKNOWN`/`AMBIGUOUS`
       * ("Nao evidenciado em SRC-001"), entao o documento nao afirma se e referencia do cliente
       * ou interna — apenas nomeia o termo e mostra o valor que a OS carrega.
       */
      { label: 'RC', value: orAbsent(snapshot.rcNumber) },
      { label: 'Pedido interno CISNE', value: orAbsent(snapshot.purchaseOrderNumber) },
      { label: 'Referência contratual', value: orAbsent(snapshot.contractReference) },
    ];

    const colW = CONTENT_WIDTH / 4;
    const renderRow = (fields: Field[]) => {
      const top = doc.y;
      let maxY = top;
      fields.forEach((item, index) => {
        const y = field(MARGIN + colW * index, top, colW - 8, item);
        maxY = Math.max(maxY, y);
      });
      doc.y = maxY + 8;
    };

    renderRow(identRow1);
    renderRow(identRow2);
    renderRow(identRow3);

    // -------------------------------------------------------------- PAGAMENTO
    sectionTitle('CONDIÇÕES DE PAGAMENTO');
    const payTop = doc.y;
    let payMax = payTop;
    payMax = Math.max(
      payMax,
      field(MARGIN, payTop, CONTENT_WIDTH * 0.46, {
        label: 'Condição de pagamento',
        value: orAbsent(snapshot.paymentTerms),
        strong: true,
      }),
    );
    payMax = Math.max(
      payMax,
      field(MARGIN + CONTENT_WIDTH * 0.5, payTop, CONTENT_WIDTH * 0.24, {
        label: 'Vencimento',
        value: formatDate(snapshot.dueDate),
        strong: true,
      }),
    );
    payMax = Math.max(
      payMax,
      field(MARGIN + CONTENT_WIDTH * 0.76, payTop, CONTENT_WIDTH * 0.24, {
        label: 'Moeda',
        value: snapshot.currencyCode,
      }),
    );
    doc.y = payMax + 12;

    // ----------------------------------------------------------------- ITENS
    sectionTitle('ITENS E VALORES');

    const cols = [
      { key: '#', width: 22, align: 'left' as const },
      { key: 'Descrição', width: 218, align: 'left' as const },
      { key: 'Qtd', width: 46, align: 'right' as const },
      { key: 'Un.', width: 38, align: 'left' as const },
      { key: 'Preço unit.', width: 80, align: 'right' as const },
      { key: 'Total', width: 107, align: 'right' as const },
    ];

    const drawTableHead = (y: number) => {
      band(y, 15);
      let x = MARGIN;
      doc.font('Helvetica-Bold').fontSize(7.2).fillColor(COLORS.ink);
      for (const col of cols) {
        doc.text(col.key, x + 4, y + 4.5, { width: col.width - 8, align: col.align });
        x += col.width;
      }
      return y + 15;
    };

    let rowY = drawTableHead(doc.y);

    const bottomLimit = PAGE_HEIGHT - MARGIN - 74;

    if (snapshot.items.length === 0) {
      doc.font('Helvetica').fontSize(8.2).fillColor(COLORS.subtle);
      doc.text('Nenhum item registrado neste documento.', MARGIN, rowY + 6, {
        width: CONTENT_WIDTH,
        align: 'center',
      });
      doc.fillColor(COLORS.ink);
      rowY = doc.y + 8;
    }

    let striped = false;
    for (const item of snapshot.items) {
      const cells = [
        String(item.lineNumber),
        resolveItemDescription(item.lineLabel, snapshot.serviceName),
        formatQuantity(item.quantity),
        present(item.unitCode) ?? ABSENT,
        item.unitPrice ? formatMoney(item.unitPrice, snapshot.currencyCode) : ABSENT,
        formatMoney(item.lineAmount, snapshot.currencyCode),
      ];

      // Altura da linha calculada pela descricao, que e a unica celula que quebra.
      doc.font('Helvetica').fontSize(8.2);
      const descHeight = doc.heightOfString(cells[1] ?? '', { width: cols[1]!.width - 8 });
      const rowHeight = Math.max(14, descHeight + 5);

      if (rowY + rowHeight > bottomLimit) {
        doc.addPage();
        rowY = MARGIN;
        rowY = drawTableHead(rowY);
        striped = false;
      }

      if (striped) {
        band(rowY, rowHeight);
      }
      striped = !striped;

      let x = MARGIN;
      doc.font('Helvetica').fontSize(8.2).fillColor(COLORS.ink);
      for (let index = 0; index < cols.length; index += 1) {
        const col = cols[index]!;
        const isAmount = col.key === 'Total';
        if (isAmount) {
          doc.font('Helvetica-Bold');
        }
        doc.text(cells[index] ?? '', x + 4, rowY + 3.5, {
          width: col.width - 8,
          align: col.align,
        });
        if (isAmount) {
          doc.font('Helvetica');
        }
        x += col.width;
      }
      rowY += rowHeight;
      rule(rowY, 0.4, COLORS.rule);
    }

    doc.y = rowY + 10;

    // ---------------------------------------------------------------- TOTAIS
    const totalsX = PAGE_WIDTH - MARGIN - 210;
    const totalsW = 210;
    const totalTop = doc.y;

    band(totalTop, 26);
    doc.font('Helvetica-Bold').fontSize(8.6).fillColor(COLORS.ink);
    doc.text('TOTAL DO DOCUMENTO', totalsX + 6, totalTop + 5, { width: totalsW - 12 });
    doc.fontSize(12).text(formatMoney(snapshot.totalAmount, snapshot.currencyCode), totalsX + 6, totalTop + 13, {
      width: totalsW - 12,
      align: 'right',
    });

    doc.y = totalTop + 34;

    // Quantidade declarada de itens: informacao de conferencia, nao valor.
    doc.font('Helvetica').fontSize(7.4).fillColor(COLORS.subtle);
    doc.text(
      `Itens: ${snapshot.items.length}`,
      MARGIN,
      totalTop + 5,
      { width: CONTENT_WIDTH - totalsW - 20 },
    );
    doc.fillColor(COLORS.ink);

    // ------------------------------------------------- RODAPE (todas as paginas)
    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      const footerY = PAGE_HEIGHT - MARGIN - 26;

      doc.save();
      // O rodape e escrito na area de margem: sem isso o pdfkit abriria pagina nova.
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;

      rule(footerY - 6, 0.6, COLORS.rule);

      doc.font('Helvetica-Bold').fontSize(6.8).fillColor(COLORS.ink);
      /*
       * O disclaimer ocupa a faixa da esquerda e PARA antes da coluna do numero. Antes a largura
       * era CONTENT_WIDTH-60 (473pt) comecando em MARGIN, ou seja, terminava em x=515 e invadia
       * a coluna do numero (que comeca em x=497) — o texto do rodape passava por cima do
       * identificador do documento.
       */
      const footerNumberW = 74;
      const footerTextW = CONTENT_WIDTH - footerNumberW - 14;
      doc.text(snapshot.fiscalDisclaimer, MARGIN, footerY, {
        width: footerTextW,
        lineBreak: true,
      });

      doc.font('Helvetica').fontSize(6.8).fillColor(COLORS.subtle);
      const footerNumberX = PAGE_WIDTH - MARGIN - footerNumberW;
      doc.text(`${snapshot.documentNumber}`, footerNumberX, footerY, {
        width: footerNumberW,
        align: 'right',
      });
      doc.text(`Pág. ${index + 1}/${range.count}`, footerNumberX, footerY + 9, {
        width: footerNumberW,
        align: 'right',
      });

      doc.page.margins.bottom = bottomMargin;
      doc.restore();
    }

    doc.end();
  });
}

export function stabilizePdfArtifact(buffer: Buffer, seed: string): Buffer {
  const pdf = buffer.toString('latin1');
  const stableId = seed.replace(/[^A-Fa-f0-9]/g, '').slice(0, 32).padEnd(32, '0').toUpperCase();
  const normalized = pdf.replace(
    /\/ID\s*\[\s*<[^>]+>\s*<[^>]+>\s*\]/,
    `/ID [ <${stableId}> <${stableId}> ]`,
  );
  return Buffer.from(normalized, 'latin1');
}

export async function renderBillingDocumentPdf(snapshot: BillingDocumentPdfSnapshot): Promise<{
  buffer: Buffer;
  sha256: string;
}> {
  const raw = await renderPdf(snapshot);
  const seed = createHash('sha256')
    .update(
      [
        snapshot.documentNumber,
        snapshot.issuedAt,
        snapshot.totalAmount,
        snapshot.items.map((item) => `${item.lineNumber}:${item.lineAmount}`).join('|'),
      ].join('::'),
    )
    .digest('hex');
  const buffer = stabilizePdfArtifact(raw, seed);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  return { buffer, sha256 };
}
