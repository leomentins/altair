/**
 * conducao-proximo.test.mjs — `conducao.mjs proximo` e `conferir` (VEGA-22 T6).
 *
 * Canonicos de fixture em repos git temporários, com hooks desligados no repo
 * de teste (core.hooksPath=/dev/null: o hooksPath global do servidor rodaria
 * os gates do projeto em cada commit de fixture). O script é chamado como CLI,
 * do mesmo jeito que a maestra o chama: uma linha JSON por chamada.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEM_COFRE, embrulharSemProducao, estadoDasTasks, lerAviso, nonce } from "../conducao.mjs";
import { MARCA_SEM_COFRE_PADRAO, PROJETO_DE_TESTE, validar } from "../adaptador.mjs";
import { comandoDaVerificacao, globParaRegex, lerPlano } from "../ler-plano.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;

// ── fixture ─────────────────────────────────────────────────────────────────

/**
 * Task de fixture. `inputs` aceita tasks e paths; `extra` entra como bullets
 * adicionais (Estação, Independente, Prazo, Verificação pós-merge).
 */
function task(id, { titulo = `tarefa ${id}`, inputs = "`README.md`", outputs, extra = [], verificacao, steps = "faz", satisfies = "[AC-TESTE1-1]" } = {}) {
  return [
    `#### ${id} — ${titulo}`,
    "",
    `- **Objetivo:** ${titulo}`,
    `- **satisfies:** ${satisfies}`,
    `- **Inputs:** ${inputs}`,
    `- **Outputs:** ${outputs ?? `\`src/${id.toLowerCase()}.mjs\` (create)`}`,
    ...extra.map((e) => `- ${e}`),
    `- **Steps:** ${steps}`,
    `- **Verificação:** \`${verificacao ?? `echo verificacao-${id}`}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-F1/${id} — ${titulo}\``,
    "",
  ].join("\n");
}

function canonico({ largura, fases }) {
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
    largura === undefined ? "" : `**Largura do ciclo:** ${largura}`,
    "",
    "## 3. Tasks",
    "",
    ...fases.map(({ id, modelo = "sonnet", tasks }) => [`### ${id} — fase ${id} (**Modelo:** ${modelo})`, "", ...tasks].join("\n")),
    "## 4. Pronto",
    "",
  ].join("\n");
}

function novoRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "conducao-proximo-"));
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "ciclo-teste");
  g("config", "core.hooksPath", "/dev/null");
  g("config", "user.name", "teste");
  g("config", "user.email", "teste@example.invalid");
  g("config", "commit.gpgsign", "false");
  const escrever = (texto, msg = "plano") => {
    mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
    writeFileSync(path.join(dir, CAMINHO), texto);
    g("add", CAMINHO);
    g("commit", "-q", "-m", msg);
  };
  const vazio = (...linhas) => g("commit", "-q", "--allow-empty", ...linhas.flatMap((l) => ["-m", l]));
  const blob = () => g("rev-parse", `HEAD:${CAMINHO}`);
  const autorizar = (fase) => vazio(`Conducao: ${fase} autorizada`, "sim do Rita, no turno dele", `Conducao-Plano: ${blob()}`);
  const conferida = (t) =>
    vazio(`Conducao: ${t} conferida`, `Conducao-Task: ${t}\nConducao-Sha-Filha: 0000000\nConducao-Sessao-Filha: s\nConducao-Nonce: n\nConducao-Verificacao: verde`);
  /** Tentativa em voo: marcador fora do ramo + referência local, como o `abrir` da T10 grava. */
  const emVoo = (t, n, nonceX) => {
    const base = g("rev-parse", "HEAD");
    const tree = g("rev-parse", "HEAD^{tree}");
    const marcador = execFileSync("git", ["-C", dir, "commit-tree", tree, "-p", base, "-m", `Conducao: abrir ${t} tentativa ${n} nonce ${nonceX}`], { encoding: "utf8" }).trim();
    g("update-ref", `refs/conducao-local/${CICLO}/${t}/${n}`, marcador);
  };
  return { dir, g, escrever, vazio, autorizar, conferida, emVoo, blob, limpar: () => rmSync(dir, { recursive: true, force: true }) };
}

function rodar(dir, args, env = process.env) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8", env });
  return { ...r, linhas: r.stdout.split("\n").filter(Boolean) };
}

