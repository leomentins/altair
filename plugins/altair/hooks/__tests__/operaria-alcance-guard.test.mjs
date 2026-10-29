// Testes do operaria-alcance-guard (ruling 3a, 13/10/2026): a operária arquiva só a si mesma e
// escreve só para "@parent"; a sessão provada comum arquiva e escreve para qualquer uma (ruling
// F4.8b, 23/10/2026); dentro disso o hook devolve `allow`, fora devolve `ask`, e nenhum caminho
// sai sem decisão.
// Prova viva = hook invocado direto com JSON no stdin — nenhuma sessão real é tocada.
//
// Rodar: node --test hooks/__tests__/operaria-alcance-guard.test.mjs

import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "operaria-alcance-guard.js");
const ARQUIVAR = "mcp__claude-code-remote__archive_session";
const MENSAGEM = "mcp__claude-code-remote__send_message";
const RAIZ = "/srv/x/projeto/.claude/worktrees/bridge-cse_01AbC123";
const EU = "session_01AbC123";

import os from "node:os";

// Log de condução isolado por teste: o hook não lê mais a última ação emitida (F4.8b), e o teste
// "a ação `arquivar` emitida não alarga a operária" prova que o log não decide; o log real da
// estação nunca pode decidir um teste.
const LOG_VAZIO = fs.mkdtempSync(path.join(os.tmpdir(), "alcance-log-"));

function logCom(linhas) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "alcance-log-"));
  fs.writeFileSync(
    path.join(d, "CICLO-1-teste.jsonl"),
    linhas.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n",
  );
  return d;
}

function intencao(acao, sessao, atributos = {}, quando = new Date().toISOString()) {
  return {
    linha: "evento",
    procedencia: "intencao",
    acao,
    objetos: sessao ? [{ id: `sessao:${sessao}`, tipo: "sessao", qualificador: "alvo" }] : [],
    atributos,
    quando,
  };
}

/** Transcript cujo pedido de nascimento é `pedido` (o brief da condução faz operária). */
function transcriptCom(pedido) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "alcance-transcript-"));
  const f = path.join(d, "t.jsonl");
  fs.writeFileSync(f, JSON.stringify({ type: "user", message: { role: "user", content: pedido } }) + "\n");
  return f;
}

// Transcript da maestra (nasceu de pedido de Rita): a liberação da condução exige leitura positiva.
const MAESTRA = transcriptCom("Conduzir CICLO-1-teste — F1");
// Transcript de operária: o raio estreito (a si mesma e @parent) é o padrão dos testes abaixo;
// a sessão comum (MAESTRA) tem o raio largo do ruling F4.8b, testado no fim.
const OPERARIA = transcriptCom(`## contrato da operária — T4 · nonce \`${"b".repeat(16)}\`\n\nVocê é a operária…`);

