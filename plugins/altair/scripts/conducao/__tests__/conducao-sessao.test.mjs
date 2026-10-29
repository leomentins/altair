/**
 * conducao-sessao.test.mjs — uma fase por sessão maestra (VEGA-22 T21) e o
 * re-plano no meio da fase e o fechamento do ciclo pelo próximo passo (T22).
 *
 * Fase anterior com o fechamento conferido e a seguinte sem autorização: o
 * `proximo` fecha a sessão (`encerrar-sessao`, só com CI verde no HEAD) antes
 * de pedir o "sim" da fase seguinte; com a marca `Conducao-Encerrada` gravada,
 * volta a pedir o "sim" — sem depender de qual sessão chama. Plano do HEAD
 * mudado nas tasks com a fase em curso pergunta `plano-mudou`; sem fase
 * restante, o `proximo` entrega o texto da sessão limpa do `/close-cycle`.
 *
 * Origin bare em pasta temporária (o verbo empurra a cópia do ciclo), hooks
 * desligados no repo de teste (core.hooksPath=/dev/null).
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
  "opened: 2026-10-17",
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

/** Origin bare + árvore da maestra no ramo do ciclo, com a F1 conduzida até o fechamento conferido. */
function ambiente(t) {
  const raiz = mkdtempSync(path.join(tmpdir(), "conducao-sessao-"));
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
  writeFileSync(path.join(dir, CAMINHO), CANONICO);
  g("add", CAMINHO);
  g("commit", "-q", "-m", "plano");
  g("push", "-q", "origin", "ciclo-teste");
  const vazio = (...linhas) => g("commit", "-q", "--allow-empty", ...linhas.flatMap((l) => ["-m", l]));
  const autorizar = (fase) => vazio(`Conducao: ${fase} autorizada`, "sim do Rita, no turno dele", `Conducao-Plano: ${g("rev-parse", `HEAD:${CAMINHO}`)}`);
  const conferida = (id) =>
    vazio(
      `Conducao: ${id} conferida`,
      `Conducao-Task: ${id}\nConducao-Sha-Filha: 0000000\nConducao-Sessao-Filha: s\nConducao-Nonce: n-${id}\nConducao-Verificacao: verde\nConducao-Publicacao: nao-se-aplica`,
    );
  autorizar("F1");
  for (const id of ["T1", "T2"]) conferida(id);
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8" });
  const proximo = (entrada) => {
    const r = cli("proximo", ...(entrada ? ["--entrada", JSON.stringify(entrada)] : []));
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim());
  };
  const head = () => g("rev-parse", "HEAD");
  /** O que a maestra da F1 e a da F2 fazem: encerra a F1 com CI verde e autoriza a F2. */
  const abrirF2 = () => {
    const n = proximo({ ci: { sha: head(), veredito: "verde", run: 1 } });
    assert.equal(n.acao, "encerrar-sessao");
    assert.equal(cli("encerrar-sessao", "--fase", "F1", "--nonce", n.nonce).status, 0);
    autorizar("F2");
  };
  /** Re-plano: o canonico do HEAD com `de` trocado por `para`, num commit. */
  const replanejar = (de, para) => {
    const texto = readFileSync(path.join(dir, CAMINHO), "utf8");
    assert.ok(texto.includes(de), de);
    writeFileSync(path.join(dir, CAMINHO), texto.replace(de, para));
    g("commit", "-q", "-am", "re-plano");
  };
  return { dir, g, cli, proximo, head, vazio, autorizar, conferida, abrirF2, replanejar };
}

