/**
 * conducao-vigia.test.mjs — vigia de filha e regra de falha (VEGA-22 T12).
 *
 * Tabela de casos sobre `conducao.mjs proximo`, chamado como CLI em repos git
 * temporários (hooks desligados: core.hooksPath=/dev/null). A data de abertura
 * da tentativa é a do marcador (GIT_COMMITTER_DATE), e o relógio da vigia vem
 * de `entrada.agora` — nenhum caso depende do relógio da máquina.
 *
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nonce } from "../conducao.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-vigia";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;
const ABERTA = 1_800_000_000; // epoch s do marcador de fixture
const ISO = (s) => new Date(s * 1000).toISOString();

// ── fixture ─────────────────────────────────────────────────────────────────

function task(id, extra = ["**Estação:** servidor", "**Independente:** sim"]) {
  return [
    `#### ${id} — tarefa ${id}`,
    "",
    `- **Objetivo:** tarefa ${id}`,
    "- **satisfies:** [AC-TESTE1-1]",
    "- **Inputs:** `README.md`",
    `- **Outputs:** \`src/${id.toLowerCase()}.mjs\` (create)`,
    ...extra.map((e) => `- ${e}`),
    "- **Steps:** faz",
    `- **Verificação:** \`echo ${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-F1/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

function canonico(tasks, largura = 2) {
  return [
    "---",
    `cycle: ${CICLO}`,
    "opened: 2026-10-15",
    "---",
    "",
    "### 1.5 Modo de Execução",
    "",
    `**Largura do ciclo:** ${largura}`,
    "",
    "## 3. Tasks",
    "",
    "### F1 — fase F1 (**Modelo:** opus)",
    "",
    ...tasks,
    "## 4. Pronto",
    "",
  ].join("\n");
}

function novoRepo(tasks = [task("T1"), task("T2")], largura = 2) {
  const dir = mkdtempSync(path.join(tmpdir(), "conducao-vigia-"));
  const g = (args, env = {}) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }).trim();
  g(["init", "-q", "-b", "ciclo-teste"]);
  g(["config", "core.hooksPath", "/dev/null"]);
  g(["config", "user.name", "teste"]);
  g(["config", "user.email", "teste@example.invalid"]);
  g(["config", "commit.gpgsign", "false"]);
  mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
  writeFileSync(path.join(dir, CAMINHO), canonico(tasks, largura));
  g(["add", CAMINHO]);
  g(["commit", "-q", "-m", "plano"]);
  const vazio = (...linhas) => g(["commit", "-q", "--allow-empty", ...linhas.flatMap((l) => ["-m", l])]);
  vazio("Conducao: F1 autorizada", "sim do Rita", `Conducao-Plano: ${g(["rev-parse", `HEAD:${CAMINHO}`])}`);
  /** Tentativa em voo como o `abrir` grava: marcador fora do ramo, datado, + referência local. */
  const emVoo = (t, n, x, quando = ABERTA) => {
    const d = `@${quando} +0000`;
    const marcador = g(["commit-tree", g(["rev-parse", "HEAD^{tree}"]), "-p", g(["rev-parse", "HEAD"]), "-m", `Conducao: abrir ${t} tentativa ${n} nonce ${x}`], {
      GIT_COMMITTER_DATE: d,
      GIT_AUTHOR_DATE: d,
    });
    g(["update-ref", `refs/conducao-local/${CICLO}/${t}/${n}`, marcador]);
  };
  const falhou = (t, n, x, coberta = "nao") => vazio(`Conducao: ${t} tentativa ${n} falhou`, `Conducao-Task: ${t}\nConducao-Nonce: ${x}\ncoberta-por-reinicio: ${coberta}`);
  const conferida = (t, x) =>
    vazio(
      `Conducao: ${t} conferida`,
      `Conducao-Task: ${t}\nConducao-Sha-Filha: 0000000\nConducao-Sessao-Filha: s\nConducao-Nonce: ${x}\nConducao-Verificacao: verde\nConducao-Publicacao: nao-se-aplica`,
    );
  const revertida = (t, n, x) => vazio(`Conducao: ${t} tentativa ${n} revertida`, `Conducao-Task: ${t}\nConducao-Nonce: ${x}`);
  return { dir, g, vazio, emVoo, falhou, conferida, revertida, limpar: () => rmSync(dir, { recursive: true, force: true }) };
}

function cli(dir, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8" });
  return { ...r, linhas: r.stdout.split("\n").filter(Boolean) };
}