function proximo(dir, entrada) {
  const r = rodar(dir, ["proximo", ...(entrada ? ["--entrada", JSON.stringify(entrada)] : [])]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.linhas.length, 1, `uma linha JSON por chamada, veio:\n${r.stdout}`);
  return JSON.parse(r.linhas[0]);
}

const indep = (n) => Array.from({ length: n }, (_, i) => task(`T${i + 1}`, { extra: ["**Estação:** servidor", "**Independente:** sim"] }));

// ── testes ──────────────────────────────────────────────────────────────────

test("proximo emite uma acao so e abre ate min(prontas, largura do ciclo, teto menos filhas vivas)", (t) => {
  const casos = [
    // [prontas, largura, teto, vivas] → abertas
    { prontas: 4, largura: 3, teto: 16, vivas: 0, abertas: 3 },
    { prontas: 4, largura: 3, teto: 4, vivas: 2, abertas: 2 },
    { prontas: 2, largura: 5, teto: 16, vivas: 0, abertas: 2 },
    { prontas: 4, largura: 3, teto: 3, vivas: 3, abertas: 0 },
  ];
  for (const c of casos) {
    const r = novoRepo();
    t.after(r.limpar);
    r.escrever(canonico({ largura: c.largura, fases: [{ id: "F1", tasks: indep(c.prontas) }] }));
    r.autorizar("F1");
    const filhas = Array.from({ length: c.vivas }, (_, i) => ({ sessao: `s${i}`, task: "T9", tentativa: 1, nonce: `outro-ciclo-${i}`, estado: "RUNNING" }));
    const a = proximo(r.dir, { filhas, tetoPonte: c.teto });
    assert.equal(a.abertas ?? a.tarefas?.length ?? 0, Math.min(c.prontas, c.largura, c.teto - c.vivas), JSON.stringify(c));
    if (c.abertas === 0) {
      assert.equal(a.acao, "esperar");
      assert.equal(a.motivo, "sem-vaga");
      continue;
    }
    assert.equal(a.acao, "abrir");
    assert.deepEqual(a.tarefas.map((x) => x.task), ["T1", "T2", "T3", "T4"].slice(0, c.abertas));
    assert.ok(a.tarefas.every((x) => x.tentativa === 1 && /^[0-9a-f]{16}$/.test(x.nonce) && x.modelo === "sonnet"));
    assert.deepEqual(a.largura, { prontas: c.prontas, ciclo: c.largura, teto: c.teto, vivas: c.vivas, emVoo: 0, abertas: c.abertas });
    assert.match(a.nonce, /^[0-9a-f]{16}$/);
  }
});

test("proximo repetido sobre o mesmo estado emite a mesma acao com o mesmo nonce", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(canonico({ largura: 2, fases: [{ id: "F1", tasks: indep(3) }] }));
  r.autorizar("F1");
  const a = proximo(r.dir);
  const b = proximo(r.dir);
  assert.deepEqual(a, b);
  assert.equal(a.tarefas[0].nonce, nonce(CICLO, "T1", 1, r.g("rev-parse", "HEAD")));
  r.vazio("outro commit");
  assert.notEqual(proximo(r.dir).tarefas[0].nonce, a.tarefas[0].nonce, "HEAD novo, nonce novo");
});

test("fase sem marca de autorizacao emite perguntar, nunca abrir", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(canonico({ largura: 2, fases: [{ id: "F1", tasks: indep(2) }, { id: "F2", tasks: [task("T3", { inputs: "T1 · T2", extra: ["**Estação:** servidor"] })] }] }));
  const antes = proximo(r.dir);
  assert.equal(antes.acao, "perguntar");
  assert.equal(antes.motivo, "autorizar-ciclo");
  assert.equal(antes.fase, "F1");
  assert.equal(antes.planoNovo, r.blob());
  r.autorizar("F1");
  r.conferida("T1");
  r.conferida("T2");
  const depois = proximo(r.dir);
  assert.equal(depois.acao, "perguntar");
  assert.equal(depois.motivo, "autorizar-ciclo");
  assert.equal(depois.fase, "F2", "a F2 não começa sem o sim dela, mesmo com a F1 inteira feita");
});

