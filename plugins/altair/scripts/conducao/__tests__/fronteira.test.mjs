/**
 * fronteira.test.mjs — a fronteira da condução (VEGA-29 T17, 20-a; princípios
 * 4 e 5 de `3-codigo.md` §7).
 *
 * Três desfechos que antes eram espera ou exceção:
 * - entrada malformada da maestra ⇒ `perguntar entrada-invalida`, nunca
 *   decisão calada nem pilha (exit 2);
 * - git que passa do prazo ⇒ morto com `SIGKILL`, desfecho
 *   `git-prazo-estourado` com os `*.lock` do git-dir (o teste põe na frente do
 *   PATH um `git` falso que dorme além do prazo);
 * - escrita parcial (marca gravada no ramo, cópia não empurrada) ⇒
 *   `registrado-sem-copia`, com o que gravou e o remédio, exit 1.
 *
 * O script é chamado como CLI, do jeito que a maestra o chama; o log de
 * eventos vai para uma pasta temporária (`ALTAIR_CONDUCAO_LOG_DIR`).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { problemasDaEntrada } from "../conducao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const GIT_EXEC = path.resolve(AQUI, "..", "git-exec.mjs");
const CICLO = "TESTE-17-fronteira";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;

const TMP = mkdtempSync(path.join(tmpdir(), "conducao-fronteira-"));
after(() => rmSync(TMP, { recursive: true, force: true }));
const ENV = { ...process.env, ALTAIR_CONDUCAO_LOG_DIR: path.join(TMP, "log") };

function cli(args, env = ENV) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env });
  const linha = r.stdout.trim();
  return { status: r.status, saida: linha ? JSON.parse(linha) : null, erro: r.stderr };
}

function canonico() {
  return [
    "---",
    `cycle: ${CICLO}`,
    "opened: 2026-10-28",
    "---",
    "",
    "## 3. Tasks",
    "",
    "### F1 — fase F1 (**Modelo:** sonnet)",
    "",
    "#### T1 — tarefa T1",
    "",
    "- **Objetivo:** tarefa T1",
    "- **satisfies:** [AC-TESTE17-1]",
    "- **Inputs:** `README.md`",
    "- **Outputs:** `src/t1.mjs` (create)",
    "- **Estação:** servidor",
    "- **Steps:** faz",
    "- **Verificação:** `echo ok`.",
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-F1/T1 — tarefa T1\``,
    "",
    "## 4. Pronto",
    "",
  ].join("\n");
}

/** Repo com o canonico commitado; `origin` aponta para um caminho que não existe. */
function novoRepo() {
  const dir = mkdtempSync(path.join(TMP, "repo-"));
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "ciclo-teste");
  g("config", "core.hooksPath", "/dev/null");
  g("config", "user.name", "teste");
  g("config", "user.email", "teste@example.invalid");
  g("config", "commit.gpgsign", "false");
  g("remote", "add", "origin", path.join(TMP, "origin-que-nao-existe"));
  mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
  writeFileSync(path.join(dir, CAMINHO), canonico());
  g("add", CAMINHO);
  g("commit", "-q", "-m", "plano");
  return { dir, g };
}

// ── entrada da maestra ───────────────────────────────────────────────────────

test("entrada na forma da SKILL §2 passo 1 nao tem problema", () => {
  const entrada = {
    filhas: [{ sessao: "session_1", task: "T1", tentativa: 1, nonce: "abc", estado: "RUNNING", aviso: "T1-OK 1234abcd abc", arquivamentos: [] }],
    agora: "2026-10-28T10:00:00Z",
    ci: { sha: "0123456789abcdef", veredito: "em-curso", run: 7 },
    sessaoMaestra: "session_m",
    proposta: { number: 9, state: "OPEN" },
    aprovacoes: [{ task: "T1", nonce: "abc" }],
    tetoPonte: 2,
  };
  assert.deepEqual(problemasDaEntrada(entrada), []);
  assert.deepEqual(problemasDaEntrada({}), []);
  assert.deepEqual(problemasDaEntrada({ ci: null, proposta: null, filhas: [] }), []);
});

test("cada forma errada da entrada vira um problema nomeado", () => {
  const casos = [
    [[], /^a entrada é lista/],
    ["x", /^a entrada é string/],
    [{ filha: [] }, /^campo desconhecido: filha$/],
    [{ filhas: "x" }, /^filhas: esperado lista$/],
    [{ filhas: [1] }, /^filhas\[0\]: esperado objeto$/],
    [{ filhas: [{ sessao: 1 }] }, /^filhas\[0\]\.sessao: 1, esperado texto$/],
    [{ filhas: [{ tentativa: "1" }] }, /^filhas\[0\]\.tentativa: /],
    [{ filhas: [{ arquivamentos: "n" }] }, /^filhas\[0\]\.arquivamentos: /],
    [{ aprovacoes: {} }, /^aprovacoes: esperado lista$/],
    [{ aprovacoes: [{ task: 1 }] }, /^aprovacoes\[0\]\.task: /],
    [{ ci: "verde" }, /^ci: "verde", esperado objeto$/],
    [{ ci: { sha: 1 } }, /^ci\.sha: /],
    [{ proposta: [] }, /^proposta: /],
    [{ tetoPonte: "2" }, /^tetoPonte: /],
    [{ tetoPonte: -1 }, /^tetoPonte: /],
    [{ agora: "ontem" }, /^agora: /],
    [{ sessaoMaestra: 3 }, /^sessaoMaestra: /],
  ];
  for (const [entrada, re] of casos) {
    const p = problemasDaEntrada(entrada);
    assert.equal(p.length, 1, `${JSON.stringify(entrada)}: ${JSON.stringify(p)}`);
    assert.match(p[0], re, JSON.stringify(entrada));
  }
});

