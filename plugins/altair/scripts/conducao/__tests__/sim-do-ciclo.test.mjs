/**
 * sim-do-ciclo.test.mjs — o sim do ciclo é a forma única (T13 do VEGA-29,
 * D-VEGA29-14, ruling 23-a do `/draft-review`).
 *
 * Um sim, dado pelo `autorizar-ciclo` na fase de partida, atravessa as fases
 * seguintes sem pedido novo (`herdar-autorizacao`, origem `ciclo`). Volta ao
 * operador só a task que mudou de classe ou de sensibilidade desde o sim — e
 * a pergunta pede o sim do ciclo de novo (`autorizar-ciclo`), nunca o da
 * fase: o `autorizar-fase` recusa.
 *
 * Hooks desligados no repo de teste (core.hooksPath=/dev/null); origin bare
 * em pasta temporária, porque os verbos de autorização empurram a cópia do ciclo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;

function task(id, { steps = "faz", fase = "F1" } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE1-1]",
    "- **Inputs:** `README.md`",
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    "- **Estação:** servidor",
    "- **Independente:** sim",
    `- **Steps:** ${steps}`,
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-${fase}/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

/** Três fases de uma task comum cada: F1/T1, F2/T2, F3/T3. */
function canonico() {
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
    ...[
      ["F1", "T1"],
      ["F2", "T2"],
      ["F3", "T3"],
    ].map(([f, t]) => [`### ${f} — fase ${f} (**Modelo:** sonnet)`, "", task(t, { fase: f })].join("\n")),
    "## 4. Pronto",
    "",
  ].join("\n");
}

function novoRepo(t) {
  const raiz = mkdtempSync(path.join(tmpdir(), "conducao-sim-ciclo-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const dir = path.join(raiz, "maestra");
  mkdirSync(dir);
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "ciclo-teste");
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]])
    g("config", k, v);
  g("remote", "add", "origin", origin);
  mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
  writeFileSync(path.join(dir, CAMINHO), canonico());
  writeFileSync(path.join(dir, "README.md"), "fixture\n");
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  const vazio = (...linhas) => g("commit", "-q", "--allow-empty", ...linhas.flatMap((l) => ["-m", l]));
  const conferida = (id) => vazio(`Conducao: ${id} conferida`, `Conducao-Task: ${id}\nConducao-Nonce: n-${id}`);
  const replanejar = (de, para, subject) => {
    const atual = readFileSync(path.join(dir, CAMINHO), "utf8");
    assert.ok(atual.includes(de), de);
    writeFileSync(path.join(dir, CAMINHO), atual.replace(de, para));
    g("commit", "-q", "-am", subject);
  };
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8" });
  const ok = (...args) => {
    const x = cli(...args);
    assert.equal(x.status, 0, `${args.join(" ")} → ${x.status}\n${x.stderr}\n${x.stdout}`);
    return JSON.parse(x.stdout.trim());
  };
  const proximo = () => ok("proximo");
  return { g, conferida, replanejar, cli, ok, proximo };
}

/**
 * Leva a condução até a F3 sob um sim só: devolve cada saída do `proximo`
 * no caminho, para o teste conferir que nenhuma perguntou.
 */
function atravessarF1eF2(r) {
  const saidas = [];
  const p = (x) => (saidas.push(x), x);
  const a1 = p(r.proximo());
  assert.equal(a1.acao, "abrir", JSON.stringify(a1));
  assert.equal(a1.fase, "F1");
  r.conferida("T1");
  const h2 = p(r.proximo());
  assert.equal(h2.acao, "herdar-autorizacao", JSON.stringify(h2));
  assert.equal(h2.fase, "F2");
  assert.equal(h2.origem, "ciclo");
  r.ok("herdar-autorizacao", "F2", "--nonce", h2.nonce);
  const a2 = p(r.proximo());
  assert.equal(a2.acao, "abrir", JSON.stringify(a2));
  assert.equal(a2.fase, "F2");
  r.conferida("T2");
  return saidas;
}

test("o sim do ciclo atravessa duas fases sem novo pedido e para na task que muda de classe", (t) => {
  const r = novoRepo(t);
  // Sem autorização nenhuma, a pergunta é o sim do ciclo, com a fase de partida sugerida.
  const pedido = r.proximo();
  assert.equal(pedido.acao, "perguntar", JSON.stringify(pedido));
  assert.equal(pedido.motivo, "autorizar-ciclo");
  assert.equal(pedido.fase, "F1");

  r.ok("autorizar-ciclo", "F1", "--sim", "sim, pode tocar o ciclo inteiro");
  const saidas = atravessarF1eF2(r);
  assert.deepEqual(
    saidas.filter((s) => s.acao === "perguntar"),
    [],
    "F1 e F2 sob o mesmo sim, sem pergunta",
  );

  // Re-plano de ruling que dá publicação à T3: muda a classe dela desde o sim.
  r.replanejar(
    "- **Steps:** faz\n- **Verificação:** `echo verificacao-T3`",
    "- **Steps:** aplica a migration com `db-publish.mjs … db push`\n- **Verificação:** `echo verificacao-T3`",
    `${CICLO}-F2/D-TESTE1-9 — re-plano de T3: publica`,
  );
  const parada = r.proximo();
  assert.equal(parada.acao, "perguntar", JSON.stringify(parada));
  assert.equal(parada.motivo, "autorizar-ciclo", "pede o sim do ciclo de novo, nunca o da fase");
  assert.equal(parada.fase, "F3");
  assert.deepEqual(parada.mudaramDeClasse.map((m) => m.task), ["T3"]);

  // O sim por fase não é a saída: o verbo recusa e não grava nada.
  const antes = r.g("rev-parse", "HEAD");
  const velho = r.cli("autorizar-fase", "F3", "--sim", "sim");
  assert.equal(velho.status, 1, velho.stderr);
  assert.match(velho.stderr, /autorizar-fase foi aposentado/);
  assert.equal(r.g("rev-parse", "HEAD"), antes);

  // O sim do ciclo de novo, sob o plano novo: a T3, sensível, abre coberta pelo sim dado nesta fase.
  r.ok("autorizar-ciclo", "F3", "--sim", "sim, a T3 pode publicar");
  const a3 = r.proximo();
  assert.equal(a3.acao, "abrir", JSON.stringify(a3));
  assert.deepEqual(a3.tarefas.map((x) => [x.task, x.classe]), [["T3", "sensivel"]]);
  assert.deepEqual(a3.cobertasPelaFase?.tasks, ["T3"]);
});

test("contraprova: o mesmo re-plano sem mudar classe nem sensibilidade segue sob o sim do ciclo", (t) => {
  const r = novoRepo(t);
  r.ok("autorizar-ciclo", "F1", "--sim", "sim, pode tocar o ciclo inteiro");
  atravessarF1eF2(r);
  r.replanejar("- **Objetivo:** tarefa T3", "- **Objetivo:** tarefa T3, reescrita", `${CICLO}-F2/D-TESTE1-9 — re-plano de T3: objetivo`);
  const h3 = r.proximo();
  assert.equal(h3.acao, "herdar-autorizacao", JSON.stringify(h3));
  assert.equal(h3.fase, "F3");
  assert.equal(h3.origem, "ciclo");
});
