// erros-do-adaptador.test.mjs — o erro do adaptador sai como pergunta tipada, o brief não rebaixa
// o código do erro, o `ci.veredito` ilegível não some, régua única do nome embutido e a recusa
// clara do log v0 (VEGA-29 T36, D-VEGA29-36; achados do carimbo `0eaee765`). Cada item com contraprova.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ehNomeEmbutido } from "../adaptador.mjs";
import { gerarBrief } from "../git-conducao.mjs";
import { ErroLogV0 } from "../log-eventos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
/** O projeto de teste das suítes: a declaração e o código de um projeto de mentira. */
const RAIZ = path.resolve(AQUI, "fixtures", "projeto-de-teste");
const CLI = path.resolve(AQUI, "..", "conducao.mjs");
const DECLARACAO = JSON.parse(readFileSync(path.join(RAIZ, ".altair", "adaptador.json"), "utf8"));
const CICLO = "X-1-teste";

const tmps = [];
function tmp(prefixo) {
  const d = mkdtempSync(path.join(tmpdir(), prefixo));
  tmps.push(d);
  return d;
}
after(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Repositório git com a declaração dada em `.altair/adaptador.json` e um commit. */
function repoCom(declaracao) {
  const repo = tmp("erros-adaptador-repo-");
  mkdirSync(path.join(repo, ".altair"));
  writeFileSync(path.join(repo, ".altair", "adaptador.json"), JSON.stringify(declaracao));
  const g = (...a) => execFileSync("git", a, { cwd: repo, stdio: "pipe" });
  g("init", "-q");
  g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "raiz");
  return repo;
}

function cli(args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, encoding: "utf8" });
  let saida = null;
  try {
    saida = JSON.parse(r.stdout);
  } catch {
    // sem JSON no stdout: o teste diz o que esperava
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, saida };
}

const registrar = (repo, env) => cli(["registrar-evento", "--repo", repo, "--ciclo", CICLO, "--acao", "esperar"], env);

describe("(1) ErroAdaptador sai como perguntar com motivo = e.codigo", () => {
  test("codigo inválido: perguntar entrada-invalida no stdout, a linha de antes no stderr, exit 1", () => {
    const r = registrar(repoCom({ ...DECLARACAO, codigo: "Foo" }), { ALTAIR_CONDUCAO_LOG_DIR: tmp("erros-log-") });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.saida, `sem JSON no stdout: ${r.stdout}`);
    assert.equal(r.saida.acao, "perguntar");
    assert.equal(r.saida.motivo, "entrada-invalida");
    assert.equal(r.saida.ciclo, CICLO);
    assert.equal(r.saida.verbo, "registrar-evento");
    assert.match(r.saida.detalhe, /^codigo: /);
    assert.match(r.stderr, /entrada-invalida: codigo: /);
  });

  test("declaração com campo a mais: o motivo segue o código do erro (adaptador-invalido)", () => {
    const r = registrar(repoCom({ ...DECLARACAO, extra: 1 }), { ALTAIR_CONDUCAO_LOG_DIR: tmp("erros-log-") });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.saida?.acao, "perguntar");
    assert.equal(r.saida.motivo, "adaptador-invalido");
  });

  test("contraprova: a declaração válida registra e sai 0, sem perguntar", () => {
    const r = registrar(repoCom(DECLARACAO), { ALTAIR_CONDUCAO_LOG_DIR: tmp("erros-log-") });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.saida.acao, "evento-registrado");
  });
});

describe("(2) gerarBrief não rebaixa o código do erro para brief-indisponivel", () => {
  test("codigo inválido: motivo entrada-invalida", () => {
    const b = gerarBrief({ repo: repoCom({ ...DECLARACAO, codigo: "../x" }), ciclo: CICLO, task: "T1", nonce: "n", ref: "r" });
    assert.equal(b.ok, false);
    assert.equal(b.motivo, "entrada-invalida");
    assert.match(b.detalhe, /\.\.\/x/);
  });

  test("contraprova: outro erro tipado leva o código dele (canonico-ausente), não um fixo", () => {
    const b = gerarBrief({ repo: repoCom(DECLARACAO), ciclo: CICLO, task: "T1", nonce: "n", ref: "r" });
    assert.equal(b.ok, false);
    assert.equal(b.motivo, "canonico-ausente");
  });
});

