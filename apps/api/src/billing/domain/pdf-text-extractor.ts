/**
 * Extrator de texto de PDF, usado pelos testes da representação impressa da Nota Fatura.
 *
 * MOTIVO DE EXISTIR: o pdfkit não escreve texto literal no stream — emite glifos em hexadecimal
 * dentro de arrays TJ (`[<4349534e45> 20 <...>] TJ`). Um `buffer.toString('latin1').includes('X')`
 * funciona por acidente em strings curtas e falha em longas (o kit fragmenta os arrays), de modo
 * que o teste passaria a medir o encoding e não o documento.
 *
 * Este módulo decodifica os arrays TJ e devolve o texto realmente impresso, para que o teste
 * afirme o que o leitor vê.
 */
/**
 * Mapa WinAnsi (cp1252) para os bytes que o pdfkit emite fora do ASCII.
 *
 * O pdfkit codifica as fontes padrão (Helvetica) em WinAnsi, não em Latin-1. A faixa 0x80–0x9F é
 * justamente onde os dois divergem: em Latin-1 são caracteres de controle, em cp1252 são
 * pontuação tipográfica. Sem este mapa, `String.fromCharCode(0x97)` produziria um byte invisível
 * em vez do travessão — e o teste passaria a afirmar algo falso sobre o documento.
 */
const WIN_ANSI_HIGH: Record<number, string> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
};

function decodeByte(code: number): string {
  return WIN_ANSI_HIGH[code] ?? String.fromCharCode(code);
}

export function extractPdfText(buffer: Buffer): string {
  const latin1 = buffer.toString('latin1');
  const parts: string[] = [];
  const arrayPattern = /\[((?:[^[\]]|\\\])*)\]\s*TJ/g;

  let match: RegExpExecArray | null;
  while ((match = arrayPattern.exec(latin1)) !== null) {
    const body = match[1] ?? '';
    let text = '';
    const tokenPattern = /<([0-9A-Fa-f]+)>|(-?\d+(?:\.\d+)?)/g;

    let token: RegExpExecArray | null;
    while ((token = tokenPattern.exec(body)) !== null) {
      if (token[1]) {
        const hex = token[1];
        for (let index = 0; index + 1 < hex.length; index += 2) {
          const code = parseInt(hex.slice(index, index + 2), 16);
          if (Number.isFinite(code)) {
            text += decodeByte(code);
          }
        }
      } else if (token[2]) {
        // Deslocamento tipográfico grande vira separação visual entre palavras.
        if (Number(token[2]) <= -100) {
          text += ' ';
        }
      }
    }

    if (text.length > 0) {
      parts.push(text);
    }
  }

  return parts.join('\n');
}
