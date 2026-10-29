// log-v1.test.mjs — o log v1: versão em toda linha, pasta por projeto e esquema conferido
// sem ajv (VEGA-29 T11, AC-VEGA29-8, D-VEGA29-3, D-VEGA29-21).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { lerAdaptador } from "../adaptador.mjs";
import {
  ARQUIVO_DO_ESQUEMA,
  ATRIBUTOS,
  PALAVRAS_DO_ESQUEMA,
  VERSAO,
  arquivoDoLog,
  conferirEsquema,
  lerLog,
  linhasDoEvento,
  pastaDoLog,
  registrar,
  validarLinha,
} from "../log-eventos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
/** O projeto de teste das suítes: a declaração e o código de um projeto de mentira. */
const RAIZ = path.resolve(AQUI, "fixtures", "projeto-de-teste");
const PLUGIN = path.resolve(AQUI, "..", "..", "..");
const require = createRequire(import.meta.url);
const nonceGuard = require(path.join(PLUGIN, "hooks", "conducao-nonce-guard.js"));
const stopGuard = require(path.join(PLUGIN, "hooks", "operaria-stop-guard.js"));

const DECLARACAO = JSON.parse(readFileSync(path.join(RAIZ, ".altair", "adaptador.json"), "utf8"));
const ESQUEMA = JSON.parse(readFileSync(ARQUIVO_DO_ESQUEMA, "utf8"));
const CICLO = "X-1-mesmo-ciclo";
const QUANDO = "2026-10-28T12:00:00.000Z";
const NONCE = "0123456789abcdef";