test("fase fechada com CI verde no HEAD e sem marca de encerramento emite encerrar-sessao com o texto da proxima", (t) => {
  const a = ambiente(t);
  const head = a.head();
  const e = a.proximo({ ci: { sha: head, veredito: "verde", run: 101 }, sessaoMaestra: "session_maestra_f1" });
  assert.equal(e.acao, "encerrar-sessao");
  assert.equal(e.fase, "F1");
  assert.equal(e.faseSeguinte, "F2");
  assert.equal(e.task, "T2");
  assert.match(e.nonce, /^[0-9a-f]{16}$/);
  // O texto: ciclo conduzido, fase seguinte, worktree conduzida, a sessão a arquivar, retomar e o pedido do sim.
  assert.match(e.texto, new RegExp(`Conduzir ${CICLO} — F2`));
  assert.ok(e.texto.includes(`--repo ${a.dir}`), e.texto);
  // O caminho é o da raiz do plugin: `<raiz>/skills/conducao/SKILL.md` e `<raiz>/scripts/conducao/conducao.mjs`.
  assert.match(e.texto, /pela skill \S+\/skills\/conducao\/SKILL\.md /);
  assert.match(e.texto, /node \S+\/scripts\/conducao\/conducao\.mjs retomar /);
  assert.match(e.texto, /archive_session da maestra anterior session_maestra_f1 antes do retomar/);
  assert.match(e.texto, / retomar --repo /);
  assert.match(e.texto, /autorizar-ciclo F2: pedir o sim do ciclo a Rita/);
  // sha abreviado do HEAD também vale; mesmo estado, mesmo nonce.
  assert.equal(a.proximo({ ci: { sha: head.slice(0, 8), veredito: "verde", run: 101 } }).nonce, e.nonce);

  // O verbo grava a marca no ramo, com o trailer, e empurra a cópia.
  const r = a.cli("encerrar-sessao", "--fase", "F1", "--nonce", e.nonce);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout.trim());
  assert.equal(s.acao, "encerrada");
  assert.equal(s.jaEstava, false);
  assert.equal(a.g("log", "-1", "--format=%s"), "Conducao: F1 sessao encerrada");
  assert.equal(a.g("log", "-1", "--format=%(trailers:key=Conducao-Encerrada,valueonly)"), "F1");
  assert.equal(a.g("ls-remote", "origin", `refs/conducao/${CICLO}/copia`).split("\t")[0], a.head());
  // De novo: não grava outra marca.
  const de2 = JSON.parse(a.cli("encerrar-sessao", "--fase", "F1", "--nonce", e.nonce).stdout.trim());
  assert.equal(de2.jaEstava, true);
  assert.equal(de2.sha, s.sha);
  assert.equal(a.head(), s.sha);
});

test("com a marca de encerramento da fase o proximo pede o sim do ciclo seja qual for a sessao", (t) => {
  const a = ambiente(t);
  const n = a.proximo({ ci: { sha: a.head(), veredito: "verde", run: 7 } }).nonce;
  assert.equal(a.cli("encerrar-sessao", "--fase", "F1", "--nonce", n).status, 0);
  // Qualquer sessão, qualquer CI (ou nenhum): a marca vive no ramo, não na conversa.
  for (const entrada of [undefined, { sessaoMaestra: "session_nova" }, { sessaoMaestra: "session_maestra_f1", ci: { sha: a.head(), veredito: "verde", run: 7 } }, { ci: { sha: "deadbeef", veredito: "vermelho", run: 8 } }]) {
    const p = a.proximo(entrada);
    assert.equal(p.acao, "perguntar", JSON.stringify(entrada));
    assert.equal(p.motivo, "autorizar-ciclo");
    assert.equal(p.fase, "F2");
  }
  // Autorizada a F2, o laço segue: abre a T3.
  const blob = a.g("rev-parse", `HEAD:${CAMINHO}`);
  a.g("commit", "-q", "--allow-empty", "-m", "Conducao: F2 autorizada", "-m", "sim", "-m", `Conducao-Plano: ${blob}`);
  const ab = a.proximo();
  assert.equal(ab.acao, "abrir");
  assert.deepEqual(ab.tarefas.map((x) => x.task), ["T3"]);
});

test("CI vermelho emite perguntar ci-vermelho e CI ausente ou de outro sha emite esperar, nunca encerrar-sessao", (t) => {
  const a = ambiente(t);
  const head = a.head();
  const v = a.proximo({ ci: { sha: head, veredito: "vermelho", run: 9 } });
  assert.equal(v.acao, "perguntar");
  assert.equal(v.motivo, "ci-vermelho");
  assert.equal(v.fase, "F1");
  assert.deepEqual(v.ci, { sha: head, veredito: "vermelho", run: 9 });
  for (const entrada of [
    undefined,
    {},
    { ci: null },
    { ci: { sha: "0123456789abcdef0123456789abcdef01234567", veredito: "verde", run: 3 } },
    { ci: { sha: head, run: 3 } },
    { ci: { sha: head.slice(0, 4), veredito: "verde", run: 3 } },
    { ci: { desfecho: "verde", sha: head } },
  ]) {
    const p = a.proximo(entrada);
    assert.equal(p.acao, "esperar", JSON.stringify(entrada));
    assert.equal(p.motivo, "ci-pendente");
    assert.equal(p.fase, "F1");
  }
  // Nenhum dos dois gravou marca: o ramo segue sem `Conducao-Encerrada`.
  assert.equal(a.head(), head);
});

