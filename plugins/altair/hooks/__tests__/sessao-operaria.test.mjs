// Testes de `lib/sessao-operaria.js` — a regra única que separa a operária da maestra quando as
// duas rodam como o mesmo usuário (decisao/filha-herdeira-da-maestra). Os dois hooks que a usam
// têm suíte própria; aqui fica o que é só da leitura: o pedido de nascimento decide, a leitura para
// nele, atravessa borda de bloco e caractere multibyte, e falha fechada vira "não é operária".
//
// Rodar: node --test .claude/hooks/__tests__/sessao-operaria.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { contratoDaSessao, contratoDoTranscript } = require("../lib/sessao-operaria.js");
const NONCE = "0123456789abcdef";
const CONTRATO = `## contrato da operária — T7 · nonce \`${NONCE}\`\n\nVocê é a operária…`;

function transcript(t, entradas) {
  const dir = mkdtempSync(path.join(tmpdir(), "sessao-operaria-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = path.join(dir, "t.jsonl");
  writeFileSync(f, entradas.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join("\n") + "\n");
  return f;
}

const pedido = (content, extra = {}) => ({ type: "user", message: { role: "user", content }, ...extra });

test("o pedido de nascimento com o contrato faz operaria", (t) => {
  const f = transcript(t, [{ type: "queue-operation" }, { type: "attachment" }, pedido(CONTRATO)]);
  assert.deepEqual(contratoDaSessao(f), { task: "T7", nonce: NONCE });
});

test("pedido de nascimento sem contrato decide nao, mesmo com contrato depois", (t) => {
  const f = transcript(t, [pedido("Conduzir X — F1"), pedido(CONTRATO)]);
  assert.equal(contratoDaSessao(f), null);
  assert.equal(contratoDoTranscript(`${JSON.stringify(pedido("oi"))}\n${JSON.stringify(pedido(CONTRATO))}`), null);
});

test("tool_result, meta, compactacao e eco de comando nao sao pedido", (t) => {
  const f = transcript(t, [
    pedido([{ type: "tool_result", tool_use_id: "x", content: CONTRATO }]),
    pedido("<local-command-caveat>c</local-command-caveat>", { isMeta: true }),
    pedido("resumo", { isCompactSummary: true }),
    pedido("<command-name>/clear</command-name>"),
    "linha truncada {",
    pedido([{ type: "text", text: CONTRATO }]),
  ]);
  assert.deepEqual(contratoDaSessao(f), { task: "T7", nonce: NONCE });
});

test("a leitura atravessa borda de bloco com caractere multibyte", (t) => {
  // ~200 KB de anexos com "ç" antes do pedido: várias bordas de 64 KB caem no meio de um.
  const anexos = Array.from({ length: 50 }, () => ({ type: "attachment", texto: "ç".repeat(2000) }));
  const f = transcript(t, [...anexos, pedido(CONTRATO)]);
  assert.deepEqual(contratoDaSessao(f), { task: "T7", nonce: NONCE });
});

test("teto de bytes, arquivo ausente ou caminho vazio dao nao-operaria", (t) => {
  const anexos = Array.from({ length: 10 }, () => ({ type: "attachment", texto: "x".repeat(20_000) }));
  const f = transcript(t, [...anexos, pedido(CONTRATO)]);
  assert.equal(contratoDaSessao(f, { teto: 64 * 1024 }), null);
  assert.deepEqual(contratoDaSessao(f), { task: "T7", nonce: NONCE });
  assert.equal(contratoDaSessao(path.join(tmpdir(), "nao-existe-sessao-operaria.jsonl")), null);
  assert.equal(contratoDaSessao(""), null);
  assert.equal(contratoDaSessao(undefined), null);
});

test("lerSessao separa sessao comum (leitura positiva) da duvida", (t) => {
  const { lerSessao } = require("../lib/sessao-operaria.js");
  assert.deepEqual(lerSessao(transcript(t, [pedido(CONTRATO)])), { estado: "operaria", task: "T7", nonce: NONCE });
  assert.deepEqual(lerSessao(transcript(t, [pedido("Conduzir X — F1")])), { estado: "comum" });
  assert.deepEqual(lerSessao(transcript(t, [{ type: "attachment" }])), { estado: "comum" }, "lido até o fim sem pedido");
  assert.deepEqual(lerSessao(undefined), { estado: "ilegivel", motivo: "sem-caminho" });
  assert.deepEqual(lerSessao(path.join(tmpdir(), "nao-existe-sessao-operaria.jsonl")), { estado: "ilegivel", motivo: "transcript-ilegivel" });
  assert.deepEqual(lerSessao(tmpdir()), { estado: "ilegivel", motivo: "transcript-ilegivel" }, "diretório");
  const anexos = Array.from({ length: 10 }, () => ({ type: "attachment", texto: "x".repeat(20_000) }));
  assert.deepEqual(lerSessao(transcript(t, [...anexos, pedido(CONTRATO)]), { teto: 64 * 1024 }), { estado: "ilegivel", motivo: "teto" });
});
