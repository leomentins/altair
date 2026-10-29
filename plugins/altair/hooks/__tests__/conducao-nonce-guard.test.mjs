// Testes do conducao-nonce-guard (VEGA-22 T15, AC-VEGA22-3): ação de sessão da maestra sem o
// nonce da última ação emitida vira divergência no log, e em shadow nunca bloqueia.
// O log de eventos do ciclo é gravado pelo próprio `log-eventos.mjs` (T13), para a forma lida
// pelo hook ser a que a condução grava. O hook roda como subprocesso, JSON no stdin.
//
// Rodar: node --test .claude/hooks/__tests__/conducao-nonce-guard.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registrar } from "../../scripts/conducao/log-eventos.mjs";

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "conducao-nonce-guard.js");
const CRIAR = "mcp__claude-code-remote__create_session";
const MENSAGEM = "mcp__claude-code-remote__send_message";
const ARQUIVAR = "mcp__claude-code-remote__archive_session";
const CICLO = "VEGA-99-prova";
const N1 = "0123456789abcdef";
const N2 = "fedcba9876543210";

function ambiente(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "nonce-guard-"));
  const log = path.join(dir, "log");
  const projeto = path.join(dir, "projeto");
  mkdirSync(path.join(projeto, ".claude", "state"), { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const emitir = (saida) => registrar({ ciclo: CICLO, ...saida }, { procedencia: "intencao", pasta: log });
  // `pedido` = a primeira mensagem de usuário do transcript (o nascimento da sessão); sem ele o
  // payload não traz transcript, como nas chamadas da maestra lidas até aqui.
  const rodar = (tool_name, tool_input, { pedido, raw } = {}) => {
    const env = { ...process.env, ALTAIR_CONDUCAO_LOG_DIR: log, CLAUDE_PROJECT_DIR: projeto };
    let transcript_path;
    if (pedido !== undefined) {
      transcript_path = path.join(dir, "transcript.jsonl");
      writeFileSync(transcript_path, JSON.stringify({ type: "user", message: { role: "user", content: pedido } }) + "\n");
    }
    const r = spawnSync(process.execPath, [HOOK], { input: raw ?? JSON.stringify({ tool_name, tool_input, transcript_path }), encoding: "utf8", env });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const linhas = () => {
    const f = path.join(log, "conducao-nonce-guard.log");
    return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  const modo = (m) => writeFileSync(path.join(projeto, ".claude", "state", "conducao-nonce-guard-mode"), `${m}\n`);
  return { emitir, rodar, linhas, modo, log, projeto };
}

const abrir = { acao: "abrir", fase: "F2", tarefas: [{ task: "T4", tentativa: 1, nonce: N1 }] };

test("acao da maestra sem nonce do script vira divergencia registrada e nao bloqueia", (t) => {
  const a = ambiente(t);
  a.emitir(abrir);
  const r = a.rodar(CRIAR, { environment_id: "env_x", prompt: "faça a task, sem nonce nenhum" });
  assert.equal(r.status, 0, "shadow nunca bloqueia");
  assert.equal(r.stdout, "", "não emite decisão de permissão — quem decide são os outros hooks");
  assert.match(r.stderr, /CONDUCAO-NONCE \[shadow\] create_session: sem-nonce/);
  const [l] = a.linhas();
  assert.equal(l.resultado, "divergencia");
  assert.equal(l.motivo, "sem-nonce");
  assert.equal(l.ferramenta, "create_session");
  assert.deepEqual(l.esperados, [{ ciclo: CICLO, acao: "abrir", nonces: [N1] }]);
});

test("nonce certo no brief passa calado e grava ok", (t) => {
  const a = ambiente(t);
  a.emitir(abrir);
  const r = a.rodar(CRIAR, { environment_id: "env_x", prompt: `## contrato da operária — T4 · nonce \`${N1}\`\n…` });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "", "passe é calado");
  const [l] = a.linhas();
  assert.equal(l.resultado, "ok", "o passe também grava linha — log vazio nunca é 'tudo conforme'");
  assert.equal(l.nonce, N1);
  assert.equal(l.ciclo, CICLO);
});

test("nonce de outra acao vira divergencia nonce-diferente", (t) => {
  const a = ambiente(t);
  a.emitir(abrir);
  const r = a.rodar(MENSAGEM, { session_id: "session_y", message: `T4 segue · ${N2}` });
  assert.equal(r.status, 0);
  const [l] = a.linhas();
  assert.equal(l.resultado, "divergencia");
  assert.equal(l.motivo, "nonce-diferente");
  assert.deepEqual(l.vistos, [N2]);
});

test("vale so a ultima acao emitida: nonce de acao anterior diverge", (t) => {
  const a = ambiente(t);
  a.emitir(abrir);
  a.emitir({ acao: "esperar", fase: "F2", nonce: N2, motivo: "filhas-em-voo" });
  a.rodar(CRIAR, { prompt: `nonce \`${N1}\`` });
  assert.equal(a.linhas()[0].motivo, "nonce-diferente");
});

test("archive_session da sessao emitida em arquivar conta ok pela sessao", (t) => {
  const a = ambiente(t);
  a.emitir({ acao: "arquivar", nonce: N2, sessao: "session_filha1", task: "T4", tentativa: 1, nonceTentativa: N1 });
  const r = a.rodar(ARQUIVAR, { session_id: "session_filha1" });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  const [l] = a.linhas();
  assert.equal(l.resultado, "ok");
  assert.equal(l.via, "sessao");
  const outra = a.rodar(ARQUIVAR, { session_id: "session_outra" });
  assert.match(outra.stderr, /sem-nonce/);
  assert.equal(a.linhas()[1].resultado, "divergencia");
});

test("input sem campo texto grava forma-desconhecida com as chaves e nunca os valores", (t) => {
  const a = ambiente(t);
  a.emitir(abrir);
  const r = a.rodar(CRIAR, { opcoes: { capacidade: 3, ativo: true } });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  const [l] = a.linhas();
  assert.equal(l.resultado, "forma-desconhecida");
  assert.deepEqual(l.chaves, ["opcoes", "opcoes.capacidade", "opcoes.ativo"]);
});

test("o texto do input nunca entra no log", (t) => {
  const a = ambiente(t);
  a.emitir(abrir);
  a.rodar(CRIAR, { prompt: `paciente Fulano de Tal, laudo sigiloso, nonce ${N1}` });
  const bruto = readFileSync(path.join(a.log, "conducao-nonce-guard.log"), "utf8");
  assert.doesNotMatch(bruto, /Fulano|laudo/);
  assert.match(bruto, /"chaves":\["prompt"\]/);
});

test("em hard a divergencia bloqueia; sem acao emitida nunca bloqueia", (t) => {
  const a = ambiente(t);
  a.modo("hard");
  const semConducao = a.rodar(MENSAGEM, { session_id: "session_y", message: "oi" });
  assert.equal(semConducao.status, 0, "sem condução viva a sessão não é maestra");
  assert.equal(a.linhas()[0].motivo, "sem-acao-emitida");
  a.emitir(abrir);
  assert.equal(a.rodar(CRIAR, { prompt: "sem nonce" }).status, 2);
  assert.equal(a.rodar(CRIAR, { prompt: `nonce ${N1}` }).status, 0);
});

test("off nao julga nem grava", (t) => {
  const a = ambiente(t);
  a.modo("off");
  a.emitir(abrir);
  assert.equal(a.rodar(CRIAR, { prompt: "sem nonce" }).status, 0);
  assert.deepEqual(a.linhas(), []);
});

test("sessao de filha fica fora do alcance", (t) => {
  const a = ambiente(t);
  a.emitir(abrir);
  const r = a.rodar(MENSAGEM, { session_id: "@parent", message: `T4-OK 1234abcd ${N1}` }, { pedido: `## contrato da operária — T4 · nonce \`${N1}\`\n\nVocê é a operária…` });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  assert.deepEqual(a.linhas(), []);
});

test("sessao que nasceu de pedido de Rita e julgada como maestra, mesmo usuario da filha", (t) => {
  const a = ambiente(t);
  a.emitir(abrir);
  const r = a.rodar(CRIAR, { prompt: "sem nonce" }, { pedido: "Conduzir VEGA-99-prova — F2" });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /sem-nonce/);
  assert.equal(a.linhas()[0].motivo, "sem-nonce");
});

test("ferramenta fora das tres nao grava; payload ilegivel grava erro e libera", (t) => {
  const a = ambiente(t);
  a.emitir(abrir);
  assert.equal(a.rodar("Bash", { command: "ls" }).status, 0);
  assert.deepEqual(a.linhas(), []);
  assert.equal(a.rodar(null, null, { raw: "{nao é json" }).status, 0);
  assert.equal(a.linhas()[0].resultado, "erro");
});

// ── modo pela declaração do adaptador ────────────────────────────────────────
// O guard lê o `<guard>-mode` na pasta que a declaração do projeto aponta (`guardas.pastaDoModo`).
// Sem o campo, ou sem o arquivo, roda em shadow: o plugin não supõe pasta de estado de projeto.

/** Declaração do projeto de teste no repositório da fixture, com `guardas` trocado (`undefined` tira). */
function declarar(projeto, guardas) {
  const d = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "conducao", "__tests__", "fixtures", "projeto-de-teste", ".altair", "adaptador.json"), "utf8"));
  if (guardas === undefined) delete d.guardas;
  else d.guardas = guardas;
  mkdirSync(path.join(projeto, ".altair"), { recursive: true });
  writeFileSync(path.join(projeto, ".altair", "adaptador.json"), JSON.stringify(d));
}

