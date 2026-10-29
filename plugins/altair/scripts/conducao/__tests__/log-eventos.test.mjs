/**
 * log-eventos.test.mjs — log de eventos por objeto da condução (VEGA-22 T13).
 *
 * Fixa a forma descrita em D-GAME1-21 (OCEL 2.0 em JSONL, procedência por
 * linha). O esquema real do gêmeo não está no servidor: a conferência contra
 * ele fica com o consumidor (§7 R4 do canonico do VEGA-22).
 *
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { linhasDoEvento, pastaDoLog, registrar } from "../log-eventos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const CICLO = "TESTE-1-log";
const QUANDO = "2026-10-15T22:00:00.000Z";
const CONVERSA = "Rita disse: pode seguir com a task, o paciente Fulano ficou de fora";

function pasta() {
  return mkdtempSync(path.join(tmpdir(), "conducao-log-"));
}

function ler(arquivo) {
  return readFileSync(arquivo, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// Saída de `trazer` como o verbo de git devolve, com campos de texto livre misturados.
const TRAZIDA = {
  acao: "trazida",
  ciclo: CICLO,
  fase: "F2",
  task: "T13",
  tentativa: 2,
  sessao: "session_01ABCdef",
  nonce: "a1b2c3d4e5f60718",
  modo: "cherry-pick",
  antes: "1111111111111111111111111111111111111111",
  depois: "2222222222222222222222222222222222222222",
  copia: { copia: "2222222222222222222222222222222222222222", anterior: "1111111111111111111111111111111111111111", empurrada: true },
  motivo: CONVERSA,
  relato: CONVERSA,
  paciente: "Fulano",
  prompt: CONVERSA,
  corpo: "feat: algo\n\nCorpo do commit com texto livre",
  avisoLeo: [CONVERSA],
};

test("evento da conducao liga sessao, task, fase e ciclo com qualificador e procedencia, sem texto de conversa", () => {
  const dir = pasta();
  try {
    const r = registrar(TRAZIDA, { procedencia: "registrado", quando: QUANDO, pasta: dir });
    assert.equal(r.arquivo, path.join(dir, `${CICLO}.jsonl`));
    const linhas = ler(r.arquivo);

    // Toda linha tem procedência, chave e horário UTC.
    for (const l of linhas) {
      assert.equal(l.procedencia, "registrado");
      assert.match(l.chave, /^[0-9a-f]{24}$/);
      assert.equal(l.quando, QUANDO);
    }

    const evento = linhas.find((l) => l.linha === "evento");
    assert.equal(evento.acao, "trazida");
    assert.deepEqual(
      evento.objetos.map((o) => [o.tipo, o.id, o.qualificador]),
      [
        ["ciclo", `ciclo:${CICLO}`, "conduzido"],
        ["fase", `fase:${CICLO}/F2`, "da-fase"],
        ["task", `task:${CICLO}/T13`, "alvo"],
        ["tentativa", `tentativa:${CICLO}/T13/2`, "tentativa"],
        ["sessao", "sessao:session_01ABCdef", "filha"],
      ],
    );

    // Objetos declarados e relações objeto→objeto.
    assert.deepEqual(linhas.filter((l) => l.linha === "objeto").map((l) => l.tipo), ["ciclo", "fase", "task", "tentativa", "sessao"]);
    assert.deepEqual(
      linhas.filter((l) => l.linha === "relacao").map((l) => [l.de, l.qualificador, l.para]),
      [
        [`fase:${CICLO}/F2`, "pertence-a", `ciclo:${CICLO}`],
        [`task:${CICLO}/T13`, "pertence-a", `fase:${CICLO}/F2`],
        [`tentativa:${CICLO}/T13/2`, "tentativa-de", `task:${CICLO}/T13`],
        ["sessao:session_01ABCdef", "executa", `tentativa:${CICLO}/T13/2`],
      ],
    );

    // Histórico de atributo do fato registrado, ligado ao evento.
    const attr = linhas.filter((l) => l.linha === "atributo");
    assert.deepEqual(
      attr.map((l) => [l.objeto, l.nome, l.valor, l.evento]),
      [[`tentativa:${CICLO}/T13/2`, "estado", "trazida", evento.chave]],
    );

    // Allowlist: só ids, sha, nonce, ação e estado; nenhum texto livre.
    assert.deepEqual(evento.atributos, {
      tentativa: 2,
      nonce: "a1b2c3d4e5f60718",
      modo: "cherry-pick",
      antes: TRAZIDA.antes,
      depois: TRAZIDA.depois,
      copia: TRAZIDA.depois,
    });
    assert.deepEqual(r.descartados, ["avisoLeo", "corpo", "motivo", "paciente", "prompt", "relato"]);
    const bruto = readFileSync(r.arquivo, "utf8");
    assert.ok(!bruto.includes("Rita disse"), "texto de conversa vazou para o log");
    assert.ok(!bruto.includes("Fulano"), "texto de conversa vazou para o log");
    assert.ok(!bruto.includes("Corpo do commit"), "corpo de commit vazou para o log");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mesmo evento gravado duas vezes nao duplica linha", () => {
  const dir = pasta();
  try {
    const a = registrar(TRAZIDA, { procedencia: "registrado", quando: QUANDO, pasta: dir });
    const b = registrar(TRAZIDA, { procedencia: "registrado", quando: "2026-10-15T23:00:00.000Z", pasta: dir });
    assert.equal(a.novo, true);
    assert.equal(b.novo, false);
    assert.equal(b.linhas, 0);
    assert.equal(a.chave, b.chave);
    assert.equal(ler(a.arquivo).filter((l) => l.linha === "evento").length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("intencao do proximo nao gera historico de atributo", () => {
  const abrir = {
    acao: "abrir",
    nonce: "ffffeeeeddddcccc",
    ciclo: CICLO,
    head: "3333333333333333333333333333333333333333",
    plano: "4444444444444444444444444444444444444444",
    fase: "F2",
    tarefas: [
      { task: "T13", tentativa: 1, nonce: "0000000000000001", modelo: "opus" },
      { task: "T14", tentativa: 1, nonce: "0000000000000002", modelo: "opus" },
    ],
    avisoLeo: [CONVERSA],
    diffPlano: "diff --git a/canonico.md\n+texto do plano",
  };
  const { linhas, descartados } = linhasDoEvento(abrir, { procedencia: "intencao", quando: QUANDO });
  assert.equal(linhas.filter((l) => l.linha === "atributo").length, 0);
  const evento = linhas.find((l) => l.linha === "evento");
  assert.equal(evento.procedencia, "intencao");
  assert.deepEqual(
    evento.objetos.filter((o) => o.tipo === "task" || o.tipo === "tentativa").map((o) => o.id),
    [`task:${CICLO}/T13`, `tentativa:${CICLO}/T13/1`, `task:${CICLO}/T14`, `tentativa:${CICLO}/T14/1`],
  );
  assert.equal(evento.atributos.nonces, "0000000000000001+0000000000000002");
  assert.deepEqual(descartados, ["avisoLeo", "diffPlano"]);

  // Mesmo nome de fato (`conferida`) dito como intenção não muda estado.
  const dita = linhasDoEvento({ acao: "conferida", ciclo: CICLO, task: "T13" }, { procedencia: "intencao", quando: QUANDO });
  assert.equal(dita.linhas.filter((l) => l.linha === "atributo").length, 0);
});

test("registrar-evento grava o observado pela maestra no log do ciclo", () => {
  const dir = pasta();
  try {
    const r = spawnSync(
      process.execPath,
      [SCRIPT, "registrar-evento", "--ciclo", CICLO, "--acao", "filha-arquivada", "--task", "T13", "--tentativa", "1", "--sessao", "session_01XYZ", "--estado", "ARCHIVED", "--quando", QUANDO],
      { encoding: "utf8", env: { ...process.env, ALTAIR_CONDUCAO_LOG_DIR: dir } },
    );
    assert.equal(r.status, 0, r.stderr);
    const saida = JSON.parse(r.stdout);
    assert.equal(saida.acao, "evento-registrado");
    assert.equal(saida.novo, true);
    const linhas = ler(path.join(dir, `${CICLO}.jsonl`));
    assert.ok(linhas.every((l) => l.procedencia === "observado"));
    const attr = linhas.find((l) => l.linha === "atributo");
    assert.deepEqual([attr.objeto, attr.valor], ["sessao:session_01XYZ", "ARCHIVED"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pasta do log padrao e a de estado da estacao", () => {
  assert.equal(pastaDoLog({ HOME: "/h" , XDG_STATE_HOME: "/h/.local/state" }), "/h/.local/state/altair/conducao");
  assert.equal(pastaDoLog({ ALTAIR_CONDUCAO_LOG_DIR: "/x" }), "/x");
  assert.equal(pastaDoLog({ NODE_TEST_CONTEXT: "child-v8" }), path.join(tmpdir(), "altair-conducao-log-teste"));
});

test("procedencia fora do vocabulario e recusada", () => {
  assert.throws(() => linhasDoEvento(TRAZIDA, { procedencia: "robo", quando: QUANDO }), /procedência inválida/);
});
