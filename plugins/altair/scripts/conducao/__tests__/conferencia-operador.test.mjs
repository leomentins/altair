/**
 * conferencia-operador.test.mjs — a tarefa que só o operador confere, peça do
 * núcleo (VEGA-29 T14, AC-VEGA29-4, ruling 7-a).
 *
 * A filha faz a parte da máquina; o núcleo pergunta o resultado pela pergunta
 * tipada; o não abre rodada nova (a tentativa seguinte da mesma task), o sim
 * fecha pela conferência. A task se marca com `(conferencia-do-operador)` no
 * `satisfies` (marca do núcleo, resposta por pergunta) ou com uma marca que o
 * adaptador declara em `conferencia`; o `/gate-de-ux` do projeto de teste é o caso
 * declarado com resposta por arquivo, e passa pelo mesmo verbo.
 *
 * Contraprova: sem a generalização, a task `(conferencia-do-operador)` não
 * pergunta resultado — o `proximo` sai `trazida-sem-conferencia` e o
 * `--rodada` recusa (`rodada-fora-do-gate-de-ux`).
 *
 * Mesmo arranjo de conducao-rodadas.test.mjs: origin bare, árvore da maestra,
 * clone da filha, hooks desligados, verbos chamados como CLI. O repositório do
 * teste não tem `.altair/`: lê a declaração da árvore do núcleo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ErroAdaptador, MARCA_DA_CONFERENCIA, lerAdaptador, validar } from "../adaptador.mjs";
import { lerPlano } from "../ler-plano.mjs";
import { casoDeConferencia, respostaDoArquivo } from "../verbos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
/** O projeto de teste das suítes: a declaração e o código de um projeto de mentira. */
const RAIZ = path.resolve(AQUI, "fixtures", "projeto-de-teste");
const CICLO = "TESTE-3-conferencia";
const PASTA = `.agents/ciclo/teste/${CICLO}`;
const CAMINHO = `${PASTA}/canonico.md`;
const APPROVAL = `${PASTA}/gate-de-ux-approval.md`;

