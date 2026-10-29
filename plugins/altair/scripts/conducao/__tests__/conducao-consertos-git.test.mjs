/**
 * conducao-consertos-git.test.mjs — consertos da condução depois do ATRM-52
 * (hotfix conducao-consertos-pos-atrm52, ruling 1-a de Rita, 28/10/2026), na
 * parte dos verbos de git:
 *
 *   P25/P27  `esperar-filha` volta com ponta ou aviso já tratados (`--desde`, `--aviso-tratado`)
 *   C18b     `empurrar-copia` recusado pelo proposta-guard: a recusa diz o passo
 *   C24      `saida/` gitignored: o `conferir` avisa o que a task deixou fora do git
 *   C24      `trazer` recusa a faixa com merge de origin/main que o plano mandou fazer
 *   P19      `abrir` confere o modo de permissão da maestra antes de nascer filha
 *   P21/P24  `trazer` aceita caminho clínico nos segmentos que os Steps da task nomeiam
 *
 * Mesma montagem do conducao-git.test.mjs: origin bare, árvore da maestra no
 * ramo do ciclo, clone da filha; hooks desligados (core.hooksPath=/dev/null).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;
const TELA = "apps/web/src/app/(app)/agenda/agenda";

function task(id, { outputs, steps = "faz", verificacao = `echo verificacao-${id}` } = {}) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE1-1]",
    "- **Inputs:** `README.md`",
    `- **Outputs:** ${outputs ?? `\`src/${id.toLowerCase()}.mjs\` (create)`}`,
    "- **Estação:** servidor",
    "- **Independente:** sim",
    `- **Steps:** ${steps}`,
    `- **Verificação:** \`${verificacao}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-F1/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

function canonico(tasks) {
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

const gitEm = (dir) => (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function configurar(g) {
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]])
    g("config", k, v);
}

function escreverEm(dir, arquivos) {
  for (const [p, conteudo] of Object.entries(arquivos)) {
    mkdirSync(path.join(dir, path.dirname(p)), { recursive: true });
    writeFileSync(path.join(dir, p), conteudo);
  }
}

function ambiente(t, { tasks = [task("T1"), task("T2")] } = {}) {
  const raiz = mkdtempSync(path.join(tmpdir(), "conducao-consertos-git-"));
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
  g("push", "-q", "origin", "ciclo-teste", "ciclo-teste:main");
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
  const pergunta = (motivo, ...args) => {
    const r = cli(...args);
    assert.equal(r.status, 1, `${args.join(" ")} deveria perguntar\n${r.stderr}\n${r.linhas.join("\n")}`);
    assert.equal(r.saida?.acao, "perguntar", r.linhas.join("\n"));
    assert.equal(r.saida.motivo, motivo, r.linhas.join("\n"));
    return r.saida;
  };
  const refTentativa = (tk, n) => `refs/conducao/${CICLO}/${tk}/${n}`;
  const filhaParte = (tk, n) => {
    f("fetch", "-q", "origin", `+${refTentativa(tk, n)}:refs/remotes/tentativa`);
    f("checkout", "-q", "--detach", "refs/remotes/tentativa");
  };
  const filhaCommita = (tk, arquivos) => {
    escreverEm(filha, arquivos);
    f("add", "-A");
    f("commit", "-q", "-m", `${CICLO}-F1/${tk} — trabalho`);
    return f("rev-parse", "HEAD");
  };
  const filhaEmpurra = (tk, n) => {
    f("push", "-q", "origin", `HEAD:${refTentativa(tk, n)}`);
    return f("rev-parse", "HEAD");
  };
  const filhaAvisa = (tk, n, linha) => {
    const ref = `refs/conducao-aviso/${CICLO}/${tk}/${n}`;
    const anterior = f("ls-remote", "origin", ref).split("\t")[0] || null;
    const sha = f("commit-tree", "HEAD^{tree}", "-p", anterior ?? f("rev-parse", "HEAD"), "-m", linha);
    f("push", "-q", "origin", `${sha}:${ref}`);
    return sha;
  };
  const autorizar = () => ok("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1");
  const abrir = (tk, n = 1, nonce = `nonce${tk}${n}`) => ok("abrir", tk, "--tentativa", String(n), "--nonce", nonce, "--modo-maestra", "auto");
  /** Um commit novo no `main` do origin, de um clone à parte (o merge que o plano manda trazer). */
  const mainAnda = (arquivos) => {
    const outro = path.join(raiz, `outro-${Math.random().toString(36).slice(2)}`);
    execFileSync("git", ["clone", "-q", "-b", "main", origin, outro]);
    const o = gitEm(outro);
    configurar(o);
    escreverEm(outro, arquivos);
    o("add", "-A");
    o("commit", "-q", "-m", "commit do main");
    o("push", "-q", "origin", "main");
    return o("rev-parse", "HEAD");
  };
  return { raiz, origin, maestra, filha, g, f, cli, ok, pergunta, filhaParte, filhaCommita, filhaEmpurra, filhaAvisa, autorizar, abrir, mainAnda };
}