/**
 * `ativaDesde` (epoch s) troca o `ActiveEnterTimestamp` da ponte; padrão: 1 s depois do `quando`
 * do registro (reinício confirmado). `stderr` recebe o stderr do verbo.
 */
function proximo(dir, entrada = {}, reinicio, { ativaDesde, stderr } = {}) {
  const args = ["proximo", "--entrada", JSON.stringify({ agora: ISO(ABERTA + 60), ...entrada })];
  if (reinicio) {
    const arq = path.join(dir, ".git", "reinicio.json");
    writeFileSync(arq, JSON.stringify(reinicio));
    args.push("--reinicio", arq, "--ponte-ativa-desde", ISO(ativaDesde ?? Math.floor(Date.parse(reinicio.quando) / 1000) + 1));
  }
  const r = cli(dir, args);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.linhas.length, 1, `uma linha JSON por chamada, veio:\n${r.stdout}`);
  if (stderr) stderr.push(r.stderr);
  return JSON.parse(r.linhas[0]);
}

const filha = (campos) => ({ sessao: "s1", task: "T1", tentativa: 1, nonce: "n1", estado: "RUNNING", ...campos });

// ── tabela da regra de falha ────────────────────────────────────────────────

test("regra de falha por tabela de casos", (t) => {
  const casos = [
    {
      nome: "falha avisada, primeira: tentativa nova automatica com a falha a gravar",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { filhas: [filha({ estado: "IDLE", aviso: "T1-FALHA vitest n1" })] },
      espera: (a) => {
        assert.equal(a.acao, "abrir");
        const x = a.tarefas.find((y) => y.task === "T1");
        assert.equal(x.tentativa, 2);
        assert.deepEqual(x.falhaAnterior, { tentativa: 1, coberta: "nao", motivo: "falha-avisada" });
      },
    },
    {
      // P22 do ATRM-51: a pergunta virava `abrir` da tentativa seguinte e contava falha.
      nome: "pergunta da filha: vai a Rita, sem falha a gravar e sem abrir",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { filhas: [filha({ estado: "IDLE", aviso: "T1-FALHA pergunta n1" })] },
      espera: (a) => {
        assert.equal(a.acao, "perguntar");
        assert.equal(a.motivo, "pergunta-da-filha");
        assert.equal(a.task, "T1");
        assert.equal(a.tentativa, 1);
        assert.equal(a.sessao, "s1");
        assert.equal(a.nonceTentativa, "n1");
        assert.equal(a.aviso, "T1-FALHA pergunta n1");
        assert.equal(a.registrarFalha, undefined);
        assert.equal(a.tarefas, undefined);
      },
    },
    {
      nome: "pergunta da filha depois de uma falha contada: segue pergunta, nunca segunda-falha",
      montar: (r) => {
        r.emVoo("T1", 1, "n1");
        r.falhou("T1", 1, "n1", "nao");
        r.emVoo("T1", 2, "n2");
      },
      entrada: { filhas: [filha({ tentativa: 2, nonce: "n2", estado: "IDLE", aviso: "T1-FALHA pergunta n2" })] },
      espera: (a) => {
        assert.equal(a.acao, "perguntar");
        assert.equal(a.motivo, "pergunta-da-filha");
        assert.equal(a.tentativa, 2);
        assert.equal(a.registrarFalha, undefined);
      },
    },
    {
      nome: "ARCHIVED com status FAILED e aviso OK: o aviso decide, trazer",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { filhas: [filha({ estado: "ARCHIVED", statusBucket: "FAILED", aviso: "T1-OK deadbeef n1" })] },
      espera: (a) => {
        assert.equal(a.acao, "trazer");
        assert.equal(a.sha, "deadbeef");
      },
    },
    {
      nome: "arquivada sem aviso: perguntar, nunca reabrir em silencio",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { filhas: [filha({ estado: "ARCHIVED" })] },
      espera: (a) => {
        assert.equal(a.acao, "perguntar");
        assert.equal(a.motivo, "filha-sumiu");
        assert.deepEqual(a.registrarFalha, { task: "T1", tentativa: 1, coberta: "nao" });
      },
    },
    {
      nome: "tentativa sem filha na entrada: perguntar",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { filhas: [] },
      espera: (a) => assert.equal(a.motivo, "tentativa-sem-filha"),
    },
    {
      nome: "prazo vencido sem aviso: perguntar",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { agora: ISO(ABERTA + 121 * 60), filhas: [filha()] },
      espera: (a) => {
        assert.equal(a.acao, "perguntar");
        assert.equal(a.motivo, "prazo-vencido");
        assert.equal(a.prazoMin, 120);
      },
    },
    {
      nome: "dentro do prazo, sem aviso: a filha segue em voo",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { agora: ISO(ABERTA + 119 * 60), filhas: [filha()] },
      espera: (a) => {
        assert.notEqual(a.acao, "perguntar");
        assert.ok(!a.tarefas?.some((x) => x.task === "T1"), "T1 em voo não reabre");
      },
    },
    {
      nome: "queda coberta pelo registro de reinicio: reabre sem contar falha, com aviso a Rita",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { filhas: [filha({ estado: "ARCHIVED" })] },
      reinicio: { quando: ISO(ABERTA + 30) },
      espera: (a) => {
        assert.equal(a.acao, "abrir");
        const x = a.tarefas.find((y) => y.task === "T1");
        assert.equal(x.tentativa, 2);
        assert.deepEqual(x.falhaAnterior, { tentativa: 1, coberta: "sim", motivo: "reinicio-da-ponte" });
        assert.match(a.avisoLeo.join("\n"), /T1 tentativa 1 caiu no reinício da ponte;/);
      },
    },
    {
      nome: "reinicio anterior a abertura nao cobre a queda",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { filhas: [filha({ estado: "ARCHIVED" })] },
      reinicio: { quando: ISO(ABERTA - 30) },
      espera: (a) => assert.equal(a.motivo, "filha-sumiu"),
    },
    {
      nome: "registro velho, confirmado por subida posterior, nao cobre tentativa aberta depois dele",
      montar: (r) => r.emVoo("T1", 1, "n1"),
      entrada: { filhas: [filha({ estado: "ARCHIVED" })] },
      // reinício de 30 dias antes da abertura; a ponte subiu de novo depois (queda da máquina)
      reinicio: { quando: ISO(ABERTA - 30 * 24 * 3600) },
      ativaDesde: ABERTA + 30,
      espera: (a) => assert.equal(a.motivo, "filha-sumiu"),
    },
    {
      nome: "falha coberta por reinicio nao conta: falha avisada seguinte ainda reabre",
      montar: (r) => {
        r.emVoo("T1", 1, "n1");
        r.falhou("T1", 1, "n1", "sim");
        r.emVoo("T1", 2, "n2");
      },
      entrada: { filhas: [filha({ tentativa: 2, nonce: "n2", estado: "IDLE", aviso: "T1-FALHA lint n2" })] },
      espera: (a) => {
        assert.equal(a.acao, "abrir");
        assert.equal(a.tarefas.find((y) => y.task === "T1").tentativa, 3);
      },
    },
    {
      nome: "verificacao vermelha (revertida sem falha): tentativa nova com a falha a gravar",
      montar: (r) => r.revertida("T1", 1, "n1"),
      entrada: { filhas: [] },
      espera: (a) => {
        assert.equal(a.acao, "abrir");
        assert.deepEqual(a.tarefas.find((y) => y.task === "T1").falhaAnterior, { tentativa: 1, coberta: "nao", motivo: "verificacao-vermelha" });
      },
    },
    {
      nome: "verificacao vermelha depois de uma falha contada: perguntar",
      montar: (r) => {
        r.falhou("T1", 1, "n1");
        r.revertida("T1", 2, "n2");
      },
      entrada: { filhas: [] },
      espera: (a) => {
        assert.equal(a.motivo, "segunda-falha");
        assert.deepEqual(a.registrarFalha, { task: "T1", tentativa: 2, coberta: "nao" });
      },
    },
  ];
  for (const c of casos) {
    const r = novoRepo();
    t.after(r.limpar);
    c.montar(r);
    c.espera(proximo(r.dir, c.entrada, c.reinicio, { ativaDesde: c.ativaDesde }));
  }
});

