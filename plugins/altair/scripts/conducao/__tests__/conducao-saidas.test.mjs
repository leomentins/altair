/**
 * conducao-saidas.test.mjs — caracterização dos códigos de saída de `main` e
 * da resposta a entrada malformada (VEGA-29 T3).
 *
 * Cada caso afirma a saída de HOJE, mesmo a ruim: é rede para a reconstrução
 * do núcleo (F1), que deve manter tudo isto igual. Os casos que a F2 mudou
 * levam no nome a task que os mudou (`[mudou na T17]`): lá a entrada
 * malformada deixou de estourar como exceção (exit 2 com pilha) e virou
 * `perguntar entrada-invalida`; o resto da fronteira está em `fronteira.test.mjs`.
 *
 * Tabela que estes casos exercem: `contrato-atual.md` §Códigos de saída.
 * O script é chamado como CLI, do jeito que a maestra o chama; o log de
 * eventos vai para uma pasta temporária (`ALTAIR_CONDUCAO_LOG_DIR`).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-3-saidas";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;
const PUSH = "2026-10-15T10:00:00.000Z";
const AGORA = "2026-10-15T10:30:00.000Z";

const TMP = mkdtempSync(path.join(tmpdir(), "conducao-saidas-"));
after(() => rmSync(TMP, { recursive: true, force: true }));
const ENV = { ...process.env, ALTAIR_CONDUCAO_LOG_DIR: path.join(TMP, "log") };

function cli(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: ENV });
  const linha = r.stdout.trim();
  return { status: r.status, saida: linha ? JSON.parse(linha) : null, stdout: r.stdout, erro: r.stderr };
}

// ── fixture: repo git com um canonico de uma task ────────────────────────────

function canonico(verificacao) {
  return [
    "---",
    `cycle: ${CICLO}`,
    "opened: 2026-10-15",
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
    "#### T1 — tarefa T1",
    "",
    "- **Objetivo:** tarefa T1",
    "- **satisfies:** [AC-TESTE3-1]",
    "- **Inputs:** `README.md`",
    "- **Outputs:** `src/t1.mjs` (create)",
    "- **Estação:** servidor",
    "- **Steps:** faz",
    `- **Verificação:** \`${verificacao}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-F1/T1 — tarefa T1\``,
    "",
    "## 4. Pronto",
    "",
  ].join("\n");
}

/** Repo vazio (sem commit); `escrever` grava o canonico, `autorizar` a marca da F1. */
function novoRepo() {
  const dir = mkdtempSync(path.join(TMP, "repo-"));
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "ciclo-teste");
  g("config", "core.hooksPath", "/dev/null");
  g("config", "user.name", "teste");
  g("config", "user.email", "teste@example.invalid");
  g("config", "commit.gpgsign", "false");
  const escrever = (verificacao = "echo verificacao-T1") => {
    mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
    writeFileSync(path.join(dir, CAMINHO), canonico(verificacao));
    g("add", CAMINHO);
    g("commit", "-q", "-m", "plano");
  };
  const autorizar = () =>
    g("commit", "-q", "--allow-empty", "-m", "Conducao: F1 autorizada", "-m", "sim do Rita", "-m", `Conducao-Plano: ${g("rev-parse", `HEAD:${CAMINHO}`)}`);
  const rodar = (...args) => cli([...args, "--repo", dir, "--ciclo", CICLO]);
  return { dir, escrever, autorizar, rodar };
}

const comPlano = () => {
  const r = novoRepo();
  r.escrever();
  return r;
};