test("proximo com chave trocada (filha) pergunta entrada-invalida, sem decidir", () => {
  const repo = novoRepo();
  const r = cli(["proximo", "--repo", repo.dir, "--ciclo", CICLO, "--entrada", '{"filha":[]}']);
  assert.equal(r.status, 0, r.erro);
  assert.equal(r.saida.acao, "perguntar");
  assert.equal(r.saida.motivo, "entrada-invalida");
  assert.deepEqual(r.saida.problemas, ["campo desconhecido: filha"]);
  assert.match(r.saida.nonce, /^[0-9a-f]{16}$/);
});

test("proximo com entrada valida segue decidindo (autorizar-ciclo)", () => {
  const repo = novoRepo();
  const r = cli(["proximo", "--repo", repo.dir, "--ciclo", CICLO, "--entrada", '{"filhas":[],"tetoPonte":1}']);
  assert.equal(r.status, 0, r.erro);
  assert.equal(r.saida.motivo, "autorizar-ciclo");
});

// ── git com prazo ────────────────────────────────────────────────────────────

/** PATH com um `git` falso na frente: dorme além do prazo; `rev-parse --git-dir` vai ao git de verdade. */
function pathComGitLento() {
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const dir = mkdtempSync(path.join(TMP, "bin-"));
  const falso = path.join(dir, "git");
  writeFileSync(falso, ["#!/bin/sh", 'case "$*" in', `  *"rev-parse --git-dir"*) exec "${real}" "$@" ;;`, "esac", "exec sleep 30", ""].join("\n"));
  chmodSync(falso, 0o755);
  return `${dir}${path.delimiter}${process.env.PATH}`;
}

test("git que estoura o prazo e morto e sai com desfecho git-prazo-estourado e o lock", () => {
  const repo = novoRepo();
  const lock = path.join(repo.dir, ".git", "index.lock");
  writeFileSync(lock, "");
  const env = { ...ENV, PATH: pathComGitLento(), ALTAIR_CONDUCAO_GIT_PRAZO_MS: "400" };
  const inicio = Date.now();
  const r = cli(["proximo", "--repo", repo.dir, "--ciclo", CICLO], env);
  const ms = Date.now() - inicio;
  assert.ok(ms < 20_000, `o git falso dorme 30 s; o prazo o matou em ${ms} ms`);
  assert.equal(r.status, 1, r.erro);
  assert.equal(r.saida.acao, "perguntar");
  assert.equal(r.saida.motivo, "git-prazo-estourado");
  assert.equal(r.saida.prazoMs, 400);
  assert.match(r.saida.comando, /^git rev-parse HEAD$/);
  assert.deepEqual(r.saida.locks, [lock]);
  assert.match(r.erro, /^conducao: git-prazo-estourado: /);
});

test("tentarGit no estouro nao lanca: status null, prazoEstourado e os locks", () => {
  const repo = novoRepo();
  const env = { ...ENV, PATH: pathComGitLento(), ALTAIR_CONDUCAO_GIT_PRAZO_MS: "300" };
  const codigo = `import { tentarGit } from ${JSON.stringify(GIT_EXEC)}; process.stdout.write(JSON.stringify(tentarGit(${JSON.stringify(repo.dir)}, ["status"])));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", codigo], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  const t = JSON.parse(r.stdout);
  assert.equal(t.status, null);
  assert.equal(t.prazoEstourado, true);
  assert.deepEqual(t.locks, []);
  assert.match(t.erro, /git status passou de 300 ms/);
});

// ── escrita parcial ──────────────────────────────────────────────────────────

test("marca gravada e copia recusada sai registrado-sem-copia com o que gravou, exit 1", () => {
  const repo = novoRepo();
  const antes = repo.g("rev-parse", "HEAD");
  const r = cli(["encerrar-sessao", "--repo", repo.dir, "--ciclo", CICLO, "--fase", "F1", "--nonce", "0123456789abcdef"]);
  assert.equal(r.status, 1, r.erro);
  assert.equal(r.saida.acao, "registrado-sem-copia");
  assert.equal(r.saida.desfecho, "encerrada");
  assert.equal(r.saida.motivo, "copia-push-falhou");
  assert.equal(r.saida.remedio, "empurrar-copia");
  assert.equal(r.saida.copia, null);
  // A marca está no ramo: é o sha da saída, filho do commit de antes.
  const head = repo.g("rev-parse", "HEAD");
  assert.equal(r.saida.sha, head);
  assert.equal(repo.g("rev-parse", "HEAD^"), antes);
  assert.equal(repo.g("log", "-1", "--format=%s"), "Conducao: F1 sessao encerrada");
});