function run(tool_name, tool_input, { raiz = RAIZ, cwd = RAIZ, raw, logDir = LOG_VAZIO, transcript_path = OPERARIA } = {}) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (raiz !== null) env.CLAUDE_PROJECT_DIR = raiz;
  env.ALTAIR_CONDUCAO_LOG_DIR = logDir;
  const r = spawnSync(process.execPath, [HOOK], {
    input: raw ?? JSON.stringify({ tool_name, tool_input, cwd, transcript_path }),
    encoding: "utf8",
    env,
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = r.stdout.trim();
  assert.ok(out, "o hook saiu sem decisão");
  return JSON.parse(out).hookSpecificOutput.permissionDecision;
}

test("arquivar a si mesma é permitido", () => {
  assert.strictEqual(run(ARQUIVAR, { session_id: EU }), "allow");
  assert.strictEqual(
    run(ARQUIVAR, { session_id: EU }, { raiz: `${RAIZ}/` }),
    "allow",
  );
});

test("arquivar a si mesma com raiz Windows é permitido", () => {
  assert.strictEqual(
    run(
      ARQUIVAR,
      { session_id: EU },
      { raiz: "D:\\\\projeto\\\\.claude\\worktrees\\bridge-cse_01AbC123" },
    ),
    "allow",
  );
});

test("o id vem da raiz do projeto, nunca do cwd (cd para a worktree de outra sessão)", () => {
  const vitima = "/srv/x/projeto/.claude/worktrees/bridge-cse_01Vitima";
  assert.strictEqual(
    run(ARQUIVAR, { session_id: "session_01Vitima" }, { cwd: vitima }),
    "ask",
  );
  assert.strictEqual(
    run(ARQUIVAR, { session_id: EU }, { cwd: "/tmp/qualquer" }),
    "allow",
  );
});

test("arquivar outra sessão pergunta", () => {
  assert.strictEqual(run(ARQUIVAR, { session_id: "session_01Outra" }), "ask");
});

test("arquivar com id que só começa igual ao próprio pergunta", () => {
  assert.strictEqual(run(ARQUIVAR, { session_id: `${EU}X` }), "ask");
  assert.strictEqual(
    run(ARQUIVAR, { session_id: EU }, { raiz: `${RAIZ}X` }),
    "ask",
  );
  assert.strictEqual(
    run(ARQUIVAR, { session_id: EU }, { raiz: `${RAIZ}-copia` }),
    "ask",
  );
});

test("raiz que só CONTÉM a worktree de sessão, sem terminar nela, pergunta", () => {
  assert.strictEqual(
    run(ARQUIVAR, { session_id: EU }, { raiz: `${RAIZ}/apps/web` }),
    "ask",
  );
});

test("arquivar sem saber quem é pergunta", () => {
  assert.strictEqual(run(ARQUIVAR, { session_id: EU }, { raiz: null }), "ask");
  assert.strictEqual(
    run(ARQUIVAR, { session_id: EU }, { raiz: "/srv/x/projeto" }),
    "ask",
  );
  assert.strictEqual(
    run(
      ARQUIVAR,
      { session_id: EU },
      { raiz: "/srv/x/projeto-worktrees/bridge-cse_01AbC123" },
    ),
    "ask",
  );
});

test("arquivar sem id ou com id de outro tipo pergunta", () => {
  assert.strictEqual(run(ARQUIVAR, {}), "ask");
  assert.strictEqual(run(ARQUIVAR, { session_id: [EU] }), "ask");
  assert.strictEqual(run(ARQUIVAR, { session_id: { id: EU } }), "ask");
  assert.strictEqual(run(ARQUIVAR, null), "ask");
});

test("mensagem para @parent com texto é permitida", () => {
  assert.strictEqual(
    run(MENSAGEM, { session_id: "@parent", message: "ok" }),
    "allow",
  );
});

test("mensagem para id explícito pergunta, mesmo que seja o pai", () => {
  assert.strictEqual(
    run(MENSAGEM, { session_id: "session_01Pai", message: "ok" }),
    "ask",
  );
});

test("mensagem para @parent com QUALQUER chave além de session_id e message pergunta", () => {
  for (const extra of [
    { to: "parent" },
    { visibility: "posted_to_shared_channel" },
    { slack_message_ts: "1.2" },
    { attachments: [{ file_uuid: "f" }] },
    { in_reply_to: "1.2" },
    { thread_ts: "1.2" },
    { priority: "now" },
    { channel: "C1" },
    { campo_que_ainda_nao_existe: true },
  ]) {
    assert.strictEqual(
      run(MENSAGEM, { session_id: "@parent", message: "ok", ...extra }),
      "ask",
      JSON.stringify(extra),
    );
  }
});

test("mensagem sem alvo ou sem texto pergunta", () => {
  assert.strictEqual(run(MENSAGEM, { message: "ok" }), "ask");
  assert.strictEqual(run(MENSAGEM, { session_id: "@parent" }), "ask");
  assert.strictEqual(
    run(MENSAGEM, { session_id: "@parent", message: { texto: "x" } }),
    "ask",
  );
});

test("ferramenta que não é nenhuma das três pergunta (matcher alargado por engano)", () => {
  assert.strictEqual(run("mcp__claude-code-remote__get_session", {}), "ask");
  assert.strictEqual(run("Read", { file_path: "/etc/hosts" }), "ask");
});

test("entrada vazia, nula ou ilegível pergunta", () => {
  for (const raw of ["", "null", "[]", "{}", "{nao-json"]) {
    assert.strictEqual(run(null, null, { raw }), "ask", JSON.stringify(raw));
  }
});

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lerJson = (rel) => JSON.parse(fs.readFileSync(path.join(PLUGIN, rel), "utf8"));

test("o hooks.json do plugin liga o hook às duas ferramentas e a nenhuma outra", () => {
  const s = lerJson("hooks/hooks.json");
  const blocos = s.hooks.PreToolUse.filter((b) =>
    (b.hooks || []).some((h) =>
      String(h.command).includes("operaria-alcance-guard.js"),
    ),
  );
  assert.strictEqual(blocos.length, 1);
  assert.ok(
    blocos[0].hooks[0].command.includes("${CLAUDE_PLUGIN_ROOT}/hooks/operaria-alcance-guard.js"),
    "o comando aponta para dentro do plugin",
  );
  const rx = new RegExp(`^(?:${blocos[0].matcher})$`);
  assert.ok(rx.test(ARQUIVAR));
  assert.ok(rx.test(MENSAGEM));
  assert.ok(rx.test("Bash"), "o push de aviso da operária passa pelo Bash");
  for (const outra of [
    "mcp__claude-code-remote__get_session",
    "mcp__claude-code-remote__create_session",
    "mcp__claude-code-remote__list_sessions",
  ]) {
    assert.ok(!rx.test(outra), outra);
  }
});

// A permissão das duas ferramentas é SÓ do hook. Se elas fossem a um allow que o plugin
// declarasse, hook que não roda (caminho relativo, timeout, node ausente) viraria allow livre.
test("archive_session e send_message ficam fora de qualquer allow do plugin — quem decide é o hook", () => {
  for (const rel of [".claude-plugin/plugin.json", "hooks/hooks.json"]) {
    const s = lerJson(rel);
    const allow = (s.permissions && s.permissions.allow) || [];
    for (const t of [ARQUIVAR, MENSAGEM]) {
      assert.ok(
        !allow.some((r) => r === t || r.startsWith(`${t}(`)),
        `${t} no allow de ${rel}`,
      );
    }
    assert.ok(!allow.some((r) => /^mcp__claude-code-remote__(\*|$)/.test(r)), rel);
  }
});

// O plugin não libera create_session: a capacidade de criar sessão vem do settings de quem o
// instala, e o matcher deste hook não cobre create_session.
test("create_session fica fora de qualquer allow do plugin (a capacidade vem do settings de quem instala)", () => {
  for (const rel of [".claude-plugin/plugin.json", "hooks/hooks.json"]) {
    const s = lerJson(rel);
    const allow = (s.permissions && s.permissions.allow) || [];
    const t = "mcp__claude-code-remote__create_session";
    assert.ok(
      !allow.some((r) => r === t || r.startsWith(`${t}(`)),
      `${t} no allow de ${rel}`,
    );
  }
});

// Re-revisão de 0c567974..197eb1af (13/10/2026).
test("arquivar a si mesma com QUALQUER chave além de session_id pergunta", () => {
  for (const extra of [
    { session_ids: ["session_01Vitima"] },
    { delete: true },
    { motivo: "x" },
  ]) {
    assert.strictEqual(
      run(ARQUIVAR, { session_id: EU, ...extra }),
      "ask",
      JSON.stringify(extra),
    );
  }
});

test("sem raiz conhecida, nem id nulo vira allow", () => {
  assert.strictEqual(
    run(ARQUIVAR, { session_id: null }, { raiz: null }),
    "ask",
  );
  assert.strictEqual(run(ARQUIVAR, {}, { raiz: "" }), "ask");
});

test("raiz relativa ou com quebra de linha não identifica a sessão", () => {
  assert.strictEqual(
    run(
      ARQUIVAR,
      { session_id: EU },
      { raiz: "x/.claude/worktrees/bridge-cse_01AbC123" },
    ),
    "ask",
  );
  assert.strictEqual(
    run(
      ARQUIVAR,
      { session_id: EU },
      { raiz: `/srv/x\n/y/.claude/worktrees/bridge-cse_01AbC123` },
    ),
    "ask",
  );
});

test("alvo que só começa com @parent pergunta", () => {
  for (const alvo of ["@parent-x", "@parent ", "@PARENT"]) {
    assert.strictEqual(
      run(MENSAGEM, { session_id: alvo, message: "ok" }),
      "ask",
      alvo,
    );
  }
});

test(
  "sem como escrever a decisão, o hook bloqueia (exit 2)",
  { skip: !fs.existsSync("/dev/full") },
  () => {
    const r = spawnSync("sh", ["-c", `node "${HOOK}" >/dev/full`], {
      input: JSON.stringify({
        tool_name: ARQUIVAR,
        tool_input: { session_id: EU },
      }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: RAIZ },
    });
    assert.strictEqual(r.status, 2);
  },
);

// ── sessão comum: raio largo (ruling F4.8b de Rita, 23/10/2026) ─────────────────────────────────

const OUTRA = "session_01Outra";

test("sessão comum arquiva outra sessão sem pergunta", () => {
  assert.strictEqual(run(ARQUIVAR, { session_id: OUTRA }, { transcript_path: MAESTRA }), "allow");
  // nem precisa saber quem é: o raio largo não depende da raiz do projeto
  assert.strictEqual(run(ARQUIVAR, { session_id: OUTRA }, { transcript_path: MAESTRA, raiz: null }), "allow");
});

test("sessão comum manda mensagem para id explícito sem pergunta", () => {
  assert.strictEqual(
    run(MENSAGEM, { session_id: OUTRA, message: "ok" }, { transcript_path: MAESTRA }),
    "allow",
  );
  assert.strictEqual(
    run(MENSAGEM, { session_id: "@parent", message: "ok" }, { transcript_path: MAESTRA }),
    "allow",
  );
});

test("operária arquiva outra sessão ⇒ pergunta", () => {
  assert.strictEqual(run(ARQUIVAR, { session_id: OUTRA }, { transcript_path: OPERARIA }), "ask");
  assert.strictEqual(run(ARQUIVAR, { session_id: EU }, { transcript_path: OPERARIA }), "allow");
});

test("operária manda mensagem para id explícito ⇒ pergunta", () => {
  assert.strictEqual(
    run(MENSAGEM, { session_id: OUTRA, message: "ok" }, { transcript_path: OPERARIA }),
    "ask",
  );
});

test("a ação `arquivar` emitida pela condução não alarga a operária", () => {
  const logDir = logCom([intencao("arquivar", OUTRA, { nonce: "a".repeat(16) })]);
  assert.strictEqual(run(ARQUIVAR, { session_id: OUTRA }, { logDir, transcript_path: OPERARIA }), "ask");
});

test("transcript ausente, ilegível ou acima do teto ⇒ raio estreito (a dúvida não libera)", () => {
  const ausente = path.join(LOG_VAZIO, "nao-existe.jsonl");
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "alcance-transcript-"));
  // 9 MB de anexos antes do pedido: acima do teto de leitura
  const grande = path.join(pasta, "grande.jsonl");
  const anexo = JSON.stringify({ type: "attachment", texto: "x".repeat(1024 * 1024) }) + "\n";
  fs.writeFileSync(grande, anexo.repeat(9) + JSON.stringify({ type: "user", message: { role: "user", content: "Conduzir X" } }) + "\n");
  for (const transcript_path of [null, ausente, pasta, grande]) {
    const rotulo = String(transcript_path);
    assert.strictEqual(run(ARQUIVAR, { session_id: OUTRA }, { transcript_path }), "ask", rotulo);
    assert.strictEqual(run(MENSAGEM, { session_id: OUTRA, message: "ok" }, { transcript_path }), "ask", rotulo);
    // o raio estreito segue valendo
    assert.strictEqual(run(ARQUIVAR, { session_id: EU }, { transcript_path }), "allow", rotulo);
    assert.strictEqual(run(MENSAGEM, { session_id: "@parent", message: "ok" }, { transcript_path }), "allow", rotulo);
  }
});

