"use strict";
// sessao-operaria — esta sessão é a operária de uma task conduzida? Uma regra só, para os
// hooks que precisam separar a filha da maestra (`operaria-stop-guard`, `conducao-nonce-guard`,
// `operaria-alcance-guard`).
//
// POR QUE NÃO PELO USUÁRIO. Antes a filha rodava com um usuário do SO próprio, numa ponte só
// dela, e o usuário do SO bastava. Desde [[decisao/filha-herdeira-da-maestra]] ela nasce no
// ambiente de quem a cria — mesmo usuário, mesmos hooks, mesma pasta de log —, e o que a
// distingue é o NASCIMENTO: o `prompt` do `create_session` é a partida da condução (`conducao.mjs
// abrir`; o brief inteiro, nos scripts antigos), e as duas abrem
// com o cabeçalho do contrato (`contrato da operária — T<k> · nonce \`<x>\``, composto por
// `task-brief.mjs --operaria`).
//
// A REGRA. Vale só a PRIMEIRA mensagem de usuário com texto do transcript — o pedido com que a
// sessão nasceu. Ficam de fora, antes dela: `isMeta`, `isCompactSummary`, `isSidechain` e o eco de
// comando local (`<command-…>`, `<local-command-…>`, que o `/clear` grava antes do pedido).
// Cabeçalho do contrato em mensagem posterior NÃO faz operária: o resumo de compactação da
// maestra, ou um brief que o operador cole na conversa, citam o cabeçalho e a maestra não vira filha.
//
// CUSTO. O `Stop` corre a cada resposta de toda sessão: a leitura para na primeira mensagem de
// usuário, em blocos, com teto de bytes.
//
// TRÊS RESPOSTAS, NUNCA DUAS (`lerSessao`). "Não é operária" só sai de uma leitura POSITIVA:
// transcript lido até o pedido (ou até o fim) sem o contrato ⇒ `{ estado: "comum" }`. Caminho
// ausente, arquivo que não abre ou não se lê, e teto de bytes atingido antes do pedido ⇒
// `{ estado: "ilegivel", motivo }` — quem chama decide o lado seguro (o `alcance-guard` pergunta,
// o `stop-guard` grava `erro`), nunca o lê como sessão comum. `contratoDaSessao` é o atalho de
// quem só quer o contrato e trata a dúvida como "não é operária" (o `nonce-guard`, em que isso
// é o lado que julga).

const fs = require("node:fs");
const { StringDecoder } = require("node:string_decoder");

const CONTRATO_RE =
  /contrato da operária — (T\d{1,3}) · nonce `([0-9a-f]{16})`/;
const BLOCO = 64 * 1024;
const TETO_BYTES = 8 * 1024 * 1024;
const ECO_DE_COMANDO = /^\s*<(?:command-|local-command-)/;

function textosDe(conteudo) {
  if (typeof conteudo === "string") return [conteudo];
  if (!Array.isArray(conteudo)) return [];
  return conteudo
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text);
}

/**
 * Uma linha do JSONL: `undefined` quando ela não decide (não é pedido de usuário), ou o texto do
 * pedido (string, possivelmente sem contrato) quando é a mensagem que decide.
 */
function pedidoDaLinha(linha) {
  if (!linha) return undefined;
  let o;
  try {
    o = JSON.parse(linha);
  } catch {
    return undefined;
  }
  if (!o || o.type !== "user" || !o.message) return undefined;
  if (o.isMeta || o.isCompactSummary || o.isSidechain) return undefined;
  const textos = textosDe(o.message.content).filter((t) => t.trim());
  if (!textos.length) return undefined; // só tool_result: não é pedido
  if (textos.every((t) => ECO_DE_COMANDO.test(t))) return undefined;
  return textos.join("\n");
}

function contratoDoPedido(pedido) {
  const m = CONTRATO_RE.exec(pedido);
  return m ? { task: m[1], nonce: m[2] } : null;
}