test("conjunto pronto: dependencia por Inputs, leitura conservadora e Outputs em comum", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(
    canonico({
      largura: 5,
      fases: [
        {
          id: "F1",
          tasks: [
            task("T1", { extra: ["**Estação:** servidor"] }),
            // sem task em Inputs e sem Independente: depende da T1 (conservadora)
            task("T2", { extra: ["**Estação:** servidor"] }),
            task("T3", { extra: ["**Estação:** servidor", "**Independente:** sim"], outputs: "`src/t1.mjs` (modify)" }),
            task("T4", { extra: ["**Estação:** servidor", "**Independente:** sim"] }),
            task("T5", { inputs: "T4", extra: ["**Estação:** servidor"] }),
          ],
        },
      ],
    }),
  );
  r.autorizar("F1");
  const a = proximo(r.dir);
  assert.equal(a.acao, "abrir");
  // T1 e T4 prontas; T3 escreve o mesmo arquivo que T1 e não abre junto; T2 e T5 esperam dependência.
  assert.deepEqual(a.tarefas.map((x) => x.task), ["T1", "T4"]);
});

test("task com publicacao ou caminho clinico: o sim da fase cobre; fora da fase da ultima autorizacao, perguntar antes de abrir", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(
    canonico({
      largura: 3,
      fases: [
        {
          id: "F1",
          tasks: [
            task("T1", { extra: ["**Estação:** servidor", "**Independente:** sim"], steps: "aplica a migration com `db-publish.mjs … db push`" }),
            task("T2", { extra: ["**Estação:** servidor", "**Independente:** sim"], outputs: "`apps/web/src/app/(app)/fichas/laudo/page.tsx` (modify)" }),
            task("T3", { extra: ["**Estação:** servidor", "**Independente:** sim"] }),
          ],
        },
        { id: "F2", tasks: [task("T4", { extra: ["**Estação:** servidor", "**Independente:** sim"] })] },
      ],
    }),
  );
  r.autorizar("F1");
  // O sim da F1 cobre as sensíveis dela (F4.17).
  const coberta = proximo(r.dir);
  assert.equal(coberta.acao, "abrir");
  assert.deepEqual(coberta.tarefas.map((x) => x.task), ["T1", "T2", "T3"]);
  assert.deepEqual(coberta.cobertasPelaFase.tasks, ["T1", "T2"]);
  // Última autorização de outra fase: a pergunta por task e nonce de antes.
  r.autorizar("F2");
  const p1 = proximo(r.dir);
  assert.equal(p1.acao, "perguntar");
  assert.equal(p1.motivo, "task-sensivel");
  assert.equal(p1.task, "T1");
  assert.deepEqual(p1.publicacao, ["db push", "db-publish"]);
  // O sim de Rita vale só para aquela task e aquele nonce.
  const p2 = proximo(r.dir, { aprovacoes: [{ task: "T1", nonce: p1.nonce }] });
  assert.equal(p2.acao, "perguntar");
  assert.equal(p2.task, "T2");
  assert.deepEqual(p2.caminhosClinicos, ["apps/web/src/app/(app)/fichas/laudo/page.tsx"]);
  const aprov = [{ task: "T1", nonce: p1.nonce }, { task: "T2", nonce: p2.nonce }];
  const a = proximo(r.dir, { aprovacoes: aprov });
  assert.equal(a.acao, "abrir");
  assert.deepEqual(a.tarefas.map((x) => x.task), ["T1", "T2", "T3"]);
  assert.equal(a.tarefas[0].nonce, p1.nonce, "abrir sai com o nonce que Rita aprovou");
  // Aprovação de outro estado (nonce velho) não destrava.
  r.vazio("commit qualquer");
  assert.equal(proximo(r.dir, { aprovacoes: aprov }).acao, "perguntar");
});

test("task de estacao workstation pronta emite parar, depois das filhas em voo", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(
    canonico({
      largura: 2,
      fases: [{ id: "F1", tasks: [task("T1", { extra: ["**Estação:** servidor", "**Independente:** sim"] }), task("T2", { extra: ["**Estação:** workstation", "**Independente:** sim"] })] }],
    }),
  );
  r.autorizar("F1");
  r.emVoo("T1", 1, "n1");
  const filha = { sessao: "s1", task: "T1", tentativa: 1, nonce: "n1", estado: "RUNNING" };
  assert.equal(proximo(r.dir, { filhas: [filha] }).acao, "esperar");
  r.conferida("T1");
  const a = proximo(r.dir);
  assert.equal(a.acao, "parar");
  assert.equal(a.motivo, "workstation");
  assert.equal(a.task, "T2");
});

