/**
 * conducao-consertos-proximo.test.mjs — consertos da condução depois do
 * ATRM-52 (hotfix conducao-consertos-pos-atrm52, ruling 1-a de Rita, 28/10/2026),
 * na parte que o `proximo` e o `conferir` decidem:
 *
 *   P16  estado da filha na entrada sensível a caixa
 *   C24  `conferir` lê palavra-chave de shell como binário (`binario-ausente`)
 *   C24  merge de origin/main derruba a herança da autorização; task nova comum
 *        conta como mudança de classe
 *   —    `autorizar-ciclo`: o sim de Rita vale para todas as fases do ciclo, salvo os gates
 *
 * Hooks desligados no repo de teste (core.hooksPath=/dev/null); origin bare em
 * pasta temporária, porque os verbos de autorização empurram a cópia do ciclo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executaveisDaVerificacao } from "../conducao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;
const RULING = `${CICLO}-F1/D-TESTE1-7 — re-plano de T3: depende da T1`;

function task(id, { inputs = "`README.md`", steps = "faz", fase = "F1" } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE1-1]",
    `- **Inputs:** ${inputs}`,
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

function canonico(fases, largura = 1) {
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
    `**Largura do ciclo:** ${largura}`,
    "",
    "## 3. Tasks",
    "",
    ...fases.map(({ id, tasks }) => [`### ${id} — fase ${id} (**Modelo:** sonnet)`, "", ...tasks].join("\n")),
    "## 4. Pronto",
    "",
  ].join("\n");
}

const PUBLICA = "aplica a migration com `db-publish.mjs … db push`";

/** F1 com a T1 sensível e T2/T3 comuns; F2 com a T4 (comum ou sensível) e a T5. */
const PADRAO = ({ t4 = "faz" } = {}) =>
  canonico([
    { id: "F1", tasks: [task("T1", { steps: PUBLICA }), task("T2"), task("T3")] },
    { id: "F2", tasks: [task("T4", { fase: "F2", steps: t4 }), task("T5", { fase: "F2" })] },
  ]);

function novoRepo(t, texto = PADRAO()) {
  const raiz = mkdtempSync(path.join(tmpdir(), "conducao-consertos-"));
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
  writeFileSync(path.join(dir, CAMINHO), texto);
  writeFileSync(path.join(dir, "README.md"), "fixture\n");
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  const vazio = (...linhas) => g("commit", "-q", "--allow-empty", ...linhas.flatMap((l) => ["-m", l]));
  const blob = () => g("rev-parse", `HEAD:${CAMINHO}`);
  const autorizar = (fase) => {
    vazio(`Conducao: ${fase} autorizada`, "sim do Rita, no turno dele", `Conducao-Plano: ${blob()}`);
    return g("rev-parse", "HEAD");
  };
  const replanejar = (de, para, subject) => {
    const atual = readFileSync(path.join(dir, CAMINHO), "utf8");
    assert.ok(atual.includes(de), de);
    writeFileSync(path.join(dir, CAMINHO), atual.replace(de, para));
    g("commit", "-q", "-am", subject);
    return g("rev-parse", "HEAD");
  };
  const conferida = (id, nonceX = `n-${id}`) => vazio(`Conducao: ${id} conferida`, `Conducao-Task: ${id}\nConducao-Nonce: ${nonceX}`);
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8" });
  const proximo = (entrada) => {
    const r = cli("proximo", ...(entrada ? ["--entrada", JSON.stringify(entrada)] : []));
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim());
  };
  const emVoo = (id, n, nonceX) => {
    const marcador = g("commit-tree", g("rev-parse", "HEAD^{tree}"), "-p", g("rev-parse", "HEAD"), "-m", `Conducao: abrir ${id} tentativa ${n} nonce ${nonceX}`);
    g("update-ref", `refs/conducao-local/${CICLO}/${id}/${n}`, marcador);
  };
  return { dir, g, vazio, blob, autorizar, replanejar, conferida, cli, proximo, emVoo };
}

const DEP_T3 = ["- **Inputs:** `README.md`\n- **Outputs:** `src/t3.mjs`", "- **Inputs:** T1\n- **Outputs:** `src/t3.mjs`"];

// ── 1. P16: estado da filha sem depender de caixa ────────────────────────────