const esperar = (a, ...extra) => a.ok("esperar-filha", "T1", "--tentativa", "1", "--teto-chamador-min", "30", "--max-min", "0", ...extra);

// ── 1. esperar-filha: ponta e aviso já tratados ──────────────────────────────

test("P25/P27: esperar-filha --desde <ponta ja vista> nao volta andou na hora, e acorda quando a ponta anda de novo", (t) => {
  const a = ambiente(t);
  a.autorizar();
  a.abrir("T1");
  a.filhaParte("T1", 1);
  a.filhaCommita("T1", { "src/t1.mjs": "1\n" });
  const p1 = a.filhaEmpurra("T1", 1);
  assert.equal(esperar(a).desfecho, "andou");
  // Antes do conserto: rearmar saía `andou` de novo na hora (compara com o marcador).
  assert.equal(esperar(a, "--desde", p1).desfecho, "prazo");
  a.filhaCommita("T1", { "src/t1.mjs": "2\n" });
  const p2 = a.filhaEmpurra("T1", 1);
  const e = esperar(a, "--desde", p1);
  assert.equal(e.desfecho, "andou");
  assert.equal(e.ponta, p2);
  // `--desde` que não é sha recusa antes de esperar.
  assert.equal(a.cli("esperar-filha", "T1", "--tentativa", "1", "--teto-chamador-min", "30", "--max-min", "0", "--desde", "x").status, 1);
});

test("P25/P27: aviso ja tratado por mensagem nao acorda a espera rearmada; aviso novo acorda", (t) => {
  const a = ambiente(t);
  a.autorizar();
  a.abrir("T1");
  a.filhaParte("T1", 1);
  // A mensagem chegou antes (a espera foi parada); a referência do aviso sobe depois.
  a.filhaAvisa("T1", 1, "T1-FALHA pergunta nonceT11");
  // Antes do conserto: `avisou` com a pergunta já respondida.
  const e1 = esperar(a, "--aviso-tratado", "T1-FALHA pergunta nonceT11");
  assert.equal(e1.desfecho, "prazo", JSON.stringify(e1));
  // Marcado como visto: a espera seguinte, sem o flag, também não volta com ele.
  assert.equal(esperar(a).desfecho, "prazo");
  a.filhaCommita("T1", { "src/t1.mjs": "x\n" });
  const ponta = a.filhaEmpurra("T1", 1);
  a.filhaAvisa("T1", 1, `T1-OK ${ponta.slice(0, 8)} nonceT11`);
  const e2 = esperar(a, "--aviso-tratado", "T1-FALHA pergunta nonceT11");
  assert.equal(e2.desfecho, "avisou");
  assert.equal(e2.linha, `T1-OK ${ponta.slice(0, 8)} nonceT11`);
});

// ── 2. empurrar-copia antes da proposta ──────────────────────────────────────

test("C18b: empurrar-copia recusado pelo proposta-guard diz o passo que falta", (t) => {
  const a = ambiente(t);
  a.autorizar();
  const hooks = path.join(a.raiz, "hooks");
  mkdirSync(hooks);
  writeFileSync(
    path.join(hooks, "pre-push"),
    "#!/bin/sh\necho '[proposta-guard] `ciclo-teste` ja existe no remoto e NAO tem proposta aberta.' >&2\nexit 1\n",
  );
  chmodSync(path.join(hooks, "pre-push"), 0o755);
  a.g("config", "core.hooksPath", hooks);
  a.g("commit", "-q", "--allow-empty", "-m", "anda");
  const r = a.cli("empurrar-copia");
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /copia-sem-proposta/);
  assert.match(r.stderr, /gh pr create --draft --fill --head ciclo-teste/);
  assert.match(r.stderr, /empurrar-copia/);
});