// ── T22: re-plano no meio da fase ───────────────────────────────────────────

test("plano do HEAD diferente do autorizado nas tasks com a fase em curso emite perguntar plano-mudou com o diff", (t) => {
  const a = ambiente(t);
  a.abrirF2();
  assert.equal(a.proximo().acao, "abrir");
  const blobAutorizado = a.g("rev-parse", `HEAD:${CAMINHO}`);
  // Re-plano: a T3 ganha uma saída.
  a.replanejar("`src/t3.mjs` (create)", "`src/t3.mjs` (create) · `src/t3b.mjs` (create)");
  const p = a.proximo();
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, "plano-mudou");
  assert.equal(p.fase, "F2");
  assert.equal(p.planoAnterior, blobAutorizado);
  assert.equal(p.planoNovo, a.g("rev-parse", `HEAD:${CAMINHO}`));
  assert.match(p.diffPlano, /^\+.*src\/t3b\.mjs/m);
  assert.deepEqual(p.tasksMudadas, [
    { task: "T3", mudou: "campos", campos: { outputs: { de: ["src/t3.mjs"], para: ["src/t3.mjs", "src/t3b.mjs"] } } },
  ]);
  assert.deepEqual(p.mudaramDeClasse, []);
  assert.deepEqual(p.trazidas, []);

  // Com a T3 trazida e não conferida, a pergunta diz qual.
  const tree = a.g("rev-parse", "HEAD^{tree}");
  const reg = a.g("commit-tree", tree, "-p", a.head(), "-m", "Conducao: T3 tentativa 1 trazida", "-m", "Conducao-Nonce: n-traz\nConducao-Sha-Filha: 1234567");
  const ref = `refs/conducao-local/${CICLO}/trazida/T3/1`;
  a.g("update-ref", ref, reg);
  const comTrazida = a.proximo();
  assert.equal(comTrazida.motivo, "plano-mudou");
  assert.deepEqual(comTrazida.trazidas, [{ task: "T3", tentativa: 1, nonceTentativa: "n-traz", ref }]);

  // Reautorizada a F2 sob o plano novo, a condução segue: a trazida pede a conferência.
  a.autorizar("F2");
  const segue = a.proximo();
  assert.equal(segue.acao, "perguntar");
  assert.equal(segue.motivo, "trazida-sem-conferencia");
  assert.equal(segue.task, "T3");
});

test("so o paragrafo 13 mudou desde a autorizacao e o proximo segue sem perguntar", (t) => {
  const a = ambiente(t);
  a.abrirF2();
  const blobAutorizado = a.g("rev-parse", `HEAD:${CAMINHO}`);
  a.replanejar("## 4. Pronto\n", "## 4. Pronto\n\n## 13. Estado vivo\n\n- **evento · F2/T3 · `abcdef12`** — tarefa T3 · 17/10\n");
  // E um typo no objetivo de uma task: texto, não plano.
  a.replanejar("- **Objetivo:** tarefa T3", "- **Objetivo:** tarefa T3, corrigida");
  assert.notEqual(a.g("rev-parse", `HEAD:${CAMINHO}`), blobAutorizado);
  const p = a.proximo();
  assert.equal(p.acao, "abrir", JSON.stringify(p));
  assert.deepEqual(p.tarefas.map((x) => x.task), ["T3"]);
  assert.equal(p.plano, blobAutorizado);
});

// ── T22: fechamento do ciclo ────────────────────────────────────────────────

/** A F2 conduzida até o fechamento conferido: nenhuma fase restante. */
function ultimaFaseConferida(t) {
  const a = ambiente(t);
  a.abrirF2();
  for (const id of ["T3", "T4"]) a.conferida(id);
  return a;
}