/** Sobre o texto inteiro do transcript: `{ task, nonce }` ou `null`. */
function contratoDoTranscript(texto) {
  for (const l of String(texto).split("\n")) {
    const p = pedidoDaLinha(l);
    if (p !== undefined) return contratoDoPedido(p);
  }
  return null;
}

// A referência da tentativa que o contrato manda empurrar (`refs/conducao/<ciclo>/T<k>/<n>`) dá o
// ciclo e a tentativa da operária, que o `operaria-alcance-guard` usa para liberar só o push do
// aviso DELA (P22 do ATRM-51). Ausente no pedido, ou mais de uma referência distinta da mesma
// task (pedido que cita tentativa anterior) ⇒ os dois campos não vêm: a dúvida não libera.
const REF_DA_TENTATIVA_RE =
  /refs\/conducao\/([A-Za-z0-9._-]+)\/(T\d{1,3})\/(\d+)/g;

function tentativaDoPedido(pedido, task) {
  const refs = new Set(
    [...String(pedido).matchAll(REF_DA_TENTATIVA_RE)]
      .filter((x) => x[2] === task)
      .map((x) => `${x[1]}\u0000${x[3]}`),
  );
  if (refs.size !== 1) return {};
  const [ciclo, n] = [...refs][0].split("\u0000");
  return { ciclo, tentativa: Number(n) };
}

const decidido = (contrato, pedido = "") =>
  contrato
    ? {
        estado: "operaria",
        ...contrato,
        ...tentativaDoPedido(pedido, contrato.task),
      }
    : { estado: "comum" };
const ilegivel = (motivo) => ({ estado: "ilegivel", motivo });

/**
 * Pelo caminho do transcript, lendo só até o primeiro pedido:
 * `{ estado: "operaria", task, nonce[, ciclo, tentativa] }` · `{ estado: "comum" }` (leitura positiva, sem contrato) ·
 * `{ estado: "ilegivel", motivo: "sem-caminho" | "transcript-ilegivel" | "teto" }`.
 * `teto` (bytes) é ponto de troca para a suíte.
 */
function lerSessao(caminho, { teto = TETO_BYTES } = {}) {
  if (typeof caminho !== "string" || !caminho) return ilegivel("sem-caminho");
  let fd;
  try {
    fd = fs.openSync(caminho, "r");
  } catch {
    return ilegivel("transcript-ilegivel");
  }
  try {
    const buf = Buffer.alloc(BLOCO);
    // O decoder guarda o caractere multibyte cortado na borda do bloco.
    const dec = new StringDecoder("utf8");
    let resto = "";
    let lidos = 0;
    for (;;) {
      if (lidos >= teto) return ilegivel("teto");
      const n = fs.readSync(fd, buf, 0, BLOCO, null);
      if (n <= 0) {
        const p = pedidoDaLinha(resto + dec.end());
        return decidido(p === undefined ? null : contratoDoPedido(p), p);
      }
      lidos += n;
      resto += dec.write(buf.subarray(0, n));
      const linhas = resto.split("\n");
      resto = linhas.pop();
      for (const l of linhas) {
        const p = pedidoDaLinha(l);
        if (p !== undefined) return decidido(contratoDoPedido(p), p);
      }
    }
  } catch {
    return ilegivel("transcript-ilegivel");
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // fechar é auxiliar
    }
  }
}

/**
 * Atalho: `{ task, nonce }` só com leitura positiva de operária; `null` em sessão comum E na
 * dúvida. Quem precisa separar "comum" de "não li" usa `lerSessao`.
 */
function contratoDaSessao(caminho, opcoes) {
  const r = lerSessao(caminho, opcoes);
  return r.estado === "operaria" ? { task: r.task, nonce: r.nonce } : null;
}

module.exports = {
  CONTRATO_RE,
  contratoDoTranscript,
  contratoDaSessao,
  lerSessao,
};
