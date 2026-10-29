/**
 * contrato-atual.test.mjs — o contrato escrito da condução confere com o código (VEGA-29 T2).
 *
 * Extrai do código-fonte, sem executá-lo, as ações do `proximo`, os motivos de
 * cada ação, os códigos de saída de `main`, as marcas que `lerMarcas` e
 * `ultimaAutorizacao` reconhecem pelo subject e os trailers que elas leem
 * (desde a T5 as duas moram em `marcas.mjs`, dono único da gramática); e
 * exige igualdade com as tabelas de `../contrato-atual.md`. Item no código que o
 * texto não tem, ou no texto que o código não tem, falha nomeando o item.
 *
 * NOMES DE TESTE SAO CONTRATO: conferidos por `assert-test-names.mjs --file/--name`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PASTA = path.resolve(AQUI, "..");
const CONDUCAO = readFileSync(path.join(PASTA, "conducao.mjs"), "utf8");
const MARCAS = readFileSync(path.join(PASTA, "marcas.mjs"), "utf8");
const REGRAS = readFileSync(path.join(PASTA, "regras.mjs"), "utf8");
const CONTRATO = path.join(PASTA, "contrato-atual.md");

// ── leitura do código-fonte ─────────────────────────────────────────────────

/**
 * Troca comentários e o miolo de strings por espaço, preservando posições:
 * os índices do texto mascarado valem no original. O miolo de `${…}` de
 * template literal fica visível (é código).
 */
function mascarar(src) {
  const out = src.split("");
  const apagar = (i) => {
    if (out[i] !== "\n") out[i] = " ";
  };
  const pilha = []; // profundidade de `{` aberta dentro de `${`
  let i = 0;
  const n = src.length;
  const lerTemplate = () => {
    // i aponta logo depois de uma crase ou do `}` que fecha um `${`
    while (i < n) {
      if (src[i] === "\\") { apagar(i); apagar(i + 1); i += 2; continue; }
      if (src[i] === "`") { i++; return; }
      if (src[i] === "$" && src[i + 1] === "{") { pilha.push(0); i += 2; return; }
      apagar(i++);
    }
  };
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") apagar(i++); continue; }
    if (c === "/" && src[i + 1] === "*") {
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) apagar(i++);
      apagar(i); apagar(i + 1); i += 2; continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") { apagar(i); i++; }
        apagar(i++);
      }
      i++;
      continue;
    }
    if (c === "`") { i++; lerTemplate(); continue; }
    if (pilha.length && c === "{") { pilha[pilha.length - 1]++; i++; continue; }
    if (pilha.length && c === "}") {
      if (pilha[pilha.length - 1] === 0) { pilha.pop(); i++; lerTemplate(); continue; }
      pilha[pilha.length - 1]--;
      i++;
      continue;
    }
    // Regex literal: depois de `(`, `,`, `=`, `:`, `[`, `!`, `&`, `|`, `?`, `{`, `}`, `;`, `=>`, `return`, `typeof` ou início.
    if (c === "/") {
      let j = i - 1;
      while (j >= 0 && /\s/.test(src[j])) j--;
      const antes = src.slice(Math.max(0, j - 5), j + 1);
      if (j < 0 || "(,=:[!&|?{};>".includes(src[j]) || /(?:^|[^\w$])(?:return|typeof)$/.test(antes)) {
        i++;
        let classe = false;
        while (i < n && (classe || src[i] !== "/")) {
          if (src[i] === "\\") { apagar(i); i++; }
          else if (src[i] === "[") classe = true;
          else if (src[i] === "]") classe = false;
          apagar(i++);
        }
        i++;
        continue;
      }
    }
    i++;
  }
  return out.join("");
}

/** Índice do fechamento que casa com a abertura em `ini`, no texto mascarado. */
function fecho(mask, ini) {
  const abre = mask[ini];
  const fecha = { "(": ")", "{": "}", "[": "]" }[abre];
  let prof = 0;
  for (let i = ini; i < mask.length; i++) {
    if (mask[i] === abre) prof++;
    else if (mask[i] === fecha && --prof === 0) return i;
  }
  throw new Error(`sem fechamento para ${abre} em ${ini}`);
}

