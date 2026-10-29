// adaptador.test.mjs — a declaração mínima do adaptador (VEGA-29 T10, D-VEGA29-13).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ErroAdaptador, caminhoDeCodigo, caminhoDeEscrita, caminhoDoEmbutido, codigoDoAdaptador, codigoDoNucleo, embutidos, lerAdaptador, validar } from "../adaptador.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
/** O projeto de teste das suítes: a declaração e o código de um projeto de mentira. */
const RAIZ = path.resolve(AQUI, "fixtures", "projeto-de-teste");
const CLI = path.resolve(AQUI, "..", "conducao.mjs");

const tmps = [];
function tmp(prefixo) {
  const d = mkdtempSync(path.join(tmpdir(), prefixo));
  tmps.push(d);
  return d;
}
after(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

const DECLARACAO = JSON.parse(readFileSync(path.join(RAIZ, ".altair", "adaptador.json"), "utf8"));

function repoCom(declaracao) {
  const repo = tmp("adaptador-repo-");
  mkdirSync(path.join(repo, ".altair"));
  writeFileSync(path.join(repo, ".altair", "adaptador.json"), JSON.stringify(declaracao));
  return repo;
}

/** env de estação (sem NODE_TEST_CONTEXT), com a raiz de estado num tmp. */
function estacao() {
  return { XDG_STATE_HOME: tmp("adaptador-estado-") };
}

describe("declaração do projeto de teste", () => {
  test("lida do repositório: operadores, pasta do log e onde a pergunta grava", () => {
    const env = estacao();
    const a = lerAdaptador(RAIZ, { env });
    assert.equal(a.origem, "repo");
    assert.equal(a.operador.nome, "Rita");
    assert.deepEqual(a.operadores.map((o) => o.handle), ["rita"]);
    const esperada = path.join(env.XDG_STATE_HOME, "altair", "conducao");
    assert.equal(a.pastaDeEstado, esperada);
    assert.equal(a.projeto, "teste");
    // Log v1 (T11): a base é a pasta fixa de antes (onde ficam os v0); o v1 grava em `<base>/<projeto>/`.
    assert.equal(a.pastaDoLog, path.join(esperada, "teste"));
    assert.deepEqual(a.pergunta, { destino: "log" });
    assert.equal(a.pastaDaPergunta, a.pastaDoLog);
  });

  test("override ALTAIR_CONDUCAO_LOG_DIR segue sobrepondo a pasta do log", () => {
    const dir = tmp("adaptador-override-");
    const a = lerAdaptador(RAIZ, { env: { ...estacao(), ALTAIR_CONDUCAO_LOG_DIR: dir } });
    assert.equal(a.pastaDoLog, dir);
    assert.equal(a.pastaDaPergunta, dir);
  });

  test("repositório sem declaração lê a da árvore do núcleo", () => {
    const a = lerAdaptador(tmp("adaptador-sem-"), { env: estacao() });
    assert.equal(a.origem, "nucleo");
    assert.equal(a.operador.nome, "Rita");
  });
});

describe("recusa", () => {
  test("campo a mais na raiz", () => {
    const repo = repoCom({ ...DECLARACAO, extra: true });
    assert.throws(() => lerAdaptador(repo, { env: estacao() }), (e) => e instanceof ErroAdaptador && /campo desconhecido extra/.test(e.message));
  });

  test("campo a mais aninhado", () => {
    assert.throws(() => validar({ ...DECLARACAO, operadores: [{ handle: "x", nome: "X", email: "x@y" }] }), /campo desconhecido email/);
    assert.throws(() => validar({ ...DECLARACAO, pergunta: { destino: "log", pasta: "p" } }), /campo desconhecido pasta/);
    assert.throws(() => validar({ ...DECLARACAO, log: { pasta: ".", formato: "v1" } }), /campo desconhecido formato/);
  });

  test("campo faltando, destino desconhecido, operadores vazio", () => {
    const { log, ...semLog } = DECLARACAO;
    assert.ok(log);
    assert.throws(() => validar(semLog), /falta o campo log/);
    assert.throws(() => validar({ ...DECLARACAO, pergunta: { destino: "slack" } }), /pergunta\.destino/);
    assert.throws(() => validar({ ...DECLARACAO, operadores: [] }), /operadores/);
  });

  test("caminho absoluto ou com .. na declaração", () => {
    assert.throws(() => validar({ ...DECLARACAO, estado: { pasta: "/etc" } }), /fora da raiz/);
    assert.throws(() => validar({ ...DECLARACAO, log: { pasta: "../fora" } }), /fora da raiz/);
    assert.throws(() => validar({ ...DECLARACAO, pergunta: { destino: "pasta", pasta: "a/../../b" } }), /fora da raiz/);
  });

  test("JSON ilegível", () => {
    const repo = tmp("adaptador-ilegivel-");
    mkdirSync(path.join(repo, ".altair"));
    writeFileSync(path.join(repo, ".altair", "adaptador.json"), "{ nao e json");
    assert.throws(() => lerAdaptador(repo, { env: estacao() }), /JSON ilegível/);
  });
});

describe("caminhos por realpath", () => {
  test("escrita: link simbólico que salta para fora da pasta de estado é recusado", () => {
    const env = estacao();
    const fora = tmp("adaptador-fora-");
    mkdirSync(path.join(env.XDG_STATE_HOME, "proj"), { recursive: true });
    symlinkSync(fora, path.join(env.XDG_STATE_HOME, "proj", "fuga"));
    const repo = repoCom({ ...DECLARACAO, estado: { pasta: "proj" }, log: { pasta: "fuga/log" } });
    assert.throws(() => lerAdaptador(repo, { env }), /log\.pasta: fuga\/log resolve fora/);
    const repo2 = repoCom({ ...DECLARACAO, estado: { pasta: "proj/fuga" } });
    assert.throws(() => lerAdaptador(repo2, { env }), /estado\.pasta: proj\/fuga resolve fora/);
  });

  test("escrita: caminho ainda inexistente dentro da pasta resolve", () => {
    const base = tmp("adaptador-base-");
    assert.equal(caminhoDeEscrita(base, "a/b/c"), path.join(base, "a", "b", "c"));
  });

  test("pergunta com destino próprio grava na pasta declarada", () => {
    const env = estacao();
    const repo = repoCom({ ...DECLARACAO, estado: { pasta: "proj" }, pergunta: { destino: "pasta", pasta: "perguntas" } });
    const a = lerAdaptador(repo, { env });
    assert.equal(a.pastaDaPergunta, path.join(env.XDG_STATE_HOME, "proj", "perguntas"));
    assert.notEqual(a.pastaDaPergunta, a.pastaDoLog);
  });

  test("código: dentro de .altair resolve; fora, inexistente ou por link é recusado", () => {
    const repo = repoCom(DECLARACAO);
    writeFileSync(path.join(repo, ".altair", "projeto.mjs"), "export default 1;\n");
    writeFileSync(path.join(repo, "fora.mjs"), "export default 2;\n");
    symlinkSync(path.join(repo, "fora.mjs"), path.join(repo, ".altair", "atalho.mjs"));
    assert.equal(caminhoDeCodigo(repo, "projeto.mjs"), path.join(repo, ".altair", "projeto.mjs"));
    assert.throws(() => caminhoDeCodigo(repo, "../fora.mjs"), /fora da raiz/);
    assert.throws(() => caminhoDeCodigo(repo, "nada.mjs"), /não existe/);
    assert.throws(() => caminhoDeCodigo(repo, "atalho.mjs"), /resolve fora/);
  });
});

describe("núcleo tira os dados da declaração", () => {
  function gitRepo(declaracao) {
    const repo = repoCom(declaracao);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    return repo;
  }

  test("registrar-evento grava na pasta do log declarada", () => {
    const env = estacao();
    const repo = gitRepo({ ...DECLARACAO, estado: { pasta: "proj-x" }, log: { pasta: "eventos" } });
    const { NODE_TEST_CONTEXT, ALTAIR_CONDUCAO_LOG_DIR, ...base } = process.env;
    void NODE_TEST_CONTEXT;
    void ALTAIR_CONDUCAO_LOG_DIR;
    const r = spawnSync(process.execPath, [CLI, "registrar-evento", "--repo", repo, "--ciclo", "X-1-teste", "--acao", "esperar"], {
      env: { ...base, ...env },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    const pasta = path.join(env.XDG_STATE_HOME, "proj-x", "eventos", DECLARACAO.projeto);
    assert.deepEqual(readdirSync(pasta), ["X-1-teste.jsonl"]);
    assert.equal(JSON.parse(r.stdout).arquivo, path.join(pasta, "X-1-teste.jsonl"));
  });

  test("declaração com campo a mais derruba o verbo com exit 1", () => {
    const repo = gitRepo({ ...DECLARACAO, extra: 1 });
    const r = spawnSync(process.execPath, [CLI, "registrar-evento", "--repo", repo, "--ciclo", "X-1-teste", "--acao", "esperar"], {
      env: { ...process.env, ALTAIR_CONDUCAO_LOG_DIR: tmp("adaptador-log-") },
      encoding: "utf8",
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /adaptador-invalido: declaração: campo desconhecido extra/);
  });
});

describe("publicacao.frasesLegadas (T16)", () => {
  test("ausente ⇒ lista vazia; a do projeto de teste traz a frase dos commits antigos", () => {
    const { publicacao, ...semPublicacao } = DECLARACAO;
    assert.deepEqual(validar(semPublicacao).publicacao, { frasesLegadas: [] });
    assert.ok(publicacao.frasesLegadas.length > 0);
    assert.deepEqual(validar(DECLARACAO).publicacao.frasesLegadas, publicacao.frasesLegadas);
  });

  test("forma errada recusa", () => {
    for (const p of [[], { frasesLegadas: "x" }, { frasesLegadas: [""] }, { frasesLegadas: ["a\nb"] }, { frasesLegadas: [], outra: 1 }])
      assert.throws(() => validar({ ...DECLARACAO, publicacao: p }), ErroAdaptador, JSON.stringify(p));
  });
});

describe("codigo: arquivo em .altair/, nome embutido ou ausente (D-VEGA29-34)", () => {
  const { codigo, ...semCodigo } = DECLARACAO;
  void codigo;
  const MINIMO = [
    "export default {",
    "  plano: { raiz: 'proprio', casa: () => false, ler: () => ({}), brief: () => [] },",
    "  publicacao: [], caminhosClinicos: [], telasClinicasDosSteps: [], foraDasTelasDosSteps: [],",
    "  carimbo: null, ci: null,",
    "};",
    "",
  ].join("\n");
  const recusa = (codigoEsperado, re) => (e) => e instanceof ErroAdaptador && e.codigo === codigoEsperado && re.test(e.message);

  test("a lista fechada de embutidos é a dos arquivos .mjs de adaptadores/", () => {
    const pasta = path.resolve(AQUI, "..", "adaptadores");
    const noDisco = readdirSync(pasta).filter((n) => n.endsWith(".mjs")).map((n) => n.slice(0, -4)).sort();
    assert.deepEqual([...embutidos()], noDisco);
    assert.ok(embutidos().includes("superpowers"));
    assert.equal(caminhoDoEmbutido("superpowers"), path.join(pasta, "superpowers.mjs"));
    for (const v of ["inexistente", "../superpowers", "superpowers.mjs"])
      assert.throws(() => caminhoDoEmbutido(v), (e) => e instanceof ErroAdaptador && e.codigo === "entrada-invalida", v);
  });

  test("nome embutido: carrega adaptadores/<nome>.mjs do núcleo, sem nada em .altair/", () => {
    const repo = repoCom({ ...DECLARACAO, codigo: "superpowers" });
    assert.equal(validar({ ...DECLARACAO, codigo: "superpowers" }).codigo, "superpowers");
    const c = codigoDoAdaptador(repo);
    assert.equal(c.plano.raiz, "docs");
    assert.equal(c.carimbo, null);
  });

  test("terminado em .mjs: o arquivo em .altair/, como antes", () => {
    const repo = repoCom({ ...DECLARACAO, codigo: "proprio.mjs" });
    writeFileSync(path.join(repo, ".altair", "proprio.mjs"), MINIMO);
    assert.equal(codigoDoAdaptador(repo).plano.raiz, "proprio");
  });

  test("ausente: o código da árvore do núcleo, como antes", () => {
    assert.equal(codigoDoAdaptador(repoCom(semCodigo)), codigoDoNucleo());
  });

  test("../x, nome embutido inexistente e outro valor recusam com entrada-invalida", () => {
    for (const v of ["../x", "inexistente", "Superpowers", "x.js", "a/b", "", "superpowers.", 7])
      assert.throws(() => validar({ ...DECLARACAO, codigo: v }), recusa("entrada-invalida", /^codigo: /), JSON.stringify(v));
    assert.throws(() => lerAdaptador(repoCom({ ...DECLARACAO, codigo: "../x" }), { env: estacao() }), recusa("entrada-invalida", /\.\.\/x/));
    assert.throws(() => codigoDoAdaptador(repoCom({ ...DECLARACAO, codigo: "inexistente" })), recusa("entrada-invalida", /não é adaptador embutido/));
  });

  test("terminado em .mjs que sai de .altair/ segue recusado como hoje (adaptador-invalido)", () => {
    for (const v of ["../x.mjs", "a/../../x.mjs", "/etc/x.mjs"])
      assert.throws(() => validar({ ...DECLARACAO, codigo: v }), recusa("adaptador-invalido", /fora da raiz/), v);
    // Link em .altair/ que salta para fora: recusado no carregamento, por realpath.
    const repo = repoCom({ ...DECLARACAO, codigo: "atalho.mjs" });
    writeFileSync(path.join(repo, "fora.mjs"), MINIMO);
    symlinkSync(path.join(repo, "fora.mjs"), path.join(repo, ".altair", "atalho.mjs"));
    assert.throws(() => codigoDoAdaptador(repo), recusa("adaptador-invalido", /resolve fora/));
  });

  test("nome embutido também é só da versão 2", () => {
    const { versao, ...v1 } = DECLARACAO;
    void versao;
    assert.throws(() => validar({ ...v1, codigo: "superpowers" }), /só na versao 2/);
  });

  test("o CLI recusa a declaração com codigo inválido: exit 1 e entrada-invalida no stderr", () => {
    const repo = repoCom({ ...DECLARACAO, codigo: "../x" });
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const r = spawnSync(process.execPath, [CLI, "registrar-evento", "--repo", repo, "--ciclo", "X-1-teste", "--acao", "esperar"], {
      env: { ...process.env, ALTAIR_CONDUCAO_LOG_DIR: tmp("adaptador-log-") },
      encoding: "utf8",
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /entrada-invalida: codigo: /);
  });
});

// ── v4: verificacao e guardas ─────────────────────────────────────────────────
// A marca que a Verificação embrulhada liga e as variáveis de produção que ela tira, e a pasta
// do `<guard>-mode`, são campos da declaração (eram literais do projeto de origem no núcleo).
describe("versão 4: verificacao e guardas", () => {
  const { verificacao, guardas, ...v3 } = DECLARACAO;

  test("a declaração do projeto de teste traz os dois campos, e eles chegam lidos", () => {
    const lida = validar(DECLARACAO);
    assert.equal(lida.versao, 4);
    assert.deepEqual(lida.verificacao, { marcaSemCofre: verificacao.marcaSemCofre, variaveisDeProducao: verificacao.variaveisDeProducao });
    assert.deepEqual(lida.guardas, { pastaDoModo: guardas.pastaDoModo });
  });

  test("ausentes ⇒ a marca padrão, nenhuma variável e nenhuma pasta de modo", () => {
    const lida = validar({ ...v3, versao: 3 });
    assert.deepEqual(lida.verificacao, { marcaSemCofre: "ALTAIR_SEM_COFRE_PRODUCAO", variaveisDeProducao: [] });
    assert.deepEqual(lida.guardas, { pastaDoModo: null });
    assert.deepEqual(validar({ ...v3, versao: 4, verificacao: {} }).verificacao, { marcaSemCofre: "ALTAIR_SEM_COFRE_PRODUCAO", variaveisDeProducao: [] });
  });

  test("só na versão 4", () => {
    assert.throws(() => validar({ ...v3, versao: 3, verificacao }), /verificacao: só na versao 4/);
    assert.throws(() => validar({ ...v3, versao: 3, guardas }), /guardas: só na versao 4/);
  });

  test("recusa nome de variável que não é nome, campo a mais e pasta fora da raiz", () => {
    assert.throws(() => validar({ ...DECLARACAO, verificacao: { marcaSemCofre: "COM ESPACO" } }), /marcaSemCofre/);
    assert.throws(() => validar({ ...DECLARACAO, verificacao: { variaveisDeProducao: ["A=B"] } }), /variaveisDeProducao/);
    assert.throws(() => validar({ ...DECLARACAO, verificacao: { outra: 1 } }), /campo desconhecido outra/);
    assert.throws(() => validar({ ...DECLARACAO, guardas: {} }), /falta o campo pastaDoModo/);
    assert.throws(() => validar({ ...DECLARACAO, guardas: { pastaDoModo: "../fora" } }), /fora da raiz/);
    assert.throws(() => validar({ ...DECLARACAO, guardas: { pastaDoModo: "/abs" } }), /fora da raiz/);
  });
});