test("sessão comum com chave extra ou tipo errado ⇒ pergunta", () => {
  const t = { transcript_path: MAESTRA };
  for (const extra of [{ force: true }, { session_ids: [EU] }]) {
    assert.strictEqual(run(ARQUIVAR, { session_id: OUTRA, ...extra }, t), "ask", JSON.stringify(extra));
  }
  for (const extra of [{ priority: "now" }, { visibility: "posted_to_shared_channel" }, { campo_que_ainda_nao_existe: true }]) {
    assert.strictEqual(
      run(MENSAGEM, { session_id: OUTRA, message: "ok", ...extra }, t),
      "ask",
      JSON.stringify(extra),
    );
  }
  assert.strictEqual(run(ARQUIVAR, { session_id: [OUTRA] }, t), "ask");
  for (const vazio of ["", "  "]) {
    assert.strictEqual(run(ARQUIVAR, { session_id: vazio }, t), "ask", JSON.stringify(vazio));
    assert.strictEqual(run(MENSAGEM, { session_id: vazio, message: "ok" }, t), "ask", JSON.stringify(vazio));
  }
  assert.strictEqual(run(ARQUIVAR, {}, t), "ask");
  assert.strictEqual(run(MENSAGEM, { session_id: OUTRA }, t), "ask");
  assert.strictEqual(run(MENSAGEM, { session_id: OUTRA, message: { texto: "x" } }, t), "ask");
  assert.strictEqual(run(MENSAGEM, { session_id: { id: OUTRA }, message: "ok" }, t), "ask");
});