test("registro de reinicio sem subida da ponte depois dele e ignorado com aviso", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.emVoo("T1", 1, "n1");
  const stderr = [];
  // o restart --no-block não aconteceu: a ponte está ativa desde ANTES do registro
  const a = proximo(r.dir, { filhas: [filha({ estado: "ARCHIVED" })] }, { quando: ISO(ABERTA + 30) }, { ativaDesde: ABERTA + 10, stderr });
  assert.equal(a.motivo, "filha-sumiu", "queda não coberta por reinício não confirmado");
  assert.match(stderr.join(""), /registro de reinício ignorado \(ponte-nao-subiu-depois-do-registro\)/);
});

test("reinicio-valido confirma pela hora de subida da ponte", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  const arq = path.join(r.dir, ".git", "reinicio.json");
  writeFileSync(arq, JSON.stringify({ quando: ISO(ABERTA) }));
  const rodar = (...extra) => spawnSync(process.execPath, [SCRIPT, "reinicio-valido", "--arquivo", arq, ...extra], { encoding: "utf8" });
  const ok = rodar("--ponte-ativa-desde", ISO(ABERTA + 5));
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).valido, true);
  const nao = rodar("--ponte-ativa-desde", ISO(ABERTA - 5));
  assert.equal(nao.status, 1);
  assert.equal(JSON.parse(nao.stdout).motivo, "ponte-nao-subiu-depois-do-registro");
  writeFileSync(arq, "{ilegivel");
  assert.equal(JSON.parse(rodar("--ponte-ativa-desde", ISO(ABERTA + 5)).stdout).motivo, "registro-ilegivel");
  assert.equal(spawnSync(process.execPath, [SCRIPT, "reinicio-valido"], { encoding: "utf8" }).status, 2);
});

