// conduzivel.test.mjs — o contrato do plano conduzível (VEGA-29 T22, D-VEGA29-34).
//
// O plano de exemplo da T21 passa no contrato de `references/conduzivel.md`,
// lido pelo adaptador embutido declarado por nome (`"codigo": "superpowers"`),
// sem código nenhum em `.altair/`; e cada anotação obrigatória da tabela do
// contrato, tirada de uma tarefa, faz o núcleo recusar o plano.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { codigoDoAdaptador } from "../adaptador.mjs";
import { ErroPlano, lerPlanoNoCommit } from "../ler-plano.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..", "..");
const CONTRATO = readFileSync(path.join(RAIZ, "skills", "conducao", "references", "conduzivel.md"), "utf8");
const EXEMPLO = readFileSync(path.join(AQUI, "fixtures", "exemplo-superpowers.md"), "utf8");
const CICLO = "fase-2";

const tmps = [];
after(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Primeira coluna da tabela sob `## <titulo>` do contrato, sem crases. */
function primeiraColuna(titulo) {
  const secao = CONTRATO.split(/^## /m).find((p) => p.startsWith(`${titulo}\n`));
  assert.ok(secao, `seção "## ${titulo}" ausente de conduzivel.md`);
  return secao
    .split("\n")
    .filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l))
    .slice(1)
    .map((l) => l.split("|")[1].trim().replace(/^`(.*)`$/, "$1"));
}

/** Projeto de mentira: declaração com o embutido por nome e o plano em `docs/planos/`. */
function projeto(plano) {
  const repo = mkdtempSync(path.join(tmpdir(), "conduzivel-"));
  tmps.push(repo);
  const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  mkdirSync(path.join(repo, ".altair"));
  mkdirSync(path.join(repo, "docs", "planos"), { recursive: true });
  writeFileSync(
    path.join(repo, ".altair", "adaptador.json"),
    JSON.stringify({
      versao: 2,
      codigo: "superpowers",
      projeto: "mentira",
      operadores: [{ handle: "op", nome: "Operador" }],
      estado: { pasta: "mentira/conducao" },
      log: { pasta: "." },
      pergunta: { destino: "log" },
      ci: false,
    }),
  );
  writeFileSync(path.join(repo, "docs", "planos", `${CICLO}.md`), plano);
  git("add", "-A");
  git("commit", "-q", "-m", "plano");
  return repo;
}

/** O exemplo sem a linha `**<campo>:**` da primeira tarefa que a tem. */
function semAnotacao(campo) {
  const L = EXEMPLO.split("\n");
  const i = L.findIndex((l) => l.startsWith(`**${campo}:**`));
  assert.ok(i >= 0, `exemplo sem nenhuma anotação ${campo}`);
  const tarefa = L.slice(0, i).findLast((l) => /^### Tarefa \d+:/.test(l));
  L.splice(i, 1);
  return { texto: L.join("\n"), task: `T${/^### Tarefa (\d+):/.exec(tarefa)[1]}` };
}

describe("o plano de exemplo passa no contrato", () => {
  test("lido pelo embutido declarado por nome, sem código em .altair/", () => {
    const repo = projeto(EXEMPLO);
    assert.equal(existsSync(path.join(repo, ".altair", "superpowers.mjs")), false);
    assert.equal(codigoDoAdaptador(repo).plano.raiz, "docs");
    const { caminho, plano } = lerPlanoNoCommit(repo, "HEAD", CICLO);
    assert.equal(caminho, `docs/planos/${CICLO}.md`);
    assert.deepEqual(plano.tasks.map((t) => t.id), ["T1", "T2", "T3", "T4", "T5"]);
    for (const t of plano.tasks) {
      assert.ok(t.estacao, `${t.id} sem estação`);
      assert.ok(t.verificacao, `${t.id} sem Verificação`);
      assert.ok(t.outputs.length, `${t.id} sem Outputs`);
    }
    // Toda fase tem a tarefa que a fecha.
    for (const f of plano.fases) assert.ok(plano.tasks.some((t) => t.fase === f.id && t.fechamento), `${f.id} sem fechamento-de-fase`);
  });

  test("dependência de ordem é a leitura conservadora; Independente a desfaz", () => {
    const { plano } = lerPlanoNoCommit(projeto(EXEMPLO), "HEAD", CICLO);
    assert.deepEqual(plano.porId.get("T2").deps, []);
    assert.equal(plano.porId.get("T2").independente, true);
    assert.deepEqual(plano.porId.get("T3").deps, ["T2"]);
  });
});

describe("plano fora do contrato é recusado", () => {
  const obrigatorias = primeiraColuna("Anotações obrigatórias de cada tarefa");

  test("o contrato lista as anotações que o núcleo cobra", () => {
    assert.deepEqual(obrigatorias, ["Estação", "Publicação", "Sensível", "Verificação", "Commit"]);
  });

  for (const campo of obrigatorias)
    test(`tarefa sem ${campo} vai a perguntar (declaracao-invalida), sem abrir filha`, () => {
      const { texto, task } = semAnotacao(campo);
      assert.throws(
        () => lerPlanoNoCommit(projeto(texto), "HEAD", CICLO),
        (e) => e instanceof ErroPlano && e.codigo === "declaracao-invalida" && e.message.includes(`${task} ${campo}`),
      );
    });

  test("fase sem tarefa de fechamento vai a perguntar", () => {
    const texto = EXEMPLO.replace("**Marcas:** fechamento-de-fase\n", "");
    assert.throws(
      () => lerPlanoNoCommit(projeto(texto), "HEAD", CICLO),
      (e) => e instanceof ErroPlano && e.codigo === "declaracao-invalida" && /fechamento-de-fase/.test(e.message),
    );
  });
});

describe("o contrato cobre os achados da execução", () => {
  test("Outputs num núcleo dividido por lugar (A6) e dependência de dado × de ordem (A7)", () => {
    assert.match(CONTRATO, /^\*\*Núcleo dividido por lugar\.\*\*/m);
    assert.match(CONTRATO, /^## Dependência de dado e dependência de ordem$/m);
    const planejar = readFileSync(path.join(RAIZ, "skills", "conducao", "references", "planejar.md"), "utf8");
    assert.match(planejar, /Procurar ativamente tarefas independentes/);
    assert.match(planejar, /sondas e medições/);
  });
});