// ── push do aviso da operária (P22 do ATRM-51) ─────────────────────────────────────────────────

/** Saída crua do hook: `null` quando ele não decide (sai 0 sem nada no stdout). */
function decisaoOuNada(tool_name, tool_input, transcript_path) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: RAIZ, ALTAIR_CONDUCAO_LOG_DIR: LOG_VAZIO };
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name, tool_input, cwd: RAIZ, transcript_path }),
    encoding: "utf8",
    env,
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = r.stdout.trim();
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : null;
}

const NONCE_OP = "c".repeat(16);
const OPERARIA_T27 = transcriptCom(
  `## contrato da operária — T27 · nonce \`${NONCE_OP}\`\n\nVocê é a operária de **T27** do ciclo \`ATRM-51-x\`.\n` +
    `git push origin 'HEAD:refs/conducao/ATRM-51-x/T27/1'\n`,
);
const SHA_AVISO = "0123456789abcdef0123456789abcdef01234567";

test("operária empurra o aviso da própria tentativa sem pergunta", () => {
  for (const command of [
    `git push origin ${SHA_AVISO}:refs/conducao-aviso/ATRM-51-x/T27/1`,
    `git push origin '${SHA_AVISO.slice(0, 12)}:refs/conducao-aviso/ATRM-51-x/T27/1'`,
    `git push origin "${SHA_AVISO}:refs/conducao-aviso/ATRM-51-x/T27/1"`,
  ]) {
    // Antes do conserto o hook não via o Bash, e o `Bash` que chegasse a ele saía `ask`.
    assert.strictEqual(decisaoOuNada("Bash", { command }, OPERARIA_T27), "allow", command);
  }
});

