/**
 * conducao-replay.test.mjs — `conducao.mjs retomar`, `auditar` e o replay de
 * um ciclo executado.
 *
 * O replay copia o plano neutro do ciclo gravado (`fixtures/replay-canonico.md`:
 * fases, tarefas, dependências, estação, marcas, publicação e sensibilidade do
 * plano original, com nomes e textos trocados) para um repo temporário, deixa
 * o `proximo` conduzir com largura 1 — respondendo cada pergunta como a
 * maestra responderia com o "sim" de Rita — e compara a ordem emitida com a
 * primeira aparição de cada task na fixture (`fixtures/replay-ciclo.json`),
 * gravada uma vez a partir da proposta do ciclo. Divergência vira ajuste da
 * regra de leitura, nunca edição da fixture.
 *
 * Repos temporários com hooks desligados (core.hooksPath=/dev/null), como na
 * suíte do `proximo`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lerNota } from "../conducao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const FIXTURE = path.join(AQUI, "fixtures", "replay-ciclo.json");
const GRAVADO = "REPLAY-21-ciclo-gravado";
const CANONICO_GRAVADO = path.join(AQUI, "fixtures", "replay-canonico.md");

// ── repo de teste ───────────────────────────────────────────────────────────

function novoRepo(ciclo, { bare = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "conducao-replay-"));
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (bare) {
    g("init", "-q", "--bare");
    return { dir, g, limpar: () => rmSync(dir, { recursive: true, force: true }) };
  }
  const caminho = `.agents/ciclo/vega/${ciclo}/canonico.md`;
  g("init", "-q", "-b", `ciclo-${ciclo}`);
  g("config", "core.hooksPath", "/dev/null");
  g("config", "user.name", "teste");
  g("config", "user.email", "teste@example.invalid");
  g("config", "commit.gpgsign", "false");
  const escrever = (texto, msg = "plano") => {
    mkdirSync(path.join(dir, path.dirname(caminho)), { recursive: true });
    writeFileSync(path.join(dir, caminho), texto);
    g("add", caminho);
    g("commit", "-q", "-m", msg);
  };
  const vazio = (...linhas) => g("commit", "-q", "--allow-empty", ...linhas.flatMap((l) => ["-m", l]));
  const autorizar = (fase) => vazio(`Conducao: ${fase} autorizada`, "sim do Rita, no turno dele", `Conducao-Plano: ${g("rev-parse", `HEAD:${caminho}`)}`);
  const conferida = (t, { verificacao = "verde", publicacao = "nao-se-aplica", semFilha = false, trailers, corpo } = {}) =>
    vazio(
      `Conducao: ${t} conferida`,
      ...(corpo ? [corpo] : []),
      trailers ??
        [
          `Conducao-Task: ${t}`,
          ...(semFilha ? [] : [`Conducao-Sha-Filha: 0000000`, `Conducao-Sessao-Filha: s-${t}`, `Conducao-Nonce: n-${t}`]),
          `Conducao-Verificacao: ${verificacao}`,
          `Conducao-Publicacao: ${publicacao}`,
        ].join("\n"),
    );
  /** Marcador fora do ramo + referência local, como o `abrir` da T10 grava. */
  const tentativa = (t, n, nonceX) => {
    const marcador = g("commit-tree", g("rev-parse", "HEAD^{tree}"), "-p", g("rev-parse", "HEAD"), "-m", `Conducao: abrir ${t} tentativa ${n} nonce ${nonceX}`);
    g("update-ref", `refs/conducao-local/${ciclo}/${t}/${n}`, marcador);
    return marcador;
  };
  return { dir, g, caminho, escrever, vazio, autorizar, conferida, tentativa, limpar: () => rmSync(dir, { recursive: true, force: true }) };
}

function rodar(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  const linhas = r.stdout.split("\n").filter(Boolean);
  return { ...r, linhas, json: linhas.length === 1 ? JSON.parse(linhas[0]) : null };
}

function canonicoMinimo(ciclo, tasks) {
  const bloco = (id, { inputs = "`README.md`", extra = [] }) =>
    [
      `#### ${id} — tarefa ${id}`,
      "",
      `- **Objetivo:** tarefa ${id}`,
      "- **satisfies:** [AC-TESTE-1]",
      `- **Inputs:** ${inputs}`,
      `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
      ...extra.map((e) => `- ${e}`),
      "- **Steps:** faz",
      `- **Verificação:** \`echo ${id}\`.`,
      "- **Esperado:** exit 0.",
      "- **Falha-se:** exit 1.",
      `- **Commit:** \`${ciclo}-F1/${id} — tarefa ${id}\``,
      "",
    ].join("\n");
  return [
    "---",
    `cycle: ${ciclo}`,
    "---",
    "",
    "## 3. Tasks",
    "",
    "### F0 — à mão (**Modelo:** sonnet)",
    "",
    bloco("T1", {}),
    "### F1 — conduzida (**Modelo:** sonnet)",
    "",
    ...tasks.map(([id, o]) => bloco(id, o)),
    "## 4. Pronto",
    "",
  ].join("\n");
}

