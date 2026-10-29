/**
 * pre-voo.test.mjs — o pré-voo da condução (VEGA-29 T30, D-VEGA29-15, AC-VEGA29-12).
 *
 * A CLI do host e o `systemctl` são executáveis falsos num tmp, à frente do PATH:
 * nada depende da máquina. Cada conferência tem o seu caso de falha (sai
 * `perguntar pre-voo` com o que falhou e o remédio, exit 1, e nada se grava no
 * repositório), o caminho todo verde sai `ok`, e o aviso de tier avisa só a
 * tarefa de julgamento em `mecanico`. Por último, o núcleo não nomeia modelo
 * nem fornecedor.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { validar } from "../adaptador.mjs";
import { pedeJulgamento } from "../pre-voo.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const NUCLEO = path.resolve(AQUI, "..");
const CLI = path.join(NUCLEO, "conducao.mjs");
const DECLARACAO = JSON.parse(readFileSync(path.join(AQUI, "fixtures", "projeto-de-teste", ".altair", "adaptador.json"), "utf8"));
const { cli: [BINARIO], variavelDoTrafego: VARIAVEL, ponte: { unidade: UNIDADE } } = DECLARACAO.sessao;
const CICLO = "TESTE-1-tier";

const tmps = [];
function tmp(prefixo) {
  const d = mkdtempSync(path.join(tmpdir(), prefixo));
  tmps.push(d);
  return d;
}
after(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

const LISTA_VERDE = [{ id: "altair@marketplace-de-teste", scope: "project", enabled: true }];

/** Tarefa no formato público: anotações e um passo. */
function tarefa(n, { sensivel = "não", marcas = null, tier = null } = {}) {
  return [
    `### Tarefa ${n}: tarefa ${n}`,
    "",
    "**Estação:** servidor",
    "**Publicação:** não",
    `**Sensível:** ${sensivel}`,
    ...(marcas ? [`**Marcas:** ${marcas}`] : []),
    ...(tier ? [`**Tier:** ${tier}`] : []),
    `**Verificação:** \`test -f src/t${n}.mjs\``,
    `**Commit:** ${CICLO}-F1/T${n} — tarefa ${n}`,
    "",
    "**Arquivos:**",
    `- Criar: \`src/t${n}.mjs\``,
    "",
    "- [ ] **Passo 1: escrever**",
    "",
  ].join("\n");
}

/** O plano de julgamento: comum, sensível, conferência do operador, review-gate e fechamento. */
function plano({ tierDaFase = null, tiers = {} } = {}) {
  const t = (n, extra) => tarefa(n, { ...extra, tier: tiers[n] ?? null });
  return [
    `# ${CICLO}`,
    "",
    "**Fase:** F1",
    ...(tierDaFase ? [`**Tier:** ${tierDaFase}`] : []),
    "**Largura do ciclo:** 1",
    "",
    t(1),
    t(2, { sensivel: "sim" }),
    t(3, { marcas: "conferencia-do-operador" }),
    t(4, { marcas: "review-gate" }),
    t(5),
    t(6, { marcas: "fechamento-de-fase" }),
  ].join("\n");
}

/**
 * Projeto de mentira: declaração do projeto de teste (com o leitor público, para
 * o plano), PATH com os falsos, e o plano commitado. `host` e `systemctl` dizem o
 * que os falsos respondem; `settings` são os arquivos de configuração do projeto.
 */