test("mode-file ausente na pasta declarada: shadow, a divergencia so grava", (t) => {
  const a = ambiente(t);
  a.emitir(abrir);
  const r = a.rodar(CRIAR, { prompt: "sem nonce" });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /CONDUCAO-NONCE \[shadow\]/);
  assert.equal(a.linhas()[0].modo, "shadow");
});

test("sem o campo guardas na declaracao, o mode-file hard nao vale: shadow", (t) => {
  const a = ambiente(t);
  declarar(a.projeto);
  a.modo("hard");
  a.emitir(abrir);
  const r = a.rodar(CRIAR, { prompt: "sem nonce" });
  assert.equal(r.status, 0, "sem o campo o guard nao sabe onde ler o modo");
  assert.match(r.stderr, /CONDUCAO-NONCE \[shadow\]/);
  assert.equal(a.linhas()[0].modo, "shadow");
});

test("o campo guardas aponta a pasta: hard la bloqueia, hard fora dela nao", (t) => {
  const a = ambiente(t);
  declarar(a.projeto, { pastaDoModo: "config/guardas" });
  a.modo("hard"); // em .claude/state, fora da pasta declarada
  a.emitir(abrir);
  assert.equal(a.rodar(CRIAR, { prompt: "sem nonce" }).status, 0);
  mkdirSync(path.join(a.projeto, "config", "guardas"), { recursive: true });
  writeFileSync(path.join(a.projeto, "config", "guardas", "conducao-nonce-guard-mode"), "hard\n");
  assert.equal(a.rodar(CRIAR, { prompt: "sem nonce" }).status, 2);
  assert.equal(a.rodar(CRIAR, { prompt: `nonce ${N1}` }).status, 0);
});