test("ultima fase fechada com CI verde no HEAD emite fechar-ciclo com o texto da sessao limpa, nunca perguntar squash", (t) => {
  const a = ultimaFaseConferida(t);
  const head = a.head();
  const f = a.proximo({ ci: { sha: head, veredito: "verde", run: 55 }, sessaoMaestra: "session_maestra_f2" });
  assert.equal(f.acao, "fechar-ciclo");
  assert.notEqual(f.motivo, "squash");
  assert.equal(f.fase, "ciclo");
  assert.equal(f.ultimaFase, "F2");
  assert.deepEqual(f.conduzidas, ["F1", "F2"]);
  assert.match(f.nonce, /^[0-9a-f]{16}$/);
  const linhas = f.texto.split("\n");
  assert.equal(linhas[0], `/close-cycle ${CICLO}`);
  assert.match(f.texto, /archive_session da maestra anterior session_maestra_f2/);
  assert.ok(f.texto.includes(`auditar --repo ${a.dir} --ciclo ${CICLO} --ref HEAD --exigir-fases F1,F2 --exigir-encerramentos F1,ciclo`), f.texto);
  assert.ok(f.texto.includes(`limpar --repo ${a.dir} --ciclo ${CICLO}`), f.texto);
  assert.match(f.texto, /ler o \/close-cycle do projeto/);

  // A maestra grava o encerramento do ciclo e para; daí em diante, nada a emitir.
  const r = a.cli("encerrar-sessao", "--fase", "ciclo", "--nonce", f.nonce);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(a.g("log", "-1", "--format=%(trailers:key=Conducao-Encerrada,valueonly)"), "ciclo");
  for (const entrada of [undefined, { ci: { sha: a.head(), veredito: "verde", run: 56 } }, { sessaoMaestra: "session_nova" }]) {
    const p = a.proximo(entrada);
    assert.equal(p.acao, "esperar", JSON.stringify(entrada));
    assert.equal(p.motivo, "close-cycle-em-sessao-limpa");
  }
  // Proposta mesclada: nada a emitir, com ou sem a marca.
  assert.equal(a.proximo({ proposta: { numero: 9, state: "MERGED" } }).motivo, "mesclado");
});

test("ultima fase conferida com CI em curso, vermelho ou ausente nao emite fechar-ciclo", (t) => {
  const a = ultimaFaseConferida(t);
  const head = a.head();
  const v = a.proximo({ ci: { sha: head, veredito: "vermelho", run: 57 } });
  assert.equal(v.acao, "perguntar");
  assert.equal(v.motivo, "ci-vermelho");
  assert.equal(v.fase, "ciclo");
  for (const entrada of [
    undefined,
    { ci: null },
    { ci: { sha: head, run: 58 } },
    { ci: { sha: head, veredito: "em-curso", run: 58 } },
    { ci: { sha: "0123456789abcdef0123456789abcdef01234567", veredito: "verde", run: 58 } },
  ]) {
    const p = a.proximo(entrada);
    assert.equal(p.acao, "esperar", JSON.stringify(entrada));
    assert.equal(p.motivo, "ci-pendente");
  }
  assert.equal(a.head(), head);
});