function projeto({ lista = LISTA_VERDE, listaStatus = 0, restart = "always", loadState = "loaded", settings = {}, sem = [], declaracao = {}, declCompleta = null, texto = plano(), comBinario = true } = {}) {
  const repo = tmp("pre-voo-repo-");
  const bin = tmp("pre-voo-bin-");
  const decl = declCompleta ?? { ...DECLARACAO, codigo: "superpowers", ...declaracao };
  mkdirSync(path.join(repo, ".altair"));
  writeFileSync(path.join(repo, ".altair", "adaptador.json"), JSON.stringify(decl));
  for (const [rel, json] of Object.entries(settings)) {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), typeof json === "string" ? json : JSON.stringify(json));
  }
  mkdirSync(path.join(repo, "docs", "planos"), { recursive: true });
  writeFileSync(path.join(repo, "docs", "planos", `${CICLO}.md`), texto);
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  for (const [k, v] of [["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"], ["core.hooksPath", "/dev/null"]]) g("config", k, v);
  g("add", "-A");
  g("commit", "-q", "-m", "projeto");
  if (comBinario) {
    writeFileSync(path.join(bin, "lista.json"), typeof lista === "string" ? lista : JSON.stringify(lista));
    writeFileSync(path.join(bin, BINARIO), `#!/bin/sh\ncat "$(dirname "$0")/lista.json"\nexit ${listaStatus}\n`);
    chmodSync(path.join(bin, BINARIO), 0o755);
  }
  writeFileSync(path.join(bin, "systemctl.txt"), `Restart=${restart}\nLoadState=${loadState}\n`);
  writeFileSync(path.join(bin, "systemctl"), `#!/bin/sh\ncat "$(dirname "$0")/systemctl.txt"\n`);
  chmodSync(path.join(bin, "systemctl"), 0o755);
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  delete env[VARIAVEL];
  for (const k of sem) delete env[k];
  return { repo, bin, g, env };
}

function preVoo(p, { ciclo = null, env = {} } = {}) {
  const args = [CLI, "pre-voo", "--repo", p.repo, ...(ciclo ? ["--ciclo", ciclo] : [])];
  const r = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...p.env, ...env } });
  const linhas = r.stdout.split("\n").filter(Boolean);
  assert.equal(linhas.length, 1, `uma linha JSON: ${r.stdout}\n${r.stderr}`);
  return { status: r.status, saida: JSON.parse(linhas[0]), stderr: r.stderr };
}

/** Falhou só `conferencia`, com encontrado e remédio, exit 1, e nada se gravou no repositório. */
function falhouSo(p, r, conferencia, encontrado) {
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.saida.acao, "perguntar");
  assert.equal(r.saida.motivo, "pre-voo");
  assert.deepEqual(r.saida.falhas.map((f) => f.conferencia), [conferencia], JSON.stringify(r.saida.falhas));
  const [f] = r.saida.falhas;
  assert.match(f.encontrado, encontrado);
  assert.ok(f.remedio && f.remedio.trim(), "falha sem remédio");
  // Nenhuma filha: nenhum commit, nenhuma referência da condução.
  assert.equal(p.g("rev-list", "--count", "HEAD"), "1");
  assert.equal(p.g("for-each-ref", "--format=%(refname)"), "refs/heads/main");
}

