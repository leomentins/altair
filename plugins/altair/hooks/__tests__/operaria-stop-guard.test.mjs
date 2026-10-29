// Testes do operaria-stop-guard (VEGA-22 T15): a operária conduzida não encerra sem commit da
// task desde o marcador da tentativa nem aviso FALHA devolvido à maestra; com um dos dois, encerra.
// Repo git de verdade (marcador e commits) e transcript JSONL na forma do Claude Code; o hook
// roda como subprocesso, JSON no stdin. Quem é operária sai do PEDIDO de nascimento no transcript
// (`lib/sessao-operaria.js`), não do usuário do SO (decisao/filha-herdeira-da-maestra): o
// transcript da fixture é o ponto de troca.
//
// Rodar: node --test .claude/hooks/__tests__/operaria-stop-guard.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "operaria-stop-guard.js");
const NONCE = "0123456789abcdef";
const CICLO = "VEGA-99-prova";

// `modo`: conteúdo do mode-file no projeto da fixture; `null` = mode-file ausente. Os testes do
// julgamento rodam em `hard` (o comportamento que recusa); os de modo, no fim, cobrem o shadow.
function ambiente(t, { task = "T15", modo = "hard" } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "stop-guard-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const projeto = path.join(dir, "projeto");
  const modeFile = path.join(projeto, ".claude", "state", "operaria-stop-guard-mode");
  mkdirSync(path.dirname(modeFile), { recursive: true });
  if (modo !== null) writeFileSync(modeFile, `${modo}\n`);
  const repo = path.join(dir, "repo");
  const g = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", HUSKY: "0" } });
  execFileSync("git", ["init", "-q", repo]);
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  g("config", "core.hooksPath", "/dev/null");
  const commit = (subject) => g("commit", "-q", "--allow-empty", "-m", subject);
  commit("base");
  const transcript = path.join(dir, "t.jsonl");
  const entradas = [
    { type: "user", message: { role: "user", content: `## contrato da operária — ${task} · nonce \`${NONCE}\`\n\nVocê é a operária…` } },
  ];
  const salvar = () => writeFileSync(transcript, entradas.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const avisar = (message, session_id = "@parent") =>
    entradas.push({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "tool_use", id: "x", name: "mcp__claude-code-remote__send_message", input: { session_id, message } }] },
    });
  const responder = (texto) =>
    entradas.push({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: texto }] } });
  const log = path.join(dir, "log");
  let stderr = "";
  const rodar = ({ sessao = "s1", logDir = log, ultima, transcript: caminho = transcript } = {}) => {
    salvar();
    const env = { ...process.env, ALTAIR_CONDUCAO_LOG_DIR: logDir, CLAUDE_PROJECT_DIR: projeto };
    const r = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ session_id: sessao, transcript_path: caminho, cwd: repo, hook_event_name: "Stop", stop_hook_active: false, ...(ultima === undefined ? {} : { last_assistant_message: ultima }) }),
      encoding: "utf8",
      env,
    });
    assert.equal(r.status, 0, r.stderr);
    stderr = r.stderr;
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  };
  const linhas = () => {
    const f = path.join(log, "operaria-stop-guard.log");
    return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  };
  return { dir, modeFile, commit, avisar, responder, rodar, linhas, entradas, stderr: () => stderr, marcador: (t2 = task) => commit(`Conducao: abrir ${t2} tentativa 1 nonce ${NONCE}`) };
}

test("operaria nao encerra sem commit da task nem pergunta devolvida", (t) => {
  const a = ambiente(t);
  a.marcador();
  const saida = a.rodar();
  assert.equal(saida?.decision, "block");
  assert.match(saida.reason, /T15-FALHA pergunta 0123456789abcdef/);
  const [l] = a.linhas();
  assert.equal(l.resultado, "bloqueado");
  assert.equal(l.motivo, "sem-commit-da-task");
});

test("commit da task depois do marcador permite encerrar", (t) => {
  const a = ambiente(t);
  a.marcador();
  a.commit(`${CICLO}-F2/T15 — hooks inertes`);
  assert.equal(a.rodar(), null);
  assert.equal(a.linhas()[0].motivo, "commit-da-task");
});

test("subject com ponto antes do T tambem conta", (t) => {
  const a = ambiente(t);
  a.marcador();
  a.commit(`${CICLO}-F2.T15 — hooks inertes`);
  assert.equal(a.rodar(), null);
});

test("pergunta devolvida a maestra permite encerrar", (t) => {
  const a = ambiente(t);
  a.marcador();
  a.avisar(`T15-FALHA pergunta ${NONCE}\nO plano manda X, o código tem Y.`);
  assert.equal(a.rodar(), null);
  assert.equal(a.linhas()[0].motivo, "devolvida-a-maestra");
});

test("pergunta na primeira linha da resposta final permite encerrar sem send_message", (t) => {
  const a = ambiente(t);
  a.marcador();
  a.responder(`T15-FALHA pergunta ${NONCE}\nO plano manda X, o código tem Y.`);
  assert.equal(a.rodar(), null);
  assert.equal(a.linhas()[0].motivo, "devolvida-a-maestra");
});

