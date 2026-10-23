/**
 * REGRESSAO: secret colado com BOM quebra a montagem de header HTTP.
 *
 * DEFEITO MEDIDO (run 39883399921, `Release Ready` em c4bc535f, job
 * "Railway HML / migrations / readiness / authenticated smoke"):
 *
 *   TypeError: Cannot convert argument to a ByteString because the character at
 *   index 7 has a value of 65279 which is greater than 255.
 *
 * Indice 7 = primeiro caractere apos `Bearer ` no header `authorization`.
 * 65279 = U+FEFF (BOM UTF-8). O `fetch` do Node rejeita qualquer code point > 255
 * em valor de header, entao o deploy morria ANTES de qualquer chamada de rede.
 *
 * A correcao normaliza o envelope na LEITURA (`env()`), sem relaxar validacao:
 * secret ausente continua erro, e o valor nao e alterado alem do envelope.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { env } from './secret-envelope.mjs';

const BOM = '\uFEFF';
const ZWSP = '\u200B';
const NBSP = '\u00A0';

test('o defeito e real: BOM no token produz ByteString invalido no header', () => {
  const dirtyToken = `${BOM}railway-token-value`;
  // Reproduz exatamente o que `fetch` faz ao montar o header.
  assert.throws(
    () => new Headers({ authorization: `Bearer ${dirtyToken}` }),
    /ByteString|65279|greater than 255/,
  );
  // E o BOM esta no indice 7 do valor do header.
  assert.equal(`Bearer ${dirtyToken}`.charCodeAt(7), 65279);
});

for (const label of ['railway-ensure-hml', 'coolify-deploy']) {
  test(`${label}: env() remove BOM, zero-width space e NBSP`, () => {
    assert.equal(env('__CISNE_TEST_DIRTY', { __CISNE_TEST_DIRTY: `${BOM}value${ZWSP}-x${NBSP}` }), 'value-x');
  });

  test(`${label}: env() nao transforma ausente em valor`, () => {
    assert.equal(env('__CISNE_TEST_ABSENT', {}), undefined);
  });

  test(`${label}: env() deixa valor limpo intacto`, () => {
    assert.equal(env('__CISNE_TEST_CLEAN', { __CISNE_TEST_CLEAN: 'feedee-1234' }), 'feedee-1234');
  });

  test(`${label}: token normalizado monta header valido`, () => {
    const token = env('__CISNE_TEST_TOKEN', { __CISNE_TEST_TOKEN: `${BOM}railway-token-value\n` });
    const headers = new Headers({ authorization: `Bearer ${token}` });
    assert.equal(headers.get('authorization'), 'Bearer railway-token-value');
  });
}
