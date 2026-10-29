/**
 * sem-ci.test.mjs — projeto sem CI e modos sem clique do adaptador (VEGA-29 T15, 5-a, D-VEGA29-29).
 *
 * Um ciclo de mentira cujo adaptador declara `ci: false` fecha a fase
 * (`encerrar-sessao`) e o ciclo (`fechar-ciclo`) pela Verificação verde da
 * última tarefa, sem `esperar` veredito de CI; o mesmo ciclo com o adaptador
 * default (`ci` ausente ⇒ `true`) segue esperando o CI.
 *
 * O `abrir` mede o "sem clique" pelo modo da sessão que cria a filha, contra
 * `sessao.modosSemClique` do adaptador: com a declaração do projeto de teste (só
 * `auto`), uma criadora em `bypassPermissions` sai `perguntar
 * modo-da-maestra` e nada é gravado; com uma declaração que aceita
 * `bypassPermissions`, a filha abre.
 *
 * Origin bare em pasta temporária, hooks desligados no repo de teste
 * (core.hooksPath=/dev/null); a declaração do adaptador vai em
 * `<repo>/.altair/adaptador.json`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lerAdaptador, modoSemClique, validar } from "../adaptador.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
/** O projeto de teste das suítes: a declaração e o código de um projeto de mentira. */
const RAIZ = path.resolve(AQUI, "fixtures", "projeto-de-teste");
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;
const DECLARACAO = JSON.parse(readFileSync(path.join(RAIZ, ".altair", "adaptador.json"), "utf8"));

function task(id, { inputs = "`README.md`", satisfies = "[AC-TESTE1-1]", fase = "F1" } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    `- **satisfies:** ${satisfies}`,
    `- **Inputs:** ${inputs}`,
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    "- **Estação:** servidor",
    "- **Steps:** faz",
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-${fase}/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

const FECHA = "[—] (fechamento-de-fase)";

const CANONICO = [
  "---",
  `cycle: ${CICLO}`,
  "opened: 2026-10-28",
  "---",
  "",
  "## 1. Goal",
  "",
  "### 1.5 Modo de Execução",
  "",
  "**Largura do ciclo:** 2",
  "",
  "## 3. Tasks",
  "",
  "### F1 — fase F1 (**Modelo:** sonnet)",
  "",
  task("T1"),
  task("T2", { inputs: "T1", satisfies: FECHA }),
  "### F2 — fase F2 (**Modelo:** opus)",
  "",
  task("T3", { inputs: "T2", fase: "F2" }),
  task("T4", { inputs: "T3", satisfies: FECHA, fase: "F2" }),
  "## 4. Pronto",
  "",
].join("\n");

/**
 * Declaração de mentira: a do projeto de teste com os campos de `extra` por cima (`undefined` tira o campo).
 * Sem a `pagina` do projeto de teste: o repositório de mentira não tem a página, e o `abrir` a confere no HEAD (T38).
 */
function declaracao(extra) {
  const d = { ...DECLARACAO, pagina: undefined, projeto: "mentira", ...extra };
  for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
  return d;
}

/** Origin bare + árvore da maestra no ramo do ciclo, com o plano e a declaração do adaptador commitados. */
function ambiente(t, decl) {
  const raiz = mkdtempSync(path.join(tmpdir(), "conducao-sem-ci-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const dir = path.join(raiz, "maestra");
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  mkdirSync(dir);
  g("init", "-q", "-b", "ciclo-teste");
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]])
    g("config", k, v);
  g("remote", "add", "origin", origin);
  mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
  mkdirSync(path.join(dir, ".altair"));
  writeFileSync(path.join(dir, CAMINHO), CANONICO);
  writeFileSync(path.join(dir, "README.md"), "fixture\n");
  writeFileSync(path.join(dir, ".altair", "adaptador.json"), `${JSON.stringify(decl, null, 2)}\n`);
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  g("push", "-q", "origin", "ciclo-teste");
  const vazio = (...linhas) => g("commit", "-q", "--allow-empty", ...linhas.flatMap((l) => ["-m", l]));
  const autorizar = (fase) => vazio(`Conducao: ${fase} autorizada`, "sim do Rita, no turno dele", `Conducao-Plano: ${g("rev-parse", `HEAD:${CAMINHO}`)}`);
  const conferida = (id) =>
    vazio(
      `Conducao: ${id} conferida`,
      `Conducao-Task: ${id}\nConducao-Sha-Filha: 0000000\nConducao-Sessao-Filha: s\nConducao-Nonce: n-${id}\nConducao-Verificacao: verde\nConducao-Publicacao: nao-se-aplica`,
    );
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const linhas = r.stdout.split("\n").filter(Boolean);
    return { status: r.status, stderr: r.stderr, saida: linhas.length === 1 ? JSON.parse(linhas[0]) : null };
  };
  const proximo = (entrada) => {
    const r = cli("proximo", ...(entrada ? ["--entrada", JSON.stringify(entrada)] : []));
    assert.equal(r.status, 0, r.stderr);
    return r.saida;
  };
  const noOrigin = (ref) => {
    const linha = g("ls-remote", "origin", ref);
    return linha ? linha.split("\t")[0] : null;
  };
  return { dir, g, cli, proximo, autorizar, conferida, noOrigin, head: () => g("rev-parse", "HEAD") };
}

/** A F1 conduzida até o fechamento conferido (a Verificação verde da última tarefa). */
function f1Conferida(t, decl) {
  const a = ambiente(t, decl);
  a.autorizar("F1");
  for (const id of ["T1", "T2"]) a.conferida(id);
  return a;
}

// ── fechamento sem CI ───────────────────────────────────────────────────────

