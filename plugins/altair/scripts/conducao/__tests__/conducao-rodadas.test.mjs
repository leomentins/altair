/**
 * conducao-rodadas.test.mjs — rodadas da conferência do operador, no caso por
 * arquivo: o `/gate-de-ux` do projeto de teste.
 *
 * Desde a T14 (7-a) a task `(gate-de-ux)` é um caso de conferência do
 * operador declarado no adaptador do projeto de teste (`.altair/adaptador.json`,
 * `conferencia`): a resposta do operador é o `verdict:` do approval, e o não
 * (`NEEDS_REWORK`) abre rodada nova por `--rodada nao` (ou `needs-rework`, o
 * mesmo não no nome do gate). O caso por pergunta, e este passando pelo mesmo
 * caminho, ficam em `conferencia-operador.test.mjs`. O repositório do teste
 * não tem `.altair/`, então lê a declaração da árvore do núcleo.
 *
 * O rito da task `(gate-de-ux)` (task-brief.mjs `contratoDeRodadas`) roda uma
 * rodada por sessão fresca: A (gate + approval), B (conserto + carimbo), C
 * (gate de novo, `rodada: n+1`), com teto em `rodada: 3`. Cada rodada é uma
 * tentativa da mesma task. Antes do verbo `registrar-conferencia --rodada`, a
 * rodada com `verdict: NEEDS_REWORK` deixava a trazida sem saída: a
 * Verificação (`grep SHIP|SHIP_WITH_DEBT`) sai 1, a conferência só aceita
 * `verde`, e o `proximo` parava em `trazida-sem-conferencia` (contraprova:
 * o primeiro teste falha no `registrar-conferencia --rodada` sem o verbo).
 *
 * Mesmo arranjo de conducao-git.test.mjs: origin bare, árvore da maestra,
 * clone da filha, hooks desligados, verbos chamados como CLI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lerApproval, TETO_RODADAS_GATE } from "../git-conducao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-2-rodadas";
const PASTA = `.agents/ciclo/teste/${CICLO}`;
const CAMINHO = `${PASTA}/canonico.md`;
const APPROVAL = `${PASTA}/gate-de-ux-approval.md`;

function task(id, { satisfies = "[AC-TESTE2-1]", outputs = `\`src/${id.toLowerCase()}.mjs\` (create)`, verificacao = `echo verificacao-${id}` } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    `- **satisfies:** ${satisfies}`,
    "- **Inputs:** `README.md`",
    `- **Outputs:** ${outputs}`,
    "- **Estação:** servidor",
    "- **Independente:** sim",
    "- **Steps:** faz",
    `- **Verificação:** \`${verificacao}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-F1/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

const GATE = task("T1", {
  satisfies: "[AC-TESTE2-1] (gate-de-ux)",
  outputs: `\`${APPROVAL}\` (create) · \`src/t1.mjs\` (create)`,
  verificacao: `grep -qE '^verdict: (SHIP|SHIP_WITH_DEBT)$' ${APPROVAL}`,
});

function canonico(tasks) {
  return [
    "---",
    `cycle: ${CICLO}`,
    "opened: 2026-10-23",
    "---",
    "",
    "## 1. Goal",
    "",
    "### 1.5 Modo de Execução",
    "",
    "**Largura do ciclo:** 3",
    "",
    "## 3. Tasks",
    "",
    "### F1 — fase F1 (**Modelo:** sonnet)",
    "",
    ...tasks,
    "## 4. Pronto",
    "",
  ].join("\n");
}

const approval = (verdict, rodada) =>
  ["---", `id: ciclo/${CICLO}/gate-de-ux-approval`, `verdict: ${verdict}`, ...(rodada === undefined ? [] : [`rodada: ${rodada}`]), "dois_tempos:", "  verdict_provisorio: SHIP", "---", "", "corpo", ""].join("\n");

function gitEm(dir) {
  return (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function configurar(g) {
  g("config", "core.hooksPath", "/dev/null");
  g("config", "user.name", "teste");
  g("config", "user.email", "teste@example.invalid");
  g("config", "commit.gpgsign", "false");
}

function escreverEm(dir, arquivos) {
  for (const [p, conteudo] of Object.entries(arquivos)) {
    mkdirSync(path.join(dir, path.dirname(p)), { recursive: true });
    writeFileSync(path.join(dir, p), conteudo);
  }
}

function ambiente(t, tasks = [GATE, task("T2")]) {
  const raiz = mkdtempSync(path.join(tmpdir(), "conducao-rodadas-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const maestra = path.join(raiz, "maestra");
  mkdirSync(maestra);
  const g = gitEm(maestra);
  g("init", "-q", "-b", "ciclo-teste");
  configurar(g);
  g("remote", "add", "origin", origin);
  escreverEm(maestra, { "README.md": "fixture\n", [CAMINHO]: canonico(tasks) });
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  g("push", "-q", "origin", "ciclo-teste");
  const filha = path.join(raiz, "filha");
  execFileSync("git", ["clone", "-q", origin, filha]);
  const f = gitEm(filha);
  configurar(f);

  const cli = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", maestra, "--ciclo", CICLO], {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const linhas = r.stdout.split("\n").filter(Boolean);
    return { status: r.status, stderr: r.stderr, saida: linhas.length === 1 ? JSON.parse(linhas[0]) : null, linhas };
  };
  const ok = (...args) => {
    const r = cli(...args);
    assert.equal(r.status, 0, `${args.join(" ")} → ${r.status}\n${r.stderr}\n${r.linhas.join("\n")}`);
    return r.saida;
  };
  const recusa = (codigo, ...args) => {
    const r = cli(...args);
    assert.equal(r.status, 1, `${args.join(" ")} deveria recusar\n${r.linhas.join("\n")}`);
    assert.match(r.stderr, new RegExp(`^conducao: ${codigo}:`, "m"), r.stderr);
    return r;
  };
  const proximo = () => {
    const r = cli("proximo", "--entrada", "{}");
    assert.equal(r.status, 0, r.stderr);
    return r.saida;
  };
  /** O `proximo` abre a tentativa que ele mesmo emite; devolve a tarefa aberta. */
  const abrirPeloProximo = (tk, tentativa) => {
    const p = proximo();
    assert.equal(p.acao, "abrir", JSON.stringify(p));
    const x = p.tarefas.find((y) => y.task === tk);
    assert.ok(x, JSON.stringify(p));
    assert.equal(x.tentativa, tentativa, JSON.stringify(p));
    ok("abrir", tk, "--tentativa", String(tentativa), "--nonce", x.nonce, "--modo-maestra", "auto");
    return x;
  };
  /** A filha empurra a tentativa; a maestra a traz. */
  const rodada = (tk, n, arquivos) => {
    const ref = `refs/conducao/${CICLO}/${tk}/${n}`;
    f("fetch", "-q", "origin", `+${ref}:refs/remotes/tentativa`);
    f("checkout", "-q", "--detach", "refs/remotes/tentativa");
    escreverEm(filha, arquivos);
    f("add", "-A");
    f("commit", "-q", "-m", `${CICLO}-F1/${tk} — rodada ${n}`);
    f("push", "-q", "origin", `HEAD:${ref}`);
    ok("trazer", tk, "--tentativa", String(n), "--sessao", `filha-${tk}-${n}`);
  };
  const marcas = () => g("log", "--format=%s", "--grep=^Conducao: ").split("\n");
  return { g, f, maestra, filha, cli, ok, recusa, proximo, abrirPeloProximo, rodada, marcas };
}