// ── replay ──────────────────────────────────────────────────────────────────

/**
 * Conduz o canonico no repo com largura 1 até o `fechar-ciclo` (T22) e
 * devolve a ordem em que o `proximo` emitiu as tasks. Cada ação recebe a
 * resposta que a maestra daria: `abrir`/`fechar-fase` ⇒ um commit com o
 * subject da task e a conferência; `perguntar autorizar-ciclo` e
 * `task-sensivel` ⇒ o "sim" de Rita (desde o F4.17, só fora da fase autorizada); `parar workstation` ⇒ conferência manual;
 * `encerrar-sessao` ⇒ a marca `Conducao-Encerrada` da fase (T21), com o CI
 * do HEAD lido verde a cada chamada.
 */
function conduzir(r, ciclo) {
  const ordem = [];
  const aprovacoes = [];
  // Sensíveis cobertas pelo sim da fase (F4.17): o `abrir` as lista.
  const sensiveis = new Set();
  for (let passo = 0; passo < 400; passo++) {
    const out = rodar(["proximo", "--repo", r.dir, "--ciclo", ciclo, "--entrada", JSON.stringify({ tetoPonte: 1, aprovacoes, ci: { sha: r.g("rev-parse", "HEAD"), veredito: "verde", run: 1 } })]);
    assert.equal(out.status, 0, out.stderr);
    const a = out.json;
    assert.ok(a, `uma linha JSON por chamada, veio:\n${out.stdout}`);
    const feita = (t) => {
      ordem.push(t);
      r.vazio(`${ciclo}-F0/${t} — trabalho da filha`);
      // task sensível que o plano liga a publicação fecha `nao-se-aplica` só
      // com o sim de Rita no corpo, como o verbo grava (ruling 18.7, T18)
      const sensivel = aprovacoes.some((x) => x.task === t) || sensiveis.has(t);
      r.conferida(t, sensivel ? { corpo: "Sem publicação, por Rita: replay" } : {});
    };
    if (a.acao === "fechar-ciclo") return ordem;
    if (a.acao === "perguntar" && a.motivo === "autorizar-ciclo") r.autorizar(a.fase);
    else if (a.acao === "perguntar" && a.motivo === "task-sensivel") aprovacoes.push({ task: a.task, nonce: a.nonce });
    else if (a.acao === "abrir") {
      assert.equal(a.tarefas.length, 1, "largura 1 abre uma task por vez");
      for (const x of a.cobertasPelaFase?.tasks ?? []) sensiveis.add(x);
      feita(a.tarefas[0].task);
    } else if (a.acao === "fechar-fase") feita(a.task);
    else if (a.acao === "encerrar-sessao") r.vazio(`Conducao: ${a.fase} sessao encerrada`, `Conducao-Encerrada: ${a.fase}\nConducao-Nonce: ${a.nonce}`);
    else if (a.acao === "parar" && a.motivo === "workstation") {
      ordem.push(a.task);
      r.conferida(a.task, { verificacao: "manual", semFilha: true });
    } else assert.fail(`ação sem resposta da maestra no replay: ${JSON.stringify(a)}`);
  }
  assert.fail("o replay não chegou ao fechar-ciclo em 400 passos");
}

/** Primeira aparição de cada task na fixture, na ordem dos commits. */
function primeiraAparicao(fixture) {
  const re = new RegExp(`^${fixture.ciclo}-F\\d{1,2}[/.](T\\d{1,3}) — `);
  const vistas = [];
  for (const c of [...fixture.commits].sort((a, b) => a.posicao - b.posicao)) {
    const t = re.exec(c.subject)?.[1];
    if (t && !vistas.includes(t)) vistas.push(t);
  }
  return vistas;
}