describe("pré-voo: uma falha por conferência", () => {
  test("tudo verde: ok, as quatro conferências e nenhum aviso", () => {
    const p = projeto();
    const r = preVoo(p);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.saida.acao, "pre-voo");
    assert.equal(r.saida.ok, true);
    assert.deepEqual(r.saida.conferencias.map((c) => [c.conferencia, c.estado]), [
      ["plugin-carregado", "ok"],
      ["instalacao-unica", "ok"],
      ["ponte-com-restart", "ok"],
      ["trafego-ligado", "ok"],
    ]);
    assert.deepEqual(r.saida.avisos, []);
  });

  test("plugin ausente da lista do host: pergunta, com o remédio", () => {
    const p = projeto({ lista: [{ id: "outro@marketplace-de-teste", scope: "user", enabled: true }] });
    falhouSo(p, preVoo(p), "plugin-carregado", /altair fora da lista/);
  });

  test("plugin instalado e desligado também não está carregado", () => {
    const p = projeto({ lista: [{ id: "altair@marketplace-de-teste", scope: "project", enabled: false }] });
    falhouSo(p, preVoo(p), "plugin-carregado", /instalado e desligado/);
  });

  test("CLI do host ausente: falha com remédio, nunca exceção crua", () => {
    const p = projeto({ comBinario: false });
    const r = preVoo(p);
    falhouSo(p, r, "plugin-carregado", new RegExp(`comando ausente: ${BINARIO}`));
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });

  test("CLI do host que sai com erro ou não devolve JSON: falha", () => {
    const p = projeto({ listaStatus: 3 });
    falhouSo(p, preVoo(p), "plugin-carregado", /saiu 3/);
    const q = projeto({ lista: "isto não é JSON" });
    falhouSo(q, preVoo(q), "plugin-carregado", /não devolveu JSON/);
  });

  test("instalação dupla na lista do host: pergunta", () => {
    const p = projeto({ lista: [...LISTA_VERDE, { id: "altair@outro-marketplace", scope: "user", enabled: true }] });
    falhouSo(p, preVoo(p), "instalacao-unica", /2 instalações de altair \(project, user\)/);
  });

  test("instalação de OUTRO projeto na lista do host não conta como dupla (nem desligada, nem ligada)", () => {
    for (const enabled of [false, true]) {
      const outro = { id: "altair@marketplace-de-teste", scope: "project", enabled, projectPath: tmp("pre-voo-outro-") };
      const p = projeto({ lista: [outro, ...LISTA_VERDE] });
      const r = preVoo(p);
      assert.equal(r.status, 0, JSON.stringify(r.saida));
      assert.equal(r.saida.conferencias.find((c) => c.conferencia === "instalacao-unica").estado, "ok");
    }
  });

  test("instalação só de outro projeto não carrega o plugin aqui", () => {
    const p = projeto({ lista: [{ id: "altair@marketplace-de-teste", scope: "project", enabled: true, projectPath: tmp("pre-voo-outro-") }] });
    falhouSo(p, preVoo(p), "plugin-carregado", /altair fora da lista/);
  });

  test("contraprova: instalação de projeto com projectPath deste projeto conta, inclusive vista de uma worktree", () => {
    const p = projeto();
    const deste = { id: "altair@outro-marketplace", scope: "project", enabled: true, projectPath: p.repo };
    writeFileSync(path.join(p.bin, "lista.json"), JSON.stringify([...LISTA_VERDE, deste]));
    falhouSo(p, preVoo(p), "instalacao-unica", /2 instalações de altair/);
    const wt = path.join(tmp("pre-voo-wt-"), "arvore");
    p.g("worktree", "add", "-q", "-b", "outra", wt);
    const r = preVoo({ ...p, repo: wt });
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(r.saida.falhas.map((f) => f.conferencia), ["instalacao-unica"]);
    assert.match(r.saida.falhas[0].encontrado, /2 instalações de altair/);
  });

  test("instalação dupla pelo settings do projeto, que registra um hook do plugin à mão: pergunta", () => {
    const [rel] = DECLARACAO.sessao.settings;
    const settings = { [rel]: { hooks: { PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: "node /x/plugins/altair/hooks/conducao-nonce-guard.js" }] }] } } };
    const p = projeto({ settings });
    falhouSo(p, preVoo(p), "instalacao-unica", new RegExp(`${rel.replace(/\./g, "\\.")} registra hook do plugin: .*conducao-nonce-guard\\.js`));
  });

  test("contraprova: settings com hook que não é do plugin não acusa", () => {
    const [rel] = DECLARACAO.sessao.settings;
    const settings = { [rel]: { hooks: { Stop: [{ hooks: [{ type: "command", command: "node .host/hooks/outro-guard.js" }] }] } } };
    const p = projeto({ settings });
    assert.equal(preVoo(p).status, 0);
  });

  test("ponte com Restart=no: pergunta", () => {
    const p = projeto({ restart: "no" });
    falhouSo(p, preVoo(p), "ponte-com-restart", new RegExp(`${UNIDADE.replace(/\./g, "\\.")} com Restart=no`));
  });

  test("ponte cuja unidade não existe: pergunta", () => {
    const p = projeto({ loadState: "not-found" });
    falhouSo(p, preVoo(p), "ponte-com-restart", /não existe/);
  });

  test("ponte sem unidade declarada: aviso nao-declarada, sem falhar", () => {
    const { ponte, ...sessao } = DECLARACAO.sessao;
    void ponte;
    const p = projeto({ declaracao: { sessao } });
    const r = preVoo(p);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.saida.conferencias.find((c) => c.conferencia === "ponte-com-restart").estado, "nao-declarada");
    assert.deepEqual(r.saida.avisos.map((a) => [a.tipo, a.conferencia]), [["nao-declarada", "ponte-com-restart"]]);
  });

  test("tráfego não essencial desligado no ambiente do processo: pergunta", () => {
    const p = projeto();
    falhouSo(p, preVoo(p, { env: { [VARIAVEL]: "1" } }), "trafego-ligado", /no ambiente do processo/);
  });

  test("tráfego não essencial desligado no env do settings do projeto: pergunta", () => {
    const rel = DECLARACAO.sessao.settings[1];
    const p = projeto({ settings: { [rel]: { env: { [VARIAVEL]: "1" } } } });
    falhouSo(p, preVoo(p), "trafego-ligado", new RegExp(`no env de ${rel.replace(/\./g, "\\.")}`));
  });

  test("declaração v4, sem o contrato do host: as conferências que dependem dele falham dizendo o campo", () => {
    const { tiers, ...semTiers } = DECLARACAO;
    void tiers;
    const p = projeto({ declCompleta: { ...semTiers, codigo: "superpowers", versao: 4, sessao: { modosSemClique: ["auto"] } } });
    const r = preVoo(p);
    assert.equal(r.status, 1);
    assert.deepEqual(r.saida.falhas.map((f) => f.encontrado), ["sessao.cli não declarado", "sessao.settings não declarado", "sessao.variavelDoTrafego não declarado"]);
    assert.ok(r.saida.falhas.every((f) => /declarar sessao\./.test(f.remedio)));
  });
});