test("rodada NEEDS_REWORK abre a tentativa n+1 da mesma task, sem contar falha", (t) => {
  const a = ambiente(t, [GATE]);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1");

  // Rodada A: gate, approval NEEDS_REWORK rodada 1.
  a.abrirPeloProximo("T1", 1);
  a.rodada("T1", 1, { [APPROVAL]: approval("NEEDS_REWORK", 1) });
  // Contraprova do estado antigo: sem registro, a trazida para o laço.
  const parado = a.proximo();
  assert.equal(parado.acao, "perguntar");
  assert.equal(parado.motivo, "trazida-sem-conferencia");
  assert.equal(parado.liveUxGate, true);
  assert.equal(parado.conferenciaDoOperador, "gate-de-ux");

  const s = a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
  assert.equal(s.acao, "rodada-registrada");
  assert.equal(s.tentativa, 1);
  assert.equal(s.rodadaDoApproval, 1);
  assert.equal(a.g("log", "-1", "--format=%s"), "Conducao: T1 tentativa 1 rodada");
  assert.equal(a.g("log", "-1", "--format=%(trailers:key=Conducao-Rodada,valueonly=true)"), "needs-rework");
  // O trabalho trazido fica: a rodada B parte do approval.
  assert.match(a.g("show", `HEAD:${APPROVAL}`), /^verdict: NEEDS_REWORK$/m);

  // Rodada B: conserto (o approval não muda) — também NEEDS_REWORK, também registrável.
  const b = a.abrirPeloProximo("T1", 2);
  assert.equal(b.falhaAnterior, undefined, "rodada não é falha: a tentativa nova não grava falha anterior");
  a.rodada("T1", 2, { "src/t1.mjs": "export const conserto = 1;\n" });
  // `nao` é o nome geral do não do operador; `needs-rework`, o mesmo no nome do gate.
  assert.equal(a.ok("registrar-conferencia", "T1", "--rodada", "nao").rodada, "nao");

  // Rodada C na 3ª tentativa: o teto de 2 falhas não alcança rodadas.
  a.abrirPeloProximo("T1", 3);
  a.rodada("T1", 3, { [APPROVAL]: approval("SHIP", 2) });
  assert.ok(!a.marcas().some((m) => /falhou$/.test(m)), a.marcas().join("\n"));

  // SHIP fecha pela conferência verde de sempre.
  a.recusa("approval-nao-pede-rodada", "registrar-conferencia", "T1", "--rodada", "needs-rework");
  const c = a.ok("registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica");
  assert.equal(c.acao, "conferida");
  assert.equal(c.tentativa, 3);
});

