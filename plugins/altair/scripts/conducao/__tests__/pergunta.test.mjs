// pergunta.test.mjs — a pergunta tipada numa forma só, gravada onde o adaptador diz
// (VEGA-29 T12, AC-VEGA29-3, D-VEGA29-20).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { lerAdaptador } from "../adaptador.mjs";
import { arquivoDoLog, lerLog, validarLinha } from "../log-eventos.mjs";
import { ErroPergunta, EVENTO, comPergunta, decisaoDe, foiConstruida, gravar, perguntar } from "../pergunta.mjs";
import * as verbos from "../verbos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
/** O projeto de teste das suítes: a declaração e o código de um projeto de mentira. */
const RAIZ = path.resolve(AQUI, "fixtures", "projeto-de-teste");
const CONDUCAO = path.resolve(AQUI, "..");
const CLI = path.join(CONDUCAO, "conducao.mjs");
const CICLO = "X-1-pergunta";
const QUANDO = "2026-10-28T12:00:00.000Z";

const tmps = [];
function tmp(prefixo) {
  const d = mkdtempSync(path.join(tmpdir(), prefixo));
  tmps.push(d);
  return d;
}
after(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** env de estação (sem NODE_TEST_CONTEXT nem override do log), com a raiz de estado num tmp. */
function estacao() {
  const env = { ...process.env, XDG_STATE_HOME: tmp("pergunta-estado-") };
  delete env.NODE_TEST_CONTEXT;
  delete env.ALTAIR_CONDUCAO_LOG_DIR;
  return env;
}

function repoCom(declaracao) {
  const repo = tmp("pergunta-repo-");
  mkdirSync(path.join(repo, ".altair"));
  writeFileSync(path.join(repo, ".altair", "adaptador.json"), JSON.stringify(declaracao));
  return repo;
}

/** Adaptador falso: o destino da pergunta é uma pasta própria, fora do log. */
const FALSO = {
  projeto: "falso",
  operadores: [{ handle: "fulana", nome: "Fulana" }],
  estado: { pasta: "falso/conducao" },
  log: { pasta: "." },
  pergunta: { destino: "pasta", pasta: "perguntas" },
};

// ── o construtor ────────────────────────────────────────────────────────────

describe("construtor único", () => {
  test("a forma que a maestra lê não muda: acao perguntar, motivo e os campos do chamador", () => {
    const p = perguntar({ acao: "trazida", motivo: "conflito", ciclo: CICLO, task: "T1", tentativa: 2 });
    assert.deepEqual(p, { acao: "perguntar", motivo: "conflito", ciclo: CICLO, task: "T1", tentativa: 2 });
    assert.ok(foiConstruida(p));
    assert.ok(!foiConstruida({ ...p }), "cópia à mão não conta como construída");
  });

  test("a decisão: id determinístico, número, opções, recomendada, destinatário e sha256 do texto", () => {
    const campos = { motivo: "conflito", ciclo: CICLO, task: "T1", tentativa: 2, nonce: "0123456789abcdef" };
    const d = decisaoDe(perguntar({ ...campos, numero: 7, opcoes: [{ id: "a", texto: "um" }, { id: "b" }], recomendada: "a" }));
    assert.match(d.id, /^d-[0-9a-f]{16}$/);
    assert.equal(d.id, decisaoDe(perguntar(campos)).id, "o mesmo estado dá o mesmo id");
    assert.notEqual(d.id, decisaoDe(perguntar({ ...campos, motivo: "outro" })).id);
    assert.equal(d.numero, 7);
    assert.deepEqual(d.opcoes, [{ id: "a", texto: "um" }, { id: "b", texto: null }]);
    assert.equal(d.recomendada, "a");
    assert.equal(d.destinatario, "operador");
    assert.match(d.texto, /^[0-9a-f]{64}$/);
    const semOpcoes = decisaoDe(perguntar(campos));
    assert.deepEqual([semOpcoes.numero, semOpcoes.opcoes, semOpcoes.recomendada], [null, [], null]);
  });

  test("recusa o que não é decisão: sem motivo, opção sem id, recomendada fora das opções, papel desconhecido", () => {
    assert.throws(() => perguntar({ ciclo: CICLO }), ErroPergunta);
    assert.throws(() => perguntar({ motivo: "com espaço" }), ErroPergunta);
    assert.throws(() => perguntar({ motivo: "m", opcoes: [{ texto: "sem id" }] }), ErroPergunta);
    assert.throws(() => perguntar({ motivo: "m", opcoes: [{ id: "a" }, { id: "a" }] }), ErroPergunta);
    assert.throws(() => perguntar({ motivo: "m", opcoes: [{ id: "a" }], recomendada: "b" }), ErroPergunta);
    assert.throws(() => perguntar({ motivo: "m", recomendada: "a" }), ErroPergunta);
    assert.throws(() => perguntar({ motivo: "m", destinatario: "leo" }), ErroPergunta);
    assert.throws(() => perguntar({ motivo: "m", numero: 0 }), ErroPergunta);
    assert.throws(() => decisaoDe({ acao: "perguntar", motivo: "m" }), /construtor/);
  });

  test("os verbos e a fábrica do decidir saem pelo construtor", () => {
    const v = verbos.perguntar("conflito", { ciclo: CICLO, acao: "trazida" });
    assert.ok(foiConstruida(v));
    const fabrica = comPergunta((tipo, alvo, tentativa, campos) => ({ acao: tipo, alvo, tentativa, ...campos }));
    assert.ok(foiConstruida(fabrica("perguntar", "T1", 0, { motivo: "sem-saida", ciclo: CICLO })));
    assert.ok(!foiConstruida(fabrica("esperar", "T1", 0, { motivo: "sem-vaga", ciclo: CICLO })), "só a pergunta passa pelo construtor");
  });
});

// ── toda parada pelo mesmo construtor ───────────────────────────────────────

/** Comentários viram espaço (mesmo comprimento, mesmas quebras): só código conta. */
function semComentarios(src) {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      for (; j < src.length && src[j] !== c; j++) if (src[j] === "\\") j++;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) {
      const fim = src[i + 1] === "/" ? src.indexOf("\n", i) : src.indexOf("*/", i) + 2;
      const j = fim < i ? src.length : fim;
      out += src.slice(i, j).replace(/[^\n]/g, " ");
      i = j - 1;
    } else out += c;
  }
  return out;
}

