/**
 * criar-condutora.test.mjs — o `proximo` do nível da maestra (VEGA-29 T37, A1).
 *
 * `proximo --nivel maestra`: as `filhas` da entrada são as condutoras que a
 * maestra criou, cada uma com a `fase`. Emite `criar-condutora` para a
 * primeira fase sem `Conducao-Encerrada` quando nenhuma condutora vive
 * (inclusive a primeira do ciclo, sem sessão anterior), `esperar`
 * `condutora-viva` enquanto ela vive, `arquivar` da condutora encerrada e
 * `criar-fechamento` depois de `Conducao-Encerrada: ciclo`. Sem a flag, o
 * laço da condutora sai igual.
 *
 * Repos git temporários com hooks desligados (core.hooksPath=/dev/null), o
 * script chamado como CLI, como a maestra o chama.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;

function task(id, fase) {
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
    `- **Verificação:** \`echo verificacao-${id}\`.`,
    "- **Esperado:** exit 0.",
    "- **Falha-se:** exit 1.",
    `- **Commit:** \`${CICLO}-${fase}/${id} — tarefa ${id}\``,
    "",
  ].join("\n");
}

const CANONICO = [
  "---",
  `cycle: ${CICLO}`,
  "opened: 2026-10-15",
  "---",
  "",
  "## 1. Goal",
  "",
  "## 3. Tasks",
  "",
  "### F1 — fase um (**Modelo:** opus)",
  "",
  task("T1", "F1"),
  "### F2 — fase dois (**Modelo:** sonnet)",
  "",
  task("T2", "F2"),
  "## 4. Pronto",
  "",
].join("\n");

function novoRepo(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "criar-condutora-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "ciclo-teste");
  g("config", "core.hooksPath", "/dev/null");
  g("config", "user.name", "teste");
  g("config", "user.email", "teste@example.invalid");
  g("config", "commit.gpgsign", "false");
  mkdirSync(path.join(dir, path.dirname(CAMINHO)), { recursive: true });
  writeFileSync(path.join(dir, CAMINHO), CANONICO);
  g("add", CAMINHO);
  g("commit", "-q", "-m", "plano");
  const vazio = (...linhas) => g("commit", "-q", "--allow-empty", ...linhas.flatMap((l) => ["-m", l]));
  const autorizar = (fase) => vazio(`Conducao: ${fase} autorizada`, "sim do operador", `Conducao-Plano: ${g("rev-parse", `HEAD:${CAMINHO}`)}\nConducao-Ciclo: sim`);
  const encerrar = (fase) => vazio(`Conducao: ${fase} sessao encerrada`, `Conducao-Encerrada: ${fase}\nConducao-Nonce: 0123456789abcdef`);
  return { dir, autorizar, encerrar };
}

function rodar(dir, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", dir, "--ciclo", CICLO], { encoding: "utf8" });
  return { ...r, linhas: r.stdout.split("\n").filter(Boolean) };
}

function maestra(dir, entrada) {
  const r = rodar(dir, ["proximo", "--nivel", "maestra", ...(entrada ? ["--entrada", JSON.stringify(entrada)] : [])]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.linhas.length, 1, `uma linha JSON por chamada, veio:\n${r.stdout}`);
  return JSON.parse(r.linhas[0]);
}

const condutora = (sessao, fase, estado = "RUNNING", extra = {}) => ({ sessao, fase, estado, ...extra });

test("ciclo sem marca: a maestra cria a condutora da primeira fase, sem sessão anterior a arquivar", (t) => {
  const r = novoRepo(t);
  const a = maestra(r.dir);
  assert.equal(a.acao, "criar-condutora");
  assert.equal(a.fase, "F1");
  assert.equal(a.modelo, "opus");
  assert.equal(a.tentativa, 1);
  assert.equal(a.nivel, "maestra");
  assert.match(a.nonce, /^[0-9a-f]{16}$/);
  assert.match(a.texto, /^Conduzir TESTE-1-conducao — F1, pela skill /);
  assert.match(a.texto, /sem condutora anterior a arquivar/);
  assert.doesNotMatch(a.texto, /maestra anterior/);
  assert.match(a.texto, /retomar --repo /);
  // Mesmo estado, mesma ação, mesmo nonce.
  assert.deepEqual(maestra(r.dir), a);
});

test("condutora viva: a maestra espera, uma condutora por vez", (t) => {
  const r = novoRepo(t);
  const a = maestra(r.dir, { filhas: [condutora("s1", "F1")] });
  assert.equal(a.acao, "esperar");
  assert.equal(a.motivo, "condutora-viva");
  assert.equal(a.fase, "F1");
  assert.equal(a.sessao, "s1");
});

test("fase encerrada: arquiva a condutora dela, e depois cria a da fase seguinte com a condutora anterior", (t) => {
  const r = novoRepo(t);
  r.autorizar("F1");
  r.encerrar("F1");
  const arq = maestra(r.dir, { filhas: [condutora("s1", "F1")] });
  assert.equal(arq.acao, "arquivar");
  assert.equal(arq.sessao, "s1");
  assert.equal(arq.fase, "F1");
  assert.match(arq.nonce, /^[0-9a-f]{16}$/);

  const nova = maestra(r.dir, { filhas: [condutora("s1", "F1", "ARCHIVED")] });
  assert.equal(nova.acao, "criar-condutora");
  assert.equal(nova.fase, "F2");
  assert.equal(nova.modelo, "sonnet");
  assert.match(nova.texto, /archive_session da condutora anterior s1 antes do retomar/);
  assert.doesNotMatch(nova.texto, /maestra anterior/);
  // F2 sem autorização, com o sim do ciclo gravado: a condutora herda sem perguntar.
  assert.match(nova.texto, /herdar-autorizacao F2 pelo sim do ciclo/);
});

test("condutora que caiu sem encerrar a fase é recriada com nonce novo e a condutora anterior no texto", (t) => {
  const r = novoRepo(t);
  const primeira = maestra(r.dir);
  const de_novo = maestra(r.dir, { filhas: [condutora("s1", "F1", "ARCHIVED")] });
  assert.equal(de_novo.acao, "criar-condutora");
  assert.equal(de_novo.fase, "F1");
  assert.equal(de_novo.tentativa, 2);
  assert.notEqual(de_novo.nonce, primeira.nonce);
  assert.match(de_novo.texto, /archive_session da condutora anterior s1/);
});

test("arquivar repetido sem a condutora chegar a ARCHIVED vira pergunta", (t) => {
  const r = novoRepo(t);
  r.encerrar("F1");
  const arq = maestra(r.dir, { filhas: [condutora("s1", "F1")] });
  const p = maestra(r.dir, { filhas: [condutora("s1", "F1", "RUNNING", { arquivamentos: [arq.nonce, arq.nonce] })] });
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, "falha-de-arquivamento");
});

test("ciclo encerrado: arquiva a condutora, cria o fechamento uma vez, e espera enquanto ele vive", (t) => {
  const r = novoRepo(t);
  r.autorizar("F1");
  r.encerrar("F1");
  r.encerrar("ciclo");
  const arq = maestra(r.dir, { filhas: [condutora("s1", "F1", "ARCHIVED"), condutora("s2", "F2")] });
  assert.equal(arq.acao, "arquivar");
  assert.equal(arq.sessao, "s2");

  const filhas = [condutora("s1", "F1", "ARCHIVED"), condutora("s2", "F2", "ARCHIVED")];
  const f = maestra(r.dir, { filhas });
  assert.equal(f.acao, "criar-fechamento");
  assert.match(f.texto, /^\/close-cycle TESTE-1-conducao/);
  assert.match(f.texto, /archive_session da condutora anterior s2 antes do Ato A/);
  assert.match(f.texto, /--exigir-encerramentos F1,ciclo/);

  const viva = maestra(r.dir, { filhas: [...filhas, condutora("s3", "ciclo")] });
  assert.equal(viva.acao, "esperar");
  assert.equal(viva.motivo, "condutora-viva");

  const depois = maestra(r.dir, { filhas: [...filhas, condutora("s3", "ciclo", "ARCHIVED")] });
  assert.equal(depois.acao, "esperar");
  assert.equal(depois.motivo, "close-cycle-em-sessao-limpa");
});

test("sem a flag, o laço da condutora sai igual", (t) => {
  const r = novoRepo(t);
  const semSim = rodar(r.dir, ["proximo"]);
  assert.equal(semSim.status, 0, semSim.stderr);
  const p = JSON.parse(semSim.linhas[0]);
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, "autorizar-ciclo");
  assert.equal(p.nivel, undefined);

  r.autorizar("F1");
  const a = JSON.parse(rodar(r.dir, ["proximo"]).linhas[0]);
  assert.equal(a.acao, "abrir");
  assert.equal(a.nivel, undefined);
  assert.deepEqual(a.tarefas.map((x) => x.task), ["T1"]);
});

test("condutora sem sessão, fase ou estado vira entrada-invalida, nunca espera calada", (t) => {
  const r = novoRepo(t);
  for (const k of ["sessao", "fase", "estado"]) {
    const c = condutora("s1", "F1");
    delete c[k];
    const p = maestra(r.dir, { filhas: [c] });
    assert.equal(p.acao, "perguntar", k);
    assert.equal(p.motivo, "entrada-invalida", k);
    assert.match(p.problemas.join(" "), new RegExp(`filhas\\[0\\]\\.${k}`), k);
  }
  // Sem a flag, a filha sem `fase` segue aceita, como antes.
  const semFlag = JSON.parse(rodar(r.dir, ["proximo", "--entrada", JSON.stringify({ filhas: [{ sessao: "s1", estado: "RUNNING" }] })]).linhas[0]);
  assert.notEqual(semFlag.motivo, "entrada-invalida");
});

test("--nivel com outro valor sai 2", (t) => {
  const r = novoRepo(t);
  for (const args of [["--nivel", "condutora"], ["--nivel"]]) {
    const s = rodar(r.dir, ["proximo", ...args]);
    assert.equal(s.status, 2, args.join(" "));
    assert.match(s.stderr, /--nivel aceita só maestra/);
  }
});

// ── vigia da condutora (T39) ────────────────────────────────────────────────

const AGORA = "2026-10-29T12:00:00Z";
const minutosAntes = (min) => new Date(Date.parse(AGORA) - min * 60_000).toISOString();

test("condutora FAILED: a maestra cutuca antes, e pergunta condutora-caida depois do silêncio", (t) => {
  const r = novoRepo(t);
  const c = maestra(r.dir, { agora: AGORA, filhas: [condutora("s1", "F1", "RUNNING", { statusBucket: "FAILED" })] });
  assert.equal(c.acao, "cutucar");
  assert.equal(c.motivo, "condutora-falhou");
  assert.equal(c.sessao, "s1");
  assert.equal(c.fase, "F1");
  assert.equal(c.nivel, "maestra");
  assert.match(c.mensagem, /caiu antes de encerrar F1/);

  // Cutucada há pouco: dentro do prazo, segue esperando a condutora viva.
  const dentro = maestra(r.dir, { agora: AGORA, filhas: [condutora("s1", "F1", "RUNNING", { statusBucket: "FAILED", cutucadaEm: minutosAntes(2) })] });
  assert.equal(dentro.acao, "esperar");
  assert.equal(dentro.motivo, "condutora-viva");

  // Calada além do prazo depois do cutucar: pergunta, nunca espera sem teto.
  const p = maestra(r.dir, { agora: AGORA, filhas: [condutora("s1", "F1", "RUNNING", { statusBucket: "FAILED", cutucadaEm: minutosAntes(30) })] });
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, "condutora-caida");
  assert.equal(p.situacao, "caida");
  assert.equal(p.fase, "F1");
  assert.equal(p.sessao, "s1");
  assert.match(p.detalhe, /caiu, recebeu a mensagem e seguiu calada/);

  // A condutora que volta sai do FAILED: espera de novo.
  const voltou = maestra(r.dir, { agora: AGORA, filhas: [condutora("s1", "F1", "RUNNING", { statusBucket: "RUNNING", cutucadaEm: minutosAntes(30) })] });
  assert.equal(voltou.acao, "esperar");
});

test("condutora que voltou e caiu de novo, com o cutucadaEm da primeira queda: cutucar novo, nunca a pergunta direto (T40)", (t) => {
  const r = novoRepo(t);
  const segunda = maestra(r.dir, { agora: AGORA, filhas: [condutora("s1", "F1", "FAILED", { cutucadaEm: minutosAntes(60), caidaEm: minutosAntes(1) })] });
  assert.equal(segunda.acao, "cutucar");
  assert.equal(segunda.motivo, "condutora-falhou");
  assert.equal(segunda.sessao, "s1");
  // Cutucada desta queda e calada além do prazo: a pergunta, como na T39.
  const calada = maestra(r.dir, { agora: AGORA, filhas: [condutora("s1", "F1", "FAILED", { caidaEm: minutosAntes(31), cutucadaEm: minutosAntes(30) })] });
  assert.equal(calada.acao, "perguntar");
  assert.equal(calada.situacao, "caida");
  // Cutucada desta queda há pouco: espera.
  const dentro = maestra(r.dir, { agora: AGORA, filhas: [condutora("s1", "F1", "FAILED", { caidaEm: minutosAntes(3), cutucadaEm: minutosAntes(2) })] });
  assert.equal(dentro.acao, "esperar");
  assert.equal(dentro.motivo, "condutora-viva");
});

test("condutora bloqueada: pergunta condutora-caida já, sem cutucar nem esperar o prazo", (t) => {
  const r = novoRepo(t);
  for (const extra of [{ statusBucket: "blocked" }, {}]) {
    const estado = extra.statusBucket ? "RUNNING" : "SESSION_STATUS_REQUIRES_ACTION";
    const p = maestra(r.dir, { agora: AGORA, filhas: [condutora("s1", "F1", estado, extra)] });
    assert.equal(p.acao, "perguntar", JSON.stringify(extra));
    assert.equal(p.motivo, "condutora-caida");
    assert.equal(p.situacao, "bloqueada");
    assert.equal(p.sessao, "s1");
  }
});

test("condutora viva com fase fora do plano: pergunta condutora-caida, nunca espera por ela", (t) => {
  const r = novoRepo(t);
  const p = maestra(r.dir, { agora: AGORA, filhas: [condutora("s9", "F7")] });
  assert.equal(p.acao, "perguntar");
  assert.equal(p.motivo, "condutora-caida");
  assert.equal(p.situacao, "fase-fora-do-plano");
  assert.equal(p.fase, "F7");
  // A sessão de fechamento (`ciclo`) não é fase do plano e não entra.
  r.encerrar("F1");
  r.encerrar("F2");
  r.encerrar("ciclo");
  const f = maestra(r.dir, { agora: AGORA, filhas: [condutora("s3", "ciclo")] });
  assert.equal(f.acao, "esperar");
  assert.equal(f.motivo, "condutora-viva");
});

test("vigia da condutora: FAILED só no estado, bucket minúsculo e fechamento sem o ciclo encerrado", (t) => {
  const r = novoRepo(t);
  // Sem `statusBucket`, o estado FAILED basta; o bucket vem normalizado.
  for (const c of [condutora("s1", "F1", "FAILED"), condutora("s1", "F1", "RUNNING", { statusBucket: "failed" })]) {
    const a = maestra(r.dir, { agora: AGORA, filhas: [c] });
    assert.equal(a.acao, "cutucar", JSON.stringify(c));
    assert.equal(a.motivo, "condutora-falhou");
  }
  // Duas quedas cutucadas da mesma condutora: perguntas com nonces diferentes.
  const caida = (min) => maestra(r.dir, { agora: AGORA, filhas: [condutora("s1", "F1", "FAILED", { cutucadaEm: minutosAntes(min) })] });
  const p1 = caida(30);
  const p2 = caida(60);
  assert.equal(p1.situacao, "caida");
  assert.notEqual(p1.nonce, p2.nonce);
  // A sessão de fechamento viva sem `Conducao-Encerrada: ciclo` não tem marca que a encerre.
  const f = maestra(r.dir, { agora: AGORA, filhas: [condutora("s3", "ciclo")] });
  assert.equal(f.acao, "perguntar");
  assert.equal(f.situacao, "fase-fora-do-plano");
});
