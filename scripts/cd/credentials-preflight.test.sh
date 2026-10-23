#!/usr/bin/env bash
#
# REGRESSAO: o preflight de credenciais precisa REPROVAR secret com caractere invisivel.
#
# DEFEITO MEDIDO (run 39883399921, `Release Ready` em c4bc535f):
#   TypeError: Cannot convert argument to a ByteString because the character at
#   index 7 has a value of 65279 which is greater than 255
#
# O preflight antigo usava apenas `-z` (string vazia). Um BOM (U+FEFF) nao e vazio, entao
# passava pelo preflight e explodia no job seguinte — num ponto onde a mensagem nao dizia
# qual variavel estava suja.
#
# Este script reproduz o loop do workflow com valores SINTETICOS (nunca le secret real) e
# prova que a deteccao morde nos tres caracteres e nao gera falso positivo em valor limpo.
set -euo pipefail

failures=0

verdict() {
  # Recebe um valor e responde "dirty" ou "clean" usando A MESMA expressao do workflow.
  local value="$1"
  if [ -z "$value" ]; then
    echo "empty"
  elif printf '%s' "$value" | LC_ALL=C od -An -tx1 | tr -d ' \n' | grep -qE 'efbbbf|e2808b|c2a0'; then
    echo "dirty"
  elif [ "x$value" != "x$(printf '%s' "$value" | tr -d '\r\n')" ]; then
    echo "dirty"
  else
    echo "clean"
  fi
}

check() {
  local label="$1" expected="$2" value="$3"
  local actual
  actual="$(verdict "$value")"
  if [ "$actual" = "$expected" ]; then
    echo "ok:   $label -> $actual"
  else
    echo "FAIL: $label -> esperado '$expected', obtido '$actual'" >&2
    failures=$((failures + 1))
  fi
}

# printf constroi os caracteres por escape: nada de invisivel literal no arquivo.
BOM="$(printf '\357\273\277')"
ZWSP="$(printf '\342\200\213')"
NBSP="$(printf '\302\240')"

check "valor limpo"                  clean "token-value-123"
check "BOM no inicio"                dirty "${BOM}token-value-123"
check "BOM no meio"                  dirty "token${BOM}-value"
check "zero-width space"             dirty "token${ZWSP}value"
check "NBSP"                         dirty "token${NBSP}value"
check "newline no fim"               dirty "token-value-123
"
check "vazio continua detectado"     empty ""
check "espaco nas pontas (tolerado)" clean "  token-value-123  "

if [ "$failures" -ne 0 ]; then
  echo ""
  echo "$failures verificacao(oes) falharam" >&2
  exit 1
fi

echo ""
echo "preflight de credenciais: deteccao de invisiveis verificada"