test("segunda falha avisada da mesma task emite perguntar, nunca terceira tentativa", (t) => {
  const r = novoRepo([task("T1")], 1);
  t.after(r.limpar);
  r.emVoo("T1", 1, "n1");
  r.falhou("T1", 1, "n1");
  r.emVoo("T1", 2, "n2");
  const entrada = { filhas: [filha({ tentativa: 2, nonce: "n2", estado: "IDLE", aviso: "T1-FALHA vitest n2" })] };
  const a = proximo(r.dir, entrada);
  assert.equal(a.acao, "perguntar");
  assert.equal(a.motivo, "segunda-falha");
  assert.equal(a.falhas, 1);
  assert.deepEqual(a.registrarFalha, { task: "T1", tentativa: 2, coberta: "nao" });
  // A maestra grava a 2ª falha e arquiva a filha: a task fica parada no teto.
  r.falhou("T1", 2, "n2");
  const b = proximo(r.dir, { filhas: [filha({ tentativa: 2, nonce: "n2", estado: "ARCHIVED", aviso: "T1-FALHA vitest n2" })] });
  assert.equal(b.acao, "perguntar");
  assert.equal(b.motivo, "teto-de-falhas");
  assert.equal(b.falhas, 2);
  assert.notEqual(b.acao, "abrir");
});

test("retomar em sessao nova preserva a contagem de falhas e a segunda falha continua perguntando", (t) => {
  const r = novoRepo([task("T1"), task("T2")], 2);
  t.after(r.limpar);
  r.emVoo("T1", 1, "n1");
  r.falhou("T1", 1, "n1");
  r.emVoo("T2", 1, "m1");
  r.falhou("T2", 1, "m1", "sim");
  r.emVoo("T1", 2, "n2");
  // Sessão nova: nenhum estado além do git — o `retomar` relê as marcas.
  const ret = cli(r.dir, ["retomar"]);
  assert.equal(ret.status, 0, ret.stderr);
  const estado = JSON.parse(ret.linhas[0]);
  assert.deepEqual(estado.falhas, { T1: 1 }, "falha coberta por reinício não entra na contagem");
  assert.deepEqual(estado.emVoo.map((x) => [x.task, x.tentativa]), [["T1", 2]]);
  const a = proximo(r.dir, { filhas: [filha({ tentativa: 2, nonce: "n2", estado: "IDLE", aviso: "T1-FALHA tsc n2" })] });
  assert.equal(a.acao, "perguntar");
  assert.equal(a.motivo, "segunda-falha");
});

// ── rede de arquivamento ────────────────────────────────────────────────────