const PR = JSON.stringify({ number: 1, state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED", headRefOid: "abc" });

// ── exit 0 ───────────────────────────────────────────────────────────────────

test("exit 0: proximo sai 0 mesmo quando a acao e perguntar", () => {
  const r = comPlano().rodar("proximo");
  assert.equal(r.status, 0, r.erro);
  assert.equal(r.saida.acao, "perguntar");
  assert.equal(r.saida.motivo, "autorizar-ciclo");
});

test("exit 0: retomar sai 0 mesmo com origin inacessivel como divergencia", () => {
  const r = comPlano().rodar("retomar");
  assert.equal(r.status, 0, r.erro);
  assert.equal(r.saida.acao, "retomar");
  assert.equal(r.saida.divergencias[0].tipo, "origin-inacessivel");
});

test("exit 0: conferir com a task no plano congelado", () => {
  const repo = comPlano();
  repo.autorizar();
  const r = repo.rodar("conferir", "T1");
  assert.equal(r.status, 0, r.erro);
  assert.equal(r.saida.acao, "conferir");
  assert.equal(r.saida.task, "T1");
});

test("exit 0: ci sai 0 com qualquer veredito, inclusive conclusion fora do vocabulario", () => {
  const runs = JSON.stringify([{ databaseId: 1, headSha: "abc", status: "completed", conclusion: "banana", createdAt: "2026-10-15T10:01:00Z", workflowName: "CI" }]);
  const r = cli(["ci", "--push-em", PUSH, "--agora", AGORA, "--sha", "abc", "--runs", runs, "--pr", PR]);
  assert.equal(r.status, 0, r.erro);
  assert.equal(r.saida.acao, "ler-run");
  assert.deepEqual(r.saida.runs, [{ id: 1, workflow: "CI", conclusion: "banana" }]);
  assert.deepEqual(r.saida.lerPorDentro, ["gh run view 1 --log"]);
});

test("exit 0: conferir-workflows sem nenhum workflow sai ok", () => {
  const dir = mkdtempSync(path.join(TMP, "wf-"));
  const r = cli(["conferir-workflows", "--repo", dir]);
  assert.equal(r.status, 0, r.erro);
  assert.deepEqual(r.saida, { acao: "workflows", ok: true, conferidos: [], violacoes: [] });
});

test("exit 0: registrar-evento com --acao", () => {
  const r = cli(["registrar-evento", "--ciclo", CICLO, "--acao", "abrir"]);
  assert.equal(r.status, 0, r.erro);
  assert.equal(r.saida.acao, "evento-registrado");
  assert.equal(r.saida.ciclo, CICLO);
});

// ── exit 1 ───────────────────────────────────────────────────────────────────

test("exit 1: verbo de git que responde perguntar escreve o JSON e sai 1", () => {
  const r = comPlano().rodar("abrir", "T1", "--modo-maestra", "default");
  assert.equal(r.status, 1, r.erro);
  assert.equal(r.saida.acao, "perguntar");
  assert.equal(r.saida.motivo, "modo-da-maestra");
  assert.equal(r.saida.modo, "default");
});

test("exit 1: conferir que responde perguntar (binario ausente) escreve o JSON e sai 1", () => {
  const repo = novoRepo();
  repo.escrever("binario-que-nao-existe-t3 --versao");
  repo.autorizar();
  const r = repo.rodar("conferir", "T1");
  assert.equal(r.status, 1, r.erro);
  assert.equal(r.saida.acao, "perguntar");
  assert.equal(r.saida.motivo, "binario-ausente");
  assert.deepEqual(r.saida.binarios, ["binario-que-nao-existe-t3"]);
});

test("exit 1: auditar com violacao escreve o JSON e sai 1", () => {
  const r = comPlano().rodar("auditar", "--ref", "ciclo-teste");
  assert.equal(r.status, 1, r.erro);
  assert.equal(r.saida.acao, "auditar");
  assert.equal(r.saida.violacoes[0].regra, "sem-conferencia");
});

test("exit 1: conferir-workflows com push fora de main que le secrets", () => {
  const dir = mkdtempSync(path.join(TMP, "wf-"));
  mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(
    path.join(dir, ".github", "workflows", "ramo.yml"),
    ["on:", "  push:", '    branches: ["ciclo-*"]', "jobs:", "  a:", "    env:", "      T: ${{ secrets.TOKEN }}", ""].join("\n"),
  );
  const r = cli(["conferir-workflows", "--repo", dir]);
  assert.equal(r.status, 1, r.erro);
  assert.equal(r.saida.ok, false);
});

test("exit 1: reinicio-valido com arquivo ausente sai 1 com sem-registro", () => {
  const r = cli(["reinicio-valido", "--arquivo", path.join(TMP, "nao-existe.json")]);
  assert.equal(r.status, 1, r.erro);
  assert.deepEqual(r.saida, { valido: false, motivo: "sem-registro" });
});

test("exit 1: ErroPlano de uso em verbo de git (abrir sem --modo-maestra) sai 1 so com stderr", () => {
  const r = comPlano().rodar("abrir", "T1");
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.erro, /^conducao: uso: abrir exige --modo-maestra/);
});

test("exit 1: ErroPlano fora de verbo de git (conferir sem fase autorizada) sai 1 so com stderr", () => {
  const r = comPlano().rodar("conferir", "T1");
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.erro, /^conducao: sem-autorizacao: /);
});

test("exit 1: registrar-evento sem --acao e ErroPlano de uso e sai 1, nao 2", () => {
  const r = cli(["registrar-evento", "--ciclo", CICLO]);
  assert.equal(r.status, 1);
  assert.match(r.erro, /^conducao: uso: registrar-evento exige --acao/);
});

test("exit 1: ci com --push-em ausente e ErroPlano de uso e sai 1, nao 2", () => {
  const r = cli(["ci", "--pr", "{}", "--runs", "[]"]);
  assert.equal(r.status, 1);
  assert.match(r.erro, /^conducao: uso: ci: --push-em inválido: undefined/);
});

// ── exit 2 ───────────────────────────────────────────────────────────────────

