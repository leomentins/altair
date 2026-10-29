# Altair

Condução de ciclo por sessão para o Claude Code: uma maestra por ciclo, uma condutora
por fase e uma operária por tarefa, cada ação emitida por script com nonce e conferida
por comando. Distribuído como plugin, com um marketplace local neste repositório.

## Instalar

```bash
claude plugin marketplace add <endereço deste repositório>
claude plugin install altair@altair
```

A skill fica em `/altair:conducao`. Cada projeto conduzido declara o que é dele em
`.altair/adaptador.json` na raiz do repositório: o passo a passo está em
`plugins/altair/INSTALL.md`, e `exemplo/` traz um projeto de mentira conduzido de
ponta a ponta pela suíte.

## Testar

```bash
node --test $(find plugins/altair -name '*.test.mjs')
```