test("task de estacao maestra pronta emite fazer-maestra antes do abrir; conferida, as filhas abrem", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(
    canonico({
      largura: 2,
      fases: [{ id: "F1", tasks: [task("T1", { extra: ["**Estação:** maestra"] }), task("T2", { inputs: "T1", extra: ["**Estação:** servidor"] }), task("T3", { extra: ["**Estação:** servidor", "**Independente:** sim"] })] }],
    }),
  );
  r.autorizar("F1");
  const a = proximo(r.dir);
  assert.equal(a.acao, "fazer-maestra", "a task da maestra sai antes de abrir a T3 independente");
  assert.equal(a.task, "T1");
  assert.equal(a.nonce, nonce(CICLO, "T1", 0, r.g("rev-parse", "HEAD")));
  r.vazio("Conducao: T1 conferida", "Conducao-Task: T1\nConducao-Executor: maestra\nConducao-Sessao-Maestra: m\nConducao-Verificacao: verde\nConducao-Publicacao: nao-se-aplica");
  const b = proximo(r.dir);
  assert.equal(b.acao, "abrir");
  assert.deepEqual(b.tarefas.map((x) => x.task).sort(), ["T2", "T3"]);
});

test("task de estacao maestra que publica: o sim da fase cobre o fazer-maestra; fora dela pergunta antes", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(
    canonico({
      largura: 1,
      fases: [
        { id: "F1", tasks: [task("T1", { extra: ["**Estação:** maestra"], steps: "publica com `vercel --prod`" })] },
        { id: "F2", tasks: [task("T2", { extra: ["**Estação:** servidor"] })] },
      ],
    }),
  );
  r.autorizar("F1");
  const coberta = proximo(r.dir);
  assert.equal(coberta.acao, "fazer-maestra");
  assert.equal(coberta.simParaPublicar, true, "a publicação segue pedindo o sim por task");
  r.autorizar("F2");
  const p = proximo(r.dir);
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, "task-sensivel");
  const a = proximo(r.dir, { aprovacoes: [{ task: "T1", nonce: p.nonce }] });
  assert.equal(a.acao, "fazer-maestra");
  assert.deepEqual(a.publicacao, ["vercel --prod"]);
});

test("aviso OK da filha com o nonce da tentativa emite trazer; aviso sem nonce nao", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(canonico({ largura: 1, fases: [{ id: "F1", tasks: [task("T1", { extra: ["**Estação:** servidor"] })] }] }));
  r.autorizar("F1");
  r.emVoo("T1", 1, "abc123");
  const filha = { sessao: "s1", task: "T1", tentativa: 1, nonce: "abc123", estado: "IDLE" };
  assert.equal(proximo(r.dir, { filhas: [{ ...filha, aviso: "T1-OK deadbeef outro" }] }).acao, "esperar");
  const a = proximo(r.dir, { filhas: [{ ...filha, aviso: "T1-OK deadbeef abc123" }] });
  assert.equal(a.acao, "trazer");
  assert.equal(a.task, "T1");
  assert.equal(a.sha, "deadbeef");
  assert.equal(a.nonceTentativa, "abc123");
  assert.equal(a.ref, `refs/conducao-local/${CICLO}/T1/1`);
  // Filha arquivada sem aviso: pergunta, nunca reabre em silêncio.
  assert.equal(proximo(r.dir, { filhas: [{ ...filha, estado: "ARCHIVED" }] }).motivo, "filha-sumiu");
});

test("commit com subject da task nunca conta como feita; so a conferencia", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(canonico({ largura: 1, fases: [{ id: "F1", tasks: [task("T1", { extra: ["**Estação:** servidor"] }), task("T2", { extra: ["**Estação:** servidor"] })] }] }));
  r.autorizar("F1");
  r.vazio(`${CICLO}-F1/T1 — trabalho da filha`);
  assert.deepEqual(proximo(r.dir).tarefas.map((x) => x.task), ["T1"]);
  r.conferida("T1");
  assert.deepEqual(proximo(r.dir).tarefas.map((x) => x.task), ["T2"]);
});