test("filha com tentativa decidida e fora de ARCHIVED emite arquivar com nonce, uma vez", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.conferida("T1", "n1");
  const viva = filha({ estado: "IDLE", aviso: "T1-OK deadbeef n1" });
  const a = proximo(r.dir, { filhas: [viva] });
  assert.equal(a.acao, "arquivar", "precede o abrir da T2 pronta");
  assert.equal(a.sessao, "s1");
  assert.equal(a.nonceTentativa, "n1");
  assert.equal(a.nonce, nonce(CICLO, "arquivar:s1", "n1", ""));
  // Mesma entrada, mesma ação; HEAD novo não muda o nonce do arquivar.
  assert.deepEqual(proximo(r.dir, { filhas: [viva] }), a);
  r.vazio("outro commit");
  assert.equal(proximo(r.dir, { filhas: [viva] }).nonce, a.nonce);
  // Já arquivada: não emite nada para ela.
  const depois = proximo(r.dir, { filhas: [{ ...viva, estado: "ARCHIVED" }] });
  assert.equal(depois.acao, "abrir");
  assert.deepEqual(depois.tarefas.map((x) => x.task), ["T2"]);
  // Um arquivar executado e ainda viva: repete; dois sem ARCHIVED: falha de arquivamento.
  assert.equal(proximo(r.dir, { filhas: [{ ...viva, arquivamentos: [a.nonce] }] }).acao, "arquivar");
  const p = proximo(r.dir, { filhas: [{ ...viva, arquivamentos: [a.nonce, a.nonce] }] });
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, "falha-de-arquivamento");
});

test("sem aviso ou com tentativa ainda nao decidida, nunca arquivar", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  r.emVoo("T1", 1, "n1");
  // Aviso OK com tentativa ainda em voo: a decisão é trazer, não arquivar.
  assert.equal(proximo(r.dir, { filhas: [filha({ estado: "IDLE", aviso: "T1-OK deadbeef n1" })] }).acao, "trazer");
  // Falha gravada, filha viva sem aviso: a rede não a toca.
  r.falhou("T1", 1, "n1");
  assert.notEqual(proximo(r.dir, { filhas: [filha({ estado: "IDLE" })] }).acao, "arquivar");
  // Falha gravada e aviso FALHA: decidida ⇒ arquivar.
  const a = proximo(r.dir, { filhas: [filha({ estado: "IDLE", aviso: "T1-FALHA vitest n1" })] });
  assert.equal(a.acao, "arquivar");
  assert.equal(a.aviso, "FALHA");
});

// ── verbo de git da falha ───────────────────────────────────────────────────

test("abrir com --falhou grava a falha antes do marcador; registrar-falha e idempotente", (t) => {
  const r = novoRepo();
  t.after(r.limpar);
  const origin = mkdtempSync(path.join(tmpdir(), "conducao-vigia-origin-"));
  t.after(() => rmSync(origin, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "--bare", origin]);
  r.g(["remote", "add", "origin", origin]);
  r.g(["config", "remote.origin.mirror", "false"]);
  // Cópia do ciclo nasce como no primeiro `autorizar-fase`.
  const head0 = r.g(["rev-parse", "HEAD"]);
  r.g(["push", "-q", "origin", `${head0}:refs/conducao/${CICLO}/copia`]);
  r.g(["update-ref", `refs/conducao-local/${CICLO}/copia`, head0]);
  r.emVoo("T1", 1, "n1");

  const ab = cli(r.dir, ["abrir", "T1", "--tentativa", "2", "--nonce", "nn22", "--falhou", "1", "--coberta", "nao", "--motivo", "vitest", "--modo-maestra", "auto"]);
  assert.equal(ab.status, 0, ab.stderr);
  const s = JSON.parse(ab.linhas[0]);
  assert.equal(s.acao, "aberta");
  assert.equal(s.falha.acao, "falha-registrada");
  assert.equal(s.falha.nonce, "n1");
  assert.equal(r.g(["log", "-1", "--format=%s", s.base]), "Conducao: T1 tentativa 1 falhou");
  assert.equal(r.g(["log", "-1", "--format=%(trailers:key=coberta-por-reinicio,valueonly=true)", s.base]), "nao");
  assert.equal(r.g(["ls-remote", "origin", `refs/conducao/${CICLO}/copia`]).split("\t")[0], s.base, "a cópia leva o commit da falha");

  const de = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "1", "--coberta", "nao"]);
  assert.equal(de.status, 0, de.stderr);
  assert.equal(JSON.parse(de.linhas[0]).nova, false);
  assert.equal(r.g(["log", "--format=%s", "HEAD"]).split("\n").filter((l) => l === "Conducao: T1 tentativa 1 falhou").length, 1);
  const ruim = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "2", "--coberta", "talvez"]);
  assert.equal(ruim.status, 1);
  assert.match(ruim.stderr, /uso: --coberta sim\|nao/);
});