test("verdict SHIP e SHIP_WITH_DEBT recusam --rodada; a trazida segue pendente", (t) => {
  for (const verdict of ["SHIP", "SHIP_WITH_DEBT"]) {
    const a = ambiente(t, [GATE]);
    a.ok("autorizar-ciclo", "F1", "--sim", "sim");
    a.abrirPeloProximo("T1", 1);
    a.rodada("T1", 1, { [APPROVAL]: approval(verdict, 1) });
    a.recusa("approval-nao-pede-rodada", "registrar-conferencia", "T1", "--rodada", "needs-rework");
    assert.ok(!a.marcas().some((m) => /rodada$/.test(m)));
    assert.equal(a.proximo().motivo, "trazida-sem-conferencia");
    assert.equal(a.ok("registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica").acao, "conferida");
  }
});

test("task que não é conferência do operador recusa --rodada, mesmo com approval NEEDS_REWORK no HEAD", (t) => {
  const a = ambiente(t, [task("T2", { outputs: `\`${APPROVAL}\` (create)` })]);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim");
  a.abrirPeloProximo("T2", 1);
  a.rodada("T2", 1, { [APPROVAL]: approval("NEEDS_REWORK", 1) });
  a.recusa("rodada-fora-da-conferencia", "registrar-conferencia", "T2", "--rodada", "needs-rework");
  assert.ok(!a.marcas().some((m) => /rodada$/.test(m)));
  const p = a.proximo();
  assert.equal(p.motivo, "trazida-sem-conferencia");
  assert.equal(p.liveUxGate, undefined);
  assert.equal(p.conferenciaDoOperador, undefined);
});

test("approval ausente no HEAD recusa --rodada", (t) => {
  const a = ambiente(t, [GATE]);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim");
  a.abrirPeloProximo("T1", 1);
  a.rodada("T1", 1, { "src/t1.mjs": "export const t1 = 1;\n" });
  a.recusa("approval-ausente", "registrar-conferencia", "T1", "--rodada", "needs-rework");
  assert.ok(!a.marcas().some((m) => /rodada$/.test(m)));
});

test("teto do rito: approval NEEDS_REWORK com rodada 3 pergunta a Rita e não abre rodada além", (t) => {
  const a = ambiente(t, [GATE]);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim");
  a.abrirPeloProximo("T1", 1);
  a.rodada("T1", 1, { [APPROVAL]: approval("NEEDS_REWORK", 3) });
  const r = a.cli("registrar-conferencia", "T1", "--rodada", "needs-rework");
  assert.equal(r.status, 1, r.linhas.join("\n"));
  assert.equal(r.saida.acao, "perguntar");
  assert.equal(r.saida.motivo, "teto-de-rodadas");
  assert.equal(r.saida.rodadaDoApproval, 3);
  assert.ok(!a.marcas().some((m) => /rodada$/.test(m)));
  // O laço não abre a tentativa 2: a trazida segue esperando Rita.
  const p = a.proximo();
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, "trazida-sem-conferencia");
});