test("tentativa nova sobe o numero da referencia e publicacao recusada emite parar", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(canonico({ largura: 1, fases: [{ id: "F1", tasks: [task("T1", { extra: ["**Estação:** servidor"] }), task("T2", { extra: ["**Estação:** servidor"] })] }] }));
  r.autorizar("F1");
  r.emVoo("T1", 1, "n1");
  r.vazio("Conducao: T1 tentativa 1 falhou", "coberta-por-reinicio: nao");
  const a = proximo(r.dir);
  assert.equal(a.acao, "abrir");
  assert.equal(a.tarefas[0].tentativa, 2);
  r.vazio("Conducao: T1 publicacao recusada");
  const p = proximo(r.dir);
  assert.equal(p.acao, "parar");
  assert.equal(p.motivo, "publicacao-recusada");
  assert.equal(p.task, "T1");
});

test("fase com tudo feito menos o fechamento emite fechar-fase", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(
    canonico({
      largura: 1,
      fases: [{ id: "F1", tasks: [task("T1", { extra: ["**Estação:** servidor"] }), task("T2", { inputs: "T1", satisfies: "[—] (fechamento-de-fase)", extra: ["**Estação:** servidor"] })] }],
    }),
  );
  r.autorizar("F1");
  r.conferida("T1");
  const a = proximo(r.dir, { ci: { desfecho: "verde", sha: "x" } });
  assert.equal(a.acao, "fechar-fase");
  assert.equal(a.fase, "F1");
  assert.equal(a.task, "T2");
  r.conferida("T2");
  // Sem fase restante: sem CI do HEAD espera; com CI verde, fechar-ciclo (T22) — nunca squash.
  assert.equal(proximo(r.dir).motivo, "ci-pendente");
  assert.equal(proximo(r.dir, { ci: { sha: r.g("rev-parse", "HEAD"), veredito: "verde", run: 1 } }).acao, "fechar-ciclo");
});

// review-gate no meio da fase (ATRM-51 F4): review-gate → gate-de-ux → fechamento.
const SRV = ["**Estação:** servidor"];
const faseUiHeavy = () => [
  task("T1", { extra: SRV }),
  task("T2", { inputs: "T1", satisfies: "[—] (review-gate — cobre todos os AC)", extra: SRV }),
  task("T3", { inputs: "T2", satisfies: "[—] (gate-de-ux)", extra: SRV }),
  task("T4", { inputs: "T3", satisfies: "[—] (fechamento-de-fase)", extra: SRV }),
];

test("review-gate com task dependendo dele e task comum: abre por filha e depois a seguinte", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(canonico({ largura: 1, fases: [{ id: "F1", tasks: faseUiHeavy() }] }));
  const plano = lerPlano(readFileSync(path.join(r.dir, CAMINHO), "utf8"));
  assert.deepEqual(plano.tasks.map((x) => [x.id, x.fechamento, x.classe]), [
    ["T1", false, "comum"],
    ["T2", false, "comum"],
    ["T3", false, "comum"],
    ["T4", true, "fechamento"],
  ]);
  r.autorizar("F1");
  r.conferida("T1");
  const a = proximo(r.dir);
  assert.equal(a.acao, "abrir", JSON.stringify(a));
  assert.deepEqual(a.tarefas.map((x) => x.task), ["T2"]);
  r.conferida("T2");
  const b = proximo(r.dir);
  assert.equal(b.acao, "abrir", JSON.stringify(b));
  assert.deepEqual(b.tarefas.map((x) => x.task), ["T3"]);
  r.conferida("T3");
  const c = proximo(r.dir, { ci: { desfecho: "verde", sha: "x" } });
  assert.equal(c.acao, "fechar-fase");
  assert.equal(c.task, "T4");
});

test("review-gate do meio com Estacao maestra sai como fazer-maestra", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  const tasks = faseUiHeavy();
  tasks[1] = task("T2", { inputs: "T1", satisfies: "[—] (review-gate)", extra: ["**Estação:** maestra"] });
  r.escrever(canonico({ largura: 1, fases: [{ id: "F1", tasks }] }));
  r.autorizar("F1");
  r.conferida("T1");
  const a = proximo(r.dir);
  assert.equal(a.acao, "fazer-maestra", JSON.stringify(a));
  assert.equal(a.task, "T2");
});