// ── 3. saida/ gitignored ─────────────────────────────────────────────────────

test("C24: conferir avisa a saida que a task tirou do git, para a Verificacao vermelha nao virar falha da filha", (t) => {
  const a = ambiente(t, { tasks: [task("T1", { outputs: "`src/t1.mjs` (create) · `apps/x/.gitignore` (modify)" }), task("T2")] });
  a.autorizar();
  a.abrir("T1");
  a.filhaParte("T1", 1);
  a.filhaCommita("T1", { "src/t1.mjs": "1\n", "apps/x/.gitignore": "# gerado\ndemonstracao/saida/\n" });
  a.filhaEmpurra("T1", 1);
  a.ok("trazer", "T1", "--tentativa", "1", "--sessao", "s1");
  const c = a.ok("conferir", "T1");
  assert.equal(c.acao, "conferir");
  assert.deepEqual(c.saidaForaDoGit, [{ arquivo: "apps/x/.gitignore", padrao: "demonstracao/saida/" }]);
  assert.match(c.avisoSaida, /worktree da filha/);
  // Contraprova: task sem `.gitignore` na faixa não leva o aviso.
  a.abrir("T2");
  a.filhaParte("T2", 1);
  a.filhaCommita("T2", { "src/t2.mjs": "2\n" });
  a.filhaEmpurra("T2", 1);
  a.ok("trazer", "T2", "--tentativa", "1", "--sessao", "s2");
  assert.equal(a.ok("conferir", "T2").saidaForaDoGit, undefined);
});

// ── 4. trazer com merge de origin/main ───────────────────────────────────────

test("C24: trazer aceita a faixa com merge de origin/main e nao pergunta pelo que veio do main", (t) => {
  const a = ambiente(t);
  a.autorizar();
  a.abrir("T1");
  // O main anda com um arquivo que, vindo da filha, pediria pergunta (superfície de instrução).
  const doMain = a.mainAnda({ ".claude/rules/nova.md": "regra do main\n", "outro.txt": "do main\n" });
  a.filhaParte("T1", 1);
  a.filhaCommita("T1", { "src/t1.mjs": "1\n" });
  a.f("fetch", "-q", "origin", "main");
  a.f("merge", "-q", "--no-edit", "FETCH_HEAD");
  const ponta = a.filhaEmpurra("T1", 1);
  // Antes do conserto: `faixa-fora-do-marcador`.
  const s = a.ok("trazer", "T1", "--tentativa", "1", "--sessao", "s1");
  assert.equal(s.acao, "trazida");
  assert.equal(s.modo, "fast-forward");
  assert.equal(a.g("rev-parse", "HEAD"), ponta);
  assert.equal(a.g("merge-base", "--is-ancestor", doMain, "HEAD"), "");
});

test("C24 contraprova: merge de ramo que nao e o main segue recusado, e merge do main sem fast-forward pergunta", (t) => {
  const a = ambiente(t);
  a.autorizar();
  a.abrir("T1");
  a.abrir("T2");
  // Um ramo qualquer no origin, fora do main.
  a.f("checkout", "-q", "-b", "alheio", "origin/main");
  a.filhaCommita("T1", { "alheio.txt": "x\n" });
  a.f("push", "-q", "origin", "alheio");
  a.filhaParte("T1", 1);
  a.filhaCommita("T1", { "src/t1.mjs": "1\n" });
  a.f("merge", "-q", "--no-edit", "alheio");
  a.filhaEmpurra("T1", 1);
  a.pergunta("faixa-fora-do-marcador", "trazer", "T1", "--tentativa", "1");

  // T2 mescla o main, mas o HEAD já andou (outra trazida): sem fast-forward não há cherry-pick de merge.
  a.mainAnda({ "outro.txt": "do main\n" });
  a.filhaParte("T2", 1);
  a.filhaCommita("T2", { "src/t2.mjs": "2\n" });
  a.f("fetch", "-q", "origin", "main");
  a.f("merge", "-q", "--no-edit", "FETCH_HEAD");
  a.filhaEmpurra("T2", 1);
  a.g("commit", "-q", "--allow-empty", "-m", "a maestra anda");
  a.pergunta("merge-do-main-exige-fast-forward", "trazer", "T2", "--tentativa", "1");
});