test("aviso de outra tentativa, task ou ciclo pela operária pergunta", () => {
  for (const ref of ["ATRM-51-x/T27/2", "ATRM-51-x/T28/1", "OUTRO-1/T27/1"]) {
    const command = `git push origin ${SHA_AVISO}:refs/conducao-aviso/${ref}`;
    assert.strictEqual(decisaoOuNada("Bash", { command }, OPERARIA_T27), "ask", ref);
  }
});

test("push forçado, encadeado ou de outra referência não é liberado: o hook não decide", () => {
  for (const command of [
    `git push origin +${SHA_AVISO}:refs/conducao-aviso/ATRM-51-x/T27/1`,
    `git push --force origin ${SHA_AVISO}:refs/conducao-aviso/ATRM-51-x/T27/1`,
    `git push origin HEAD:refs/conducao-aviso/ATRM-51-x/T27/1`,
    `git push origin ${SHA_AVISO}:refs/conducao-aviso/ATRM-51-x/T27/1 && rm -rf /`,
    `git push origin ${SHA_AVISO}:refs/conducao-aviso/ATRM-51-x/T27/1\ngit push origin HEAD:main`,
    `git push origin ${SHA_AVISO}:refs/conducao-aviso/ATRM-51-x/T27/1 ${SHA_AVISO}:refs/heads/main`,
    `git push origin 'HEAD:refs/conducao/ATRM-51-x/T27/1'`,
    "ls",
  ]) {
    assert.strictEqual(decisaoOuNada("Bash", { command }, OPERARIA_T27), null, command);
  }
});