test("auditar por ciclo e ref exige as fases e os encerramentos pedidos", (t) => {
  const a = ultimaFaseConferida(t);
  const auditar = (...extra) => {
    const r = a.cli("auditar", ...extra);
    return { status: r.status, saida: r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null, stderr: r.stderr };
  };
  // Sem nota nem ref: uso.
  assert.equal(auditar().status, 2);
  // Antes do encerramento do ciclo: pedir `ciclo` reprova.
  const antes = auditar("--ref", "HEAD", "--exigir-fases", "F1,F2", "--exigir-encerramentos", "F1,ciclo");
  assert.equal(antes.status, 1, antes.stderr);
  assert.deepEqual(antes.saida.violacoes, [{ fase: "ciclo", regra: "encerramento-ausente" }]);

  const n = a.proximo({ ci: { sha: a.head(), veredito: "verde", run: 60 } }).nonce;
  assert.equal(a.cli("encerrar-sessao", "--fase", "ciclo", "--nonce", n).status, 0);
  const ok = auditar("--ref", "HEAD", "--exigir-fases", "F1,F2", "--exigir-encerramentos", "F1,ciclo");
  assert.equal(ok.status, 0, JSON.stringify(ok.saida));
  assert.equal(ok.saida.ciclo, CICLO);
  assert.equal(ok.saida.ramo, null);
  assert.deepEqual(ok.saida.conduzidas, ["F1", "F2"]);
  assert.deepEqual(ok.saida.encerramentos, ["F1", "ciclo"]);
  assert.deepEqual(ok.saida.violacoes, []);

  // Pela referência da proposta, que fica depois de o ramo sumir.
  a.g("update-ref", "refs/pull/7/head", "HEAD");
  assert.equal(auditar("--ref", "refs/pull/7/head", "--exigir-fases", "F1,F2").status, 0);

  // Fase pedida sem condução e encerramento pedido ausente: exit 1, um por falta.
  const falta = auditar("--ref", "HEAD", "--exigir-fases", "F1,F2,F3", "--exigir-encerramentos", "F1,F2,ciclo");
  assert.equal(falta.status, 1);
  assert.deepEqual(falta.saida.violacoes, [
    { fase: "F3", regra: "fase-nao-conduzida" },
    { fase: "F2", regra: "encerramento-ausente" },
  ]);
  // Referência que não existe e lista fora do vocabulário: exit 1 pelo erro.
  assert.equal(auditar("--ref", "refs/pull/99/head").status, 1);
  assert.equal(auditar("--ref", "HEAD", "--exigir-fases", "fase2").status, 1);
});

test("conferir acusa binario ausente em qualquer segmento e ignora atribuicao e builtin", (t) => {
  const a = ambiente(t);
  let atual = "echo verificacao-T1";
  /** Verificação nova da T1, congelada por uma autorização nova da F1. */
  const conferirCom = (v) => {
    a.replanejar(`\`${atual}\``, `\`${v}\``);
    atual = v;
    a.autorizar("F1");
    const r = a.cli("conferir", "T1");
    return { status: r.status, stderr: r.stderr, saida: r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null };
  };
  // Ausente no primeiro segmento, depois de atribuição: perguntar, sem a Verificação crua.
  const primeiro = conferirCom("FOO=1 BAR=2 zz9-binario-ausente --x");
  assert.equal(primeiro.status, 1, primeiro.stderr);
  assert.equal(primeiro.saida.acao, "perguntar");
  assert.equal(primeiro.saida.motivo, "binario-ausente");
  assert.deepEqual(primeiro.saida.binarios, ["zz9-binario-ausente"]);
  assert.equal(primeiro.saida.verificacao, undefined);
  assert.equal(primeiro.saida.comando, undefined);
  // Ausente depois de &&, ||, ; e |; builtins e separador dentro de aspas não contam.
  const meio = conferirCom(`cd . && test -d . || echo "a|b; c && zz9-entre-aspas" ; export X=1 | zz9-depois-do-cano -q && [ -d . ] && true && false || node -e 1`);
  assert.equal(meio.status, 1, meio.stderr);
  assert.deepEqual(meio.saida.binarios, ["zz9-depois-do-cano"]);
  // Tudo presente (atribuição, ! e builtin pulados): a Verificação embrulhada sai, exit 0.
  const ok = conferirCom("X=1 node -e 1 && ! false && git --version | grep -q git");
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.saida.acao, "conferir");
  assert.match(ok.saida.verificacao, /^env -u /);
});

// ── T27: fase fechada e não encerrada reabre por task nova ──────────────────

const T5 = task("T5", { inputs: "T2" });
const T6 = task("T6", { inputs: "T5", satisfies: FECHA });
const T7 = task("T7", { inputs: "T4", fase: "F2" });
const T8 = task("T8", { inputs: "T7", satisfies: FECHA, fase: "F2" });
const ANTES_DA_F2 = "### F2 — fase F2";
const ANTES_DO_PRONTO = "## 4. Pronto\n";

