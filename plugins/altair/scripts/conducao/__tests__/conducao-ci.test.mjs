/**
 * conducao-ci.test.mjs — leitura de CI da condução (VEGA-22 T14).
 *
 * `conducao.mjs ci` decide sobre runs e proposta que a maestra coleta pelo
 * `gh` — aqui em JSON de fixture, com `--agora` fixo: nenhum caso depende do
 * relógio da máquina. `conferir-workflows` roda sobre pastas temporárias de
 * workflow e sobre o próprio repositório.
 *
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOTOES } from "../botoes.mjs";
import { decidirCi, gatilhoPush } from "../conducao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
/** A raiz do repositório do plugin: o CI dele é o que o verbo confere. */
const RAIZ = path.resolve(AQUI, "..", "..", "..", "..", "..");

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const PUSH = "2026-10-15T10:00:00.000Z";
const depois = (min) => new Date(Date.parse(PUSH) + min * 60_000).toISOString();
const PR_OK = { number: 502, state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED", headRefOid: SHA };
const run = (extra) => ({ databaseId: 9001, headSha: SHA, status: "completed", conclusion: "success", createdAt: depois(1), workflowName: "CI", ...extra });

function cli(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { status: r.status, saida: r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null, erro: r.stderr };
}

// ── ci ──────────────────────────────────────────────────────────────────────

test("sem run depois do prazo do push emite aviso com o estado de mesclagem da proposta", () => {
  const pr = { ...PR_OK, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" };
  const r = cli(["ci", "--push-em", PUSH, "--agora", depois(BOTOES.prazoRunCiMin + 1), "--runs", "[]", "--pr", JSON.stringify(pr), "--sha", SHA]);
  assert.equal(r.status, 0, r.erro);
  assert.equal(r.saida.acao, "avisar");
  assert.equal(r.saida.veredito, "sem-run");
  assert.deepEqual(r.saida.mesclagem, { proposta: 502, state: "OPEN", mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", headRefOid: SHA });
  assert.match(r.saida.aviso, /CONFLICTING/);
  assert.match(r.saida.aviso, /não gera run/);
  assert.equal(r.saida.minutosDesdeOPush, BOTOES.prazoRunCiMin + 1);
});

test("sem run de proposta mesclavel tambem avisa, com o estado lido", () => {
  const r = decidirCi({ pushEm: PUSH, agora: depois(BOTOES.prazoRunCiMin), runs: [], pr: PR_OK });
  assert.equal(r.acao, "avisar");
  assert.equal(r.veredito, "sem-run");
  assert.match(r.aviso, /mergeable=MERGEABLE, mergeStateStatus=BLOCKED/);
});

test("sem run dentro do prazo espera ate o prazo", () => {
  const r = decidirCi({ pushEm: PUSH, agora: depois(BOTOES.prazoRunCiMin - 1), runs: [], pr: PR_OK });
  assert.equal(r.acao, "esperar");
  assert.equal(r.motivo, "run-nao-nasceu");
  assert.equal(r.ate, depois(BOTOES.prazoRunCiMin));
});

test("run de outro sha ou anterior ao push nao conta como run do push", () => {
  const runs = [run({ headSha: "ffffffffffffffffffffffffffffffffffffffff" }), run({ createdAt: depois(-30) })];
  const r = decidirCi({ pushEm: PUSH, agora: depois(60), runs, pr: PR_OK });
  assert.equal(r.acao, "avisar");
  assert.equal(r.veredito, "sem-run");
});

test("run em curso espera", () => {
  const r = decidirCi({ pushEm: PUSH, agora: depois(5), runs: [run({ status: "in_progress", conclusion: null })], pr: PR_OK });
  assert.equal(r.acao, "esperar");
  assert.equal(r.motivo, "run-em-curso");
  assert.deepEqual(r.runs, [9001]);
});

test("run terminado manda ler por dentro, porque conclusion nao e veredito", () => {
  const r = decidirCi({ pushEm: PUSH, agora: depois(20), runs: [run({})], pr: PR_OK });
  assert.equal(r.acao, "ler-run");
  assert.deepEqual(r.runs, [{ id: 9001, workflow: "CI", conclusion: "success" }]);
  assert.deepEqual(r.lerPorDentro, ["gh run view 9001 --log"]);
  assert.match(r.aviso, /desfecho \| nome/);
});

test("proposta que nao aponta para o sha empurrado avisa desalinhada", () => {
  const r = decidirCi({ pushEm: PUSH, agora: depois(20), runs: [run({})], pr: { ...PR_OK, headRefOid: "0".repeat(40) }, sha: SHA });
  assert.equal(r.acao, "avisar");
  assert.equal(r.veredito, "proposta-desalinhada");
});

test("ci sem --pr sai 2 e push-em invalido sai 1", () => {
  assert.equal(cli(["ci", "--push-em", PUSH]).status, 2);
  assert.equal(cli(["ci", "--push-em", "ontem", "--pr", JSON.stringify(PR_OK)]).status, 1);
});

// ── conferir-workflows ──────────────────────────────────────────────────────

function repoDeWorkflows(arquivos) {
  const dir = mkdtempSync(path.join(tmpdir(), "conducao-ci-"));
  mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  for (const [nome, texto] of Object.entries(arquivos)) writeFileSync(path.join(dir, ".github", "workflows", nome), texto);
  return dir;
}

const SO_MAIN = ["on:", "  pull_request:", "    branches: [main]", "  push:", "    branches:", "      - main", "jobs:", "  a:", "    env:", "      T: ${{ secrets.TOKEN }}", ""].join("\n");

test("conferir-workflows sai 1 com push fora de main que le secrets", () => {
  const dir = repoDeWorkflows({
    "ci.yml": SO_MAIN,
    "ramo.yml": ["on:", "  push:", "    branches: [\"ciclo-*\"]", "jobs:", "  a:", "    env:", "      T: ${{ secrets.TOKEN }}", ""].join("\n"),
  });
  try {
    const r = cli(["conferir-workflows", "--repo", dir]);
    assert.equal(r.status, 1);
    assert.equal(r.saida.ok, false);
    assert.deepEqual(r.saida.violacoes, [{ arquivo: ".github/workflows/ramo.yml", branches: ["ciclo-*"], linhasSecrets: [7] }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("conferir-workflows sai 0 com push so em main, push fora de main sem secrets e secrets em comentario", () => {
  const dir = repoDeWorkflows({
    "ci.yml": SO_MAIN,
    "prova.yml": ["on:", "  push:", "    branches: [ciclo-X]", "  # le secrets.env.bak so em comentario", "jobs: {}", ""].join("\n"),
  });
  try {
    const r = cli(["conferir-workflows", "--repo", dir]);
    assert.equal(r.status, 0, JSON.stringify(r.saida));
    assert.equal(r.saida.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gatilho push inline, com tags ou branches-ignore conta como fora de main", () => {
  assert.equal(gatilhoPush("on: push\n").soMain, false);
  assert.equal(gatilhoPush("on: [pull_request, push]\n").soMain, false);
  assert.equal(gatilhoPush("on: [pull_request]\n"), null);
  assert.equal(gatilhoPush("on:\n  push:\n    branches: [main]\n    tags: ['v*']\n").soMain, false);
  assert.equal(gatilhoPush("on:\n  push:\n    branches-ignore: [main]\n").soMain, false);
  assert.equal(gatilhoPush("on:\n  push:\n").soMain, false);
  assert.equal(gatilhoPush("on:\n  push:\n    branches: [main]\n    paths: ['x/**']\n").soMain, true);
});

test("conferir-workflows sai 0 sobre os workflows do repositorio", () => {
  const r = cli(["conferir-workflows", "--repo", RAIZ]);
  assert.equal(r.status, 0, JSON.stringify(r.saida?.violacoes));
  assert.ok(r.saida.conferidos.some((c) => c.arquivo === ".github/workflows/ci.yml" && c.push === "main"));
});