test("falha de ambiente nao conta no teto, leva trailer proprio e exige motivo (P7 do ATRM-51)", (t) => {
  const r = novoRepo([task("T1"), task("T2")], 2);
  t.after(r.limpar);
  const origin = mkdtempSync(path.join(tmpdir(), "conducao-vigia-origin-"));
  t.after(() => rmSync(origin, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "--bare", origin]);
  r.g(["remote", "add", "origin", origin]);
  const head0 = r.g(["rev-parse", "HEAD"]);
  r.g(["push", "-q", "origin", `${head0}:refs/conducao/${CICLO}/copia`]);
  r.g(["update-ref", `refs/conducao-local/${CICLO}/copia`, head0]);
  r.emVoo("T1", 1, "n1");

  const sem = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "1", "--coberta", "ambiente"]);
  assert.equal(sem.status, 1);
  assert.match(sem.stderr, /motivo-ausente/);

  const ok = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "1", "--coberta", "ambiente", "--motivo", "classificador recusou leitura de producao"]);
  assert.equal(ok.status, 0, ok.stderr);
  const sha = JSON.parse(ok.linhas[0]).sha;
  assert.equal(r.g(["log", "-1", "--format=%(trailers:key=Conducao-Falha-Ambiente,valueonly=true)", sha]), "sim");
  assert.equal(r.g(["log", "-1", "--format=%(trailers:key=coberta-por-reinicio,valueonly=true)", sha]), "nao");

  r.emVoo("T1", 2, "n2");
  const ret = cli(r.dir, ["retomar"]);
  assert.equal(ret.status, 0, ret.stderr);
  assert.deepEqual(JSON.parse(ret.linhas[0]).falhas, {}, "falha de ambiente não entra na contagem");
  // A falha seguinte, de trabalho, é a primeira contada: reabre em vez de parar no teto.
  const a = proximo(r.dir, { filhas: [filha({ tentativa: 2, nonce: "n2", estado: "IDLE", aviso: "T1-FALHA tsc n2" })] });
  assert.equal(a.acao, "abrir", JSON.stringify(a));
});

test("falha de ambiente tem teto proprio e entra pelo abrir --falhou (P7 do ATRM-51)", (t) => {
  const r = novoRepo([task("T1"), task("T2")], 2);
  t.after(r.limpar);
  const origin = mkdtempSync(path.join(tmpdir(), "conducao-vigia-origin-"));
  t.after(() => rmSync(origin, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "--bare", origin]);
  r.g(["remote", "add", "origin", origin]);
  const head0 = r.g(["rev-parse", "HEAD"]);
  r.g(["push", "-q", "origin", `${head0}:refs/conducao/${CICLO}/copia`]);
  r.g(["update-ref", `refs/conducao-local/${CICLO}/copia`, head0]);
  r.emVoo("T1", 1, "n1");
  // 1ª e 2ª falhas de ambiente pelo caminho do `abrir --falhou`, com motivo.
  for (const [n, nonce] of [[2, "nn22"], [3, "nn33"]]) {
    const ab = cli(r.dir, ["abrir", "T1", "--tentativa", String(n), "--nonce", nonce, "--falhou", String(n - 1), "--coberta", "ambiente", "--motivo", "credencial da ponte ausente", "--modo-maestra", "auto"]);
    assert.equal(ab.status, 0, ab.stderr);
    const s = JSON.parse(ab.linhas[0]);
    assert.equal(r.g(["log", "-1", "--format=%(trailers:key=Conducao-Falha-Ambiente,valueonly=true)", s.base]), "sim");
  }
  // Sem motivo, o `abrir --falhou … ambiente` recusa e não abre.
  const semMotivo = cli(r.dir, ["abrir", "T1", "--tentativa", "4", "--nonce", "nn44", "--falhou", "3", "--coberta", "ambiente", "--modo-maestra", "auto"]);
  assert.equal(semMotivo.status, 1);
  assert.equal(r.g(["ls-remote", "origin", `refs/conducao/${CICLO}/T1/4`]), "");
  // 3ª falha de ambiente: não conta no teto de trabalho, mas para no teto próprio.
  const de = cli(r.dir, ["registrar-falha", "T1", "--tentativa", "3", "--coberta", "ambiente", "--motivo", "classificador recusou de novo"]);
  assert.equal(de.status, 0, de.stderr);
  const ret = JSON.parse(cli(r.dir, ["retomar"]).linhas[0]);
  assert.deepEqual(ret.falhas, {});
  assert.deepEqual(ret.falhasAmbiente, { T1: 3 });
  const a = proximo(r.dir, { filhas: [] });
  assert.equal(a.acao, "perguntar", JSON.stringify(a));
  assert.equal(a.motivo, "teto-de-falhas-ambiente");
  assert.equal(a.falhasAmbiente, 3);
});
