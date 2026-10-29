// operador-declarado.test.mjs — o operador é o papel declarado e a dispensa de
// publicação é um campo no git (VEGA-29 T16, AC-VEGA29-10).
//
// Prova três coisas: (1) a conferência `nao-se-aplica` de task que o plano liga
// a publicação grava o trailer `Conducao-Publicacao-Dispensada: operador`, e o
// `auditar` aceita só por ele; (2) a frase dos commits antigos vale só quando a
// declaração do adaptador a lista em `publicacao.frasesLegadas`; (3) o código
// do núcleo não contém o nome nem o handle de nenhum operador declarado — os
// textos que nomeiam quem decide leem o nome da declaração.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PAPEL_DA_DISPENSA, TRAILER_DA_DISPENSA, dispensouPublicacao, validar } from "../adaptador.mjs";
import { politicaDaConferencia } from "../verbos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const NUCLEO = path.resolve(AQUI, "..");
/** O projeto de teste das suítes: a declaração e o código de um projeto de mentira. */
const RAIZ = path.resolve(AQUI, "fixtures", "projeto-de-teste");
const SCRIPT = path.join(NUCLEO, "conducao.mjs");
const DECLARACAO = JSON.parse(readFileSync(path.join(RAIZ, ".altair", "adaptador.json"), "utf8"));
const CICLO = "TESTE-1-conducao";
const CAMINHO = `.agents/ciclo/teste/${CICLO}/canonico.md`;

const canonico = [
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
  "#### T1 — tarefa T1",
  "",
  "- **Objetivo:** tarefa T1",
  "- **satisfies:** [AC-TESTE1-1]",
  "- **Inputs:** `README.md`",
  "- **Outputs:** `src/t1.mjs` (create)",
  "- **Estação:** servidor",
  "- **Independente:** sim",
  "- **Steps:** publica com `db push`",
  "- **Verificação:** `echo verificacao-T1`.",
  "- **Esperado:** exit 0.",
  "- **Falha-se:** exit 1.",
  `- **Commit:** \`${CICLO}-F1/T1 — tarefa T1\``,
  "",
  "## 4. Pronto",
  "",
].join("\n");

