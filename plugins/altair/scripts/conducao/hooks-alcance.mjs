/**
 * hooks-alcance.mjs — o que os hooks de commit da maestra executam (VEGA-22 T8).
 *
 * Trabalho de filha que toca isto pergunta ao operador antes de trazer
 * (D-VEGA22-17). A lista é a base fixa de `botoes.mjs` (`baseAlcance`); este
 * script extrai o que `pre-commit`, `post-commit` e `commit-msg` chamam e
 * confere que cada chamada cai na base. Hook que passa a chamar algo fora
 * dela faz o teste falhar — a base cresce em `botoes.mjs`, nunca aqui.
 *
 * Extração (§2.2#8 do canonico):
 *   - todo token de linha não-comentário (`echo` só depois do `|`) que nomeia arquivo
 *     existente do repo — `node <path>`, `bash <path>`, `--config <path>`,
 *     `require('./…')` dentro de `node -e`, variável atribuída e usada depois;
 *   - `pnpm turbo <task>` / `turbo <task>` / `pnpm [run] <script>` → o script
 *     de `package.json` de cada workspace, e os `dependsOn` do `turbo.json`,
 *     extraídos do mesmo jeito, com o caminho relativo ao workspace;
 *   - `npx <bin>` / `pnpm exec <bin>` → binário de `node_modules`, que só
 *     muda por `package.json` ou lockfile (já na base);
 *   - import relativo de cada `.js/.mjs/.cjs/.ts` alcançado, transitivo.
 *
 * O que um script lê em runtime por caminho montado (`join(__dirname, …)`)
 * não aparece no texto: a base cobre por diretório (ex.: o schema ao lado do
 * validador de flow).
 *
 * CLI: `node hooks-alcance.mjs [--repo <dir>]` → JSON `{ chamadas, fora }`;
 * exit 1 se `fora` não estiver vazio.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOTOES } from "./botoes.mjs";
import { casaAlgum } from "./ler-plano.mjs";

export const HOOKS_DE_COMMIT = Object.freeze([
  "pre-commit",
  "post-commit",
  "commit-msg",
]);

const EXT_CODIGO = /\.(?:js|mjs|cjs|ts|mts|cts)$/;
const TOKEN_CAMINHO =
  /(?:\.{1,2}\/)?[A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_.-]+)*\.[A-Za-z0-9]+/g;
const IMPORT_RELATIVO =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']+)["']/gm;

/** Caminho do repo em forma canônica: separador `/`, sem `./`. */
function normalizar(p) {
  return path.posix.normalize(p.split(path.sep).join("/")).replace(/^\.\//, "");
}

function ehArquivo(repo, rel) {
  if (!rel || rel.startsWith("../") || rel.startsWith("/")) return false;
  try {
    return statSync(path.join(repo, rel)).isFile();
  } catch {
    return false;
  }
}

/**
 * Linhas que executam algo: sem comentário de linha inteira; de `echo`
 * (texto mostrado ao humano, nunca executado) sobra só o que vem depois do
 * primeiro `|` — `echo "$x" | xargs npx prettier` executa o prettier. Variáveis atribuídas com
 * valor literal (`guard=.host/hooks/x.js`) são expandidas onde aparecem.
 */
export function linhasExecutadas(texto) {
  const vars = new Map();
  const saida = [];
  for (const bruta of texto.split(/\r?\n/)) {
    let linha = bruta.trim();
    if (/^echo\b/.test(linha))
      linha = linha.includes("|")
        ? linha.slice(linha.indexOf("|") + 1).trim()
        : "";
    if (!linha || linha.startsWith("#")) continue;
    const atrib = /^([A-Za-z_][A-Za-z0-9_]*)=(["']?)([^"'$`\s]+)\2$/.exec(
      linha,
    );
    if (atrib) vars.set(atrib[1], atrib[3]);
    saida.push(
      linha.replace(
        /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g,
        (m, nome) => vars.get(nome) ?? m,
      ),
    );
  }
  return saida;
}

/** Tokens de caminho de um texto de shell, relativos a `base` (dir do workspace). */
function caminhosDoTexto(repo, linhas, base) {
  const achados = new Set();
  for (const linha of linhas) {
    for (const m of linha.matchAll(TOKEN_CAMINHO)) {
      const tok = m[0];
      // token sem `/` só conta se for código (`node gerar.mjs` dentro de um workspace)
      if (
        !tok.includes("/") &&
        !tok.startsWith(".") &&
        !EXT_CODIGO.test(tok) &&
        !tok.endsWith(".sh")
      )
        continue;
      const rel = normalizar(path.posix.join(base, tok));
      if (ehArquivo(repo, rel)) achados.add(rel);
    }
  }
  return achados;
}

/** Comandos de pacote: `pnpm turbo <t>`, `turbo <t>`, `pnpm [run] <s>`, `npx <b>`, `pnpm exec <b>`. */
export function comandosDePacote(linhas) {
  const tarefas = new Set();
  const scripts = new Set();
  const binarios = new Set();
  for (const linha of linhas) {
    for (const m of linha.matchAll(
      /\b(?:pnpm\s+(?:run\s+)?)?turbo\s+(?:run\s+)?([A-Za-z0-9:_-]+)/g,
    ))
      tarefas.add(m[1]);
    for (const m of linha.matchAll(
      /\b(?:npx|pnpm\s+exec|pnpm\s+dlx)\s+([A-Za-z0-9@/._-]+)/g,
    ))
      binarios.add(m[1]);
    for (const m of linha.matchAll(/\bpnpm\s+(?:run\s+)?([A-Za-z0-9:_-]+)/g)) {
      if (
        !["turbo", "exec", "dlx", "run", "install", "add", "--filter"].includes(
          m[1],
        )
      )
        scripts.add(m[1]);
    }
  }
  return { tarefas, scripts, binarios };
}

/** Workspaces do repo: `[{ dir, nome, scripts, deps }]` a partir de todo `package.json` rastreável. */
function lerWorkspaces(repo) {
  const dirs = ["."];
  const yaml = path.join(repo, "pnpm-workspace.yaml");
  if (existsSync(yaml)) {
    for (const m of readFileSync(yaml, "utf8").matchAll(
      /^\s*-\s*["']?([^"'\s]+)["']?\s*$/gm,
    )) {
      const padrao = m[1].replace(/\/\*$/, "");
      const raiz = path.join(repo, padrao);
      if (!existsSync(raiz)) continue;
      if (m[1].endsWith("/*")) {
        for (const filho of readdirSeguro(raiz))
          dirs.push(normalizar(path.posix.join(padrao, filho)));
      } else dirs.push(normalizar(padrao));
    }
  }
  const ws = [];
  for (const dir of dirs) {
    const pj = path.join(repo, dir, "package.json");
    if (!existsSync(pj)) continue;
    const p = JSON.parse(readFileSync(pj, "utf8"));
    ws.push({
      dir,
      nome: p.name ?? dir,
      scripts: p.scripts ?? {},
      deps: Object.keys({ ...p.dependencies, ...p.devDependencies }),
    });
  }
  return ws;
}

function readdirSeguro(dir) {
  try {
    return readdirSync(dir).filter((n) => !n.startsWith("."));
  } catch {
    return [];
  }
}

/**
 * Pares `{ dir, comando }` que uma tarefa do turbo executa: o script de cada
 * workspace que a tem, mais os `dependsOn` (`^x` = `x` das dependências
 * internas; `pkg#x`; `x` = mesmo workspace).
 */
function comandosDaTarefa(repo, workspaces, tarefa) {
  const turbo = existsSync(path.join(repo, "turbo.json"))
    ? JSON.parse(readFileSync(path.join(repo, "turbo.json"), "utf8"))
    : {};
  const defs = turbo.tasks ?? turbo.pipeline ?? {};
  const porNome = new Map(workspaces.map((w) => [w.nome, w]));
  const vistos = new Set();
  const saida = [];
  const visitar = (w, t) => {
    const chave = `${w.dir}#${t}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    const cmd = w.scripts[t];
    if (!cmd) return;
    // a raiz que só repassa ao turbo não é comando de workspace
    if (w.dir === "." && /^turbo\s/.test(cmd)) return;
    saida.push({ dir: w.dir, comando: cmd });
    for (const dep of defs[`${w.nome}#${t}`]?.dependsOn ??
      defs[t]?.dependsOn ??
      []) {
      if (dep.startsWith("^")) {
        for (const nomeDep of w.deps) {
          const alvo = porNome.get(nomeDep);
          if (alvo) visitar(alvo, dep.slice(1));
        }
      } else if (dep.includes("#")) {
        const [pkg, t2] = dep.split("#");
        const alvo = porNome.get(pkg);
        if (alvo) visitar(alvo, t2);
      } else visitar(w, dep);
    }
  };
  for (const w of workspaces) visitar(w, tarefa);
  return saida;
}

/** Imports relativos de um arquivo de código, resolvidos contra o repo. */
function importsRelativos(repo, rel) {
  let texto;
  try {
    texto = readFileSync(path.join(repo, rel), "utf8");
  } catch {
    return [];
  }
  const dir = path.posix.dirname(rel);
  const saida = [];
  for (const m of texto.matchAll(IMPORT_RELATIVO)) {
    const alvo = normalizar(path.posix.join(dir, m[1]));
    const candidatos = [
      alvo,
      ...[
        ".js",
        ".mjs",
        ".cjs",
        ".ts",
        "/index.js",
        "/index.mjs",
        "/index.ts",
      ].map((e) => alvo + e),
    ];
    const achado = candidatos.find((c) => ehArquivo(repo, c));
    if (achado) saida.push(achado);
  }
  return saida;
}

/**
 * Tudo o que os hooks executam ou leem por caminho literal.
 * `hooks` (opcional) = `{ nome: texto }` no lugar dos arquivos de `.husky/`.
 * Devolve `[{ hook, caminho, via }]`, `via` ∈ `hook` · `script:<dir>#<nome>` ·
 * `import:<origem>` · `bin:<nome>`.
 */
export function chamadas({ repo, hooks } = {}) {
  const presentes = HOOKS_DE_COMMIT.filter((h) => existsSync(path.join(repo, ".husky", h)));
  // Nenhum hook achado é `--repo` errado ou `.husky/` renomeado, nunca alcance
  // vazio: lista vazia aprovaria o teste da T8 sem ler hook nenhum.
  if (!hooks && !presentes.length)
    throw new Error(`hooks-alcance: nenhum de ${HOOKS_DE_COMMIT.join(", ")} em ${path.join(repo, ".husky")}`);
  const textos =
    hooks ??
    Object.fromEntries(
      presentes.map((h) => [h, readFileSync(path.join(repo, ".husky", h), "utf8")]),
    );
  const workspaces = lerWorkspaces(repo);
  const raiz = workspaces.find((w) => w.dir === ".");
  const saida = [];
  const visto = new Set();
  const anotar = (hook, caminho, via) => {
    const chave = `${hook}\0${caminho}`;
    if (visto.has(chave)) return false;
    visto.add(chave);
    saida.push({ hook, caminho, via });
    return true;
  };
  const seguirImports = (hook, rel) => {
    if (!EXT_CODIGO.test(rel)) return;
    for (const imp of importsRelativos(repo, rel)) {
      if (anotar(hook, imp, `import:${rel}`)) seguirImports(hook, imp);
    }
  };
  const extrair = (hook, linhas, base, via) => {
    for (const rel of caminhosDoTexto(repo, linhas, base)) {
      if (anotar(hook, rel, via)) seguirImports(hook, rel);
    }
    const { tarefas, scripts, binarios } = comandosDePacote(linhas);
    for (const b of binarios) anotar(hook, `bin:${b}`, `bin:${b}`);
    for (const t of tarefas) {
      for (const { dir, comando } of comandosDaTarefa(repo, workspaces, t)) {
        extrair(hook, linhasExecutadas(comando), dir, `script:${dir}#${t}`);
      }
    }
    for (const s of scripts) {
      const cmd = raiz?.scripts[s];
      if (cmd && !/^turbo\s/.test(cmd))
        extrair(hook, linhasExecutadas(cmd), ".", `script:.#${s}`);
      else if (cmd) {
        const t = /^turbo\s+(?:run\s+)?([A-Za-z0-9:_-]+)/.exec(cmd)?.[1];
        if (t)
          for (const { dir, comando } of comandosDaTarefa(
            repo,
            workspaces,
            t,
          )) {
            extrair(hook, linhasExecutadas(comando), dir, `script:${dir}#${t}`);
          }
      }
    }
  };
  for (const [hook, texto] of Object.entries(textos)) {
    anotar(hook, `.husky/${hook}`, "hook");
    extrair(hook, linhasExecutadas(texto), ".", "hook");
  }
  return saida;
}

/**
 * Binário de `node_modules` só muda por `package.json` ou lockfile, que a base
 * já cobre; caminho de arquivo precisa cair num glob da base.
 */
function coberto(caminho, base) {
  return caminho.startsWith("bin:") || casaAlgum(caminho, base);
}

/** Cobertura: `{ chamadas, fora }` — `fora` são as chamadas que a base não cobre. */
export function cobertura({ repo, hooks, base = BOTOES.baseAlcance } = {}) {
  const todas = chamadas({ repo, hooks });
  return {
    chamadas: todas,
    fora: todas.filter((c) => !coberto(c.caminho, base)),
  };
}

/** Caminhos (de um diff de filha) que caem no alcance — para a T10 perguntar antes de trazer. */
export function alcanca(caminhos, base = BOTOES.baseAlcance) {
  return caminhos.map(normalizar).filter((c) => casaAlgum(c, base));
}

export function main(argv) {
  const i = argv.indexOf("--repo");
  const repo = path.resolve(i >= 0 ? argv[i + 1] : process.cwd());
  const r = cobertura({ repo });
  process.stdout.write(`${JSON.stringify(r)}\n`);
  return r.fora.length ? 1 : 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main(process.argv.slice(2)));
}