test("review-gate como ultima task segue fechando a fase", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(
    canonico({ largura: 1, fases: [{ id: "F1", tasks: [task("T1", { extra: SRV }), task("T2", { inputs: "T1", satisfies: "[—] (review-gate)", extra: SRV })] }] }),
  );
  assert.equal(lerPlano(readFileSync(path.join(r.dir, CAMINHO), "utf8")).porId.get("T2").fechamento, true);
  r.autorizar("F1");
  r.conferida("T1");
  const a = proximo(r.dir, { ci: { desfecho: "verde", sha: "x" } });
  assert.equal(a.acao, "fechar-fase");
  assert.equal(a.task, "T2");
});

test("review-gate seguido de fechamento-de-fase sem Inputs (dep implicita) e task comum", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(
    canonico({
      largura: 1,
      fases: [{ id: "F1", tasks: [task("T1", { extra: SRV }), task("T2", { inputs: "T1", satisfies: "[—] (review-gate)", extra: SRV }), task("T3", { inputs: "", satisfies: "[—] (fechamento-de-fase)", extra: SRV })] }],
    }),
  );
  const plano = lerPlano(readFileSync(path.join(r.dir, CAMINHO), "utf8"));
  assert.deepEqual(plano.porId.get("T3").deps, ["T2"]);
  assert.equal(plano.porId.get("T2").fechamento, false);
  assert.equal(plano.porId.get("T3").fechamento, true);
});

test("fase cujo unico fechamento e um review-gate com dependente guarda o review-gate como fechamento", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(
    canonico({
      largura: 1,
      fases: [{ id: "F1", tasks: [task("T1", { extra: SRV }), task("T2", { inputs: "T1", satisfies: "[—] (review-gate)", extra: SRV }), task("T3", { inputs: "T2", extra: SRV })] }],
    }),
  );
  assert.equal(lerPlano(readFileSync(path.join(r.dir, CAMINHO), "utf8")).porId.get("T2").fechamento, true);
});

test("fechamento-de-fase com task dependendo dele segue fechamento", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(
    canonico({
      largura: 1,
      fases: [{ id: "F1", tasks: [task("T1", { satisfies: "[—] (fechamento-de-fase)", extra: SRV }), task("T2", { inputs: "T1", extra: SRV })] }],
    }),
  );
  assert.equal(lerPlano(readFileSync(path.join(r.dir, CAMINHO), "utf8")).porId.get("T1").fechamento, true);
});

test("fases anteriores a primeira autorizada ficam fora da conducao", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(
    canonico({
      largura: 1,
      fases: [
        { id: "F0", tasks: [task("T1", { extra: ["**Estação:** servidor"] })] },
        { id: "F1", tasks: [task("T2", { inputs: "T1", extra: ["**Estação:** servidor"] })] },
      ],
    }),
  );
  r.vazio(`${CICLO}-F0/T1 — feita à mão`);
  const sug = proximo(r.dir);
  assert.equal(sug.fase, "F1", "a sugestão pula a fase cujas tasks já têm commit");
  assert.equal(sug.sugestao, true);
  r.autorizar("F1");
  assert.deepEqual(proximo(r.dir).tarefas.map((x) => x.task), ["T2"]);
});

test("conferir devolve a Verificacao do plano congelado na autorizacao", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  const plano = (v) => canonico({ largura: 1, fases: [{ id: "F1", tasks: [task("T1", { verificacao: v, extra: ["**Estação:** servidor", "**Verificação pós-merge:** sim"] })] }] });
  r.escrever(plano("echo congelada"));
  r.autorizar("F1");
  r.escrever(plano("echo mudada-pela-filha"), "filha mexe no plano");
  writeFileSync(path.join(r.dir, CAMINHO), plano("echo mudada-na-arvore"));
  const c = rodar(r.dir, ["conferir", "T1"]);
  assert.equal(c.status, 0, c.stderr);
  const s = JSON.parse(c.linhas[0]);
  assert.equal(s.comando, "echo congelada");
  assert.equal(s.posMerge, true);
  assert.equal(s.plano, r.g("rev-parse", `HEAD~1:${CAMINHO}`));
  // Marca cujo trailer não bate com a própria árvore não autoriza nada.
  r.vazio("Conducao: F1 autorizada", "Conducao-Plano: 0000000000000000000000000000000000000000");
  const ruim = rodar(r.dir, ["conferir", "T1"]);
  assert.equal(ruim.status, 1);
  assert.match(ruim.stderr, /plano-divergente/);
  assert.equal(proximo(r.dir).motivo, "plano-divergente");
});