test("a forma do aviso em sessão que não é operária, ou ilegível, não é liberada", () => {
  const command = `git push origin ${SHA_AVISO}:refs/conducao-aviso/ATRM-51-x/T27/1`;
  assert.strictEqual(decisaoOuNada("Bash", { command }, MAESTRA), null);
  assert.strictEqual(decisaoOuNada("Bash", { command }, undefined), null);
  // contrato sem a referência da tentativa: não sabe o ciclo nem a tentativa ⇒ pergunta
  const semRef = transcriptCom(`## contrato da operária — T27 · nonce \`${NONCE_OP}\``);
  assert.strictEqual(decisaoOuNada("Bash", { command }, semRef), "ask");
  // pedido que cita duas tentativas da mesma task: ambíguo ⇒ nenhuma é liberada (revisão do hotfix)
  const duas = transcriptCom(
    `## contrato da operária — T27 · nonce \`${NONCE_OP}\`\nA refs/conducao/ATRM-51-x/T27/1 falhou; empurre para refs/conducao/ATRM-51-x/T27/2\n`,
  );
  assert.strictEqual(decisaoOuNada("Bash", { command }, duas), "ask");
  // número de tentativa fora da forma canônica (`01`) é outra referência: não casa
  const zero = `git push origin ${SHA_AVISO}:refs/conducao-aviso/ATRM-51-x/T27/01`;
  assert.strictEqual(decisaoOuNada("Bash", { command: zero }, OPERARIA_T27), null);
});

// O guard de alcance não tem mode-file: fora do que libera, devolve `ask` sempre, com ou sem
// declaração do projeto e com qualquer `<guard>-mode` na pasta declarada.
test("sem mode-file: fora do alcance devolve ask mesmo com mode-file shadow ou off na pasta declarada", () => {
  const projeto = fs.mkdtempSync(path.join(os.tmpdir(), "alcance-modo-"));
  try {
    fs.mkdirSync(path.join(projeto, ".claude", "state"), { recursive: true });
    for (const modo of ["shadow", "off", "hard"]) {
      fs.writeFileSync(path.join(projeto, ".claude", "state", "operaria-alcance-guard-mode"), `${modo}\n`);
      assert.strictEqual(run(ARQUIVAR, { session_id: "session_01Outra" }, { raiz: projeto, cwd: projeto }), "ask", modo);
    }
  } finally {
    fs.rmSync(projeto, { recursive: true, force: true });
  }
});
