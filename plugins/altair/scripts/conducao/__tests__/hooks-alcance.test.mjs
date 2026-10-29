/**
 * hooks-alcance.test.mjs — a lista do que os hooks de commit executam sai
 * derivada dos próprios hooks (VEGA-22 T8, AC-VEGA22-5).
 *
 * Contra os hooks reais do repo (todos cobertos pela base de `botoes.mjs`) e
 * contra repos de fixture em diretório temporário: hook que passa a chamar
 * caminho fora da base tem a cobertura reprovada.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  alcanca,
  chamadas,
  cobertura,
  linhasExecutadas,
} from "../hooks-alcance.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "hooks-alcance.mjs");

/** Repo de fixture: `arquivos` = `{ caminho: conteúdo }`. */
function fixture(arquivos) {
  const dir = mkdtempSync(path.join(tmpdir(), "hooks-alcance-"));
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), conteudo);
  }
  return dir;
}

test("hooks de commit de um projeto: toda chamada cai na base", () => {
  const dir = fixture({
    "package.json": JSON.stringify({ name: "raiz", scripts: {} }),
    ".husky/pre-commit": "node .claude/scripts/scan-staged.mjs\nnode packages/database/scripts/type-check.mjs\n",
    ".husky/commit-msg": 'node .claude/hooks/desfecho-commit-msg-guard.js "$1"\n',
    ".husky/post-commit": "node .claude/hooks/presente-post-commit.js\n",
    ".claude/scripts/scan-staged.mjs": "",
    ".claude/hooks/desfecho-commit-msg-guard.js": "",
    ".claude/hooks/presente-post-commit.js": "",
    "packages/database/scripts/type-check.mjs": "",
  });
  try {
    const r = cobertura({ repo: dir });
    assert.deepEqual(r.fora, [], `fora da base: ${JSON.stringify(r.fora)}`);
    const hooks = new Set(r.chamadas.map((c) => c.hook));
    assert.deepEqual([...hooks].sort(), ["commit-msg", "post-commit", "pre-commit"]);
    const caminhos = new Set(r.chamadas.map((c) => c.caminho));
    for (const esperado of [
      ".claude/hooks/presente-post-commit.js",
      ".claude/hooks/desfecho-commit-msg-guard.js",
      ".claude/scripts/scan-staged.mjs",
      "packages/database/scripts/type-check.mjs",
    ]) {
      assert.ok(caminhos.has(esperado), `extração perdeu ${esperado}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hook de commit que passa a chamar caminho fora da lista derivada falha", () => {
  const dir = fixture({
    "package.json": JSON.stringify({ name: "raiz", scripts: {} }),
    ".claude/hooks/dentro.js": "",
    "scripts/fora.mjs": "",
  });
  try {
    const limpo = cobertura({
      repo: dir,
      hooks: { "pre-commit": "node .claude/hooks/dentro.js\n" },
    });
    assert.deepEqual(limpo.fora, []);
    const sujo = cobertura({
      repo: dir,
      hooks: {
        "pre-commit":
          "node .claude/hooks/dentro.js\nnode scripts/fora.mjs || exit 2\n",
      },
    });
    assert.deepEqual(
      sujo.fora.map((c) => c.caminho),
      ["scripts/fora.mjs"],
    );
    // a CLI reprova com exit 1
    mkdirSync(path.join(dir, ".husky"), { recursive: true });
    writeFileSync(
      path.join(dir, ".husky", "pre-commit"),
      "node scripts/fora.mjs\n",
    );
    const cli = spawnSync(process.execPath, [SCRIPT, "--repo", dir], {
      encoding: "utf8",
    });
    assert.equal(cli.status, 1, cli.stderr);
    assert.match(cli.stdout, /scripts\/fora\.mjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("import relativo de script chamado pelo hook entra na extração", () => {
  const dir = fixture({
    "package.json": JSON.stringify({ name: "raiz" }),
    ".claude/hooks/guard.js": 'const x = require("../../lib/util.cjs");\n',
    "lib/util.cjs": "",
  });
  try {
    const r = cobertura({
      repo: dir,
      hooks: {
        "commit-msg": 'guard=.claude/hooks/guard.js\nnode "$guard" "$1"\n',
      },
    });
    assert.deepEqual(
      r.fora.map((c) => [c.caminho, c.via]),
      [["lib/util.cjs", "import:.claude/hooks/guard.js"]],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("script de package.json chamado por turbo é extraído relativo ao workspace", () => {
  const dir = fixture({
    "package.json": JSON.stringify({
      name: "raiz",
      scripts: { "type-check": "turbo type-check" },
    }),
    "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
    "turbo.json": JSON.stringify({
      tasks: { "type-check": { dependsOn: ["^build"] } },
    }),
    "packages/a/package.json": JSON.stringify({
      name: "a",
      scripts: { "type-check": "node tools/tc.mjs" },
      dependencies: { b: "workspace:*" },
    }),
    "packages/a/tools/tc.mjs": "",
    "packages/b/package.json": JSON.stringify({
      name: "b",
      scripts: { build: "node gerar.mjs" },
    }),
    "packages/b/gerar.mjs": "",
  });
  try {
    const r = chamadas({
      repo: dir,
      hooks: { "pre-commit": "pnpm turbo type-check\n" },
    });
    const caminhos = r.map((c) => c.caminho);
    assert.ok(caminhos.includes("packages/a/tools/tc.mjs"));
    assert.ok(
      caminhos.includes("packages/b/gerar.mjs"),
      "dependsOn ^build da dependência interna",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("echo só vale depois do pipe; comentário não conta", () => {
  const linhas = linhasExecutadas(
    '# node fora.mjs\necho "rode node fora.mjs"\necho "$x" | xargs npx prettier --check\n',
  );
  assert.deepEqual(linhas, ["xargs npx prettier --check"]);
});

test("modo de guard em .claude/state cai no alcance", () => {
  assert.deepEqual(
    alcanca([
      ".claude/state/pre-push-bateria-mode",
      ".claude/state/review-carimbo/abcd1234.md",
      "apps/web/src/app/page.tsx",
      "./packages/database/scripts/db-publish.mjs",
      "apps/web/vercel.json",
    ]),
    [
      ".claude/state/pre-push-bateria-mode",
      ".claude/state/review-carimbo/abcd1234.md",
      "packages/database/scripts/db-publish.mjs",
      "apps/web/vercel.json",
    ],
  );
});

test("repo sem nenhum hook de commit falha, nunca alcance vazio", () => {
  const dir = fixture({ "package.json": "{}" });
  try {
    assert.throws(() => chamadas({ repo: dir }), { message: /^hooks-alcance: nenhum / });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