test("--rodada recusa valor desconhecido e mistura com flags da conferência", (t) => {
  const a = ambiente(t, [GATE]);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim");
  a.abrirPeloProximo("T1", 1);
  a.rodada("T1", 1, { [APPROVAL]: approval("NEEDS_REWORK", 1) });
  a.recusa("uso", "registrar-conferencia", "T1", "--rodada", "ship");
  a.recusa("uso", "registrar-conferencia", "T1", "--rodada", "needs-rework", "--verificacao", "verde");
  a.recusa("uso", "registrar-conferencia", "T1", "--rodada", "needs-rework", "--motivo", "x");
  assert.ok(!a.marcas().some((m) => /rodada$/.test(m)));
});

test("lerApproval lê verdict e rodada só do frontmatter; rodada ausente conta 1", () => {
  assert.deepEqual(lerApproval(approval("NEEDS_REWORK", 2)), { verdict: "NEEDS_REWORK", rodada: 2 });
  assert.deepEqual(lerApproval(approval("SHIP")), { verdict: "SHIP", rodada: 1 });
  assert.ok(Number.isNaN(lerApproval(approval("NEEDS_REWORK", "dois")).rodada));
  assert.deepEqual(lerApproval("sem frontmatter\nverdict: NEEDS_REWORK\n"), { verdict: null, rodada: null });
  // `verdict_provisorio` indentado no dois_tempos não é o verdict.
  assert.equal(lerApproval("---\ndois_tempos:\n  verdict: NEEDS_REWORK\n---\n").verdict, null);
});

/** A · B · C até o approval da vez; devolve o ambiente com a última tentativa trazida e sem registro. */
function ateRodada(t, approvals) {
  const a = ambiente(t, [GATE]);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim");
  approvals.forEach((arquivos, i) => {
    if (i > 0) a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
    a.abrirPeloProximo("T1", i + 1);
    a.rodada("T1", i + 1, arquivos);
  });
  return a;
}