// ── 5. abrir confere o modo da maestra ───────────────────────────────────────

test("P19: abrir exige --modo-maestra auto; outro modo pergunta sem gravar nada", (t) => {
  const a = ambiente(t);
  a.autorizar();
  const antes = a.g("for-each-ref", `refs/conducao-local/${CICLO}/`);
  const p = a.pergunta("modo-da-maestra", "abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "acceptEdits");
  assert.equal(p.modo, "acceptedits");
  assert.equal(a.g("for-each-ref", `refs/conducao-local/${CICLO}/`), antes, "nenhum marcador");
  const sem = a.cli("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11");
  assert.equal(sem.status, 1);
  assert.match(sem.stderr, /--modo-maestra/);
  // A forma da API (`PERMISSION_MODE_AUTO`) vale como `auto`.
  assert.equal(a.ok("abrir", "T1", "--tentativa", "1", "--nonce", "nonceT11", "--modo-maestra", "PERMISSION_MODE_AUTO").acao, "aberta");
});

// ── 6. caminho clínico nos segmentos dos Steps ───────────────────────────────

test("P21/P24: trazer aceita caminho clinico no segmento que os Steps nomeiam e pergunta pelo resto", (t) => {
  const steps = `muda a tela \`${TELA}/page.tsx\` e o teste dela`;
  const a = ambiente(t, { tasks: [task("T1", { steps }), task("T2", { steps })] });
  a.autorizar();
  a.abrir("T1");
  a.abrir("T2");
  a.filhaParte("T1", 1);
  a.filhaCommita("T1", {
    "src/t1.mjs": "1\n",
    [`${TELA}/page.tsx`]: "export default 1;\n",
    [`${TELA}/AgendaCliente.tsx`]: "export default 2;\n",
    [`${TELA}/__tests__/agenda.test.tsx`]: "test\n",
  });
  a.filhaEmpurra("T1", 1);
  // Antes do conserto: `caminho-clinico-fora-dos-outputs` pelos três.
  assert.equal(a.ok("trazer", "T1", "--tentativa", "1", "--sessao", "s1").acao, "trazida");

  a.filhaParte("T2", 1);
  a.filhaCommita("T2", {
    [`${TELA}/page.tsx`]: "export default 3;\n",
    "apps/web/src/app/(app)/agenda/pacientes/page.tsx": "export default 4;\n",
    "packages/database/supabase/migrations/20261028000000_x.sql": "select 1;\n",
  });
  a.filhaEmpurra("T2", 1);
  const p = a.pergunta("trazer-exige-aprovacao", "trazer", "T2", "--tentativa", "1");
  const clin = p.motivos.find((m) => m.motivo === "caminho-clinico-fora-dos-outputs");
  assert.deepEqual(clin.caminhos.sort(), [
    "apps/web/src/app/(app)/agenda/pacientes/page.tsx",
    "packages/database/supabase/migrations/20261028000000_x.sql",
  ]);
});

test("P21/P24 contraprova: Steps que nomeiam a raiz do modulo ou uma migration nao liberam nada", (t) => {
  const steps = "mexe em `apps/web/src/app/(app)/agenda/` e em `packages/database/supabase/migrations/20261028000000_x.sql`";
  const a = ambiente(t, { tasks: [task("T1", { steps })] });
  a.autorizar();
  a.abrir("T1");
  a.filhaParte("T1", 1);
  a.filhaCommita("T1", {
    [`${TELA}/page.tsx`]: "export default 1;\n",
    "packages/database/supabase/migrations/20261028000000_x.sql": "select 1;\n",
  });
  a.filhaEmpurra("T1", 1);
  const p = a.pergunta("trazer-exige-aprovacao", "trazer", "T1", "--tentativa", "1");
  assert.equal(p.motivos.find((m) => m.motivo === "caminho-clinico-fora-dos-outputs").caminhos.length, 2);
});

test("C24 contraprova: commit do main com subject de marca da conducao segue recusado no merge", (t) => {
  const a = ambiente(t);
  a.autorizar();
  a.abrir("T1");
  const outro = path.join(a.raiz, "outro-marca");
  execFileSync("git", ["clone", "-q", "-b", "main", a.origin, outro]);
  const o = gitEm(outro);
  configurar(o);
  o("commit", "-q", "--allow-empty", "-m", "Conducao: T1 conferida");
  o("push", "-q", "origin", "main");
  a.filhaParte("T1", 1);
  a.filhaCommita("T1", { "src/t1.mjs": "1\n" });
  a.f("fetch", "-q", "origin", "main");
  a.f("merge", "-q", "--no-edit", "FETCH_HEAD");
  a.filhaEmpurra("T1", 1);
  a.pergunta("faixa-com-marca-da-conducao", "trazer", "T1", "--tentativa", "1");
});

test("C24 contraprova: resolucao do merge que devolve arquivo sensivel ao estado do main segue perguntando", (t) => {
  const a = ambiente(t);
  // O ciclo tem uma regra que o main não tem; a filha a apaga dentro do merge do main.
  escreverEm(a.maestra, { ".claude/rules/do-ciclo.md": "regra do ciclo\n" });
  a.g("add", "-A");
  a.g("commit", "-q", "-m", "regra do ciclo");
  a.autorizar();
  a.abrir("T1");
  a.mainAnda({ "outro.txt": "do main\n" });
  a.filhaParte("T1", 1);
  a.filhaCommita("T1", { "src/t1.mjs": "1\n" });
  a.f("fetch", "-q", "origin", "main");
  a.f("merge", "-q", "--no-commit", "FETCH_HEAD");
  a.f("rm", "-q", ".claude/rules/do-ciclo.md");
  a.f("commit", "-q", "--no-edit");
  a.filhaEmpurra("T1", 1);
  const p = a.pergunta("trazer-exige-aprovacao", "trazer", "T1", "--tentativa", "1");
  assert.deepEqual(p.motivos.find((m) => m.motivo === "superficie-de-instrucao")?.caminhos, [".claude/rules/do-ciclo.md"]);
});

test("P21/P24 contraprova: server action e rota de API no segmento dos Steps seguem perguntando", (t) => {
  const steps = `muda a tela \`${TELA}/page.tsx\``;
  const a = ambiente(t, { tasks: [task("T1", { steps })] });
  a.autorizar();
  a.abrir("T1");
  a.filhaParte("T1", 1);
  a.filhaCommita("T1", { [`${TELA}/page.tsx`]: "1\n", [`${TELA}/actions.ts`]: "2\n", [`${TELA}/api/route.ts`]: "3\n" });
  a.filhaEmpurra("T1", 1);
  const p = a.pergunta("trazer-exige-aprovacao", "trazer", "T1", "--tentativa", "1");
  assert.deepEqual(p.motivos.find((m) => m.motivo === "caminho-clinico-fora-dos-outputs").caminhos.sort(), [`${TELA}/actions.ts`, `${TELA}/api/route.ts`]);
});

test("C24 contraprova: arquivo que ciclo e main mudaram, resolvido pela versao do main, segue perguntando", (t) => {
  const a = ambiente(t);
  escreverEm(a.maestra, { ".claude/rules/x.md": "v0\n" });
  a.g("add", "-A");
  a.g("commit", "-q", "-m", "regra v0");
  a.g("push", "-q", "origin", "HEAD:main");
  escreverEm(a.maestra, { ".claude/rules/x.md": "v1 do ciclo\n" });
  a.g("add", "-A");
  a.g("commit", "-q", "-m", "regra v1 no ciclo");
  a.autorizar();
  a.abrir("T1");
  a.mainAnda({ ".claude/rules/x.md": "v2 do main\n" });
  a.filhaParte("T1", 1);
  a.filhaCommita("T1", { "src/t1.mjs": "1\n" });
  a.f("fetch", "-q", "origin", "main");
  spawnSync("git", ["-C", a.filha, "merge", "--no-commit", "FETCH_HEAD"], { encoding: "utf8" });
  a.f("checkout", "--theirs", ".claude/rules/x.md");
  a.f("add", "-A");
  a.f("commit", "-q", "--no-edit");
  a.filhaEmpurra("T1", 1);
  const p = a.pergunta("trazer-exige-aprovacao", "trazer", "T1", "--tentativa", "1");
  assert.deepEqual(p.motivos.find((m) => m.motivo === "superficie-de-instrucao")?.caminhos, [".claude/rules/x.md"]);
});