test("P16: filha arquivada em minusculas ou com prefixo SESSION_STATUS_ nao volta a arquivar nem ocupa vaga", (t) => {
  const r = novoRepo(t);
  r.autorizar("F1");
  r.emVoo("T1", 1, "nonceT1a");
  r.conferida("T1", "nonceT1a");
  const filha = (estado) => ({ sessao: "s1", task: "T1", tentativa: 1, nonce: "nonceT1a", estado, aviso: "T1-OK abcdef12 nonceT1a" });
  for (const estado of ["archived", "SESSION_STATUS_ARCHIVED", " Archived "]) {
    const p = r.proximo({ filhas: [filha(estado)], tetoPonte: 1 });
    assert.equal(p.acao, "abrir", `${estado}: ${JSON.stringify(p)}`);
    assert.equal(p.largura.vivas, 0, estado);
  }
  // Contraprova: viva em qualquer caixa segue arquivada pela rede.
  assert.equal(r.proximo({ filhas: [filha("idle")], tetoPonte: 1 }).acao, "arquivar");
});

// ── 2. C24: palavras-chave de shell no `conferir` ────────────────────────────

test("C24: executaveisDaVerificacao pula palavra-chave de shell e acha o comando depois dela", () => {
  // Verificação da T10 do ATRM-52, verbatim no essencial.
  assert.deepEqual(
    executaveisDaVerificacao("cd apps/x/guias && for g in gerente recepcao; do grep -q 'id=\"avisos\"' $g.html || exit 1; done && test $(grep -c x a.html) -eq 3"),
    ["grep"],
  );
  assert.deepEqual(executaveisDaVerificacao("if true; then node a.mjs; else binario-que-nao-existe-xyz; fi"), ["node", "binario-que-nao-existe-xyz"]);
  assert.deepEqual(executaveisDaVerificacao("while false; do :; done; until true; do sleep 1; done"), ["sleep"]);
  assert.deepEqual(executaveisDaVerificacao("case x in a) ;; esac"), []);
  // Grupo de comandos da T6 do ATRM-52: `}` não é binário, e o `node` dentro do `{` é.
  assert.deepEqual(executaveisDaVerificacao("pnpm a && { node b.mjs; test $? -eq 2; } && grep -q c d"), ["pnpm", "node", "grep"]);
  // Contraprova: binário ausente segue acusado.
  assert.deepEqual(executaveisDaVerificacao("nao-existe-xyz --help"), ["nao-existe-xyz"]);
});

// ── 3. C24: merge de origin/main e task nova não derrubam a herança ─────────

test("C24: merge de origin/main que nao muda o canonico na linha do ciclo nao derruba a heranca do re-plano de ruling", (t) => {
  const r = novoRepo(t);
  r.g("branch", "main-x");
  r.replanejar("## 4. Pronto", "## 4. Pronto (typo)", "typo no canonico");
  r.autorizar("F1");
  r.g("checkout", "-q", "main-x");
  writeFileSync(path.join(r.dir, "outro.txt"), "do main\n");
  r.g("add", "outro.txt");
  r.g("commit", "-q", "-m", "commit do main");
  r.g("checkout", "-q", "ciclo-teste");
  r.g("merge", "-q", "--no-ff", "--no-edit", "main-x");
  r.replanejar(...DEP_T3, RULING);
  const h = r.proximo();
  assert.equal(h.acao, "herdar-autorizacao", JSON.stringify(h));
  assert.equal(h.replanos.length, 1);
});

test("C24 contraprova: merge que traz mudanca do canonico de fora segue perguntando", (t) => {
  const r = novoRepo(t);
  r.g("branch", "main-x");
  r.autorizar("F1");
  r.g("checkout", "-q", "main-x");
  const atual = readFileSync(path.join(r.dir, CAMINHO), "utf8");
  writeFileSync(path.join(r.dir, CAMINHO), atual.replace("## 4. Pronto", "## 4. Pronto (do main)"));
  r.g("commit", "-q", "-am", "main mexe no canonico");
  r.g("checkout", "-q", "ciclo-teste");
  r.g("merge", "-q", "--no-ff", "--no-edit", "main-x");
  r.replanejar(...DEP_T3, RULING);
  const p = r.proximo();
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "plano-mudou");
});