test("exit 2: sem verbo nem --ciclo", () => {
  const r = cli([]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  assert.equal(r.erro, "conducao: --ciclo é obrigatório\n");
});

test("exit 2: --ciclo na posicao do verbo e lido como verbo e cobra --ciclo", () => {
  const r = cli(["--ciclo", CICLO]);
  assert.equal(r.status, 2);
  assert.equal(r.erro, "conducao: --ciclo é obrigatório\n");
});

test("exit 2: verbo desconhecido lista os verbos", () => {
  const r = cli(["nao-existe", "--ciclo", CICLO]);
  assert.equal(r.status, 2);
  assert.match(r.erro, /^conducao: verbo desconhecido: nao-existe — proximo \| conferir \| retomar \| auditar \| registrar-evento \| autorizar-fase/);
});

test("exit 2: flag obrigatoria ausente em cada verbo sem ciclo", () => {
  const casos = [
    [["auditar"], "auditar exige --nota <arquivo> ou --ciclo <id> --ref <ref>"],
    [["ci", "--push-em", PUSH], "ci exige --push-em <iso> --runs <json> --pr <json>"],
    [["reinicio-valido"], "reinicio-valido exige --arquivo <ponte-reinicio.json>"],
    [["conferir", "--ciclo", CICLO], "conferir exige T<k>"],
  ];
  for (const [args, msg] of casos) {
    const r = cli(args);
    assert.equal(r.status, 2, args.join(" "));
    assert.equal(r.erro, `conducao: ${msg}\n`, args.join(" "));
  }
});

test("exit 2: ErroPlano teto-do-chamador (esperar-filha sem --teto-chamador-min)", () => {
  const r = comPlano().rodar("esperar-filha", "T1", "--tentativa", "1");
  assert.equal(r.status, 2);
  assert.match(r.erro, /^conducao: teto-do-chamador: --teto-chamador-min <n> é obrigatório/);
});

test("exit 2: excecao inesperada (repo sem commit) sai com a pilha no stderr", () => {
  const r = novoRepo().rodar("proximo");
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  assert.match(r.erro, /^conducao: Error: Command failed: git .* rev-parse HEAD/);
  assert.match(r.erro, /\n {4}at /);
});

// ── entrada malformada ───────────────────────────────────────────────────────

// Mudaram na T17 (20-a): a entrada malformada deixou de estourar como exceção
// (exit 2 com pilha) e de passar calada; vira `perguntar entrada-invalida`.

test("[mudou na T17] proximo --entrada com JSON invalido sai 0 com perguntar entrada-invalida", () => {
  const r = comPlano().rodar("proximo", "--entrada", "{nao");
  assert.equal(r.status, 0, r.erro);
  assert.equal(r.saida.acao, "perguntar");
  assert.equal(r.saida.motivo, "entrada-invalida");
  assert.match(r.saida.problemas[0], /^--entrada: JSON ilegível/);
});

test("[mudou na T17] proximo --entrada com arquivo ausente sai 0 com perguntar entrada-invalida", () => {
  const r = comPlano().rodar("proximo", "--entrada", path.join(TMP, "nao-existe.json"));
  assert.equal(r.status, 0, r.erro);
  assert.equal(r.saida.motivo, "entrada-invalida");
  assert.match(r.saida.problemas[0], /^--entrada: arquivo ilegível \(ENOENT\)/);
});

test("[mudou na T17] proximo pergunta pela entrada de forma errada (filhas nao-lista, filha sem campos, lista no lugar do objeto)", () => {
  const repo = comPlano();
  for (const entrada of ['{"filhas":"x"}', '{"filhas":[{"sessao":1}]}', "[]"]) {
    const r = repo.rodar("proximo", "--entrada", entrada);
    assert.equal(r.status, 0, `${entrada}: ${r.erro}`);
    assert.equal(r.saida.acao, "perguntar", entrada);
    assert.equal(r.saida.motivo, "entrada-invalida", entrada);
  }
});

test("[mudou na T17] ci --pr com JSON invalido sai 1 com perguntar entrada-invalida", () => {
  const r = cli(["ci", "--push-em", PUSH, "--runs", "[]", "--pr", "{nao"]);
  assert.equal(r.status, 1, r.erro);
  assert.equal(r.saida.acao, "perguntar");
  assert.equal(r.saida.motivo, "entrada-invalida");
  assert.match(r.saida.problemas[0], /^--pr: JSON ilegível/);
});

test("[mudou na T17] ci --pr com arquivo ausente sai 1 com perguntar entrada-invalida", () => {
  const r = cli(["ci", "--push-em", PUSH, "--runs", "[]", "--pr", path.join(TMP, "nao-existe.json")]);
  assert.equal(r.status, 1, r.erro);
  assert.equal(r.saida.motivo, "entrada-invalida");
  assert.match(r.saida.problemas[0], /^--pr: arquivo ilegível/);
});

test("ci --runs que nao e lista e ErroPlano de uso e sai 1", () => {
  const r = cli(["ci", "--push-em", PUSH, "--agora", AGORA, "--pr", "{}", "--runs", '{"x":1}']);
  assert.equal(r.status, 1);
  assert.equal(r.erro, "conducao: uso: ci: --runs deve ser uma lista JSON\n");
});

test("reinicio-valido com arquivo ilegivel sai 1 com registro-ilegivel", () => {
  const arq = path.join(TMP, "reinicio-ilegivel.json");
  writeFileSync(arq, "{x");
  const r = cli(["reinicio-valido", "--arquivo", arq]);
  assert.equal(r.status, 1);
  assert.deepEqual(r.saida, { valido: false, motivo: "registro-ilegivel" });
});