test("sem CI: a fase fecha pela Verificacao da ultima tarefa, sem esperar run nem veredito", (t) => {
  const a = f1Conferida(t, declaracao({ ci: false }));
  // Nenhum veredito de CI na entrada: com CI seria `esperar ci-pendente`.
  // Sem CI o veredito é o da Verificação: nem um CI vermelho na entrada o muda.
  for (const entrada of [undefined, { ci: null }, { sessaoMaestra: "session_maestra_f1" }, { ci: { sha: a.head(), veredito: "vermelho", run: 9 } }]) {
    const e = a.proximo(entrada);
    assert.equal(e.acao, "encerrar-sessao", JSON.stringify(e));
    assert.equal(e.fase, "F1");
    assert.equal(e.faseSeguinte, "F2");
    assert.equal(e.task, "T2");
  }
  const e = a.proximo();
  assert.equal(a.cli("encerrar-sessao", "--fase", "F1", "--nonce", e.nonce).status, 0);
  assert.equal(a.g("log", "-1", "--format=%(trailers:key=Conducao-Encerrada,valueonly)"), "F1");
  // A F2 inteira conferida: o ciclo também fecha sem CI.
  a.autorizar("F2");
  for (const id of ["T3", "T4"]) a.conferida(id);
  const f = a.proximo({ sessaoMaestra: "session_maestra_f2" });
  assert.equal(f.acao, "fechar-ciclo", JSON.stringify(f));
  assert.deepEqual(f.conduzidas, ["F1", "F2"]);
  assert.equal(f.texto.split("\n")[0], `/close-cycle ${CICLO}`);
});

test("com CI (o default do adaptador): a mesma fase espera o veredito do CI no HEAD", (t) => {
  const a = f1Conferida(t, declaracao({ ci: undefined }));
  const p = a.proximo();
  assert.equal(p.acao, "esperar");
  assert.equal(p.motivo, "ci-pendente");
  assert.equal(a.proximo({ ci: { sha: a.head(), veredito: "vermelho", run: 7 } }).motivo, "ci-vermelho");
  assert.equal(a.proximo({ ci: { sha: a.head(), veredito: "verde", run: 8 } }).acao, "encerrar-sessao");
});

test("sem CI: o fechamento ainda nao conferido nao fecha a fase", (t) => {
  const a = ambiente(t, declaracao({ ci: false }));
  a.autorizar("F1");
  a.conferida("T1");
  const p = a.proximo();
  assert.notEqual(p.acao, "encerrar-sessao", JSON.stringify(p));
  assert.equal(p.acao, "fechar-fase", JSON.stringify(p));
  assert.equal(p.task, "T2");
});

// ── modos sem clique ────────────────────────────────────────────────────────

test("declaracao do projeto de teste: ci true e so auto como modo sem clique", () => {
  const d = lerAdaptador(RAIZ, { env: { XDG_STATE_HOME: mkdtempSync(path.join(tmpdir(), "sem-ci-estado-")) } });
  assert.equal(d.ci, true);
  assert.deepEqual([...d.sessao.modosSemClique], ["auto"]);
  assert.equal(modoSemClique(d, "auto"), true);
  assert.equal(modoSemClique(d, "PERMISSION_MODE_AUTO"), true);
  assert.equal(modoSemClique(d, "bypassPermissions"), false);
  // Ausentes, os dois campos caem no default.
  const { ci, sessao, ...semOsDois } = DECLARACAO;
  const padrao = validar(semOsDois);
  assert.equal(padrao.ci, true);
  assert.deepEqual([...padrao.sessao.modosSemClique], ["auto"]);
});

test("declaracao recusa ci fora de booleano e lista de modos vazia ou com campo a mais", () => {
  assert.throws(() => validar({ ...DECLARACAO, ci: "nao" }), /ci: esperado true ou false/);
  assert.throws(() => validar({ ...DECLARACAO, sessao: { modosSemClique: [] } }), /sessao.modosSemClique/);
  assert.throws(() => validar({ ...DECLARACAO, sessao: { modosSemClique: ["auto"], ponte: "bypassPermissions" } }), /campo desconhecido ponte/);
});

test("com a declaracao do projeto de teste, criadora em bypassPermissions pergunta modo-da-maestra e nada e gravado", (t) => {
  const a = ambiente(t, declaracao({}));
  assert.equal(a.cli("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1").status, 0);
  const head = a.head();
  const r = a.cli("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "bypassPermissions");
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.saida.acao, "perguntar");
  assert.equal(r.saida.motivo, "modo-da-maestra");
  assert.equal(r.saida.modo, "bypasspermissions");
  assert.deepEqual(r.saida.modosSemClique, ["auto"]);
  assert.equal(a.head(), head);
  assert.equal(a.noOrigin(`refs/conducao/${CICLO}/T1/1`), null);
  assert.throws(() => a.g("rev-parse", "--verify", "-q", `refs/conducao-local/${CICLO}/T1/1`));
});

test("com declaracao que aceita bypassPermissions, a filha abre", (t) => {
  const a = ambiente(t, declaracao({ sessao: { modosSemClique: ["auto", "bypassPermissions"] } }));
  assert.equal(a.cli("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1").status, 0);
  const head = a.head();
  const r = a.cli("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "bypassPermissions");
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual(r.saida.acao, "perguntar", JSON.stringify(r.saida));
  assert.equal(a.head(), head, "o marcador não entra no ramo");
  assert.equal(a.noOrigin(`refs/conducao/${CICLO}/T1/1`), r.saida.marcador);
  assert.equal(a.g("log", "-1", "--format=%s", r.saida.marcador), "Conducao: abrir T1 tentativa 1 nonce nonceT11");
});
