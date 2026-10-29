/**
 * autorizacao-vigente.test.mjs — a autorização vigente é uma leitura só
 * (T13 do VEGA-29, D-VEGA29-25; achado A3 da neta da T5).
 *
 * `proximo` (conducao.mjs) e `trazer`/`conferir` (git-conducao.mjs) leem a
 * autorização vigente como a última `autorizada` de `lerMarcas`
 * (`--reverse --topo-order`), nunca a de data mais nova. Três casos em git
 * real: merge cujo lado mesclado traz autorização de data mais velha que a do
 * primeiro pai; `Conducao-Plano` repetido fica com o primeiro valor; trailer
 * `conducao-plano:` em minúscula não é lido como `Conducao-Plano`.
 *
 * Só caracteriza: o comportamento já é o do HEAD em que a T13 nasceu.
 * Hooks desligados no repo de teste (core.hooksPath=/dev/null); origin bare
 * em pasta temporária, porque o `trazer` busca a tentativa no origin.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lerMarcas, ultimaAutorizacao } from "../marcas.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;

function task(id, fase) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE1-1]",
    "- **Inputs:** `README.md`",
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    "- **Estação:** servidor",
    "- **Independente:** sim",
    "- **Steps:** faz",
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-${fase}/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

/** `fases`: `[["F1", ["T1", "T2"]], …]`. */
function canonico(fases) {
  return [
    "---",
    `cycle: ${CICLO}`,
    "opened: 2026-10-28",
    "---",
    "",
    "## 1. Goal",
    "",
    "### 1.5 Modo de Execução",
    "",
    "**Largura do ciclo:** 1",
    "",
    "## 3. Tasks",
    "",
    ...fases.map(([f, ts]) => [`### ${f} — fase ${f} (**Modelo:** sonnet)`, "", ...ts.map((t) => task(t, f))].join("\n")),
    "## 4. Pronto",
    "",
  ].join("\n");
}

function novoRepo(t) {
  const raiz = mkdtempSync(path.join(tmpdir(), "conducao-autorizacao-vigente-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const dir = path.join(raiz, "maestra");
  mkdirSync(dir);
  const g = (args, env = {}) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } }).trim();
  g(["init", "-q", "-b", "ciclo-teste"]);
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]])
    g(["config", k, v]);
  g(["remote", "add", "origin", origin]);
  mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "README.md"), "fixture\n");
  /** Grava o canonico com `fases` num commit; devolve o blob dele. */
  const plano = (fases, data) => {
    writeFileSync(path.join(dir, CAMINHO), canonico(fases));
    g(["add", "-A"]);
    g(["commit", "-q", "-m", "plano"], quando(data));
    return g(["rev-parse", `HEAD:${CAMINHO}`]);
  };
  /** Marca `Conducao: <fase> autorizada` com o corpo dado (trailers inclusos), na data dada. */
  const marca = (fase, corpo, data) => {
    g(["commit", "-q", "--allow-empty", "-m", `Conducao: ${fase} autorizada`, "-m", corpo], quando(data));
    return g(["rev-parse", "HEAD"]);
  };
  const cli = (...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  const json = (r) => JSON.parse(r.stdout.trim().split("\n").at(-1));
  return { raiz, dir, origin, g, plano, marca, cli, json };
}

function quando(data) {
  return data ? { GIT_AUTHOR_DATE: data, GIT_COMMITTER_DATE: data } : {};
}

const VELHA = "2026-01-01T00:00:00Z";
const NOVA = "2026-06-01T00:00:00Z";

/**
 * Histórico do caso 1: o lado mesclado traz a T2 no plano e `F1 autorizada`
 * de data VELHA; o primeiro pai traz um plano sem a T2 e `F2 autorizada` de
 * data NOVA; o merge fica com o canonico do lado.
 */
function historicoComMerge(t) {
  const r = novoRepo(t);
  r.plano([["F1", ["T1"]]], VELHA);
  r.g(["checkout", "-q", "-b", "lado"]);
  const blobLado = r.plano([["F1", ["T1", "T2"]], ["F2", ["T3"]]], VELHA);
  const doLado = r.marca("F1", `sim do Rita\n\nConducao-Plano: ${blobLado}`, VELHA);
  r.g(["checkout", "-q", "ciclo-teste"]);
  const blobPai = r.plano([["F1", ["T1"]], ["F2", ["T3"]]], NOVA);
  const doPai = r.marca("F2", `sim do Rita\n\nConducao-Plano: ${blobPai}`, NOVA);
  // O merge resolve o canonico pela versão do lado: o plano do HEAD é o congelado na vigente.
  r.g(["merge", "-q", "--no-ff", "--no-commit", "-s", "ours", "lado"]);
  r.g(["checkout", "lado", "--", CAMINHO]);
  r.g(["commit", "-q", "-m", "merge do lado"], quando(NOVA));
  return { ...r, blobLado, blobPai, doLado, doPai };
}

// ── 1. merge com autorização mais velha no lado mesclado ─────────────────────

