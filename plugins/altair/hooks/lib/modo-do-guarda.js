"use strict";
// modo-do-guarda — onde o guard com modo lê o `<guard>-mode`: na pasta que a declaração do
// adaptador do projeto aponta (`guardas.pastaDoModo`, relativa à raiz do repositório). Sem o
// campo, sem declaração legível ou sem o arquivo, o modo é `shadow`: o plugin não supõe pasta
// de estado de projeto nenhum.
//
// O `require` do adaptador (ESM) é preguiçoso e dentro do try: falha de carga vira `sem-campo`,
// nunca exceção no hook.

const path = require("node:path");
const { readModeFile } = require(path.join(__dirname, "read-mode-file.js"));

/** `guardas.pastaDoModo` da declaração do projeto em `raiz`, ou `null`. */
function pastaDoModo(raiz, env = process.env) {
  try {
    const { lerAdaptador } = require(
      path.join(__dirname, "..", "..", "scripts", "conducao", "adaptador.mjs"),
    );
    const g = lerAdaptador(raiz, { env }).guardas;
    return (g && g.pastaDoModo) || null;
  } catch {
    return null;
  }
}

/**
 * `{ valor, lido, arquivo }` do guard `nome` no projeto em `raiz`. `valor` é o conteúdo em
 * minúsculas (`shadow` quando não há o que ler); `lido` é o valor cru, `ausente` (o campo
 * aponta, o arquivo não existe) ou `sem-campo` (a declaração não diz onde ler).
 */
function lerModoDoGuarda(nome, raiz, env = process.env) {
  const pasta = pastaDoModo(raiz, env);
  if (!pasta) return { valor: "shadow", lido: "sem-campo", arquivo: null };
  const arquivo = path.join(raiz, pasta, `${nome}-mode`);
  const { value, found } = readModeFile(arquivo, { default: "shadow" });
  const valor = String(value).toLowerCase().slice(0, 32);
  return { valor, lido: found ? valor : "ausente", arquivo };
}

module.exports = { lerModoDoGuarda, pastaDoModo };