test("C24: re-plano de ruling com task nova comum herda; task nova sensivel pergunta", (t) => {
  const nova = (id, steps) => `${task(id, { steps })}### F2 — fase F2`;
  const r = novoRepo(t);
  r.autorizar("F1");
  r.replanejar("### F2 — fase F2", nova("T6", "faz"), `${CICLO}-F1/D-TESTE1-8 — re-plano de F1: T6 nova`);
  const h = r.proximo();
  assert.equal(h.acao, "herdar-autorizacao", JSON.stringify(h));

  const s = novoRepo(t);
  s.autorizar("F1");
  s.replanejar("### F2 — fase F2", nova("T6", PUBLICA), `${CICLO}-F1/D-TESTE1-8 — re-plano de F1: T6 nova`);
  const p = s.proximo();
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "plano-mudou");
});

// ── 4. autorizar-ciclo ────────────────────────────────────────────────────────

function ok(r, ...args) {
  const x = r.cli(...args);
  assert.equal(x.status, 0, `${args.join(" ")} → ${x.status}\n${x.stderr}\n${x.stdout}`);
  return JSON.parse(x.stdout.trim());
}

function fecharF1(r) {
  for (const id of ["T1", "T2", "T3"]) r.conferida(id);
}

test("autorizar-ciclo: o sim cobre a fase de partida e as seguintes herdam sem pergunta", (t) => {
  const r = novoRepo(t);
  const a = ok(r, "autorizar-ciclo", "F1", "--sim", "sim, pode tocar o ciclo inteiro");
  assert.equal(a.acao, "autorizada");
  assert.equal(a.doCiclo, true);
  assert.match(r.g("log", "-1", "--format=%B"), /^Conducao-Ciclo: sim$/m);
  // A fase de partida é a do sim de Rita: cobre a T1 sensível, como o sim gravado na fase.
  const a1 = r.proximo();
  assert.equal(a1.acao, "abrir", JSON.stringify(a1));
  assert.deepEqual(a1.cobertasPelaFase?.tasks, ["T1"]);
  fecharF1(r);
  const h = r.proximo();
  assert.equal(h.acao, "herdar-autorizacao", JSON.stringify(h));
  assert.equal(h.fase, "F2");
  assert.equal(h.origem, "ciclo");
  const herdada = ok(r, "herdar-autorizacao", "F2", "--nonce", h.nonce);
  assert.equal(herdada.acao, "autorizacao-herdada");
  const corpo = r.g("log", "-1", "--format=%B");
  assert.match(corpo, /^Conducao: F2 autorizada$/m);
  assert.match(corpo, /^Conducao-Origem: ciclo$/m);
  const ab = r.proximo();
  assert.equal(ab.acao, "abrir", JSON.stringify(ab));
  assert.equal(ab.fase, "F2");
});

test("autorizar-ciclo: task sensivel de fase herdada pelo ciclo segue pedindo o sim por task", (t) => {
  const r = novoRepo(t, PADRAO({ t4: PUBLICA }));
  ok(r, "autorizar-ciclo", "F1", "--sim", "sim, pode tocar o ciclo inteiro");
  fecharF1(r);
  const h = r.proximo();
  assert.equal(h.acao, "herdar-autorizacao", JSON.stringify(h));
  ok(r, "herdar-autorizacao", "F2", "--nonce", h.nonce);
  const p = r.proximo();
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "task-sensivel");
  assert.equal(p.task, "T4");
  // O sim de Rita àquela pergunta (task + nonce, num turno dele) abre a T4.
  const ab = r.proximo({ aprovacoes: [{ task: "T4", nonce: p.nonce }] });
  assert.equal(ab.acao, "abrir", JSON.stringify(ab));
  assert.equal(ab.cobertasPelaFase, undefined, "a fase herdada pelo ciclo não cobre a task sensível");
});

test("autorizar-ciclo: task que muda de classe depois do sim do ciclo pede o sim do ciclo de novo", (t) => {
  const r = novoRepo(t);
  ok(r, "autorizar-ciclo", "F1", "--sim", "sim, pode tocar o ciclo inteiro");
  fecharF1(r);
  r.replanejar("#### T4 — tarefa T4\n\n- **Objetivo:** tarefa T4", "#### T4 — tarefa T4\n\n- **Objetivo:** tarefa T4 com `vercel --prod`", `${CICLO}-F2/D-TESTE1-9 — re-plano de T4: publica`);
  const p = r.proximo();
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "autorizar-ciclo");
  assert.equal(p.fase, "F2");
});