const tmps = [];
function tmp(prefixo) {
  const d = mkdtempSync(path.join(tmpdir(), prefixo));
  tmps.push(d);
  return d;
}
after(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

function repoDo(projeto) {
  const repo = tmp(`log-v1-${projeto}-`);
  mkdirSync(path.join(repo, ".altair"));
  writeFileSync(path.join(repo, ".altair", "adaptador.json"), JSON.stringify({ ...DECLARACAO, projeto }));
  return repo;
}

/** env de estação: sem NODE_TEST_CONTEXT nem override, raiz de estado num tmp. */
function estacao() {
  return { XDG_STATE_HOME: tmp("log-v1-estado-") };
}

const ABRIR = { acao: "abrir", ciclo: CICLO, fase: "F2", task: "T11", tentativa: 1, nonce: NONCE };

describe("esquema v1", () => {
  test("toda linha escrita leva v: 1 e casa o esquema", () => {
    const { linhas } = linhasDoEvento(
      { ...ABRIR, acao: "trazida", sha: "abc12345", sessao: "session_01X" },
      { procedencia: "registrado", quando: QUANDO },
    );
    assert.equal(VERSAO, 1);
    assert.deepEqual(new Set(linhas.map((l) => l.linha)), new Set(["objeto", "relacao", "evento", "atributo"]));
    for (const l of linhas) {
      assert.equal(l.v, 1);
      assert.deepEqual(conferirEsquema(l), [], JSON.stringify(l));
    }
  });

  test("a allowlist do esquema é a de log-eventos.mjs (mais `nonces`)", () => {
    const doEsquema = Object.keys(ESQUEMA.$defs.evento.properties.atributos.properties).sort();
    assert.deepEqual(doEsquema, [...ATRIBUTOS, "nonces"].sort());
    assert.equal(ESQUEMA.$defs.evento.properties.atributos.additionalProperties, false);
  });

  test("o esquema só usa palavras-chave que o validador sem ajv confere", () => {
    const fora = [];
    const andar = (no, onde) => {
      if (!no || typeof no !== "object") return;
      if (Array.isArray(no)) return no.forEach((x, i) => andar(x, `${onde}[${i}]`));
      for (const [k, v] of Object.entries(no)) {
        if (!PALAVRAS_DO_ESQUEMA.includes(k)) fora.push(`${onde}.${k}`);
        if (k === "properties" || k === "$defs") for (const [nome, sub] of Object.entries(v)) andar(sub, `${onde}.${k}.${nome}`);
        else if (k !== "const" && k !== "enum") andar(v, `${onde}.${k}`);
      }
    };
    andar(ESQUEMA, "$");
    assert.deepEqual(fora, []);
  });

  test("evento sem versão é recusado na escrita", () => {
    const { linhas } = linhasDoEvento(ABRIR, { procedencia: "intencao", quando: QUANDO });
    const evento = linhas.find((l) => l.linha === "evento");
    const { v, ...semVersao } = evento;
    assert.equal(v, 1);
    assert.throws(() => validarLinha(semVersao), /sem versão 1/);
    assert.throws(() => validarLinha({ ...evento, v: 2 }), /sem versão 1/);
    assert.ok(conferirEsquema(semVersao).length > 0, "o esquema também recusa a linha sem v");
  });

  test("atributo fora da allowlist cai; valor com espaço não entra", () => {
    const pasta = tmp("log-v1-allow-");
    const r = registrar(
      { ...ABRIR, relato: "a filha disse tudo certo", motivo: "texto livre com espaço", diff: "-a\n+b" },
      { procedencia: "intencao", quando: QUANDO, pasta },
    );
    assert.deepEqual(r.descartados, ["diff", "motivo", "relato"]);
    const bruto = readFileSync(r.arquivo, "utf8");
    for (const proibido of ["filha disse", "texto livre", "relato", "diff"]) assert.ok(!bruto.includes(proibido), proibido);
    // A linha forjada com o valor em claro é recusada pelo esquema na escrita.
    const evento = lerLog(r.arquivo).find((l) => l.linha === "evento");
    assert.throws(() => validarLinha({ ...evento, atributos: { ...evento.atributos, motivo: "texto livre" } }), /fora do esquema/);
    assert.throws(() => validarLinha({ ...evento, atributos: { ...evento.atributos, relato: "x" } }), /chave fora do esquema relato/);
  });
});

describe("pasta por projeto", () => {
  test("dois projetos com o mesmo ciclo gravam em pastas diferentes", () => {
    const env = estacao();
    const x = lerAdaptador(repoDo("proj-x"), { env });
    const y = lerAdaptador(repoDo("proj-y"), { env });
    const rx = registrar(ABRIR, { procedencia: "intencao", quando: QUANDO, pasta: x.pastaDoLog });
    const ry = registrar({ ...ABRIR, nonce: "fedcba9876543210" }, { procedencia: "intencao", quando: QUANDO, pasta: y.pastaDoLog });
    assert.notEqual(rx.arquivo, ry.arquivo);
    assert.equal(path.basename(rx.arquivo), `${CICLO}.jsonl`);
    assert.equal(path.basename(path.dirname(rx.arquivo)), "proj-x");
    assert.equal(path.basename(path.dirname(ry.arquivo)), "proj-y");
    assert.equal(path.dirname(path.dirname(rx.arquivo)), path.dirname(path.dirname(ry.arquivo)), "mesma base, projeto no caminho");
    assert.ok(!readFileSync(rx.arquivo, "utf8").includes("fedcba9876543210"));
  });

  test("pastaDoLog do núcleo: projeto vira segmento; sem projeto é a base (pasta antiga)", () => {
    const env = { XDG_STATE_HOME: "/h/.local/state" };
    assert.equal(pastaDoLog(env), "/h/.local/state/altair/conducao");
    assert.equal(pastaDoLog(env, "proj-x"), "/h/.local/state/altair/conducao/proj-x");
    assert.equal(pastaDoLog({ ALTAIR_CONDUCAO_LOG_DIR: "/x" }, "proj-x"), "/x", "override é a pasta final");
    for (const ruim of ["..", "a/b", "Com Espaço", ".oculto", ""]) assert.throws(() => pastaDoLog(env, ruim), /projeto inválido/);
  });

  test("um evento gravado por registrar no projeto X é lido pelos dois hooks", () => {
    const env = estacao();
    const repoX = repoDo("proj-x");
    const repoY = repoDo("proj-y");
    const x = lerAdaptador(repoX, { env });
    registrar(ABRIR, { procedencia: "intencao", quando: QUANDO, pasta: x.pastaDoLog });

    const envX = { ...env, CLAUDE_PROJECT_DIR: repoX };
    const envY = { ...env, CLAUDE_PROJECT_DIR: repoY };
    // Os dois hooks resolvem a mesma pasta que `registrar` usou.
    assert.deepEqual(nonceGuard.pastaDoLog(envX, repoX), { pasta: x.pastaDoLog, erro: null });
    assert.deepEqual(stopGuard.pastaDoLog(envX, repoX), { pasta: x.pastaDoLog, erro: null });

    // O nonce-guard lê a última ação emitida no projeto X…
    const acoes = nonceGuard.ultimasAcoes(nonceGuard.pastaDoLog(envX, repoX).pasta);
    assert.deepEqual(acoes.map((a) => [a.ciclo, a.nonces]), [[CICLO, [NONCE]]]);
    const raw = JSON.stringify({
      tool_name: "mcp__claude-code-remote__send_message",
      tool_input: { session_id: "session_01X", message: `segue ${NONCE}` },
    });
    assert.equal(nonceGuard.executar(raw, envX), 0);
    const logX = readFileSync(path.join(x.pastaDoLog, "conducao-nonce-guard.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(logX.at(-1).resultado, "ok");

    // …e no projeto Y, com o mesmo ciclo, o nonce de X não passa.
    assert.equal(nonceGuard.executar(raw, envY), 0);
    const pastaY = lerAdaptador(repoY, { env }).pastaDoLog;
    const logY = readFileSync(path.join(pastaY, "conducao-nonce-guard.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(logY.at(-1).resultado, "divergencia");
    assert.equal(logY.at(-1).motivo, "sem-acao-emitida");
  });
});

describe("logs v0 na pasta antiga", () => {
  test("linha sem v é lida como v0 e o arquivo não é reescrito", () => {
    const env = estacao();
    const antiga = pastaDoLog(env);
    mkdirSync(antiga, { recursive: true });
    const arquivo = arquivoDoLog("ATRM-51-velho", antiga);
    const v0 = `${JSON.stringify({ linha: "evento", chave: "a".repeat(24), quando: QUANDO, procedencia: "intencao", acao: "abrir", objetos: [], atributos: { nonce: NONCE } })}\n`;
    writeFileSync(arquivo, v0);

    const lidas = lerLog(arquivo);
    assert.equal(lidas.length, 1);
    assert.equal(lidas[0].v, 0);
    assert.equal(lidas[0].acao, "abrir");
    assert.equal(readFileSync(arquivo, "utf8"), v0, "ler não reescreve");

    // Escrever v1 por cima do v0 é recusado: o arquivo segue byte a byte.
    assert.throws(
      () => registrar({ ...ABRIR, ciclo: "ATRM-51-velho" }, { procedencia: "intencao", quando: QUANDO, pasta: antiga }),
      /log v0: só leitura/,
    );
    assert.equal(readFileSync(arquivo, "utf8"), v0);
    assert.deepEqual(readdirSync(antiga), ["ATRM-51-velho.jsonl"]);

    // O v1 do mesmo ciclo vai para a pasta do projeto, ao lado.
    const teste = lerAdaptador(RAIZ, { env });
    const r = registrar({ ...ABRIR, ciclo: "ATRM-51-velho" }, { procedencia: "intencao", quando: QUANDO, pasta: teste.pastaDoLog });
    assert.equal(r.arquivo, path.join(antiga, "teste", "ATRM-51-velho.jsonl"));
    assert.ok(lerLog(r.arquivo).every((l) => l.v === 1));
  });
});
