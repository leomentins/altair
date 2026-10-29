/**
 * marcas.test.mjs — a gramática das marcas tem um dono só (VEGA-29 T5).
 *
 * Teste de tabela, sem git: cada linha é um subject (e trailers) e a marca que
 * `marcasDoLog` tem de devolver. Depois, os leitores que antes tinham cópia
 * própria da regex (`conducao.mjs`, `git-conducao.mjs`, os dois hooks) não
 * podem voltar a ter: uma regex local de marca diverge da tabela em silêncio.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NONCE_RE, RE, ehMarcadorDe, marcasDoLog, trailers, ultimaAutorizacao } from "../marcas.mjs";
import { nonce } from "../conducao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..", "..");

/** Uma linha de `git log --format=%H%x1f%s%x1f%(trailers…)%x1e`. */
function reg(sha, subject, tr = {}) {
  const bloco = Object.entries(tr).map(([k, v]) => `${k}: ${v}\n`).join("");
  return `${sha}\x1f${subject}\x1f${bloco}\x1e\n`;
}

const TABELA = [
  ["Conducao: F1 autorizada", { "Conducao-Plano": "b1" }, { tipo: "autorizada", fase: "F1", plano: "b1", herdada: null, ciclo: false }],
  ["Conducao: F12 autorizada", { "Conducao-Plano": "b2", "Conducao-Herdada": "abc", "Conducao-Ciclo": "sim" }, { tipo: "autorizada", fase: "F12", plano: "b2", herdada: "abc", ciclo: true }],
  ["Conducao: T5 conferida", {}, { tipo: "conferida", task: "T5" }],
  ["Conducao: T5 tentativa 2 falhou", { "coberta-por-reinicio": "sim" }, { tipo: "falhou", task: "T5", tentativa: 2, coberta: true, ambiente: false }],
  ["Conducao: T5 tentativa 3 falhou", { "Conducao-Falha-Ambiente": "sim" }, { tipo: "falhou", task: "T5", tentativa: 3, coberta: true, ambiente: true }],
  ["Conducao: T5 tentativa 4 falhou", {}, { tipo: "falhou", task: "T5", tentativa: 4, coberta: false, ambiente: false }],
  ["Conducao: T5 tentativa 1 revertida", {}, { tipo: "revertida", task: "T5", tentativa: 1 }],
  ["Conducao: T7 tentativa 1 rodada", { "Conducao-Rodada": "B" }, { tipo: "rodada", task: "T7", tentativa: 1, rodada: "B" }],
  ["Conducao: T7 tentativa 2 carimbo", {}, { tipo: "carimbo", task: "T7", tentativa: 2 }],
  ["Conducao: T9 publicacao recusada", {}, { tipo: "recusada", task: "T9" }],
  ["Conducao: abrir T5 tentativa 1 nonce c5a4a731bb273601", {}, { tipo: "marcador", task: "T5", tentativa: 1, nonce: "c5a4a731bb273601" }],
  ["Conducao: F0 sessao encerrada", { "Conducao-Encerrada": "F0", "Conducao-Nonce": "n1" }, { tipo: "encerrada", fase: "F0", nonce: "n1" }],
  ["Conducao: ciclo sessao encerrada", { "Conducao-Encerrada": "ciclo" }, { tipo: "encerrada", fase: "ciclo", nonce: null }],
  // Não são marca: subject a mais ou a menos, ou `encerrada` sem o trailer que a confirma.
  ["Conducao: F1 autorizada ", {}, null],
  ["Conducao: F100 autorizada", {}, null],
  ["Conducao: T1000 conferida", {}, null],
  ["conducao: T5 conferida", {}, null],
  ["Conducao: T5 tentativa 1 trazida", {}, null],
  ["VEGA-29-conducao-portatil-F1/T5 — Conducao: T5 conferida", {}, null],
  ["Conducao: F0 sessao encerrada", {}, null],
  ["Conducao: F0 sessao encerrada", { "Conducao-Encerrada": "F1" }, null],
];

test("tabela das marcas: cada subject vira a marca esperada, ou nenhuma", () => {
  for (const [i, [subject, tr, esperada]] of TABELA.entries()) {
    const [marca] = marcasDoLog(reg(`sha${i}`, subject, tr));
    if (esperada === null) {
      assert.equal(marca, undefined, `não é marca: ${JSON.stringify(subject)}`);
      continue;
    }
    assert.ok(marca, `sem marca para ${JSON.stringify(subject)}`);
    assert.equal(marca.sha, `sha${i}`);
    for (const [k, v] of Object.entries(esperada)) assert.deepEqual(marca[k], v, `${subject}: campo ${k}`);
  }
});

test("tabela das marcas: cada regex do RE tem ao menos uma linha que casa", () => {
  const casadas = new Set(TABELA.filter(([, , e]) => e).map(([, , e]) => e.tipo));
  assert.deepEqual([...casadas].sort(), Object.keys(RE).sort());
});