function task(id, { satisfies = "[AC-TESTE3-1]", outputs = `\`src/${id.toLowerCase()}.mjs\` (create)`, verificacao = `echo verificacao-${id}` } = {}) {
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

/** Task que só o operador confere: subir no celular e olhar. Resposta por pergunta. */
const CELULAR = task("T1", { satisfies: "[AC-TESTE3-1] (conferencia-do-operador)" });
/** O caso declarado no adaptador do projeto de teste: resposta pelo approval. */
const GATE = task("T1", {
  satisfies: "[AC-TESTE3-1] (gate-de-ux)",
  outputs: `\`${APPROVAL}\` (create) · \`src/t1.mjs\` (create)`,
  verificacao: `grep -qE '^verdict: (SHIP|SHIP_WITH_DEBT)$' ${APPROVAL}`,
});

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

const approval = (verdict, rodada) =>
  ["---", `id: ciclo/${CICLO}/gate-de-ux-approval`, `verdict: ${verdict}`, `rodada: ${rodada}`, "---", "", "corpo", ""].join("\n");

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

function ambiente(t, tasks, extras = {}) {
  const raiz = mkdtempSync(path.join(tmpdir(), "conducao-conferencia-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const maestra = path.join(raiz, "maestra");
  mkdirSync(maestra);
  const g = gitEm(maestra);
  g("init", "-q", "-b", "ciclo-teste");
  configurar(g);
  g("remote", "add", "origin", origin);
  escreverEm(maestra, { "README.md": "fixture\n", [CAMINHO]: canonico(tasks), ...extras });
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
  const proximo = () => ok("proximo", "--entrada", "{}");
  /** Verbo que para e pergunta: sai 1 com a pergunta na saída (contrato §Códigos de saída). */
  const pergunta = (...args) => {
    const r = cli(...args);
    assert.equal(r.status, 1, `${args.join(" ")} deveria perguntar\n${r.stderr}\n${r.linhas.join("\n")}`);
    assert.equal(r.saida?.acao, "perguntar", r.linhas.join("\n"));
    return r.saida;
  };
  /** O `proximo` abre a tentativa que ele mesmo emite. */
  const abrirPeloProximo = (tk, tentativa) => {
    const p = proximo();
    assert.equal(p.acao, "abrir", JSON.stringify(p));
    const x = p.tarefas.find((y) => y.task === tk);
    assert.ok(x, JSON.stringify(p));
    assert.equal(x.tentativa, tentativa, JSON.stringify(p));
    ok("abrir", tk, "--tentativa", String(tentativa), "--nonce", x.nonce, "--modo-maestra", "auto");
    return x;
  };
  /** A filha faz a parte da máquina e empurra; a maestra traz. */
  const maquina = (tk, n, arquivos) => {
    const ref = `refs/conducao/${CICLO}/${tk}/${n}`;
    f("fetch", "-q", "origin", `+${ref}:refs/remotes/tentativa`);
    f("checkout", "-q", "--detach", "refs/remotes/tentativa");
    escreverEm(filha, arquivos);
    f("add", "-A");
    f("commit", "-q", "-m", `${CICLO}-F1/${tk} — parte da máquina ${n}`);
    f("push", "-q", "origin", `HEAD:${ref}`);
    ok("trazer", tk, "--tentativa", String(n), "--sessao", `filha-${tk}-${n}`);
  };
  const marcas = () => g("log", "--format=%s", "--grep=^Conducao: ").split("\n");
  return { g, cli, ok, recusa, pergunta, proximo, abrirPeloProximo, maquina, marcas };
}

/** A pergunta do resultado: motivo, opções sim · nao, sem recomendada (só o operador sabe). */
function perguntaDoResultado(p, tentativa) {
  assert.equal(p.acao, "perguntar", JSON.stringify(p));
  assert.equal(p.motivo, "conferencia-do-operador", JSON.stringify(p));
  assert.equal(p.task, "T1");
  assert.equal(p.tentativa, tentativa);
  assert.equal(p.marca, MARCA_DA_CONFERENCIA);
  assert.deepEqual(
    p.opcoes.map((o) => o.id),
    ["sim", "nao"],
  );
  assert.equal(p.recomendada, undefined);
}

test("um não seguido de um sim: o não abre a rodada nova, o sim fecha pela conferência", (t) => {
  const a = ambiente(t, [CELULAR, task("T2")]);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim, pode tocar a F1");

  // Rodada 1: a filha faz a parte da máquina; o resultado é do operador.
  a.abrirPeloProximo("T1", 1);
  a.maquina("T1", 1, { "src/t1.mjs": "export const t1 = 1;\n" });
  perguntaDoResultado(a.proximo(), 1);
  // A conferência sem a resposta do operador não grava: devolve a mesma pergunta.
  const semResposta = a.pergunta("registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica");
  assert.equal(semResposta.motivo, "conferencia-do-operador");
  assert.equal(semResposta.ciclo, CICLO);
  // A mesma pergunta do `proximo`: com a tentativa trazida.
  assert.equal(semResposta.tentativa, 1);
  assert.match(semResposta.ref, /trazida\/T1\/1$/);
  // Só espaço é ausente; outra flag no lugar do texto recusa.
  assert.equal(a.pergunta("registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica", "--operador", "  ").motivo, "conferencia-do-operador");
  a.recusa("uso", "registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica", "--operador", "--sessao", "s1");
  a.recusa("uso", "registrar-conferencia", "T1", "--rodada", "nao", "--operador", "--sessao", "s1");
  assert.ok(!a.marcas().some((m) => /conferida$/.test(m)), a.marcas().join("\n"));
  // O não é do operador, nunca da maestra.
  a.recusa("operador-ausente", "registrar-conferencia", "T1", "--rodada", "nao");

  const nao = a.ok("registrar-conferencia", "T1", "--rodada", "nao", "--operador", "não abriu no celular");
  assert.equal(nao.acao, "rodada-registrada");
  assert.equal(nao.rodada, "nao");
  assert.equal(nao.tentativa, 1);
  assert.equal(a.g("log", "-1", "--format=%s"), "Conducao: T1 tentativa 1 rodada");
  assert.equal(a.g("log", "-1", "--format=%b").split("\n")[0], "Não, pelo operador: não abriu no celular");
  assert.equal(a.g("log", "-1", "--format=%(trailers:key=Conducao-Rodada,valueonly=true)"), "nao");
  assert.equal(a.g("log", "-1", "--format=%(trailers:key=Conducao-Rodada-Approval,valueonly=true)"), "");

  // Rodada 2: tentativa nova da mesma task, sem falha anterior.
  const r2 = a.abrirPeloProximo("T1", 2);
  assert.equal(r2.falhaAnterior, undefined, "o não do operador não é falha");
  a.maquina("T1", 2, { "src/t1.mjs": "export const t1 = 2;\n" });
  perguntaDoResultado(a.proximo(), 2);
  const sim = a.ok("registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica", "--operador", "abriu e funcionou");
  assert.equal(sim.acao, "conferida");
  assert.equal(sim.tentativa, 2);
  assert.equal(a.g("log", "-1", "--format=%s"), "Conducao: T1 conferida");
  assert.match(a.g("log", "-1", "--format=%b"), /^Conferida pelo operador: abriu e funcionou$/m);
  assert.ok(!a.marcas().some((m) => /falhou$/.test(m)), a.marcas().join("\n"));
  // Fechada a T1, a condução segue para a T2.
  assert.notEqual(a.proximo().task, "T1");
});

test("o 3º não pergunta ao operador e não abre a 4ª rodada", (t) => {
  const a = ambiente(t, [CELULAR]);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim");
  for (const n of [1, 2]) {
    a.abrirPeloProximo("T1", n);
    a.maquina("T1", n, { "src/t1.mjs": `export const t1 = ${n};\n` });
    a.ok("registrar-conferencia", "T1", "--rodada", "nao", "--operador", `não, rodada ${n}`);
  }
  a.abrirPeloProximo("T1", 3);
  a.maquina("T1", 3, { "src/t1.mjs": "export const t1 = 3;\n" });
  const teto = a.pergunta("registrar-conferencia", "T1", "--rodada", "nao", "--operador", "não de novo");
  assert.equal(teto.motivo, "teto-de-rodadas");
  assert.equal(teto.rodadasRegistradas, 2);
  assert.equal(a.marcas().filter((m) => /rodada$/.test(m)).length, 2);
  // O laço não abre a 4ª: a trazida segue esperando o operador.
  assert.equal(a.proximo().motivo, "conferencia-do-operador");
});

test("o caso do /gate-de-ux passa pelo mesmo caminho: o não do approval abre rodada por --rodada nao, o sim fecha", (t) => {
  const a = ambiente(t, [GATE]);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim");
  a.abrirPeloProximo("T1", 1);
  a.maquina("T1", 1, { [APPROVAL]: approval("NEEDS_REWORK", 1) });
  const parado = a.proximo();
  assert.equal(parado.motivo, "trazida-sem-conferencia");
  assert.equal(parado.conferenciaDoOperador, "gate-de-ux");
  // A resposta do operador está no arquivo: --operador não se aplica, e a conferência recusa o não.
  a.recusa("uso", "registrar-conferencia", "T1", "--rodada", "nao", "--operador", "não");
  a.recusa("approval-pede-rodada", "registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica");
  const nao = a.ok("registrar-conferencia", "T1", "--rodada", "nao");
  assert.equal(nao.acao, "rodada-registrada");
  assert.equal(nao.rodadaDoApproval, 1);

  // Rodada B (conserto) e C (gate de novo, sim).
  a.abrirPeloProximo("T1", 2);
  a.maquina("T1", 2, { "src/t1.mjs": "export const conserto = 1;\n" });
  a.ok("registrar-conferencia", "T1", "--rodada", "nao");
  a.abrirPeloProximo("T1", 3);
  a.maquina("T1", 3, { [APPROVAL]: approval("SHIP", 2) });
  a.recusa("approval-nao-pede-rodada", "registrar-conferencia", "T1", "--rodada", "nao");
  assert.equal(a.ok("registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica").acao, "conferida");
});

test("caso por arquivo: só o sim declarado fecha — approval ausente ou fora dos dois lados recusa", (t) => {
  for (const arquivos of [{ "src/t1.mjs": "export const t1 = 1;\n" }, { [APPROVAL]: approval("TIMEOUT_NO_RESPONSE", 1) }]) {
    const a = ambiente(t, [GATE]);
    a.ok("autorizar-ciclo", "F1", "--sim", "sim");
    a.abrirPeloProximo("T1", 1);
    a.maquina("T1", 1, arquivos);
    a.recusa("approval-sem-resposta", "registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica");
    assert.ok(!a.marcas().some((m) => /conferida$/.test(m)));
  }
});

test("(gate-de-ux) sem caso declarado no adaptador do repositório recusa, nunca vira task comum", (t) => {
  const semConferencia = { projeto: "teste", operadores: [{ handle: "o", nome: "O" }], estado: { pasta: "teste/conducao" }, log: { pasta: "." }, pergunta: { destino: "log" } };
  const a = ambiente(t, [GATE], { ".altair/adaptador.json": JSON.stringify(semConferencia) });
  a.ok("autorizar-ciclo", "F1", "--sim", "sim");
  a.abrirPeloProximo("T1", 1);
  a.maquina("T1", 1, { [APPROVAL]: approval("NEEDS_REWORK", 1) });
  a.recusa("conferencia-nao-declarada", "registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica");
  a.recusa("conferencia-nao-declarada", "registrar-conferencia", "T1", "--rodada", "nao");
});

test("task comum: sem pergunta do resultado, --rodada e --operador recusam", (t) => {
  const a = ambiente(t, [task("T1")]);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim");
  a.abrirPeloProximo("T1", 1);
  a.maquina("T1", 1, { "src/t1.mjs": "export const t1 = 1;\n" });
  const p = a.proximo();
  assert.equal(p.motivo, "trazida-sem-conferencia");
  assert.equal(p.conferenciaDoOperador, undefined);
  a.recusa("rodada-fora-da-conferencia", "registrar-conferencia", "T1", "--rodada", "nao", "--operador", "não");
  a.recusa("operador-fora-da-conferencia", "registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica", "--operador", "sim");
  assert.equal(a.ok("registrar-conferencia", "T1", "--verificacao", "verde", "--publicacao", "nao-se-aplica").acao, "conferida");
});

test("--rodada carimbo é só do caso por arquivo", (t) => {
  const a = ambiente(t, [CELULAR]);
  a.ok("autorizar-ciclo", "F1", "--sim", "sim");
  a.abrirPeloProximo("T1", 1);
  a.maquina("T1", 1, { "src/t1.mjs": "export const t1 = 1;\n" });
  a.recusa("uso", "registrar-conferencia", "T1", "--rodada", "carimbo", "--operador", "não");
});

test("o caso: a marca do núcleo pergunta; a declarada no adaptador do projeto de teste lê o approval; sem marca, nenhum", () => {
  const { conferencia } = lerAdaptador(RAIZ);
  assert.deepEqual(
    conferencia.map((c) => c.marca),
    ["gate-de-ux"],
  );
  const plano = lerPlano(canonico([CELULAR, task("T2", { satisfies: "[AC-TESTE3-1] (gate-de-ux) (fechamento-de-fase)" }), task("T3")]));
  const [t1, t2, t3] = ["T1", "T2", "T3"].map((id) => plano.porId.get(id));
  assert.deepEqual(t1.marcas, ["conferencia-do-operador"]);
  assert.deepEqual(t2.marcas, ["gate-de-ux", "fechamento-de-fase"]);
  // Todo token do parêntese conta, não só o primeiro.
  const composto = lerPlano(canonico([task("T1", { satisfies: "[AC-TESTE3-1] (fechamento-de-fase, conferencia-do-operador) (review-gate + gate-de-ux)" })])).porId.get("T1");
  assert.deepEqual(composto.marcas, ["fechamento-de-fase", "conferencia-do-operador", "review-gate", "gate-de-ux"]);
  assert.deepEqual(casoDeConferencia(t1, conferencia), { marca: MARCA_DA_CONFERENCIA });
  assert.equal(casoDeConferencia(t2, conferencia).arquivo, "gate-de-ux-approval.md");
  assert.equal(casoDeConferencia(t3, conferencia), null);
  // Sem a declaração, a marca do projeto não vale; a do núcleo vale sempre.
  assert.equal(casoDeConferencia(t2, []), null);
  assert.deepEqual(casoDeConferencia(t1, []), { marca: MARCA_DA_CONFERENCIA });
  const gate = casoDeConferencia(t2, conferencia);
  assert.equal(respostaDoArquivo(gate, "SHIP_WITH_DEBT"), "sim");
  assert.equal(respostaDoArquivo(gate, "NEEDS_REWORK"), "nao");
  assert.equal(respostaDoArquivo(gate, undefined), null);
});

test("a declaração de conferência: opcional, e recusa o que o leitor não entende", () => {
  const base = { projeto: "x", operadores: [{ handle: "o", nome: "O" }], estado: { pasta: "x" }, log: { pasta: "." }, pergunta: { destino: "log" } };
  assert.deepEqual(validar(base).conferencia, []);
  assert.deepEqual(validar({ ...base, conferencia: [{ marca: "headset" }] }).conferencia, [{ marca: "headset" }]);
  const ruim = (conferencia, re) => assert.throws(() => validar({ ...base, conferencia }), (e) => e instanceof ErroAdaptador && re.test(e.message));
  ruim({}, /esperada lista/);
  ruim([{ marca: MARCA_DA_CONFERENCIA }], /repetida ou do núcleo/);
  ruim([{ marca: "a" }, { marca: "a" }], /repetida/);
  ruim([{ marca: "A B" }], /token minúsculo/);
  ruim([{ marca: "a", outro: 1 }], /campo desconhecido/);
  ruim([{ marca: "a", arquivo: "x.md", sim: ["OK"] }], /falta o campo nao/);
  ruim([{ marca: "a", arquivo: "../x.md", sim: ["OK"], nao: ["NO"] }], /fora da raiz/);
  ruim([{ marca: "a", arquivo: "x.md", sim: ["OK"], nao: ["OK"] }], /dois lados/);
  ruim([{ marca: "a", arquivo: "x.md", sim: [], nao: ["NO"] }], /lista não vazia/);
});