test("replay do ciclo gravado pela referencia da proposta: ordem emitida compativel com a executada", (t) => {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  assert.equal(fixture.fonte, "refs/pull/1/head");
  assert.equal(fixture.ciclo, GRAVADO);
  const executada = primeiraAparicao(fixture);
  assert.equal(executada.length, 20, "o ciclo gravado executou 20 tasks");

  const r = novoRepo(GRAVADO);
  t.after(r.limpar);
  r.escrever(readFileSync(CANONICO_GRAVADO, "utf8"));
  const emitida = conduzir(r, GRAVADO);

  assert.deepEqual(emitida, executada, `emitida ${emitida.join(",")} × executada ${executada.join(",")}`);

  // O rastro que o replay deixou passa pelo auditar: a mesma condução, conferida.
  const nota = path.join(r.dir, "nota.md");
  writeFileSync(nota, `ciclo_conduzido: ${GRAVADO}\nramo: ciclo-${GRAVADO}\n`);
  const aud = rodar(["auditar", "--nota", nota, "--repo", r.dir]);
  assert.equal(aud.status, 0, aud.stdout + aud.stderr);
  assert.deepEqual(aud.json.violacoes, []);
  assert.equal(aud.json.tasks.length, 20);
});

test("a fixture do replay guarda so subject e posicao, nunca autor nem corpo", () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  assert.ok(fixture.commits.length > 0);
  for (const c of fixture.commits) {
    assert.deepEqual(Object.keys(c).sort(), ["posicao", "subject"]);
    assert.ok(Number.isInteger(c.posicao) && c.posicao >= 1 && c.posicao <= fixture.totalCommits);
    assert.doesNotMatch(c.subject, /\n/);
  }
});

// ── auditar ─────────────────────────────────────────────────────────────────

const CICLO = "TESTE-7-replay";

function auditarRepo(r) {
  const nota = path.join(r.dir, "nota.md");
  writeFileSync(nota, `# pre-condicoes\n\nciclo_conduzido: ${CICLO}\nramo: ciclo-${CICLO}\nprecondicoes: todas\n`);
  return rodar(["auditar", "--nota", nota, "--repo", r.dir]);
}

test("auditar sem nenhum commit de conferencia sai 1", (t) => {
  const r = novoRepo(CICLO);
  t.after(r.limpar);
  r.escrever(canonicoMinimo(CICLO, [["T2", {}]]));
  r.autorizar("F1");
  const a = auditarRepo(r);
  assert.equal(a.status, 1);
  assert.equal(a.json.violacoes[0].regra, "sem-conferencia");
});

test("auditar aprova a fase conduzida e declara a F0 feita a mao fora dela", (t) => {
  const r = novoRepo(CICLO);
  t.after(r.limpar);
  r.escrever(canonicoMinimo(CICLO, [["T2", {}], ["T3", { extra: ["**Estação:** workstation"] }]]));
  r.vazio(`${CICLO}-F0/T1 — feita a mao`);
  r.autorizar("F1");
  r.conferida("T2");
  r.conferida("T3", { verificacao: "manual", semFilha: true });
  const a = auditarRepo(r);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.deepEqual(a.json.conduzidas, ["F1"]);
  assert.deepEqual(a.json.foraDaConducao.fases, ["F0"]);
  assert.deepEqual(a.json.tasks.map((x) => [x.task, x.verificacao]), [["T2", "verde"], ["T3", "manual"]]);
});

test("auditar acusa ordem, trailers, workstation sem manual e conferencia antes da autorizacao", (t) => {
  const casos = [
    {
      nome: "conferida antes da dependencia",
      tasks: [["T2", {}], ["T3", { inputs: "T2" }]],
      passos: (r) => {
        r.autorizar("F1");
        r.conferida("T3");
        r.conferida("T2");
      },
      regra: "conferida-antes-da-dependencia",
    },
    {
      nome: "trailers ausentes",
      tasks: [["T2", {}]],
      passos: (r) => {
        r.autorizar("F1");
        r.conferida("T2", { trailers: "Conducao-Task: T2\nConducao-Verificacao: verde" });
      },
      regra: "trailers-ausentes",
    },
    {
      nome: "workstation sem manual",
      tasks: [["T2", { extra: ["**Estação:** workstation"] }]],
      passos: (r) => {
        r.autorizar("F1");
        r.conferida("T2");
      },
      regra: "workstation-sem-manual",
    },
    {
      nome: "conferencia antes da autorizacao",
      tasks: [["T2", {}]],
      passos: (r) => {
        r.conferida("T2");
        r.autorizar("F1");
      },
      regra: "conferencia-antes-da-autorizacao",
    },
    {
      nome: "task conduzida sem conferencia",
      tasks: [["T2", {}], ["T3", {}]],
      passos: (r) => {
        r.autorizar("F1");
        r.conferida("T2");
      },
      regra: "sem-conferencia",
    },
  ];
  for (const c of casos) {
    const r = novoRepo(CICLO);
    t.after(r.limpar);
    r.escrever(canonicoMinimo(CICLO, c.tasks));
    c.passos(r);
    const a = auditarRepo(r);
    assert.equal(a.status, 1, `${c.nome}: ${a.stdout}${a.stderr}`);
    assert.ok(a.json.violacoes.some((v) => v.regra === c.regra), `${c.nome}: ${JSON.stringify(a.json.violacoes)}`);
  }
});

