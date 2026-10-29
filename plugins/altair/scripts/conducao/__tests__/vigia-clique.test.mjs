/**
 * vigia-clique.test.mjs — a vigia lê a filha esperando clique e a filha caída
 * (VEGA-29 T18, AC-VEGA29-6; sota E2.A2/A3/B2).
 *
 * Filha `BLOCKED` (pedido de permissão que ninguém clica) leva a pergunta no
 * primeiro ciclo da vigia, não no fim do prazo. Filha `FAILED` sem aviso
 * recebe primeiro a mensagem (`cutucar`); só depois do silêncio
 * (`BOTOES.silencioFilhaCaidaMin`) a tentativa reabre como falha de ambiente.
 *
 * `conducao.mjs proximo` chamado como CLI em repo git temporário (hooks
 * desligados); o relógio da vigia vem de `entrada.agora`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOTOES } from "../botoes.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-clique";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;
const ABERTA = 1_800_000_000; // epoch s do marcador
const ISO = (s) => new Date(s * 1000).toISOString();
const SILENCIO = BOTOES.silencioFilhaCaidaMin * 60;

function task(id) {
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
    `- **Verificação:** \`echo ${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-F1/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

function novoRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "vigia-clique-"));
  const g = (args, env = {}) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }).trim();
  g(["init", "-q", "-b", "ciclo-teste"]);
  g(["config", "core.hooksPath", "/dev/null"]);
  g(["config", "user.name", "teste"]);
  g(["config", "user.email", "teste@example.invalid"]);
  g(["config", "commit.gpgsign", "false"]);
  const plano = ["---", `cycle: ${CICLO}`, "opened: 2026-10-28", "---", "", "### 1.5 Modo de Execução", "", "**Largura do ciclo:** 1", "", "## 3. Tasks", "", "### F1 — fase F1 (**Modelo:** opus)", "", task("T1"), "## 4. Pronto", ""];
  mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
  writeFileSync(path.join(dir, CAMINHO), plano.join("\n"));
  g(["add", CAMINHO]);
  g(["commit", "-q", "-m", "plano"]);
  g(["commit", "-q", "--allow-empty", "-m", "Conducao: F1 autorizada", "-m", "sim do Rita", "-m", `Conducao-Plano: ${g(["rev-parse", `HEAD:${CAMINHO}`])}`]);
  // Tentativa 1 de T1 em voo, como o `abrir` grava: marcador datado fora do ramo + referência local.
  const d = `@${ABERTA} +0000`;
  const marcador = g(["commit-tree", g(["rev-parse", "HEAD^{tree}"]), "-p", g(["rev-parse", "HEAD"]), "-m", "Conducao: abrir T1 tentativa 1 nonce n1"], {
    GIT_COMMITTER_DATE: d,
    GIT_AUTHOR_DATE: d,
  });
  g(["update-ref", `refs/conducao-local/${CICLO}/T1/1`, marcador]);
  return { dir, limpar: () => rmSync(dir, { recursive: true, force: true }) };
}

function proximo(dir, entrada) {
  const r = spawnSync(process.execPath, [SCRIPT, "proximo", "--entrada", JSON.stringify({ agora: ISO(ABERTA + 60), ...entrada }), "--repo", dir, "--ciclo", CICLO], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const linhas = r.stdout.split("\n").filter(Boolean);
  assert.equal(linhas.length, 1, `uma linha JSON por chamada, veio:\n${r.stdout}`);
  return JSON.parse(linhas[0]);
}

const filha = (campos) => ({ sessao: "s1", task: "T1", tentativa: 1, nonce: "n1", estado: "RUNNING", ...campos });

test("vigia da filha esperando clique e da filha caida, por tabela de casos", (t) => {
  const casos = [
    {
      nome: "filha BLOCKED sem aviso: pergunta no primeiro ciclo, um minuto depois de abrir, sem falha",
      entrada: { filhas: [filha({ statusBucket: "BLOCKED" })] },
      espera: (a) => {
        assert.equal(a.acao, "perguntar");
        assert.equal(a.motivo, "filha-esperando-clique");
        assert.equal(a.task, "T1");
        assert.equal(a.tentativa, 1);
        assert.equal(a.sessao, "s1");
        assert.equal(a.nonceTentativa, "n1");
        assert.equal(a.registrarFalha, undefined);
        assert.equal(a.tarefas, undefined);
      },
    },
    {
      nome: "bucket com prefixo e caixa da API e estado REQUIRES_ACTION tambem perguntam ja",
      entrada: { filhas: [filha({ statusBucket: "session_status_blocked" }), filha({ sessao: "s2", estado: "REQUIRES_ACTION" })] },
      espera: (a) => assert.equal(a.motivo, "filha-esperando-clique"),
    },
    {
      nome: "contraprova: a mesma filha RUNNING no mesmo instante so espera",
      entrada: { filhas: [filha({ statusBucket: "WORKING" })] },
      espera: (a) => {
        assert.equal(a.acao, "esperar");
        assert.equal(a.motivo, "filhas-em-voo");
      },
    },
    {
      nome: "BLOCKED com aviso de pergunta: o aviso decide, pergunta-da-filha",
      entrada: { filhas: [filha({ statusBucket: "BLOCKED", aviso: "T1-FALHA pergunta n1" })] },
      espera: (a) => assert.equal(a.motivo, "pergunta-da-filha"),
    },
    {
      nome: "BLOCKED arquivada nao pergunta clique: filha-sumiu",
      entrada: { filhas: [filha({ estado: "ARCHIVED", statusBucket: "BLOCKED" })] },
      espera: (a) => assert.equal(a.motivo, "filha-sumiu"),
    },
    {
      nome: "filha caida sem aviso: cutucar antes de contar falha",
      entrada: { filhas: [filha({ estado: "IDLE", statusBucket: "FAILED" })] },
      espera: (a) => {
        assert.equal(a.acao, "cutucar");
        assert.equal(a.motivo, "filha-caida");
        assert.equal(a.sessao, "s1");
        assert.equal(a.nonceTentativa, "n1");
        assert.match(a.mensagem, /T1/);
        assert.match(a.mensagem, /n1/);
        assert.equal(a.registrarFalha, undefined);
        assert.equal(a.tarefas, undefined);
      },
    },
    {
      nome: "filha caida cutucada ha pouco: espera a resposta, sem falha",
      entrada: { agora: ISO(ABERTA + 120), filhas: [filha({ estado: "IDLE", statusBucket: "FAILED", cutucadaEm: ISO(ABERTA + 60) })] },
      espera: (a) => {
        assert.equal(a.acao, "esperar");
        assert.equal(a.motivo, "filhas-em-voo");
      },
    },
    {
      nome: "filha caida em silencio depois da mensagem: reabre como falha de ambiente",
      entrada: { agora: ISO(ABERTA + 60 + SILENCIO), filhas: [filha({ estado: "IDLE", statusBucket: "FAILED", cutucadaEm: ABERTA + 60 })] },
      espera: (a) => {
        assert.equal(a.acao, "abrir");
        const x = a.tarefas.find((y) => y.task === "T1");
        assert.equal(x.tentativa, 2);
        assert.deepEqual(x.falhaAnterior, { tentativa: 1, coberta: "ambiente", motivo: "filha-caida-em-silencio" });
      },
    },
    {
      nome: "filha que voltou e caiu de novo, com o cutucadaEm da primeira queda: cutucar novo, nunca reabrir (T40)",
      entrada: {
        agora: ISO(ABERTA + 60 + SILENCIO + 120),
        filhas: [filha({ estado: "IDLE", statusBucket: "FAILED", cutucadaEm: ISO(ABERTA + 60), caidaEm: ISO(ABERTA + 60 + SILENCIO + 60) })],
      },
      espera: (a) => {
        assert.equal(a.acao, "cutucar");
        assert.equal(a.motivo, "filha-caida");
        assert.equal(a.sessao, "s1");
        assert.equal(a.tarefas, undefined);
      },
    },
    {
      nome: "primeira queda com caidaEm antes do cutucadaEm: silencio reabre como falha de ambiente, como na T18 (T40)",
      entrada: { agora: ISO(ABERTA + 60 + SILENCIO), filhas: [filha({ estado: "IDLE", statusBucket: "FAILED", caidaEm: ABERTA + 30, cutucadaEm: ABERTA + 60 })] },
      espera: (a) => {
        assert.equal(a.acao, "abrir");
        assert.deepEqual(a.tarefas.find((y) => y.task === "T1").falhaAnterior, { tentativa: 1, coberta: "ambiente", motivo: "filha-caida-em-silencio" });
      },
    },
    {
      nome: "caidaEm depois de agora: entrada-invalida, nunca cutucar sem fim (T40)",
      entrada: { agora: ISO(ABERTA + 120), filhas: [filha({ statusBucket: "FAILED", cutucadaEm: ISO(ABERTA + 60), caidaEm: ISO(ABERTA + 3600) })] },
      espera: (a) => {
        assert.equal(a.motivo, "entrada-invalida");
        assert.ok(a.problemas.some((p) => p.includes("caidaEm") && p.includes("depois de agora")), JSON.stringify(a.problemas));
      },
    },
    {
      nome: "caidaEm ilegivel: entrada-invalida (T40)",
      entrada: { filhas: [filha({ statusBucket: "FAILED", caidaEm: "ontem" })] },
      espera: (a) => {
        assert.equal(a.motivo, "entrada-invalida");
        assert.ok(a.problemas.some((p) => p.includes("caidaEm")), JSON.stringify(a.problemas));
      },
    },
    {
      nome: "filha caida que voltou e avisou OK: o aviso decide, trazer",
      entrada: { filhas: [filha({ estado: "IDLE", statusBucket: "FAILED", cutucadaEm: ABERTA, aviso: "T1-OK deadbeef n1" })] },
      espera: (a) => {
        assert.equal(a.acao, "trazer");
        assert.equal(a.sha, "deadbeef");
      },
    },
    {
      nome: "cutucadaEm ilegivel: entrada-invalida",
      entrada: { filhas: [filha({ statusBucket: "FAILED", cutucadaEm: "ontem" })] },
      espera: (a) => {
        assert.equal(a.acao, "perguntar");
        assert.equal(a.motivo, "entrada-invalida");
        assert.ok(a.problemas.some((p) => p.includes("cutucadaEm")), JSON.stringify(a.problemas));
      },
    },
  ];
  for (const c of casos) {
    const r = novoRepo();
    try {
      c.espera(proximo(r.dir, c.entrada));
    } catch (e) {
      e.message = `${c.nome}: ${e.message}`;
      throw e;
    } finally {
      r.limpar();
    }
  }
  t.diagnostic(`${casos.length} casos`);
});