test("conferir embrulha a Verificacao sem as variaveis de producao", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  const v = `echo "tok=[$SUPABASE_ACCESS_TOKEN] pw=[$SUPABASE_DB_PASSWORD] url=[$SUPABASE_DB_URL] cofre=[$TESTE_SEM_COFRE_PRODUCAO] it's"`;
  r.escrever(canonico({ largura: 1, fases: [{ id: "F1", tasks: [task("T1", { verificacao: v, extra: ["**Estação:** servidor"] })] }] }));
  r.autorizar("F1");
  const env = { ...process.env, SUPABASE_ACCESS_TOKEN: "segredo", SUPABASE_DB_PASSWORD: "segredo", SUPABASE_DB_URL: "postgres://segredo" };
  const c = rodar(r.dir, ["conferir", "T1"], env);
  assert.equal(c.status, 0, c.stderr);
  const s = JSON.parse(c.linhas[0]);
  assert.equal(s.posMerge, false);
  assert.match(s.verificacao, /^env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_DB_PASSWORD -u SUPABASE_DB_URL -u SUPABASE_SERVICE_ROLE_KEY -u VERCEL_TOKEN -u OPENROUTER_API_KEY -u GEMINI_API_KEY TESTE_SEM_COFRE_PRODUCAO=1 bash -c /);
  const saida = execFileSync("bash", ["-c", s.verificacao], { encoding: "utf8", env });
  assert.equal(saida.trim(), "tok=[] pw=[] url=[] cofre=[1] it's");
});

test("a lista de variaveis de producao e a marca vem da declaracao; sem o campo, nenhuma variavel e a marca padrao", () => {
  const declarada = validar(JSON.parse(readFileSync(path.join(PROJETO_DE_TESTE, ".altair", "adaptador.json"), "utf8"))).verificacao;
  assert.equal(declarada.marcaSemCofre, "TESTE_SEM_COFRE_PRODUCAO");
  assert.ok(declarada.variaveisDeProducao.includes("SUPABASE_ACCESS_TOKEN"));
  const e = embrulharSemProducao("echo a", declarada);
  for (const v of declarada.variaveisDeProducao) assert.ok(e.includes(` -u ${v} `), v);
  assert.match(e, / TESTE_SEM_COFRE_PRODUCAO=1 bash -c 'echo a'$/);
  assert.equal(SEM_COFRE, `${MARCA_SEM_COFRE_PADRAO}=1`);
  assert.equal(MARCA_SEM_COFRE_PADRAO, "ALTAIR_SEM_COFRE_PRODUCAO");
  assert.equal(embrulharSemProducao("echo a"), "env ALTAIR_SEM_COFRE_PRODUCAO=1 bash -c 'echo a'");
});

test("conferir num repositorio cuja declaracao nao traz verificacao: so a marca padrao, nenhuma variavel tirada", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  const d = JSON.parse(readFileSync(path.join(PROJETO_DE_TESTE, ".altair", "adaptador.json"), "utf8"));
  delete d.verificacao;
  mkdirSync(path.join(r.dir, ".altair"), { recursive: true });
  writeFileSync(path.join(r.dir, ".altair", "adaptador.json"), JSON.stringify(d));
  r.g("add", ".altair/adaptador.json");
  r.g("commit", "-q", "-m", "declaracao sem verificacao");
  const v = `echo "tok=[$SUPABASE_ACCESS_TOKEN] cofre=[$ALTAIR_SEM_COFRE_PRODUCAO]"`;
  r.escrever(canonico({ largura: 1, fases: [{ id: "F1", tasks: [task("T1", { verificacao: v, extra: ["**Estação:** servidor"] })] }] }));
  r.autorizar("F1");
  const env = { ...process.env, SUPABASE_ACCESS_TOKEN: "segredo" };
  const c = rodar(r.dir, ["conferir", "T1"], env);
  assert.equal(c.status, 0, c.stderr);
  const s = JSON.parse(c.linhas[0]);
  assert.match(s.verificacao, /^env ALTAIR_SEM_COFRE_PRODUCAO=1 bash -c /);
  assert.equal(execFileSync("bash", ["-c", s.verificacao], { encoding: "utf8", env }).trim(), "tok=[segredo] cofre=[1]");
});