test("FALHA numa resposta anterior seguida de outra resposta final nao conta", (t) => {
  const a = ambiente(t);
  a.marcador();
  a.responder(`T15-FALHA pergunta ${NONCE}`);
  a.responder("Retomei e sigo trabalhando.");
  assert.equal(a.rodar()?.decision, "block");
});

test("FALHA no meio do trabalho seguida so de chamada de ferramenta nao conta", (t) => {
  const a = ambiente(t);
  a.marcador();
  a.responder(`T15-FALHA pergunta ${NONCE}`);
  a.entradas.push({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "y", name: "Bash", input: { command: "ls" } }] } });
  assert.equal(a.rodar()?.decision, "block");
});

test("last_assistant_message do payload substitui a resposta do transcript", (t) => {
  const a = ambiente(t);
  a.marcador();
  a.responder(`T15-FALHA pergunta ${NONCE}`);
  assert.equal(a.rodar({ ultima: "Ainda trabalhando." })?.decision, "block", "payload diz que a final não é FALHA");
  const b = ambiente(t);
  b.marcador();
  assert.equal(b.rodar({ ultima: `T15-FALHA conflito ${NONCE}\ndetalhe` }), null);
});

test("aviso com outro nonce, outra task ou outro destino nao conta", (t) => {
  const a = ambiente(t);
  a.marcador();
  a.avisar("T15-FALHA pergunta ffffffffffffffff");
  a.avisar(`T14-FALHA pergunta ${NONCE}`);
  a.avisar(`T15-FALHA pergunta ${NONCE}`, "session_outra");
  a.avisar(`T15-OK 1234abcd ${NONCE}`);
  assert.equal(a.rodar()?.decision, "block", "OK sem commit não é entrega");
});

test("commit de outra task ou anterior ao marcador nao conta", (t) => {
  const a = ambiente(t);
  a.commit(`${CICLO}-F2/T15 — de antes da tentativa`);
  a.marcador();
  a.commit(`${CICLO}-F2/T1 — outra task`);
  a.commit(`${CICLO}-F2/T150 — outra task`);
  assert.equal(a.rodar()?.decision, "block");
});

test("HEAD fora do marcador da tentativa recusa e diz que o checkout nao foi feito", (t) => {
  const a = ambiente(t);
  a.commit(`${CICLO}-F2/T15 — sem partir do marcador`);
  const saida = a.rodar();
  assert.equal(saida?.decision, "block");
  assert.match(saida.reason, /não descende do marcador/);
  assert.equal(a.linhas()[0].motivo, "fora-do-marcador");
});

test("sessao sem contrato da operaria nao e julgada nem grava", (t) => {
  const a = ambiente(t);
  a.marcador();
  a.entradas[0].message.content = "uma conversa qualquer";
  assert.equal(a.rodar(), null);
  assert.deepEqual(a.linhas(), [], "o Stop corre em toda sessão do usuário: sessão comum não deixa linha");
});

test("contrato fora do pedido de nascimento nao faz operaria (resumo de compactacao, brief colado)", (t) => {
  const a = ambiente(t);
  a.marcador();
  const contrato = a.entradas[0].message.content;
  a.entradas[0].message.content = "Conduzir VEGA-99-prova — F2";
  a.entradas.push({ type: "user", isCompactSummary: true, message: { role: "user", content: contrato } });
  a.entradas.push({ type: "user", message: { role: "user", content: contrato } });
  assert.equal(a.rodar(), null);
  assert.deepEqual(a.linhas(), []);
});

test("transcript ilegivel grava erro transcript-ilegivel e libera, nunca sai calado", (t) => {
  const a = ambiente(t);
  a.marcador();
  // diretório no lugar do transcript: abre, mas a leitura falha (EISDIR)
  assert.equal(a.rodar({ transcript: a.dir }), null);
  const [l] = a.linhas();
  assert.equal(l.resultado, "erro");
  assert.equal(l.motivo, "transcript-ilegivel");
  assert.match(a.stderr(), /transcript ilegível/);
  // caminho que não existe: o mesmo
  assert.equal(a.rodar({ transcript: path.join(a.dir, "nao-existe.jsonl") }), null);
  assert.equal(a.linhas().at(-1).motivo, "transcript-ilegivel");
});

test("eco de comando e mensagem meta antes do pedido nao tiram a operaria", (t) => {
  const a = ambiente(t);
  a.marcador();
  a.entradas.unshift(
    { type: "user", isMeta: true, message: { role: "user", content: "<local-command-caveat>x</local-command-caveat>" } },
    { type: "user", message: { role: "user", content: "<command-name>/clear</command-name>" } },
    { type: "attachment" },
  );
  assert.equal(a.rodar()?.decision, "block");
});

test("recusa no maximo tres vezes por sessao e libera a quarta com liberado-teto", (t) => {
  const a = ambiente(t);
  a.marcador();
  for (let i = 0; i < 3; i++) assert.equal(a.rodar()?.decision, "block");
  assert.equal(a.rodar(), null);
  assert.equal(a.linhas().at(-1).resultado, "liberado-teto");
  assert.equal(a.rodar({ sessao: "s2" })?.decision, "block", "o teto é por sessão");
});