/** Fontes onde a condução monta ação (as da revisão `3-codigo.md` §2), sem comentários. */
const FONTES = ["conducao.mjs", "regras.mjs", "verbos.mjs", "git-conducao.mjs"].map((f) => ({ f, src: semComentarios(readFileSync(path.join(CONDUCAO, f), "utf8")) }));

/** Fecho do bracket que abre em `i` (aspas e template contam como texto). */
function fecho(src, i) {
  const pares = { "(": ")", "[": "]", "{": "}" };
  const pilha = [];
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '"' || c === "'" || c === "`") {
      for (j++; j < src.length && src[j] !== c; j++) if (src[j] === "\\") j++;
      continue;
    }
    if (pares[c]) pilha.push(pares[c]);
    else if (c === pilha.at(-1)) {
      pilha.pop();
      if (!pilha.length) return j;
    }
  }
  return src.length;
}

/**
 * Faixas que chegam ao construtor: `perguntar(…)` / `pergunta.perguntar(…)`,
 * `acao("perguntar", …)` das regras (a fábrica do `decidir` é embrulhada por
 * `comPergunta`, conferido abaixo), `perguntaDoPlano(…)` (embrulha
 * `acao("perguntar")`) e as tuplas da vigia (viram `acao("perguntar")`).
 */
function faixasDoConstrutor(src) {
  const faixas = [];
  for (const re of [/\b(?:perguntar|construirPergunta)\(/g, /\bacao\("perguntar"/g, /\bperguntaDoPlano\(/g, /\bperguntasDaVigia\.push\(/g]) {
    for (const m of src.matchAll(re)) {
      const abre = m.index + m[0].indexOf("(");
      faixas.push([abre, fecho(src, abre)]);
    }
  }
  return faixas;
}

function linha(src, i) {
  return src.slice(0, i).split("\n").length;
}

/** Linhas de uma tabela markdown sob o cabeçalho `## titulo`. */
function tabela(md, titulo) {
  const ini = md.indexOf(`## ${titulo}\n`);
  assert.ok(ini >= 0, `contrato-atual.md sem ## ${titulo}`);
  const fim = md.indexOf("\n## ", ini + 1);
  return md
    .slice(ini, fim < 0 ? undefined : fim)
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l))
    .slice(1)
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, "")));
}