describe("(3) vereditoDoCi escreve no stderr o erro do adaptador que engolia", () => {
  const ci = (repo) =>
    cli(["ci", "--repo", repo, "--push-em", "2026-10-29T00:00:00Z", "--agora", "2026-10-29T00:01:00Z", "--runs", "[]", "--pr", "{}"]);

  test("adaptador ilegível: o erro aparece no stderr e o ci segue com o veredito padrão", () => {
    const r = ci(repoCom({ ...DECLARACAO, codigo: "Foo" }));
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.saida, `sem JSON no stdout: ${r.stdout}`);
    assert.match(r.stderr, /ci\.veredito ilegível, vale o padrão — entrada-invalida: codigo: /);
  });

  test("contraprova: adaptador legível não escreve nada sobre o veredito", () => {
    const r = ci(repoCom(DECLARACAO));
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /ci\.veredito/);
  });
});

describe("(4) o núcleo usa a régua NOME_EMBUTIDO", () => {
  test("ehNomeEmbutido recusa \"Foo\", \"a\\\\b\" e \"-x\"", () => {
    for (const v of ["Foo", "a\\b", "-x"]) assert.equal(ehNomeEmbutido(v), false, v);
  });

  test("contraprova: o nome da lista de embutidos passa", () => {
    assert.equal(ehNomeEmbutido("superpowers"), true);
    assert.equal(ehNomeEmbutido("a".repeat(64)), true);
    assert.equal(ehNomeEmbutido("a".repeat(65)), false);
  });

  test("o primeiro ramo do codigo.pattern do esquema é a mesma régua de NOME_EMBUTIDO", () => {
    const esquema = JSON.parse(readFileSync(path.resolve(AQUI, "..", "adaptador.schema.json"), "utf8"));
    assert.ok(esquema.properties.codigo.pattern.startsWith("^(?:[a-z0-9][a-z0-9-]{0,63}|"), esquema.properties.codigo.pattern);
  });
});

describe("(5) registrar-evento sobre pasta com log v0 recusa com mensagem clara", () => {
  const V0 = `${JSON.stringify({ linha: "evento", chave: "a".repeat(24), quando: "2026-10-01T00:00:00.000Z", procedencia: "intencao", acao: "abrir", objetos: [], atributos: {} })}\n`;

  test("log v0 na pasta: perguntar log-v0-so-leitura com o arquivo e o só leitura, sem pilha; o v0 fica intacto", () => {
    const pasta = tmp("erros-log-v0-");
    const arquivo = path.join(pasta, `${CICLO}.jsonl`);
    writeFileSync(arquivo, V0);
    const r = registrar(repoCom(DECLARACAO), { ALTAIR_CONDUCAO_LOG_DIR: pasta });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.saida?.acao, "perguntar", r.stdout);
    assert.equal(r.saida.motivo, "log-v0-so-leitura");
    assert.ok(r.saida.detalhe.includes(arquivo), r.saida.detalhe);
    assert.match(r.saida.detalhe, /log v0: só leitura \(D-VEGA29-21\)/);
    assert.match(r.saida.detalhe, /1 linha\(s\) sem versão/);
    assert.doesNotMatch(r.stderr, /\n\s+at /, "erro cru com pilha");
    assert.equal(readFileSync(arquivo, "utf8"), V0);
  });

  test("ErroLogV0 é tipado: código, arquivo e contagem", () => {
    const e = new ErroLogV0("/x/c.jsonl", 2);
    assert.equal(e.codigo, "log-v0-so-leitura");
    assert.equal(e.arquivo, "/x/c.jsonl");
    assert.equal(e.linhas, 2);
  });

  test("contraprova: a mesma pasta sem log v0 grava e sai 0", () => {
    const r = registrar(repoCom(DECLARACAO), { ALTAIR_CONDUCAO_LOG_DIR: tmp("erros-log-v1-") });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.saida.acao, "evento-registrado");
  });
});