test("auditar le ciclo e ramo da nota e recusa nota sem eles", () => {
  assert.deepEqual(lerNota("x\nciclo_conduzido: NODUS-4-sabe-a-tela\nramo: ciclo-NODUS-4-sabe-a-tela\n"), {
    ciclo: "NODUS-4-sabe-a-tela",
    ramo: "ciclo-NODUS-4-sabe-a-tela",
  });
  assert.deepEqual(lerNota("- ciclo_conduzido: X\n"), { ciclo: null, ramo: null });
});

// ── retomar ─────────────────────────────────────────────────────────────────

test("retomar reconstroi o estado so do git local e relata o origin divergente sem adota-lo", (t) => {
  const r = novoRepo(CICLO);
  const origin = novoRepo(CICLO, { bare: true });
  t.after(r.limpar);
  t.after(origin.limpar);
  r.escrever(canonicoMinimo(CICLO, [["T2", {}], ["T3", { inputs: "`README.md`", extra: ["**Independente:** sim"] }], ["T4", {}]]));
  r.g("remote", "add", "origin", origin.dir);
  r.autorizar("F1");
  r.conferida("T2");
  const m3 = r.tentativa("T3", 1, "nonce3");
  const m4 = r.tentativa("T4", 2, "nonce4");
  const head = r.g("rev-parse", "HEAD");
  // origin: cópia igual ao HEAD, T3 igual, T4 com outra ponta, T9 só lá.
  r.g("push", "-q", "origin", `${head}:refs/conducao/${CICLO}/copia`);
  r.g("push", "-q", "origin", `${m3}:refs/conducao/${CICLO}/T3/1`);
  r.g("push", "-q", "origin", `${head}:refs/conducao/${CICLO}/T4/2`);
  r.g("push", "-q", "origin", `${head}:refs/conducao/${CICLO}/T9/1`);

  const a = rodar(["retomar", "--repo", r.dir, "--ciclo", CICLO]);
  assert.equal(a.status, 0, a.stderr);
  const s = a.json;
  assert.equal(s.acao, "retomar");
  assert.equal(s.head, head);
  assert.equal(s.ramo, `ciclo-${CICLO}`);
  assert.deepEqual(s.autorizadas, ["F1"]);
  assert.deepEqual(s.feitas, ["T2"]);
  assert.deepEqual(s.emVoo.map((x) => [x.task, x.tentativa, x.sha, x.nonce]), [["T3", 1, m3, "nonce3"], ["T4", 2, m4, "nonce4"]]);
  const tipos = s.divergencias.map((d) => [d.tipo, d.ref]).sort();
  assert.deepEqual(tipos, [
    ["so-no-origin", `refs/conducao/${CICLO}/T9/1`],
    ["tentativa-diverge", `refs/conducao-local/${CICLO}/T4/2`],
  ]);
  // Relatado, nunca adotado: a referência local segue na ponta dela.
  assert.equal(r.g("rev-parse", `refs/conducao-local/${CICLO}/T4/2`), m4);
  assert.equal(r.g("for-each-ref", "--format=%(refname)", `refs/conducao-local/${CICLO}/T9`), "");

  // Cópia do origin à frente do ramo local: relatada com o lado que está à frente.
  r.conferida("T3");
  r.g("push", "-q", "origin", `HEAD:refs/conducao/${CICLO}/copia`, "--force");
  r.g("reset", "-q", "--hard", "HEAD~1");
  const b = rodar(["retomar", "--repo", r.dir, "--ciclo", CICLO]).json;
  const copia = b.divergencias.find((d) => d.tipo === "copia-diverge");
  assert.ok(copia, JSON.stringify(b.divergencias));
  assert.equal(copia.originAFrente, true);
  assert.deepEqual(b.feitas, ["T2"], "o estado vem do git local, nunca da cópia no origin");
});

test("retomar sem origin acessivel relata, nao falha", (t) => {
  const r = novoRepo(CICLO);
  t.after(r.limpar);
  r.escrever(canonicoMinimo(CICLO, [["T2", {}]]));
  r.autorizar("F1");
  const a = rodar(["retomar", "--repo", r.dir, "--ciclo", CICLO]);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.json.divergencias[0].tipo, "origin-inacessivel");
});