describe("pré-voo: aviso de tier", () => {
  test("julgamento em mecanico avisa com o modelo declarado; comum em mecanico e inherit não avisam", () => {
    const p = projeto({ texto: plano({ tiers: { 1: "mecanico", 2: "mecanico", 3: "mecanico", 4: "mecanico", 5: "inherit", 6: "inherit" } }) });
    const r = preVoo(p, { ciclo: CICLO });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.saida.ok, true, "o aviso não para");
    assert.deepEqual(r.saida.avisos, [
      { tipo: "tier", task: "T2", tier: "mecanico", modelo: DECLARACAO.tiers.mecanico },
      { tipo: "tier", task: "T3", tier: "mecanico", modelo: DECLARACAO.tiers.mecanico },
      { tipo: "tier", task: "T4", tier: "mecanico", modelo: DECLARACAO.tiers.mecanico },
    ]);
  });

  test("sem Tier declarado vale inherit: nenhum aviso", () => {
    const p = projeto();
    assert.deepEqual(preVoo(p, { ciclo: CICLO }).saida.avisos, []);
  });

  test("o tier da fase vale para a tarefa sem o seu; o da tarefa vence o da fase", () => {
    const p = projeto({ texto: plano({ tierDaFase: "mecanico", tiers: { 2: "critico" } }) });
    const r = preVoo(p, { ciclo: CICLO });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.saida.avisos.map((a) => a.task), ["T3", "T4", "T6"]);
  });

  test("sem modelo no mapa, o aviso sai com modelo null", () => {
    const p = projeto({ texto: plano({ tiers: { 2: "mecanico" } }), declaracao: { tiers: {} } });
    assert.deepEqual(preVoo(p, { ciclo: CICLO }).saida.avisos, [{ tipo: "tier", task: "T2", tier: "mecanico", modelo: null }]);
  });

  test("tier fora do vocabulário não vira inherit calado: o plano sai ilegível no aviso", () => {
    const p = projeto({ texto: plano({ tiers: { 2: "baratinho" } }) });
    const r = preVoo(p, { ciclo: CICLO });
    assert.equal(r.status, 0);
    assert.deepEqual(r.saida.avisos.map((a) => [a.tipo, a.motivo]), [["plano-ilegivel", "declaracao-invalida"]]);
    assert.match(r.saida.avisos[0].detalhe, /T2 Tier: baratinho/);
  });

  test("tier junto de uma falha: a pergunta leva os avisos", () => {
    const p = projeto({ restart: "no", texto: plano({ tiers: { 4: "mecanico" } }) });
    const r = preVoo(p, { ciclo: CICLO });
    assert.equal(r.status, 1);
    assert.deepEqual(r.saida.avisos.map((a) => a.task), ["T4"]);
  });

  test("pedeJulgamento: fechamento, review-gate, conferência do operador e sensível; comum não", () => {
    const comum = { marcas: [], classe: "comum", fechamento: false };
    assert.equal(pedeJulgamento(comum), false);
    assert.equal(pedeJulgamento({ ...comum, fechamento: true }), true);
    assert.equal(pedeJulgamento({ ...comum, marcas: ["review-gate"] }), true);
    assert.equal(pedeJulgamento({ ...comum, marcas: ["conferencia-do-operador"] }), true);
    assert.equal(pedeJulgamento({ ...comum, marcas: ["gate-de-ux"] }, [{ marca: "gate-de-ux" }]), true);
    assert.equal(pedeJulgamento({ ...comum, classe: "sensivel" }), true);
  });
});