test("log que nao grava nem le libera o encerramento e avisa, em vez de recusar sem teto", (t) => {
  const a = ambiente(t);
  a.marcador();
  // Pasta do log embaixo de um arquivo: mkdir, leitura e escrita falham (ENOTDIR).
  writeFileSync(path.join(a.dir, "arquivo"), "x\n");
  const logDir = path.join(a.dir, "arquivo", "log");
  assert.equal(a.rodar({ logDir }), null);
  assert.match(a.stderr(), /operaria-stop-guard: log ilegível .* libera/);
});

test("mode-file ausente, shadow ou valor desconhecido: grava teria-bloqueado e libera sem decisao", (t) => {
  for (const modo of [null, "shadow", "qualquer-coisa"]) {
    const a = ambiente(t, { modo });
    a.marcador();
    assert.equal(a.rodar(), null, `modo ${modo}`);
    const [l] = a.linhas();
    assert.equal(l.resultado, "teria-bloqueado", `modo ${modo}`);
    assert.equal(l.motivo, "sem-commit-da-task");
    assert.equal(l.modo, "shadow");
    assert.equal(l.modo_lido, modo === null ? "ausente" : modo, "o valor cru prova pelo log qual mode-file foi lido");
  }
});

test("shadow tambem registra o fim fora do marcador da tentativa", (t) => {
  const a = ambiente(t, { modo: null });
  assert.equal(a.rodar(), null);
  const [l] = a.linhas();
  assert.equal(l.resultado, "teria-bloqueado");
  assert.equal(l.motivo, "fora-do-marcador");
});

test("linha de hard carrega o modo lido", (t) => {
  const a = ambiente(t);
  a.marcador();
  assert.equal(a.rodar()?.decision, "block");
  assert.equal(a.linhas()[0].modo, "hard");
  assert.equal(a.linhas()[0].modo_lido, "hard");
});

test("shadow nao conta no teto: hard depois de quatro shadow ainda recusa", (t) => {
  const a = ambiente(t, { modo: "shadow" });
  a.marcador();
  for (let i = 0; i < 4; i++) assert.equal(a.rodar(), null);
  writeFileSync(a.modeFile, "hard\n");
  assert.equal(a.rodar()?.decision, "block");
  assert.equal(a.linhas().at(-1).resultado, "bloqueado");
});

test("shadow no caminho que libera grava o mesmo que hard", (t) => {
  const a = ambiente(t, { modo: null });
  a.marcador();
  a.commit(`${CICLO}-F1/T15 — entrega`);
  assert.equal(a.rodar(), null);
  assert.equal(a.linhas()[0].resultado, "liberado");
});

test("shadow sem log avisa no stderr em vez de sair calado", (t) => {
  const a = ambiente(t, { modo: null });
  a.marcador();
  writeFileSync(path.join(a.dir, "arquivo"), "x\n");
  assert.equal(a.rodar({ logDir: path.join(a.dir, "arquivo", "log") }), null);
  assert.match(a.stderr(), /shadow sem log .* teria recusado T15/);
});

// ── modo pela declaração do adaptador ────────────────────────────────────────

/** Declaração do projeto de teste no projeto da fixture, com `guardas` trocado (`undefined` tira). */
function declarar(projeto, guardas) {
  const d = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "conducao", "__tests__", "fixtures", "projeto-de-teste", ".altair", "adaptador.json"), "utf8"));
  if (guardas === undefined) delete d.guardas;
  else d.guardas = guardas;
  mkdirSync(path.join(projeto, ".altair"), { recursive: true });
  writeFileSync(path.join(projeto, ".altair", "adaptador.json"), JSON.stringify(d));
}

test("sem o campo guardas na declaracao, o mode-file hard nao vale: shadow, com sem-campo no log", (t) => {
  const a = ambiente(t, { modo: "hard" });
  declarar(path.dirname(path.dirname(path.dirname(a.modeFile))));
  a.marcador();
  assert.equal(a.rodar(), null, "sem o campo o guard nao recusa");
  const [l] = a.linhas();
  assert.equal(l.resultado, "teria-bloqueado");
  assert.equal(l.modo, "shadow");
  assert.equal(l.modo_lido, "sem-campo");
});

test("o campo guardas aponta a pasta: hard la recusa o fim", (t) => {
  const a = ambiente(t, { modo: null });
  const projeto = path.dirname(path.dirname(path.dirname(a.modeFile)));
  declarar(projeto, { pastaDoModo: "config/guardas" });
  mkdirSync(path.join(projeto, "config", "guardas"), { recursive: true });
  writeFileSync(path.join(projeto, "config", "guardas", "operaria-stop-guard-mode"), "hard\n");
  a.marcador();
  assert.equal(a.rodar()?.decision, "block");
  assert.equal(a.linhas()[0].modo_lido, "hard");
});