describe("toda parada sai pelo mesmo construtor", () => {
  const contrato = readFileSync(path.join(CONDUCAO, "contrato-atual.md"), "utf8");
  const literais = tabela(contrato, "Motivos por ação").filter((l) => l[0] === "perguntar").map((l) => l[1]);
  const expressoes = tabela(contrato, "Motivos não literais").filter((l) => l[0] === "perguntar").map((l) => l[1]);

  test("o contrato tem motivos de pergunta para conferir", () => {
    assert.ok(literais.length >= 17, `só ${literais.length} motivos de pergunta lidos do contrato-atual.md`);
    assert.deepEqual(expressoes.sort(), ["e.codigo", "motivo"]);
  });

  test("cada motivo do contrato-atual.md nasce dentro de uma chamada que chega ao construtor", () => {
    const fora = [];
    for (const motivo of literais) {
      const ocorrencias = [];
      for (const { f, src } of FONTES) {
        const faixas = faixasDoConstrutor(src);
        const vigia = [...src.matchAll(/\bperguntasDaVigia\.push\(\[/g)].map((v) => [v.index, fecho(src, v.index + v[0].length - 1)]);
        for (const m of src.matchAll(new RegExp(`"${motivo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g"))) {
          // Só onde o motivo é emitido: `motivo: "x"` ou dentro da tupla da vigia.
          const antes = src.slice(Math.max(0, m.index - 40), m.index);
          if (!/motivo:\s*$/.test(antes) && !vigia.some(([a, b]) => a < m.index && m.index < b)) continue;
          ocorrencias.push({ f, l: linha(src, m.index), dentro: faixas.some(([a, b]) => a < m.index && m.index < b) });
        }
      }
      if (!ocorrencias.length) fora.push(`${motivo} (não achado nas fontes)`);
      for (const o of ocorrencias) if (!o.dentro) fora.push(`${motivo} (${o.f}:${o.l})`);
    }
    assert.deepEqual(fora, [], `motivo montado à mão, fora do construtor: ${fora.join(", ")}`);
  });

  test("motivos não literais: erroComoPergunta e a vigia também passam pelo construtor", () => {
    const { src } = FONTES.find((x) => x.f === "conducao.mjs");
    const i = src.indexOf("motivo: e.codigo");
    assert.ok(i > 0);
    assert.ok(faixasDoConstrutor(src).some(([a, b]) => a < i && i < b), "erroComoPergunta monta a pergunta à mão");
    const regras = FONTES.find((x) => x.f === "regras.mjs").src;
    const curtos = [...regras.matchAll(/[{,]\s*motivo\s*(?=[,}])/g)];
    assert.ok(curtos.length > 0);
    for (const m of curtos) assert.ok(faixasDoConstrutor(regras).some(([a, b]) => a < m.index && m.index < b), `regras.mjs:${linha(regras, m.index)} motivo abreviado fora de acao("perguntar")`);
  });

  test("nenhuma pergunta montada à mão: todo objeto `acao: \"perguntar\"` é argumento do construtor", () => {
    const soltos = [];
    for (const { f, src } of FONTES) {
      for (const m of src.matchAll(/\bacao:\s*"perguntar"/g)) {
        const abre = src.lastIndexOf("{", m.index);
        if (/\b(?:perguntar|construirPergunta)\(\s*$/.test(src.slice(Math.max(0, abre - 30), abre))) continue;
        const corpo = src.slice(abre, fecho(src, abre));
        soltos.push(`${f}:${linha(src, m.index)} ${/motivo:\s*"([^"]+)"/.exec(corpo)?.[1] ?? /motivo:\s*([^,\n}]+)/.exec(corpo)?.[1] ?? "(sem motivo)"}`);
      }
    }
    assert.deepEqual(soltos, [], `pergunta montada à mão: ${soltos.join(", ")}`);
  });

  test("a fábrica do decidir é embrulhada por comPergunta", () => {
    const { src } = FONTES.find((x) => x.f === "conducao.mjs");
    assert.match(src, /contextoDoProximo\(params, pergunta\.comPergunta\(fabrica\)\)/);
  });
});

// ── gravada onde o adaptador diz ────────────────────────────────────────────

describe("gravação no destino do adaptador", () => {
  test("adaptador falso com destino X: a pergunta é lida de X, e o log comum fica sem ela", () => {
    const env = estacao();
    const repo = repoCom(FALSO);
    const decl = lerAdaptador(repo, { env });
    const X = decl.pastaDaPergunta;
    assert.equal(X, path.join(env.XDG_STATE_HOME, "falso", "conducao", "perguntas"));
    assert.notEqual(X, decl.pastaDoLog);
    const p = perguntar({ motivo: "sem-saida", ciclo: CICLO, fase: "F1", task: "T3", nonce: "0123456789abcdef" });
    const r = gravar(p, decl, { quando: QUANDO });
    assert.equal(r.arquivo, arquivoDoLog(CICLO, X));
    const ev = lerLog(arquivoDoLog(CICLO, X)).filter((l) => l.linha === "evento" && l.acao === EVENTO);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].atributos.decisao, decisaoDe(p).id);
    assert.deepEqual(lerLog(arquivoDoLog(CICLO, decl.pastaDoLog)), []);
  });

  test("saída que não passou pelo construtor não grava", () => {
    const decl = lerAdaptador(repoCom(FALSO), { env: estacao() });
    assert.throws(() => gravar({ acao: "perguntar", motivo: "sem-saida", ciclo: CICLO }, decl), /construtor/);
  });

  test("pela CLI: a pergunta do modo da maestra cai no destino X do adaptador falso", () => {
    const env = estacao();
    const repo = repoCom(FALSO);
    const r = spawnSync(process.execPath, [CLI, "abrir", "--repo", repo, "--ciclo", CICLO, "T1", "--modo-maestra", "default"], { env, encoding: "utf8" });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(JSON.parse(r.stdout).motivo, "modo-da-maestra");
    assert.doesNotMatch(r.stderr, /nao gravado/);
    const X = lerAdaptador(repo, { env }).pastaDaPergunta;
    const ev = lerLog(arquivoDoLog(CICLO, X)).filter((l) => l.linha === "evento");
    assert.deepEqual(ev.map((e) => e.acao).sort(), [EVENTO, "perguntar"]);
    const tipada = ev.find((e) => e.acao === EVENTO);
    assert.equal(tipada.atributos.motivo, "modo-da-maestra");
    assert.equal(tipada.atributos.destinatario, "operador");
  });

  test("projeto de teste: a pergunta lida do log v1 tem id, sessão, opções, recomendada, destinatário e sha256; nada cai e o texto não vaza", () => {
    const env = estacao();
    const decl = lerAdaptador(RAIZ, { env });
    assert.equal(decl.pergunta.destino, "log");
    assert.equal(decl.pastaDaPergunta, decl.pastaDoLog);
    const textoA = "evoluir a tela existente, como a do paciente João da Silva";
    const textoB = "criar a nova e aposentar a velha";
    const recomendacao = "Recomendo (a) — mesmo resultado, sem tela duplicada";
    const p = perguntar({
      motivo: "pergunta-da-filha",
      ciclo: CICLO,
      fase: "F2",
      task: "T12",
      tentativa: 1,
      nonce: "fedcba9876543210",
      numero: 45,
      opcoes: [
        { id: "a", texto: textoA },
        { id: "b", texto: textoB },
      ],
      recomendada: "a",
      recomendacao,
      destinatario: "operador",
    });
    const r = gravar(p, decl, { quando: QUANDO });
    assert.deepEqual(r.descartados, [], "nenhuma chave da pergunta cai na allowlist");
    const arquivo = arquivoDoLog(CICLO, decl.pastaDoLog);
    const linhas = lerLog(arquivo);
    linhas.forEach(validarLinha);
    const ev = linhas.find((l) => l.linha === "evento" && l.acao === EVENTO);
    const sha = createHash("sha256")
      .update(JSON.stringify({ opcoes: [["a", textoA], ["b", textoB]], recomendacao }))
      .digest("hex");
    assert.deepEqual(ev.atributos, {
      motivo: "pergunta-da-filha",
      decisao: decisaoDe(p).id,
      destinatario: "operador",
      textoSha256: sha,
      tentativa: 1,
      nonce: "fedcba9876543210",
      numero: 45,
      opcoes: "a+b",
      recomendada: "a",
    });
    assert.deepEqual(ev.objetos.map((o) => o.id), [`ciclo:${CICLO}`, `fase:${CICLO}/F2`, `task:${CICLO}/T12`, `tentativa:${CICLO}/T12/1`]);
    const cru = readFileSync(arquivo, "utf8");
    for (const t of [textoA, textoB, recomendacao, "João", "paciente"]) assert.ok(!cru.includes(t), `texto livre em claro no .jsonl: ${t}`);
  });
});