test("merge com autorizacao mais velha no lado mesclado: a vigente e a da ordem topologica, igual no proximo, no conferir e no trazer", (t) => {
  const r = historicoComMerge(t);
  // O caso só discrimina se a ordem por data der outra marca: a leitura antiga dava a F2.
  const porData = r.g(["log", "-1", "--extended-regexp", "--grep=^Conducao: (F[0-9]+) autorizada$", "--format=%H"]);
  assert.equal(porData, r.doPai, "por data, a mais nova é a do primeiro pai");

  const vigente = ultimaAutorizacao(lerMarcas(r.dir));
  assert.deepEqual(vigente, { tipo: "autorizada", sha: r.doLado, fase: "F1", plano: r.blobLado });

  // proximo: a fase em curso é a F1 do plano congelado no lado (a T2 só existe nele).
  const p = r.cli("proximo");
  assert.equal(p.status, 0, p.stderr);
  const px = r.json(p);
  assert.equal(px.acao, "abrir", JSON.stringify(px));
  assert.equal(px.fase, "F1");
  assert.equal(px.plano, r.blobLado);

  // conferir (git-conducao via conducao.mjs): a T2, que só existe no plano do lado, tem a Verificação dele.
  const c = r.cli("conferir", "T2");
  assert.equal(c.status, 0, c.stderr);
  const cx = r.json(c);
  assert.equal(cx.plano, r.blobLado, JSON.stringify(cx));
  assert.match(JSON.stringify(cx), /echo verificacao-T2/);

  // trazer (git-conducao.mjs): a tentativa da T2 lê o mesmo plano congelado e é trazida.
  const head = r.g(["rev-parse", "HEAD"]);
  const marcador = r.g(["commit-tree", r.g(["rev-parse", "HEAD^{tree}"]), "-p", head, "-m", "Conducao: abrir T2 tentativa 1 nonce 0123456789abcdef"]);
  r.g(["update-ref", `refs/conducao-local/${CICLO}/T2/1`, marcador]);
  r.g(["checkout", "-q", "--detach", marcador]);
  writeFileSync(path.join(r.dir, "src", "t2.mjs"), "export const t2 = 2;\n");
  r.g(["add", "-A"]);
  r.g(["commit", "-q", "-m", `${CICLO}-F1/T2 — tarefa T2`]);
  const ponta = r.g(["rev-parse", "HEAD"]);
  r.g(["push", "-q", "origin", `${ponta}:refs/conducao/${CICLO}/T2/1`]);
  r.g(["checkout", "-q", "ciclo-teste"]);
  const tr = r.cli("trazer", "T2", "--tentativa", "1", "--sha", ponta.slice(0, 8), "--sessao", "sessao-filha");
  assert.equal(tr.status, 0, `${tr.stderr}\n${tr.stdout}`);
  assert.notEqual(r.json(tr).acao, "perguntar", tr.stdout);
  assert.equal(r.g(["rev-parse", "HEAD"]), ponta, "trazida por fast-forward");
});

test("contraprova do caso 1: no plano do primeiro pai a T2 nao existe, e o conferir recusa", (t) => {
  const r = historicoComMerge(t);
  // O plano do primeiro pai de volta e uma autorização nova da F2 sobre ele: passa a ser a vigente.
  assert.equal(r.plano([["F1", ["T1"]], ["F2", ["T3"]]], NOVA), r.blobPai);
  r.marca("F2", `sim do Rita\n\nConducao-Plano: ${r.blobPai}`, NOVA);
  assert.equal(ultimaAutorizacao(lerMarcas(r.dir)).plano, r.blobPai);
  const c = r.cli("conferir", "T2");
  assert.equal(c.status, 1, c.stdout);
  assert.match(c.stderr, /task-ausente/);
});

// ── 2. Conducao-Plano repetido ───────────────────────────────────────────────

test("Conducao-Plano repetido fica com o primeiro valor, e o proximo le o plano dele", (t) => {
  const r = novoRepo(t);
  const blob = r.plano([["F1", ["T1"]]]);
  const outro = "f".repeat(40);
  const sha = r.marca("F1", `sim do Rita\n\nConducao-Plano: ${blob}\nConducao-Plano: ${outro}`);
  assert.match(r.g(["log", "-1", "--format=%(trailers:key=Conducao-Plano,valueonly)"]), new RegExp(`${blob}\\n${outro}`));
  assert.deepEqual(ultimaAutorizacao(lerMarcas(r.dir)), { tipo: "autorizada", sha, fase: "F1", plano: blob });
  const p = r.cli("proximo");
  assert.equal(p.status, 0, p.stderr);
  const px = r.json(p);
  assert.equal(px.acao, "abrir", JSON.stringify(px));
  assert.equal(px.plano, blob);
});

// ── 3. trailer em minúscula ──────────────────────────────────────────────────

test("trailer conducao-plano em minuscula nao e lido como Conducao-Plano", (t) => {
  const r = novoRepo(t);
  const blob = r.plano([["F1", ["T1"]]]);
  const sha = r.marca("F1", `sim do Rita\n\nconducao-plano: ${blob}`);
  // O git o reconhece como trailer; a leitura da condução diferencia a caixa do nome.
  assert.equal(r.g(["log", "-1", "--format=%(trailers:only=true,unfold=true)"]), `conducao-plano: ${blob}`);
  assert.deepEqual(ultimaAutorizacao(lerMarcas(r.dir)), { tipo: "autorizada", sha, fase: "F1", plano: null });
  // Sem plano congelado, nem o proximo nem o conferir seguem: viram pergunta/recusa, nunca leem o plano.
  const p = r.cli("proximo");
  assert.equal(p.status, 0, p.stderr);
  const px = r.json(p);
  assert.equal(px.acao, "perguntar", JSON.stringify(px));
  assert.match(JSON.stringify(px), /marca-sem-plano/);
  const c = r.cli("conferir", "T1");
  assert.equal(c.status, 1, c.stdout);
  assert.match(c.stderr, /marca-sem-plano/);
});