/** Ramo do ciclo com o plano autorizado, a declaração dada e uma conferência forjada de T1. */
function auditarCom(t, { declaracao, corpo = null, trailerExtra = [] }) {
  const raiz = mkdtempSync(path.join(tmpdir(), "operador-declarado-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const repo = path.join(raiz, "maestra");
  mkdirSync(repo);
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "ciclo-teste");
  g("config", "core.hooksPath", "/dev/null");
  g("config", "user.name", "teste");
  g("config", "user.email", "teste@example.invalid");
  g("config", "commit.gpgsign", "false");
  g("remote", "add", "origin", origin);
  for (const [p, c] of Object.entries({ "README.md": "fixture\n", [CAMINHO]: canonico, ".altair/adaptador.json": JSON.stringify(declaracao) })) {
    mkdirSync(path.join(repo, path.dirname(p)), { recursive: true });
    writeFileSync(path.join(repo, p), c);
  }
  g("add", "-A");
  g("commit", "-q", "-m", "plano");
  g("push", "-q", "origin", "ciclo-teste");
  const cli = (...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args, "--repo", repo, "--ciclo", CICLO], {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  const aut = cli("autorizar-ciclo", "F1", "--sim", "pode tocar a F1");
  assert.equal(aut.status, 0, aut.stderr);
  const trailers = [
    "Conducao-Task: T1",
    "Conducao-Sha-Filha: 0000000000000000000000000000000000000000",
    "Conducao-Sessao-Filha: s1",
    "Conducao-Nonce: x",
    "Conducao-Verificacao: verde",
    "Conducao-Publicacao: nao-se-aplica",
    ...trailerExtra,
  ];
  g("commit", "-q", "--allow-empty", "-m", "Conducao: T1 conferida", ...(corpo ? ["-m", corpo] : []), "-m", trailers.join("\n"));
  const r = cli("auditar", "--ref", "refs/heads/ciclo-teste");
  const saida = r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .find((o) => o?.acao === "auditar");
  assert.ok(saida, r.stdout + r.stderr);
  return saida.violacoes.filter((v) => v.regra === "nao-se-aplica-sem-sim");
}

const semLegadas = (() => {
  const { publicacao, ...resto } = DECLARACAO;
  void publicacao;
  return resto;
})();

test("a conferência nao-se-aplica grava a dispensa como trailer com o papel, nunca o nome", () => {
  const p = politicaDaConferencia({
    task: "T1",
    t: { publicacao: ["db push"], estacao: "servidor", posMerge: false },
    verificacao: "verde",
    publicacao: "nao-se-aplica",
    sim: "não publica",
    approval: () => assert.fail("approval"),
  });
  assert.deepEqual(p.dispensa, { [TRAILER_DA_DISPENSA]: PAPEL_DA_DISPENSA });
  assert.equal(PAPEL_DA_DISPENSA, "operador");
  for (const o of DECLARACAO.operadores) assert.doesNotMatch(`${p.corpo}\n${JSON.stringify(p.dispensa)}`, new RegExp(`\\b${o.nome}\\b|${o.handle}`));
});

test("o trailer novo dispensa a publicação no auditar, mesmo sem frase legada declarada", (t) => {
  assert.deepEqual(auditarCom(t, { declaracao: semLegadas, corpo: "Sem publicação: não publica", trailerExtra: [`${TRAILER_DA_DISPENSA}: ${PAPEL_DA_DISPENSA}`] }), []);
});

test("sem o trailer, o auditar acusa — o corpo novo sozinho não dispensa", (t) => {
  assert.equal(auditarCom(t, { declaracao: semLegadas, corpo: "Sem publicação: não publica" }).length, 1);
});

test("trailer com outro valor que não o papel não dispensa", (t) => {
  assert.equal(auditarCom(t, { declaracao: semLegadas, trailerExtra: [`${TRAILER_DA_DISPENSA}: alguem`] }).length, 1);
});

test("a frase antiga vale só pela lista de frases legadas da declaração", (t) => {
  const [frase] = DECLARACAO.publicacao.frasesLegadas;
  const corpo = `${frase}replay`;
  assert.deepEqual(auditarCom(t, { declaracao: DECLARACAO, corpo }), [], "o projeto de teste declara a frase antiga");
  assert.equal(auditarCom(t, { declaracao: semLegadas, corpo }).length, 1, "projeto sem a frase declarada não a aceita");
  assert.equal(auditarCom(t, { declaracao: DECLARACAO, corpo: frase.trimEnd() }).length, 1, "frase sem texto depois não dispensa");
});

test("dispensouPublicacao: trailer, frase legada declarada e nada", () => {
  const d = validar(DECLARACAO);
  const [frase] = d.publicacao.frasesLegadas;
  assert.equal(dispensouPublicacao(d, { trailers: { [TRAILER_DA_DISPENSA]: PAPEL_DA_DISPENSA } }), true);
  assert.equal(dispensouPublicacao(d, { corpo: `linha\n${frase}ok` }), true);
  assert.equal(dispensouPublicacao(validar(semLegadas), { corpo: `${frase}ok` }), false);
  assert.equal(dispensouPublicacao(d, { corpo: `${frase}  ok` }), false, "como o antigo ^<frase>\\S: espaço logo depois não vale");
  assert.equal(dispensouPublicacao(d, {}), false);
});

test("a conferência pela maestra também grava a dispensa como trailer", () => {
  const p = politicaDaConferencia({
    task: "T1",
    t: { publicacao: ["vercel --prod"], estacao: "maestra", posMerge: false },
    verificacao: "verde",
    publicacao: "nao-se-aplica",
    maestra: true,
    sessao: "m",
    sim: "não publica",
    approval: () => assert.fail("approval"),
  });
  assert.equal(p.via, "maestra");
  assert.equal(p.trailers[TRAILER_DA_DISPENSA], PAPEL_DA_DISPENSA);
  assert.equal(p.corpo, "Sem publicação: não publica");
});

test("as mensagens de recusa nomeiam o operador pelo nome declarado", () => {
  const [o] = DECLARACAO.operadores;
  assert.throws(
    () =>
      politicaDaConferencia({
        task: "T1",
        t: { publicacao: ["db push"], estacao: "servidor", posMerge: false },
        verificacao: "verde",
        publicacao: "nao-se-aplica",
        nomeDoOperador: o.nome,
        approval: () => assert.fail("approval"),
      }),
    (e) => e.codigo === "publicacao-pendente" && e.message.includes(`texto de ${o.nome} dizendo`),
  );
});

/** O código do núcleo sem comentário: bloco `/* … *\/` e linha que começa por `//`. */
function codigoSemComentario(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .map((l) => l.replace(/\s\/\/\s.*$/, ""))
    .join("\n");
}

test("o código do núcleo não contém o nome nem o handle de nenhum operador declarado", () => {
  const modulos = readdirSync(NUCLEO).filter((f) => f.endsWith(".mjs"));
  assert.ok(modulos.length >= 10, modulos.join(", "));
  const achados = [];
  for (const f of modulos) {
    const codigo = codigoSemComentario(readFileSync(path.join(NUCLEO, f), "utf8"));
    for (const o of DECLARACAO.operadores)
      for (const alvo of [o.nome, o.handle])
        codigo.split("\n").forEach((l, i) => {
          if (new RegExp(`(^|[^A-Za-z])${alvo}([^A-Za-z]|$)`).test(l)) achados.push(`${f}: ${alvo} em «${l.trim()}» (linha ${i + 1} sem comentário)`);
        });
  }
  assert.deepEqual(achados, []);
});

test("contraprova do detector: um texto com o nome declarado é achado", () => {
  const [o] = DECLARACAO.operadores;
  const codigo = codigoSemComentario(`// ${o.nome} no comentário não conta\nconst x = \`avisar ${o.nome}\`;\n`);
  assert.match(codigo, new RegExp(`(^|[^A-Za-z])${o.nome}([^A-Za-z]|$)`));
  assert.doesNotMatch(codigo, /comentário/);
});