describe("declaração v5: tiers e contrato do host", () => {
  const { tiers, sessao, ...resto } = DECLARACAO;
  const v4 = { ...resto, versao: 4, sessao: { modosSemClique: sessao.modosSemClique } };

  test("a v4 segue aceita, sem os campos novos", () => {
    const lida = validar(v4);
    assert.equal(lida.versao, 4);
    assert.deepEqual(lida.tiers, {});
    assert.equal(lida.sessao.cli, null);
  });

  test("os campos novos são só da v5", () => {
    assert.throws(() => validar({ ...v4, tiers }), /tiers: só na versao 5/);
    assert.throws(() => validar({ ...v4, sessao: { ...v4.sessao, cli: sessao.cli } }), /sessao\.cli: só na versao 5/);
  });

  test("recusa tier fora do vocabulário, modelo vazio, argv vazio, variável que não é nome e settings fora da raiz", () => {
    const v5 = { ...DECLARACAO };
    assert.throws(() => validar({ ...v5, tiers: { barato: "x" } }), /campo desconhecido barato/);
    assert.throws(() => validar({ ...v5, tiers: { mecanico: " " } }), /tiers\.mecanico/);
    assert.throws(() => validar({ ...v5, sessao: { ...sessao, cli: [] } }), /sessao\.cli/);
    assert.throws(() => validar({ ...v5, sessao: { ...sessao, variavelDoTrafego: "A B" } }), /sessao\.variavelDoTrafego/);
    assert.throws(() => validar({ ...v5, sessao: { ...sessao, settings: ["../fora.json"] } }), /fora da raiz/);
  });
});

// ── o núcleo não nomeia modelo nem fornecedor (AC-VEGA29-12) ───────────────────
const NOMES = /anthropic|openai|claude|opus|sonnet|haiku|gpt-|gemini|grok|cursor|codex/i;

function codigoDoNucleo() {
  const deDir = (dir) => readdirSync(dir).filter((f) => f.endsWith(".mjs")).map((f) => path.join(dir, f));
  return [...deDir(NUCLEO), ...deDir(path.join(NUCLEO, "adaptadores"))];
}

test("o código do núcleo não cita nome de modelo nem de fornecedor, nem em comentário nem em string", () => {
  const arquivos = codigoDoNucleo();
  assert.ok(arquivos.length >= 10, `núcleo lido pela metade: ${arquivos.length} arquivos`);
  const achados = [];
  for (const arquivo of arquivos)
    readFileSync(arquivo, "utf8")
      .split("\n")
      .forEach((linha, i) => {
        if (NOMES.test(linha)) achados.push(`${path.relative(NUCLEO, arquivo)}:${i + 1}: ${linha.trim()}`);
      });
  assert.deepEqual(achados, []);
});

test("contraprova: o detector acha nome de modelo e de fornecedor, inclusive colado em identificador", () => {
  for (const sujo of ["modelo: 'Sonnet'", "// fornecedor OpenAI", "const doPush = 1", "gpt-x", "pasta .Claude/", "x-codex", "Gemini", "grok", "cursor"])
    assert.ok(NOMES.test(sujo), sujo);
  assert.equal(NOMES.test("const dePush = runs; tier mecanico, parecer, critico, inherit"), false);
});