test("autorizar-ciclo: re-plano sem ruling e sem mudanca de classe herda sob o sim do ciclo; sem ele pergunta", (t) => {
  const r = novoRepo(t);
  ok(r, "autorizar-ciclo", "F1", "--sim", "sim, pode tocar o ciclo inteiro");
  r.replanejar(...DEP_T3, `${CICLO}-F1/T3 — ajusta a T3`);
  const h = r.proximo();
  assert.equal(h.acao, "herdar-autorizacao", JSON.stringify(h));
  assert.equal(h.fase, "F1");

  const s = novoRepo(t);
  s.autorizar("F1");
  s.replanejar(...DEP_T3, `${CICLO}-F1/T3 — ajusta a T3`);
  assert.equal(s.proximo().motivo, "plano-mudou");
});

test("autorizar-ciclo exige a fase de partida e o texto do sim", (t) => {
  const r = novoRepo(t);
  assert.notEqual(r.cli("autorizar-ciclo", "--sim", "sim").status, 0);
  assert.notEqual(r.cli("autorizar-ciclo", "F1").status, 0);
  assert.equal(r.g("log", "-1", "--format=%s"), "plano", "nada gravado");
});

test("autorizar-ciclo: re-plano sem ruling que troca Outputs ou Verificacao pergunta, mesmo sob o sim do ciclo", (t) => {
  const r = novoRepo(t);
  ok(r, "autorizar-ciclo", "F1", "--sim", "sim, pode tocar o ciclo inteiro");
  r.replanejar("- **Outputs:** `src/t3.mjs` (create)", "- **Outputs:** `src/t3.mjs` (create) · `.husky/pre-commit` (modify)", `${CICLO}-F1/T3 — ajusta a T3`);
  assert.equal(r.proximo().motivo, "plano-mudou");

  const s = novoRepo(t);
  ok(s, "autorizar-ciclo", "F1", "--sim", "sim, pode tocar o ciclo inteiro");
  // Verificação trocada no meio da fase não é adotada: a condução segue no plano congelado.
  s.replanejar("`echo verificacao-T3`", "`echo outra-coisa`", `${CICLO}-F1/T3 — ajusta a T3`);
  assert.notEqual(s.proximo().acao, "herdar-autorizacao");
  // E na fase nova o sim do ciclo não a adota sem ruling: pede o sim do ciclo de novo.
  fecharF1(s);
  const p = s.proximo();
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "autorizar-ciclo");
});

test("C24: braco de case em varias linhas confere o comando do braco, nao o padrao", () => {
  assert.deepEqual(executaveisDaVerificacao("case $x in\na) node a.mjs ;;\n*) nao-existe-xyz ;;\nesac"), ["node", "nao-existe-xyz"]);
});

test("autorizar-ciclo: re-plano sem ruling que acrescenta segmento de tela clinica aos Steps pergunta", (t) => {
  const r = novoRepo(t);
  ok(r, "autorizar-ciclo", "F1", "--sim", "sim, pode tocar o ciclo inteiro");
  r.replanejar("- **Steps:** faz\n- **Verificação:** `echo verificacao-T3`", "- **Steps:** muda `apps/web/src/app/(app)/agenda/agenda/page.tsx`\n- **Verificação:** `echo verificacao-T3`", `${CICLO}-F1/T3 — ajusta a T3`);
  // Steps não estão em CAMPOS_DO_PLANO: o re-plano não é adotado no meio da fase; na fase nova, o sim do ciclo não o cobre.
  assert.notEqual(r.proximo().acao, "herdar-autorizacao");
  fecharF1(r);
  assert.equal(r.proximo().motivo, "autorizar-ciclo");
});

test("C24: braco de case sozinho na linha nao vira binario", () => {
  assert.deepEqual(executaveisDaVerificacao("case $1 in\n a)\n node x.mjs\n ;;\nesac"), ["node"]);
});

test("C24: subshell entre parenteses fica num segmento so, lido pelo primeiro comando de dentro", () => {
  assert.deepEqual(executaveisDaVerificacao("(cd a && make) && node b.mjs"), ["node"]);
});
