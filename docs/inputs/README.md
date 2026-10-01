# Área segura de fontes empresariais (`docs/inputs/`)

Esta pasta destina-se **apenas** a originais, exportações e cópias de trabalho fornecidas pela empresa.

## Estado atual

Fontes registradas: SRC-001 a SRC-009 e sign-offs UAT-UX. SRC-009 está `APPROVED` (opções 1-A e 2-A, 2026-09-29). SRC-005 e SRC-006 são transcrições controladas com hash dos PDFs cadastrais fornecidos; os originais não foram versionados enquanto DDP-019 permanecer `OPEN`. SRC-007 confirma gates de transmissão NF-e, autorização SEFAZ e legendas DANFE; não fornece credenciamento vigente nem tributação substantiva. SRC-008 confirma autoridade operacional máxima, solicitação≠OS, PO configurável, medição real e desacoplamento faturamento interno/emissão fiscal. Requisitos fiscais substantivos (alíquota, CFOP, NCM, código de serviço, credenciais e tipo legal de emissão) continuam `NOT_PROVIDED`/`OPEN`. Conexão com ERP foi rejeitada (SRC-004); documentação de ERP não é esperada.

## Regras

1. Não inventar arquivos “de exemplo” tratados como reais.
2. Não colocar segredos (senhas, chaves, dumps com PII desnecessário) sem classificação e autorização.
3. Não executar binários recebidos como “documento”.
4. Cada artefato real deve receber `SOURCE-ID` no registro **antes** de ser usado como evidência.
5. Preferir subpastas por data de recebimento, por exemplo `YYYY-MM-DD-<origem>/`, quando a ingestão for autorizada.
6. Registrar hash ou nome original no template de fonte, quando disponível.
7. Esta pasta é versionável com cuidado: documentos com dado pessoal podem exigir política de retenção ainda `OPEN` (DDP-019).

## Relação com o Prompt 01

A ingestão atômica e a análise das fontes pertencem ao **Prompt 01**, que **não** é executado neste Prompt 00.

## Placeholder

Não criar arquivos fictícios de PO, contrato ou planilha neste diretório.
