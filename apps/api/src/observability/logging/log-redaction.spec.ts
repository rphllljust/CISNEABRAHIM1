import { describe, expect, it } from 'vitest';
import {
  containsForbiddenLogSecret,
  redactLogMetadata,
  redactLogString,
} from './log-redaction';

describe('log redaction', () => {
  it('redacts authorization headers and tokens from strings', () => {
    const redacted = redactLogString('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload');
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(redacted).toContain('[REDACTED]');
  });

  it('redacts forbidden metadata keys', () => {
    const metadata = redactLogMetadata({
      password: 'secret',
      refresh_token: 'rt-1',
      access_token: 'at-1',
      cookie: 'sid=abc',
      authorization: 'Bearer token',
      operation: 'login',
    });

    expect(metadata).toEqual({
      password: '[REDACTED]',
      refresh_token: '[REDACTED]',
      access_token: '[REDACTED]',
      cookie: '[REDACTED]',
      authorization: '[REDACTED]',
      operation: 'login',
    });
  });

  it('masks CNPJ and contact PII in free text', () => {
    const redacted = redactLogString('Cliente 12.345.678/0001-90 contato@empresa.com +55 11 99999-0000');
    expect(redacted).toContain('[REDACTED_CNPJ]');
    expect(redacted).toContain('[REDACTED_EMAIL]');
    expect(redacted).not.toContain('contato@empresa.com');
  });

  it('detects forbidden secrets in raw log text', () => {
    expect(containsForbiddenLogSecret('password=abc')).toBe(true);
    expect(containsForbiddenLogSecret('refresh_token=abc')).toBe(true);
    expect(containsForbiddenLogSecret('operation completed')).toBe(false);
  });

  // B3: identificadores fiscais e chaves de API. Antes desta sessao o CNPJ so
  // era mascarado por VALOR pontuado — `cnpj: "12345678000190"` (sem pontos)
  // atravessava intacto, porque nao havia defesa por CHAVE.
  it('redacts fiscal identifiers by key, including unpunctuated values', () => {
    const metadata = redactLogMetadata({
      cpf: '12345678901',
      cnpj: '12345678000190',
      tax_id: '12345678000190',
      'x-api-key': 'sk-live-abc123',
      operation: 'create_client',
    });

    expect(metadata).toEqual({
      cpf: '[REDACTED]',
      cnpj: '[REDACTED]',
      tax_id: '[REDACTED]',
      'x-api-key': '[REDACTED]',
      operation: 'create_client',
    });
  });

  it('masks punctuated CPF and api keys in free text', () => {
    const redacted = redactLogString('cliente 123.456.789-01 chamou com x-api-key: sk-live-abc123');

    expect(redacted).toContain('[REDACTED_CPF]');
    expect(redacted).not.toContain('123.456.789-01');
    expect(redacted).not.toContain('sk-live-abc123');
  });
});
