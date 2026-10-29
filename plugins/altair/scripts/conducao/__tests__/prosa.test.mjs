/**
 * Prosa viva da condução (VEGA-29 T23 e T24, AC-VEGA29-10): a skill, o contrato
 * genérico, o brief da operária e o INSTALL dos hooks falam do papel, nunca da
 * pessoa, e não carregam história.
 *
 * - Tamanho: a soma das palavras dos dois corpos (sem o frontmatter, contadas
 *   como o `wc -w`) fica na faixa; acima dela o texto voltou a inchar, abaixo
 *   dela algo do laço saiu sem destino. Só a skill e o contrato contam: o brief
 *   e o INSTALL passam pela mesma régua de pessoa e de história, sem faixa.
 * - Pessoa: nenhum nome nem handle de operador que o projeto declara em
 *   `.altair/adaptador.json`, nem nome de quem decide fora da condução — sem
 *   distinguir maiúscula de minúscula (flag `iu`).
 * - História: nenhuma data, nenhum id de decisão ou de ciclo, nenhuma citação
 *   de ruling. A história fica com o projeto de origem; o que é
 *   de um projeto, na página dele (o campo `pagina` da declaração).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..", "..");
const TEXTOS = ["skills/conducao/SKILL.md", "skills/conducao/references/contrato.md"];
const COM_A_REGUA = [...TEXTOS, "skills/conducao/references/brief-operaria.md", "INSTALL.md"];
/** As declarações que as suítes leem: o projeto de teste e o projeto de exemplo do repositório. */
const DECLARACOES = [path.resolve(AQUI, "fixtures", "projeto-de-teste", ".altair", "adaptador.json"), path.resolve(RAIZ, "..", "..", "exemplo", ".altair", "adaptador.json")];
const FAIXA = { min: 5500, max: 6000 };
// Gente que decide fora da condução e não é operador declarado.
const OUTRAS_PESSOAS = ["Fulano", "Beltrano"];

const ler = (rel) => readFileSync(path.join(RAIZ, rel), "utf8");

/** Separa o frontmatter (`---` … `---` no topo) do corpo. */
export function partes(texto) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(texto);
  return m ? { frontmatter: m[1], corpo: texto.slice(m[0].length) } : { frontmatter: "", corpo: texto };
}

export function palavras(texto) {
  return texto.split(/\s+/).filter(Boolean).length;
}

function nomesDeclarados() {
  const operadores = DECLARACOES.flatMap((f) => JSON.parse(readFileSync(f, "utf8")).operadores);
  return [...operadores.flatMap((o) => [o.nome, o.handle]), ...OUTRAS_PESSOAS];
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const HISTORIA = [
  ["data", /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/],
  ["data ISO", /\b\d{4}-\d{2}-\d{2}\b/],
  ["ruling", /\bruling\b/i],
  ["id de decisão", /\bD-[A-Z0-9]+-\d+\b/],
  ["id de ciclo", /\b[A-Z]{2,6}-\d+\b/],
  ["item de gate", /\b(?:F\d+\.\d+[a-z]?|\d+\.\d+[a-z])\b/],
];

/** Achados de pessoa e de história num texto; vazio = texto vivo limpo. */
export function achados(texto, nomes) {
  const { corpo } = partes(texto);
  const saida = [];
  for (const nome of nomes) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_-])${escapar(nome)}(?![\\p{L}\\p{N}_-])`, "iu");
    const m = re.exec(texto);
    if (m) saida.push(`pessoa ${JSON.stringify(nome)}: …${texto.slice(Math.max(0, m.index - 30), m.index + 30)}…`);
  }
  for (const [tipo, re] of HISTORIA) {
    const m = re.exec(corpo);
    if (m) saida.push(`${tipo} ${JSON.stringify(m[0])}: …${corpo.slice(Math.max(0, m.index - 30), m.index + 30)}…`);
  }
  return saida;
}

test("skill e contrato somam palavras dentro da faixa", () => {
  const contagem = TEXTOS.map((rel) => [rel, palavras(partes(ler(rel)).corpo)]);
  const soma = contagem.reduce((s, [, n]) => s + n, 0);
  assert.ok(soma >= FAIXA.min && soma <= FAIXA.max, `soma ${soma} fora de ${FAIXA.min}–${FAIXA.max}: ${JSON.stringify(contagem)}`);
});

test("skill, contrato, brief e INSTALL não citam pessoa nem história", () => {
  const nomes = nomesDeclarados();
  assert.ok(nomes.length >= OUTRAS_PESSOAS.length + 2, "a declaração do projeto não trouxe operador");
  for (const rel of COM_A_REGUA) assert.deepEqual(achados(ler(rel), nomes), [], rel);
});

test("o detector acha o que procura (contraprova)", () => {
  const nomes = ["Fulana", "fulana99"];
  const limpo = "---\nupdated: 2026-01-01\n---\n\nO operador dá o sim, num turno dele.\n";
  assert.deepEqual(achados(limpo, nomes), []);
  for (const sujo of [
    "a Fulana deu o sim",
    "a fulana deu o sim",
    "como pediu FULANA99",
    "como pediu fulana99",
    "decidido em 23/10",
    "medido em 2026-10-23",
    "pelo ruling da fase",
    "ver D-ABC12-3",
    "como no VEGA-22",
    "item F4.17 da sessão",
    "o 18.4a mandou",
  ])
    assert.equal(achados(sujo, nomes).length, 1, sujo);
  assert.equal(palavras("um  dois\ntrês\tquatro"), 4);
  assert.deepEqual(partes(limpo).frontmatter, "updated: 2026-01-01");
});