test("task nova no plano do HEAD numa fase com fechamento conferido e sem encerramento emite perguntar plano-mudou com a fase reaberta antes do ci-pendente", (t) => {
  const a = ambiente(t);
  const blobAutorizado = a.g("rev-parse", `HEAD:${CAMINHO}`);
  // Hoje, sem re-plano: a F1 espera o CI para encerrar.
  assert.equal(a.proximo().motivo, "ci-pendente");
  a.replanejar(ANTES_DA_F2, T5 + T6 + ANTES_DA_F2);
  const head = a.head();
  for (const entrada of [undefined, { ci: { sha: head, veredito: "verde", run: 70 } }, { ci: { sha: head, veredito: "vermelho", run: 71 } }]) {
    const p = a.proximo(entrada);
    assert.equal(p.acao, "perguntar", JSON.stringify(entrada));
    assert.equal(p.motivo, "plano-mudou");
    assert.equal(p.fase, "F1");
    assert.equal(p.reaberta, true);
    assert.equal(p.planoAnterior, blobAutorizado);
    assert.equal(p.planoNovo, a.g("rev-parse", `HEAD:${CAMINHO}`));
    assert.match(p.diffPlano, /^\+#### T5 /m);
    assert.deepEqual(p.tasksMudadas, [
      { task: "T5", mudou: "nasceu" },
      { task: "T6", mudou: "nasceu" },
    ]);
    assert.deepEqual(p.trazidas, []);
  }
  // Mesmo estado, mesmo nonce; o alvo é o do re-plano da T22.
  assert.equal(a.proximo().nonce, a.proximo({ ci: { sha: head, veredito: "verde", run: 70 } }).nonce);

  // Task nova sem fechamento novo: a fase reaberta nunca encerraria.
  const b = ambiente(t);
  b.replanejar(ANTES_DA_F2, T5 + ANTES_DA_F2);
  const s = b.proximo({ ci: { sha: b.head(), veredito: "verde", run: 72 } });
  assert.equal(s.acao, "perguntar");
  assert.equal(s.motivo, "fase-reaberta-sem-fechamento");
  assert.equal(s.fase, "F1");
  assert.equal(s.reaberta, true);
  assert.deepEqual(s.tasksMudadas, [{ task: "T5", mudou: "nasceu" }]);
});

test("a ultima fase fechada que ganha task nova reabre antes do fechar-ciclo", (t) => {
  const a = ultimaFaseConferida(t);
  a.replanejar(ANTES_DO_PRONTO, T7 + T8 + ANTES_DO_PRONTO);
  for (const entrada of [undefined, { ci: { sha: a.head(), veredito: "verde", run: 80 } }, { ci: { sha: a.head(), veredito: "vermelho", run: 81 } }]) {
    const p = a.proximo(entrada);
    assert.equal(p.acao, "perguntar", JSON.stringify(entrada));
    assert.equal(p.motivo, "plano-mudou");
    assert.equal(p.fase, "F2");
    assert.equal(p.reaberta, true);
    assert.deepEqual(p.tasksMudadas, [
      { task: "T7", mudou: "nasceu" },
      { task: "T8", mudou: "nasceu" },
    ]);
  }
  // Reautorizada, a F2 segue pela task nova; o ciclo só fecha com a T8 conferida.
  a.autorizar("F2");
  const ab = a.proximo({ ci: { sha: a.head(), veredito: "verde", run: 82 } });
  assert.equal(ab.acao, "abrir");
  assert.deepEqual(ab.tarefas.map((x) => x.task), ["T7"]);
  for (const id of ["T7", "T8"]) a.conferida(id);
  const f = a.proximo({ ci: { sha: a.head(), veredito: "verde", run: 83 } });
  assert.equal(f.acao, "fechar-ciclo");
  assert.deepEqual(f.conduzidas, ["F1", "F2"]);
});

test("depois da reautorizacao a fase reaberta emite a task nova e o encerramento exige o ultimo fechamento da fase conferido", (t) => {
  const a = ambiente(t);
  a.replanejar(ANTES_DA_F2, T5 + T6 + ANTES_DA_F2);
  assert.equal(a.proximo().reaberta, true);
  // O "sim" de Rita: autorizar-ciclo sobre a fase já autorizada congela o plano do HEAD.
  const r = a.cli("autorizar-ciclo", "F1", "--sim", "sim, reabre a F1");
  assert.equal(r.status, 0, r.stderr);
  const verde = (x = a) => ({ ci: { sha: x.head(), veredito: "verde", run: 90 } });
  const ab = a.proximo(verde());
  assert.equal(ab.acao, "abrir", JSON.stringify(ab));
  assert.equal(ab.fase, "F1");
  assert.deepEqual(ab.tarefas.map((x) => x.task), ["T5"]);
  a.conferida("T5");
  // Com o fechamento velho (T2) conferido e o novo não, CI verde não encerra.
  const ff = a.proximo(verde());
  assert.equal(ff.acao, "fechar-fase");
  assert.equal(ff.task, "T6");
  a.conferida("T6");
  const e = a.proximo(verde());
  assert.equal(e.acao, "encerrar-sessao");
  assert.equal(e.fase, "F1");
  assert.equal(e.task, "T6");
  assert.equal(a.proximo().motivo, "ci-pendente");

  // Reautorizada sem fechamento novo: pergunta, e nem a task feita à revelia encerra a fase.
  const b = ambiente(t);
  b.replanejar(ANTES_DA_F2, T5 + ANTES_DA_F2);
  b.autorizar("F1");
  const s = b.proximo(verde(b));
  assert.equal(s.acao, "perguntar");
  assert.equal(s.motivo, "fase-reaberta-sem-fechamento");
  assert.deepEqual(s.pendentes, ["T5"]);
  b.conferida("T5");
  const s2 = b.proximo(verde(b));
  assert.equal(s2.acao, "perguntar");
  assert.equal(s2.motivo, "fase-reaberta-sem-fechamento");
  assert.equal(s2.task, "T2");
  assert.deepEqual(s2.depois, ["T5"]);
});

test("fase ja encerrada, task removida ou so dependencia mudada nao reabrem a fase", (t) => {
  // Encerrada: task nova na F1 cai na pergunta de autorização da F2.
  const a = ambiente(t);
  const n = a.proximo({ ci: { sha: a.head(), veredito: "verde", run: 100 } }).nonce;
  assert.equal(a.cli("encerrar-sessao", "--fase", "F1", "--nonce", n).status, 0);
  a.replanejar(ANTES_DA_F2, T5 + T6 + ANTES_DA_F2);
  const enc = a.proximo();
  assert.equal(enc.motivo, "autorizar-ciclo");
  assert.equal(enc.fase, "F2");
  assert.equal(enc.reaberta, undefined);

  // Task removida e Outputs mudados na F1: segue a regra de hoje.
  const b = ambiente(t);
  b.replanejar(task("T1"), "");
  b.replanejar("`src/t2.mjs` (create)", "`src/t2.mjs` (create) · `src/t2b.mjs` (create)");
  for (const [entrada, acao, motivo] of [
    [undefined, "esperar", "ci-pendente"],
    [{ ci: { sha: b.head(), veredito: "verde", run: 101 } }, "encerrar-sessao", undefined],
  ]) {
    const p = b.proximo(entrada);
    assert.equal(p.acao, acao, JSON.stringify(p));
    assert.equal(p.motivo, motivo);
    assert.equal(p.reaberta, undefined);
  }

  // Só a dependência de uma task da última fase mudou: o ciclo fecha.
  const c = ultimaFaseConferida(t);
  c.replanejar("- **Inputs:** T3", "- **Inputs:** T1");
  const f = c.proximo({ ci: { sha: c.head(), veredito: "verde", run: 102 } });
  assert.equal(f.acao, "fechar-ciclo", JSON.stringify(f));
  assert.equal(f.reaberta, undefined);
});

test("plano autorizado uma vez com task depois do fechamento nao pergunta fase-reaberta-sem-fechamento", (t) => {
  // Plano antigo: a F1 já nasce com a T5 depois do fechamento T2, autorizada uma vez só.
  const a = ambiente(t);
  a.replanejar(ANTES_DA_F2, T5 + ANTES_DA_F2);
  a.g("commit", "-q", "--allow-empty", "-m", "Conducao: F2 autorizada", "-m", "sim", "-m", `Conducao-Plano: ${a.g("rev-parse", `HEAD:${CAMINHO}`)}`);
  // Sem reautorização da F1, a T5 dela nunca vira pergunta de fase reaberta.
  for (const entrada of [undefined, { ci: { sha: a.head(), veredito: "verde", run: 110 } }]) {
    const p = a.proximo(entrada);
    assert.notEqual(p.motivo, "fase-reaberta-sem-fechamento", JSON.stringify(p));
  }
});