test("reautorizacao mostra o diff do plano e as tasks que mudaram de classe", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  const plano = (t2extra, t2steps = "faz") =>
    canonico({
      largura: 1,
      fases: [
        { id: "F1", tasks: [task("T1", { extra: ["**Estação:** servidor"] })] },
        { id: "F2", tasks: [task("T2", { inputs: "T1", extra: t2extra, steps: t2steps }), task("T3", { extra: ["**Estação:** servidor"] })] },
      ],
    });
  r.escrever(plano(["**Estação:** servidor"]));
  r.autorizar("F1");
  const antigo = r.blob();
  r.conferida("T1");
  r.escrever(plano(["**Estação:** workstation"], "publica com `functions deploy nodus-chat`"), "intra-plan da F2");
  const a = proximo(r.dir);
  assert.equal(a.acao, "perguntar");
  assert.equal(a.motivo, "autorizar-ciclo");
  assert.equal(a.fase, "F2");
  assert.equal(a.planoAnterior, antigo);
  assert.equal(a.planoNovo, r.blob());
  assert.match(a.diffPlano, /^-- \*\*Estação:\*\* servidor$/m);
  assert.match(a.diffPlano, /^\+- \*\*Estação:\*\* workstation$/m);
  assert.deepEqual(a.mudaramDeClasse, [{ task: "T2", de: "comum", para: "workstation" }]);
});

test("leitura conservadora: plano sem declaracoes le largura 1, estacao servidor e prazo dos botoes", () => {
  const p = lerPlano(canonico({ fases: [{ id: "F1", tasks: [task("T1"), task("T2")] }] }));
  assert.equal(p.largura, 1);
  assert.equal(p.larguraDeclarada, false);
  assert.deepEqual(p.porId.get("T2").deps, ["T1"]);
  assert.equal(p.porId.get("T1").estacao, "servidor");
  assert.equal(p.porId.get("T1").prazoMin, 120);
});

test("glob dos botoes: ** atravessa diretorio, * nao", () => {
  assert.ok(globParaRegex("apps/x/(app)/labs/**").test("apps/x/(app)/labs/a/b.tsx"));
  assert.ok(globParaRegex("**/package.json").test("package.json"));
  assert.ok(globParaRegex("**/package.json").test("apps/a/package.json"));
  assert.ok(!globParaRegex("src/*.mjs").test("src/a/b.mjs"));
});

test("aviso da filha e estado das tasks sao lidos do texto e das marcas", () => {
  assert.deepEqual(lerAviso("T3-FALHA push-recusado vitest abc"), { task: "T3", tipo: "FALHA", arg: "push-recusado", nonce: "abc" });
  assert.equal(lerAviso("T3-OK deadbeef"), null);
  const e = estadoDasTasks(
    [{ tipo: "marcador", task: "T1", tentativa: 1 }, { tipo: "falhou", task: "T1", tentativa: 1 }],
    [{ task: "T1", tentativa: 1, ref: "r1", nonce: "a" }, { task: "T1", tentativa: 2, ref: "r2", nonce: "b" }],
  );
  assert.equal(e.emVoo.get("T1").tentativa, 2);
  assert.equal(e.maxTent.get("T1"), 2);
  assert.equal(e.falhas.get("T1"), 1);
});

test("declaracao fora do vocabulario emite perguntar, nunca a leitura conservadora", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.escrever(canonico({ largura: 1, fases: [{ id: "F1", tasks: [task("T1", { extra: ["**Estação:** Workstation", "**Independente:** sim"] })] }] }));
  r.autorizar("F1");
  const acao = proximo(r.dir);
  assert.equal(acao.acao, "perguntar");
  assert.equal(acao.motivo, "declaracao-invalida", "Workstation lido como servidor abriria filha onde a task não roda");
});

test("verificacao com mais de um trecho em crase nao vira comando", () => {
  assert.equal(comandoDaVerificacao("`node a.mjs --x`."), "node a.mjs --x");
  assert.equal(comandoDaVerificacao("`node a.mjs`; e o censo de `.claude/settings.json` confere"), null);
  assert.equal(comandoDaVerificacao("aprovação presente, sem comando"), null);
});