test("marcasDoLog: ordem da saída, registro sem sha ou subject descartado", () => {
  const bruto = reg("a", "Conducao: F1 autorizada") + "\x1f\x1f\x1e\n" + reg("b", "Conducao: T1 conferida") + "\n";
  assert.deepEqual(marcasDoLog(bruto).map((m) => m.sha), ["a", "b"]);
});

test("trailers: chave repetida, o primeiro vence", () => {
  assert.deepEqual(trailers("Conducao-Plano: x\nConducao-Plano: y\n  Outro:  z  \nsem forma\n"), { "Conducao-Plano": "x", Outro: "z" });
});

test("ultimaAutorizacao: a última autorizada da lista, só sha/fase/plano", () => {
  const marcas = marcasDoLog(
    reg("a", "Conducao: F0 autorizada", { "Conducao-Plano": "p0" }) +
      reg("b", "Conducao: T1 conferida") +
      reg("c", "Conducao: F1 autorizada", { "Conducao-Plano": "p1", "Conducao-Ciclo": "sim" }) +
      reg("d", "Conducao: T2 conferida"),
  );
  assert.deepEqual(ultimaAutorizacao(marcas), { tipo: "autorizada", sha: "c", fase: "F1", plano: "p1" });
  assert.deepEqual(ultimaAutorizacao(marcasDoLog(reg("e", "Conducao: F2 autorizada"))), { tipo: "autorizada", sha: "e", fase: "F2", plano: null });
  assert.equal(ultimaAutorizacao(marcasDoLog(reg("f", "Conducao: T1 conferida"))), null);
  assert.equal(ultimaAutorizacao([]), null);
});

test("ehMarcadorDe: task e nonce exatos, qualquer tentativa", () => {
  const s = "Conducao: abrir T5 tentativa 3 nonce c5a4a731bb273601";
  assert.equal(ehMarcadorDe(s, "T5", "c5a4a731bb273601"), true);
  assert.equal(ehMarcadorDe(s, "T50", "c5a4a731bb273601"), false);
  assert.equal(ehMarcadorDe(s, "T5", "c5a4a731bb27360"), false);
  assert.equal(ehMarcadorDe(`${s} `, "T5", "c5a4a731bb273601"), false);
  assert.equal(ehMarcadorDe(undefined, "T5", "c5a4a731bb273601"), false);
});

test("NONCE_RE casa o nonce que a maestra gera, e não um hex mais longo", () => {
  const n = nonce("VEGA-29-conducao-portatil", "T5", 1, "0".repeat(40));
  assert.deepEqual([...`aviso T5-OK abc ${n}`.matchAll(NONCE_RE)].map((m) => m[0]), [n]);
  assert.deepEqual([..."0123456789abcdef0".matchAll(NONCE_RE)], []);
});

test("leitores sem cópia local da gramática: conducao.mjs, git-conducao.mjs e os dois hooks", () => {
  const ler = (rel) => readFileSync(path.join(RAIZ, rel), "utf8");
  for (const rel of ["scripts/conducao/conducao.mjs", "scripts/conducao/git-conducao.mjs"]) {
    const src = ler(rel);
    // Regex literal de marca (`/^Conducao: …/`, além do prefixo cru que só filtra candidatos) ou construída com `RegExp`.
    assert.deepEqual(src.match(/\/\^Conducao: [^/]+\//g) ?? [], [], `${rel}: regex de marca fora de marcas.mjs`);
    assert.ok(!/new RegExp\(`\^Conducao: /.test(src), `${rel}: RegExp de marca fora de marcas.mjs`);
    assert.ok(/from "\.\/marcas\.mjs"/.test(src), `${rel}: não importa marcas.mjs`);
    assert.ok(!/execFileSync\("git"|spawnSync\("git"/.test(src), `${rel}: executor git fora de git-exec.mjs`);
  }
  const stop = ler("hooks/operaria-stop-guard.js");
  assert.ok(/marcas\.mjs/.test(stop) && /git-exec\.mjs/.test(stop), "operaria-stop-guard.js não importa marcas.mjs e git-exec.mjs");
  assert.ok(!/new RegExp\(\s*`\^Conducao/.test(stop), "operaria-stop-guard.js constrói a regex do marcador");
  assert.ok(!/spawnSync\(\s*"git"/.test(stop), "operaria-stop-guard.js com executor git próprio");
  const nonceGuard = ler("hooks/conducao-nonce-guard.js");
  assert.ok(/marcas\.mjs/.test(nonceGuard), "conducao-nonce-guard.js não importa marcas.mjs");
  assert.ok(!/\[0-9a-f\]\{16\}/.test(nonceGuard), "conducao-nonce-guard.js com forma própria do nonce");
});