test("approval sem `rodada:` conta como 1 e registra a rodada A", (t) => {
  const a = ateRodada(t, [{ [APPROVAL]: approval("NEEDS_REWORK") }]);
  assert.equal(a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework").rodadaDoApproval, 1);
});

test("rodada C que não regrava o approval pergunta (approval-fora-do-rito), sem abrir rodada", (t) => {
  const a = ateRodada(t, [
    { [APPROVAL]: approval("NEEDS_REWORK", 1) }, // A
    { "src/t1.mjs": "export const conserto = 1;\n" }, // B
    { "src/t1.mjs": "export const conserto = 2;\n" }, // C sem approval novo
  ]);
  const r = a.cli("registrar-conferencia", "T1", "--rodada", "needs-rework");
  assert.equal(r.status, 1, r.linhas.join("\n"));
  assert.equal(r.saida.motivo, "approval-fora-do-rito");
  assert.equal(r.saida.rodadaEsperada, 2);
  assert.equal(r.saida.rodadasRegistradas, 2);
  assert.equal(a.proximo().motivo, "trazida-sem-conferencia");
});

test("teto pelas marcas: depois de A·B·C·B, approval que diz rodada 1 ainda bate no teto", (t) => {
  const a = ateRodada(t, [
    { [APPROVAL]: approval("NEEDS_REWORK", 1) }, // A
    { "src/t1.mjs": "export const conserto = 1;\n" }, // B
    { [APPROVAL]: approval("NEEDS_REWORK", 2) }, // C
    { "src/t1.mjs": "export const conserto = 2;\n" }, // B
    { [APPROVAL]: approval("NEEDS_REWORK", 1) }, // C que mente
  ]);
  const r = a.cli("registrar-conferencia", "T1", "--rodada", "needs-rework");
  assert.equal(r.status, 1, r.linhas.join("\n"));
  assert.equal(r.saida.motivo, "teto-de-rodadas");
  assert.equal(r.saida.rodadasRegistradas, 4);
  assert.equal(a.marcas().filter((m) => /rodada$/.test(m)).length, 4);
});

test("conferência verde recusa task (gate-de-ux) com o approval em NEEDS_REWORK", (t) => {
  const a = ateRodada(t, [{ [APPROVAL]: approval("NEEDS_REWORK", 1) }]);
  a.recusa("approval-pede-rodada", "registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica");
  assert.ok(!a.marcas().some((m) => /conferida$/.test(m)));
});

// O rito das rodadas (o que a sessão faz em cada uma) é do projeto, no brief dele; o teto
// que o verbo cobra é do núcleo: três emissões do arquivo, e a 4ª nunca abre.
test("teto do verbo é o do rito de três rodadas", () => {
  assert.equal(TETO_RODADAS_GATE, 3);
});

// ── rodada de carimbo (F4 do ATRM-51, T25/3 → T25/4) ─────────────────────────
//
// A B da T25/3 trouxe conserto + carimbo por cherry-pick (a maestra commitou
// nota entre o `abrir` e o `trazer`): o conserto mudou de sha e o carimbo ficou
// órfão. A T25/4 refez a B só com o carimbo do sha novo; `--rodada needs-rework`
// recusava (`approval-fora-do-rito`: 2 marcas pedem `rodada: 2`, o approval segue
// em 1), e o `proximo` repetia `trazida-sem-conferencia` para sempre.

const carimbo = (sha) => `---\nsha: ${sha}\nreviewers: typescript-reviewer\nveredito: aprovado\n---\n`;
const carimboDoCiclo = (sha) => `${PASTA}/notes/reviews/${sha.slice(0, 8)}.md`;
const SHA_QUALQUER = "0123456789abcdef0123456789abcdef01234567";

/** A filha empurra commits arbitrários na tentativa `<n>` (cada item: arquivos a escrever, ou `{ rm }`). */
function empurrarFilha(a, n, commits) {
  const ref = `refs/conducao/${CICLO}/T1/${n}`;
  a.f("fetch", "-q", "origin", `+${ref}:refs/remotes/tentativa`);
  a.f("checkout", "-q", "--detach", "refs/remotes/tentativa");
  const shas = [];
  for (const [i, c] of commits.entries()) {
    if (c.rm) a.f("rm", "-q", c.rm);
    else escreverEm(a.filha, typeof c === "function" ? c(shas) : c);
    a.f("add", "-A");
    a.f("commit", "-q", "-m", `${CICLO}-F1/T1 — commit ${i + 1}`);
    shas.push(a.f("rev-parse", "HEAD"));
  }
  a.f("push", "-q", "origin", `HEAD:${ref}`);
  return shas;
}

/** A maestra commita uma nota no ramo entre o abrir e o trazer ⇒ o trazer sai por cherry-pick. */
function notaDaMaestra(a) {
  escreverEm(a.maestra, { [`${PASTA}/notes/nota.md`]: `nota ${Date.now()}\n` });
  a.g("add", "-A");
  a.g("commit", "-q", "-m", "nota da maestra");
}

/** Rodada B por cherry-pick: conserto e, por cima, o carimbo do sha da filha. */
function rodadaBComCarimboOrfao(a, n) {
  const [conserto] = empurrarFilha(a, n, [{ "src/t1.mjs": "export const conserto = 1;\n" }, ([c]) => ({ [carimboDoCiclo(c)]: carimbo(c) })]);
  notaDaMaestra(a);
  const trazido = a.ok("trazer", "T1", "--tentativa", String(n), "--sessao", `filha-T1-${n}`);
  const novo = a.g("log", "-1", "--format=%H", "HEAD", "--", "src/t1.mjs");
  return { conserto, novo, trazido };
}

test("trazer por cherry-pick avisa carimboOrfao quando o carimbo da filha cobre um sha que mudou", (t) => {
  const a = ateRodada(t, [{ [APPROVAL]: approval("NEEDS_REWORK", 1) }]);
  a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
  a.abrirPeloProximo("T1", 2);
  const { conserto, novo, trazido } = rodadaBComCarimboOrfao(a, 2);
  assert.equal(trazido.modo, "cherry-pick");
  assert.notEqual(novo, conserto);
  assert.deepEqual(trazido.carimboOrfao, { de: conserto, para: novo, carimbo: carimboDoCiclo(conserto) });
});

test("trazer sem carimbo órfão não avisa: fast-forward com carimbo, e cherry-pick sem carimbo na ponta", (t) => {
  const ff = ambiente(t, [GATE]);
  ff.ok("autorizar-ciclo", "F1", "--sim", "sim");
  ff.abrirPeloProximo("T1", 1);
  empurrarFilha(ff, 1, [{ "src/t1.mjs": "export const t1 = 1;\n" }, ([c]) => ({ [carimboDoCiclo(c)]: carimbo(c) })]);
  const sff = ff.ok("trazer", "T1", "--tentativa", "1", "--sessao", "filha");
  assert.equal(sff.modo, "fast-forward");
  assert.equal(sff.carimboOrfao, undefined);

  const a = ambiente(t, [GATE]);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim");
  a.abrirPeloProximo("T1", 1);
  empurrarFilha(a, 1, [{ "src/t1.mjs": "export const t1 = 1;\n" }]);
  notaDaMaestra(a);
  const s = a.ok("trazer", "T1", "--tentativa", "1", "--sessao", "filha");
  assert.equal(s.modo, "cherry-pick");
  assert.equal(s.carimboOrfao, undefined);
});

test("cenário medido: B só de carimbo fecha por --rodada carimbo, sem consumir rodada, e a C seguinte registra", (t) => {
  const a = ateRodada(t, [{ [APPROVAL]: approval("NEEDS_REWORK", 1) }]); // A
  a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
  a.abrirPeloProximo("T1", 2);
  const { novo } = rodadaBComCarimboOrfao(a, 2); // B, carimbo órfão
  a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");

  // A filha da tentativa 3 refaz a B só com o carimbo do sha novo (fast-forward).
  a.abrirPeloProximo("T1", 3);
  a.rodada("T1", 3, { [carimboDoCiclo(novo)]: carimbo(novo) });

  // Contraprova do estado medido: needs-rework recusa e o laço para.
  const r = a.cli("registrar-conferencia", "T1", "--rodada", "needs-rework");
  assert.equal(r.status, 1, r.linhas.join("\n"));
  assert.equal(r.saida.motivo, "approval-fora-do-rito");
  assert.equal(a.proximo().motivo, "trazida-sem-conferencia");

  const s = a.ok("registrar-conferencia", "T1", "--rodada", "carimbo");
  assert.equal(s.acao, "carimbo-registrado");
  assert.equal(s.tentativa, 3);
  assert.deepEqual(s.carimbos, [carimboDoCiclo(novo)]);
  assert.equal(a.g("log", "-1", "--format=%s"), "Conducao: T1 tentativa 3 carimbo");
  assert.equal(a.g("log", "-1", "--format=%(trailers:key=Conducao-Rodada,valueonly=true)"), "carimbo");
  // O carimbo do conserto está no HEAD: é a condição da rodada C no rito do brief.
  assert.ok(a.g("ls-tree", "-r", "--name-only", "HEAD").split("\n").includes(carimboDoCiclo(novo)));

  // O proximo abre a 4, sem falha anterior; a C (approval rodada 2) registra: a marca carimbo não conta.
  const c = a.abrirPeloProximo("T1", 4);
  assert.equal(c.falhaAnterior, undefined);
  a.rodada("T1", 4, { [APPROVAL]: approval("NEEDS_REWORK", 2) });
  const rc = a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
  assert.equal(rc.rodadasRegistradas, 2);
  assert.equal(rc.rodadaDoApproval, 2);
  assert.ok(!a.marcas().some((m) => /falhou$/.test(m)), a.marcas().join("\n"));
});

/** A · B (conserto com carimbo órfão) registradas; abre a tentativa 3. Devolve o ambiente e o sha novo do conserto. */
function ateBRefeita(t) {
  const a = ateRodada(t, [{ [APPROVAL]: approval("NEEDS_REWORK", 1) }]);
  a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
  a.abrirPeloProximo("T1", 2);
  const { novo } = rodadaBComCarimboOrfao(a, 2);
  a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
  a.abrirPeloProximo("T1", 3);
  return { a, novo };
}

test("--rodada carimbo aceita o destino de hotfix (.claude/state/review-carimbo/<sha8>.md)", (t) => {
  const { a, novo } = ateBRefeita(t);
  const p = `.claude/state/review-carimbo/${novo.slice(0, 8)}.md`;
  const [ponta] = empurrarFilha(a, 3, [{ [p]: carimbo(novo) }]);
  // `.claude/` está no alcance dos hooks: o trazer pergunta, e Rita aprova a ponta.
  a.ok("trazer", "T1", "--tentativa", "3", "--sessao", "filha", "--aprovado", ponta);
  assert.deepEqual(a.ok("registrar-conferencia", "T1", "--rodada", "carimbo").carimbos, [p]);
});

test("--rodada carimbo recusa carimbo que não cobre o conserto do HEAD e tentativa sem arquivo", (t) => {
  const alheio = ateBRefeita(t).a;
  alheio.rodada("T1", 3, { [carimboDoCiclo(SHA_QUALQUER)]: carimbo(SHA_QUALQUER) });
  alheio.recusa("rodada-carimbo-nao-cobre-o-conserto", "registrar-conferencia", "T1", "--rodada", "carimbo");
  assert.equal(alheio.proximo().motivo, "trazida-sem-conferencia");

  const vazia = ateBRefeita(t).a;
  const ref = `refs/conducao/${CICLO}/T1/3`;
  vazia.f("fetch", "-q", "origin", `+${ref}:refs/remotes/tentativa`);
  vazia.f("checkout", "-q", "--detach", "refs/remotes/tentativa");
  vazia.f("commit", "-q", "--allow-empty", "-m", `${CICLO}-F1/T1 — vazio`);
  vazia.f("push", "-q", "origin", `HEAD:${ref}`);
  vazia.ok("trazer", "T1", "--tentativa", "3", "--sessao", "filha");
  vazia.recusa("rodada-carimbo-sem-carimbo", "registrar-conferencia", "T1", "--rodada", "carimbo");
});

test("--rodada carimbo recusa tentativa que muda código além do carimbo", (t) => {
  const a = ateRodada(t, [{ [APPROVAL]: approval("NEEDS_REWORK", 1) }]);
  a.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
  a.abrirPeloProximo("T1", 2);
  a.rodada("T1", 2, { "src/t1.mjs": "export const conserto = 1;\n", [carimboDoCiclo(SHA_QUALQUER)]: carimbo(SHA_QUALQUER) });
  const r = a.recusa("rodada-carimbo-fora-do-carimbo", "registrar-conferencia", "T1", "--rodada", "carimbo");
  assert.match(r.stderr, /src\/t1\.mjs/);
  assert.ok(!a.marcas().some((m) => /carimbo$/.test(m)));
  assert.equal(a.proximo().motivo, "trazida-sem-conferencia");
});

test("--rodada carimbo recusa carimbo fora dos destinos, carimbo apagado, approval SHIP e task que não é conferência do operador", (t) => {
  const fora = ateRodada(t, [{ [APPROVAL]: approval("NEEDS_REWORK", 1) }]);
  fora.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
  fora.abrirPeloProximo("T1", 2);
  fora.rodada("T1", 2, { [`docs/reviews/${SHA_QUALQUER.slice(0, 8)}.md`]: carimbo(SHA_QUALQUER) });
  fora.recusa("rodada-carimbo-fora-do-carimbo", "registrar-conferencia", "T1", "--rodada", "carimbo");

  const apagado = ateRodada(t, [{ [APPROVAL]: approval("NEEDS_REWORK", 1), [carimboDoCiclo(SHA_QUALQUER)]: carimbo(SHA_QUALQUER) }]);
  apagado.ok("registrar-conferencia", "T1", "--rodada", "needs-rework");
  apagado.abrirPeloProximo("T1", 2);
  empurrarFilha(apagado, 2, [{ rm: carimboDoCiclo(SHA_QUALQUER) }]);
  apagado.ok("trazer", "T1", "--tentativa", "2", "--sessao", "filha");
  apagado.recusa("rodada-carimbo-fora-do-carimbo", "registrar-conferencia", "T1", "--rodada", "carimbo");

  const ship = ateRodada(t, [{ [APPROVAL]: approval("SHIP", 1), [carimboDoCiclo(SHA_QUALQUER)]: carimbo(SHA_QUALQUER) }]);
  ship.recusa("approval-nao-pede-rodada", "registrar-conferencia", "T1", "--rodada", "carimbo");

  const comum = ambiente(t, [task("T2", { outputs: `\`${APPROVAL}\` (create)` })]);
  comum.ok("autorizar-ciclo", "F1", "--sim", "sim");
  comum.abrirPeloProximo("T2", 1);
  comum.rodada("T2", 1, { [carimboDoCiclo(SHA_QUALQUER)]: carimbo(SHA_QUALQUER) });
  comum.recusa("rodada-fora-da-conferencia", "registrar-conferencia", "T2", "--rodada", "carimbo");
});