/** Corpo `{ … }` de uma função declarada pelo nome, como `[ini, fim]` no texto. */
function corpo(src, mask, nome) {
  const m = new RegExp(`\\bfunction ${nome}\\(`).exec(mask);
  assert.ok(m, `função ${nome} não encontrada no código`);
  const fimParams = fecho(mask, m.index + m[0].length - 1);
  const abre = mask.indexOf("{", fimParams);
  return [abre, fecho(mask, abre)];
}

/** Literais de string (aspas duplas) de um trecho do texto original. */
function literais(trecho) {
  return [...trecho.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
}

const MASK_CONDUCAO = mascarar(CONDUCAO);
const MASK_MARCAS = mascarar(MARCAS);
const MASK_REGRAS = mascarar(REGRAS);

/**
 * Onde moram as ações do `proximo`: em `conducao.mjs`, `decidir`, `decidirMaestra`
 * (o nível da maestra), `proximo` e `erroComoPergunta`; em `regras.mjs`, toda função declarada no topo — as
 * `regra…` que `decidir` chama em ordem e os auxiliares delas que montam
 * ação, como `perguntaDoPlano` (VEGA-29 T6 e T7, D-VEGA29-24).
 */
const NOMES_REGRAS = [...MASK_REGRAS.matchAll(/^(?:export )?function (\w+)\(/gm)].map((m) => m[1]);
assert.ok(NOMES_REGRAS.some((n) => n.startsWith("regra")), "regras.mjs sem `export function regra…` — o extrator não acharia as ações dela");
const FONTES_DO_PROXIMO = [
  { SRC: CONDUCAO, MASK: MASK_CONDUCAO, nomes: ["decidir", "decidirMaestra", "proximo", "erroComoPergunta"] },
  { SRC: REGRAS, MASK: MASK_REGRAS, nomes: NOMES_REGRAS },
];

/** Ações e pares (ação, motivo) do caminho do `proximo`, nas `FONTES_DO_PROXIMO`. */
function acoesEMotivosDoCodigo() {
  const acoes = new Set();
  const motivos = new Set(); // "ação motivo"
  const dinamicos = new Set(); // "ação expressão" — motivo não literal
  const soltos = new Set(); // motivo literal fora de toda ação

  for (const { SRC, MASK, nomes } of FONTES_DO_PROXIMO) {
    const atribuidos = new Set(); // índice de `motivo:` já ligado a uma ação, nesta fonte

    const varrerMotivos = (ini, fim, acao) => {
      const re = /\bmotivo:\s*/g;
      re.lastIndex = ini;
      let m;
      while ((m = re.exec(MASK)) && m.index < fim) {
        if (atribuidos.has(m.index)) continue;
        atribuidos.add(m.index);
        const valor = m.index + m[0].length;
        if (SRC[valor] === '"') motivos.add(`${acao} ${literais(SRC.slice(valor, SRC.indexOf('"', valor + 1) + 1))[0]}`);
        else dinamicos.add(`${acao} ${expressao(valor)}`);
      }
      // `{ motivo, … }` abreviado: o valor vem de variável — só a vigia o usa.
      const curto = /[{,]\s*motivo\s*(?=[,}])/g;
      curto.lastIndex = ini;
      while ((m = curto.exec(MASK)) && m.index < fim) {
        if (atribuidos.has(m.index)) continue;
        atribuidos.add(m.index);
        dinamicos.add(`${acao} motivo`);
      }
    };
    // Expressão de valor até a vírgula ou o fecho de topo, espaços colapsados.
    const expressao = (de) => {
      let prof = 0;
      let i = de;
      for (; i < MASK.length; i++) {
        const c = MASK[i];
        if ("([{".includes(c)) prof++;
        else if (")]}".includes(c)) { if (prof === 0) break; prof--; }
        else if (c === "," && prof === 0) break;
      }
      return SRC.slice(de, i).replace(/\s+/g, " ").trim();
    };

    for (const nome of nomes) {
      const [ini, fim] = corpo(SRC, MASK, nome);
      const trecho = MASK.slice(ini, fim);
      // Chamada `acao("X", …)`: motivos dentro dos parênteses dela.
      for (const m of trecho.matchAll(/\bacao\(/g)) {
        const abre = ini + m.index + m[0].length - 1;
        const tipo = literais(SRC.slice(abre, SRC.indexOf(",", abre)))[0];
        assert.ok(tipo !== undefined, `${nome}: acao(…) com tipo não literal em aspas duplas — o extrator não sabe a ação: ${SRC.slice(abre, abre + 60)}`);
        acoes.add(tipo);
        varrerMotivos(abre, fecho(MASK, abre), tipo);
      }
      // Objeto `{ acao: "X", … }`: motivos dentro das chaves dele.
      for (const m of trecho.matchAll(/\bacao:\s*/g)) {
        const valor = ini + m.index + m[0].length;
        if (SRC[valor] !== '"') {
          // Só a fábrica `acao: tipo` de `decidir` e de `decidirMaestra` é não literal; outra forma é ponto cego.
          assert.ok((nome === "decidir" || nome === "decidirMaestra") && /^tipo\b/.test(SRC.slice(valor)), `${nome}: \`acao:\` com valor não literal: ${SRC.slice(valor, valor + 60)}`);
          continue;
        }
        const tipo = literais(SRC.slice(valor, SRC.indexOf('"', valor + 1) + 1))[0];
        acoes.add(tipo);
        const abre = MASK.lastIndexOf("{", ini + m.index);
        varrerMotivos(abre, fecho(MASK, abre), tipo);
      }
      // `perguntaDoPlano(…)` embrulha `acao("perguntar", …)`: o motivo dos campos sobrescreve.
      for (const m of trecho.matchAll(/\bperguntaDoPlano\(/g)) {
        const abre = ini + m.index + m[0].length - 1;
        varrerMotivos(abre, fecho(MASK, abre), "perguntar");
      }
      // Vigia de filha: o 1º elemento de cada tupla é o motivo da pergunta (`acao("perguntar", …, { motivo, … })`).
      for (const m of trecho.matchAll(/\bperguntasDaVigia\.push\(\[/g)) {
        const abre = ini + m.index + m[0].length - 1;
        const primeiro = SRC.slice(abre + 1, fecho(MASK, abre)).split(/,\s*t\b/)[0];
        const ls = literais(primeiro);
        assert.ok(ls.length, `tupla da vigia sem motivo literal: ${primeiro.slice(0, 60)}`);
        for (const l of ls) motivos.add(`perguntar ${l}`);
      }
    }
    for (const nome of nomes) {
      const [ini, fim] = corpo(SRC, MASK, nome);
      const trecho = MASK.slice(ini, fim);
      const usos = [...trecho.matchAll(/\bperguntasDaVigia\b(?!\.push\(\[|\.length\b|\[0\])/g)].length;
      const decl = [...trecho.matchAll(/\bconst perguntasDaVigia = \[\]/g)].length;
      assert.equal(usos, decl, `${nome}: perguntasDaVigia usada fora de \`push([…])\` — motivo pode entrar sem o extrator ver`);
    }
    // Motivo literal que nenhuma ação embrulha (o da falha anterior, levado pelo `abrir`).
    for (const nome of nomes) {
      const [ini, fim] = corpo(SRC, MASK, nome);
      const re = /\bmotivo:\s*"/g;
      re.lastIndex = ini;
      let m;
      while ((m = re.exec(MASK)) && m.index < fim) {
        if (atribuidos.has(m.index)) continue;
        const valor = m.index + m[0].length - 1;
        soltos.add(literais(SRC.slice(valor, SRC.indexOf('"', valor + 1) + 1))[0]);
      }
    }
  }
  return { acoes, motivos, dinamicos, soltos };
}

/** Códigos de saída de `main`: inteiros em `return …;` e em `sair(<n>, …)`. */
function codigosDoCodigo() {
  const [ini, fim] = corpo(CONDUCAO, MASK_CONDUCAO, "main");
  const trecho = MASK_CONDUCAO.slice(ini, fim);
  const codigos = new Set();
  assert.ok(!/\bprocess\.(?:exit|exitCode)\b/.test(trecho), "main: process.exit/exitCode dentro de main — o extrator lê só `return`");
  for (const m of trecho.matchAll(/\breturn\s+([^;]*);/g)) {
    const ds = [...m[1].matchAll(/(?<![\w.])(\d+)(?![\w.])/g)];
    assert.ok(ds.length || m[1].trim() === "codigo", `main: return sem código literal: ${m[1].trim().slice(0, 60)}`);
    for (const d of ds) codigos.add(Number(d[1]));
  }
  return codigos;
}

/** Marcas reconhecidas pelo subject: `tipo regex` do objeto `RE` e de `ultimaAutorizacao`. */
function marcasDoCodigo() {
  const lerMarcas = new Set();
  const regexDoTipo = new Map();
  const ini = MASK_MARCAS.search(/\bconst RE = \{/);
  assert.ok(ini >= 0, "objeto RE não encontrado em marcas.mjs");
  const abre = MASK_MARCAS.indexOf("{", ini);
  const bloco = MARCAS.slice(abre + 1, fecho(MASK_MARCAS, abre));
  for (const m of bloco.matchAll(/^\s*([a-z]+):\s*\/(.+)\/,?\s*$/gm)) {
    lerMarcas.add(`${m[1]} ${m[2]}`);
    regexDoTipo.set(m[1], m[2]);
  }
  const chaves = [...mascarar(bloco).matchAll(/^\s*([\w$]+)\s*:/gm)].length;
  assert.equal(lerMarcas.size, chaves, "objeto RE com entrada fora da forma `chave: /regex/,` numa linha — o extrator não a leu");
  // Toda regex de subject `^Conducao: ` em lerMarcas (o parse é `marcasDoLog`) vem do RE.
  for (const nome of ["lerMarcas", "marcasDoLog"]) {
    const [i1, f1] = corpo(MARCAS, MASK_MARCAS, nome);
    assert.ok(!/\/\^Conducao: /.test(MARCAS.slice(i1, f1)), `${nome} com regex de subject fora do objeto RE`);
  }

  // `ultimaAutorizacao` filtra a lista de `lerMarcas` pelo tipo: a regex é a do RE para esse tipo.
  const [i2, f2] = corpo(MARCAS, MASK_MARCAS, "ultimaAutorizacao");
  const ultima = new Set();
  for (const m of MARCAS.slice(i2, f2).matchAll(/\btipo === "([a-z]+)"/g)) {
    assert.ok(regexDoTipo.has(m[1]), `ultimaAutorizacao filtra tipo fora do RE: ${m[1]}`);
    ultima.add(`${m[1]} ${regexDoTipo.get(m[1])}`);
  }
  return { lerMarcas, ultima };
}

/** Trailers que cada leitora consulta. */
function trailersDoCodigo() {
  const [i1, f1] = corpo(MARCAS, MASK_MARCAS, "marcasDoLog");
  const lerMarcas = new Set([...MARCAS.slice(i1, f1).matchAll(/\btr\["([^"]+)"\]/g)].map((m) => m[1]));
  const outros = [...MASK_MARCAS.slice(i1, f1).matchAll(/\btr\b(?!\[")/g)].map((m) => MASK_MARCAS.slice(i1 + m.index - 12, i1 + m.index + 4));
  for (const o of outros)
    assert.ok(/const tr =|trailers: tr/.test(o), `lerMarcas lê \`tr\` por forma que o extrator não vê: ${o.trim()}`);
  assert.ok(!/trailers:key=/.test(MARCAS.slice(i1, f1)), "lerMarcas com trailers:key= — o extrator lê só tr[\"…\"]");
  // `ultimaAutorizacao` devolve campos da marca `autorizada`: o trailer de cada campo `a.<campo>`
  // é o que `marcasDoLog` lê para esse campo no ramo `RE.autorizada`.
  const ramoIni = MARCAS.indexOf("RE.autorizada.exec", i1);
  assert.ok(ramoIni >= 0 && ramoIni < f1, "marcasDoLog sem o ramo RE.autorizada");
  const ramoFim = MARCAS.indexOf("else if", ramoIni);
  const trailerDoCampo = new Map([...MARCAS.slice(ramoIni, ramoFim).matchAll(/\b(\w+):\s*tr\["([^"]+)"\]/g)].map((m) => [m[1], m[2]]));
  const [i2, f2] = corpo(MARCAS, MASK_MARCAS, "ultimaAutorizacao");
  const ultima = new Set();
  for (const m of MASK_MARCAS.slice(i2, f2).matchAll(/\ba\.(\w+)/g)) if (trailerDoCampo.has(m[1])) ultima.add(trailerDoCampo.get(m[1]));
  return { lerMarcas, ultima };
}

// ── leitura do texto ────────────────────────────────────────────────────────

/** Linhas de tabela da seção `## <titulo>`: células com a crase tirada. */
function tabela(texto, titulo) {
  const partes = texto.split(/^## /m);
  const secao = partes.find((p) => p.startsWith(`${titulo}\n`));
  assert.ok(secao, `seção "## ${titulo}" ausente de contrato-atual.md`);
  return secao
    .split("\n")
    .filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l))
    .slice(1) // cabeçalho
    .map((l) =>
      l
        .replace(/^\||\|$/g, "")
        .split(/(?<!\\)\|/)
        .map((c) => c.trim().replace(/\\\|/g, "|"))
        .map((c) => (/^`.*`$/.test(c) ? c.slice(1, -1) : c)),
    );
}

function conferir(nome, doCodigo, doTexto) {
  const faltaNoTexto = [...doCodigo].filter((x) => !doTexto.has(x)).sort();
  const sobraNoTexto = [...doTexto].filter((x) => !doCodigo.has(x)).sort();
  assert.deepEqual(
    { faltaNoTexto, sobraNoTexto },
    { faltaNoTexto: [], sobraNoTexto: [] },
    `${nome}: no código e fora do texto [${faltaNoTexto.join(", ")}] · no texto e fora do código [${sobraNoTexto.join(", ")}]`,
  );
}

function lerContrato() {
  return readFileSync(CONTRATO, "utf8");
}

// ── testes ──────────────────────────────────────────────────────────────────

test("ações do proximo: o texto lista exatamente as do código", () => {
  const { acoes } = acoesEMotivosDoCodigo();
  const texto = new Set(tabela(lerContrato(), "Ações do proximo").map((l) => l[0]));
  conferir("ações do proximo", acoes, texto);
});

test("motivos por ação: o texto lista exatamente os pares do código", () => {
  const { motivos } = acoesEMotivosDoCodigo();
  const texto = new Set(tabela(lerContrato(), "Motivos por ação").map((l) => `${l[0]} ${l[1]}`));
  conferir("motivos por ação", motivos, texto);
});

test("motivos não literais e da falha anterior: o texto lista exatamente os do código", () => {
  const { dinamicos, soltos } = acoesEMotivosDoCodigo();
  const contrato = lerContrato();
  conferir("motivos não literais", dinamicos, new Set(tabela(contrato, "Motivos não literais").map((l) => `${l[0]} ${l[1]}`)));
  conferir("motivos da falha anterior", soltos, new Set(tabela(contrato, "Motivos da falha anterior").map((l) => l[0])));
});

test("códigos de saída de main: o texto lista exatamente os do código", () => {
  const texto = new Set(tabela(lerContrato(), "Códigos de saída").map((l) => Number(l[0])));
  conferir("códigos de saída", codigosDoCodigo(), texto);
});

test("marcas pelo subject: o texto lista exatamente a gramática do código", () => {
  const { lerMarcas, ultima } = marcasDoCodigo();
  const linhas = tabela(lerContrato(), "Marcas pelo subject");
  conferir("marcas de lerMarcas", lerMarcas, new Set(linhas.filter((l) => l[2].includes("lerMarcas")).map((l) => `${l[0]} ${l[1]}`)));
  conferir("marcas de ultimaAutorizacao", ultima, new Set(linhas.filter((l) => l[2].includes("ultimaAutorizacao")).map((l) => `${l[0]} ${l[1]}`)));
});

test("trailers lidos: o texto lista exatamente os do código", () => {
  const { lerMarcas, ultima } = trailersDoCodigo();
  const linhas = tabela(lerContrato(), "Trailers lidos");
  conferir("trailers de lerMarcas", lerMarcas, new Set(linhas.filter((l) => l[1].includes("lerMarcas")).map((l) => l[0])));
  conferir("trailers de ultimaAutorizacao", ultima, new Set(linhas.filter((l) => l[1].includes("ultimaAutorizacao")).map((l) => l[0])));
});

test("extrator não sai vazio: cada classe acha ao menos um item no código", () => {
  const { acoes, motivos, dinamicos, soltos } = acoesEMotivosDoCodigo();
  const { lerMarcas: marcas, ultima } = marcasDoCodigo();
  const { lerMarcas: trailers, ultima: trailersUltima } = trailersDoCodigo();
  for (const [nome, s] of Object.entries({ acoes, motivos, dinamicos, soltos, codigos: codigosDoCodigo(), marcas, ultima, trailers, trailersUltima }))
    assert.ok(s.size > 0, `extrator de ${nome} devolveu vazio — o código mudou de forma e o teste ficou cego`);
});
