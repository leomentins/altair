/**
 * git-exec.mjs — o executor git único da condução (VEGA-29 T5, prazo na T17).
 *
 * `git` lança no exit diferente de 0 e devolve a saída aparada (`cru` devolve
 * byte a byte); `tentarGit` nunca lança e devolve `{ status, saida, erro }`.
 * Os dois rodam com `GIT_TERMINAL_PROMPT=0` e com prazo (T17, 20-a): a chamada
 * de rede (`rede`) tem `PRAZO_REDE_MS`, a local `PRAZO_GIT_MS`, e o estouro
 * mata o processo com `SIGKILL` (o git pendurado num hook ou num lock não
 * responde a `SIGTERM` a tempo). No `git`, o estouro vira `ErroGitPrazo`,
 * desfecho `git-prazo-estourado`, com os `*.lock` achados sob o git-dir — o
 * lock que sobra é o que trava a próxima chamada; no `tentarGit`, volta
 * `status: null` com `prazoEstourado` e os mesmos locks.
 *
 * Consumidores: `conducao.mjs`, `git-conducao.mjs`, `marcas.mjs` e o hook
 * `operaria-stop-guard.js`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const ENV_GIT = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
/** Rede (push/fetch/ls-remote) com prazo: origin pendurado vira erro, nunca espera infinita. */
export const PRAZO_REDE_MS = 120_000;
/**
 * Git local com prazo: folgado para `commit` com hooks e `log` de histórico
 * longo, curto o bastante para a maestra não esperar para sempre. O teste o
 * encurta por `ALTAIR_CONDUCAO_GIT_PRAZO_MS` (vale para rede e local).
 */
export const PRAZO_GIT_MS = 600_000;
const PRAZO_FORCADO = Number(process.env.ALTAIR_CONDUCAO_GIT_PRAZO_MS) > 0 ? Number(process.env.ALTAIR_CONDUCAO_GIT_PRAZO_MS) : null;

export const DESFECHO_PRAZO = "git-prazo-estourado";

export class ErroGitPrazo extends Error {
  constructor({ args, prazoMs, locks }) {
    super(`git ${args.join(" ")} passou de ${prazoMs} ms e foi morto${locks.length ? ` — lock: ${locks.join(", ")}` : ""}`);
    this.name = "ErroGitPrazo";
    this.codigo = DESFECHO_PRAZO;
    this.comando = ["git", ...args].join(" ");
    this.prazoMs = prazoMs;
    this.locks = locks;
  }
}

function prazo(rede) {
  return PRAZO_FORCADO ?? (rede ? PRAZO_REDE_MS : PRAZO_GIT_MS);
}

function estourou(e) {
  return e?.code === "ETIMEDOUT";
}

/** Git-dir (e o comum, em worktree) sem depender do git que acabou de pendurar: `.git` lido à mão se ele não responder. */
function gitDirs(repo) {
  const r = spawnSync("git", ["-C", repo, "rev-parse", "--git-dir", "--git-common-dir"], {
    encoding: "utf8",
    env: ENV_GIT,
    timeout: 5_000,
    killSignal: "SIGKILL",
  });
  if (r.status === 0) return [...new Set(r.stdout.split("\n").filter(Boolean).map((l) => path.resolve(repo, l)))];
  const ponto = path.join(repo, ".git");
  try {
    if (statSync(ponto).isDirectory()) return [ponto];
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(ponto, "utf8"));
    return m ? [path.resolve(repo, m[1].trim())] : [];
  } catch {
    return [];
  }
}

/** `*.lock` sob o git-dir (sem descer em `objects`), em caminho absoluto. */
export function locksDoRepo(repo) {
  const achados = new Set();
  const descer = (dir, fundo) => {
    let itens;
    try {
      itens = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (it.name !== "objects" && fundo < 8) descer(p, fundo + 1);
      } else if (it.name.endsWith(".lock")) achados.add(p);
    }
  };
  for (const d of gitDirs(repo)) if (existsSync(d)) descer(d, 0);
  return [...achados].sort();
}

export function git(repo, args, { rede = false, entrada, cru = false } = {}) {
  const prazoMs = prazo(rede);
  let saida;
  try {
    saida = execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      env: ENV_GIT,
      input: entrada,
      timeout: prazoMs,
      killSignal: "SIGKILL",
      stdio: [entrada === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
  } catch (e) {
    if (estourou(e)) throw new ErroGitPrazo({ args, prazoMs, locks: locksDoRepo(repo) });
    throw e;
  }
  return cru ? saida : saida.trim();
}

export function tentarGit(repo, args, { rede = false } = {}) {
  const prazoMs = prazo(rede);
  const r = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: ENV_GIT,
    timeout: prazoMs,
    killSignal: "SIGKILL",
  });
  if (estourou(r.error)) {
    const locks = locksDoRepo(repo);
    return { status: null, saida: (r.stdout ?? "").trim(), erro: new ErroGitPrazo({ args, prazoMs, locks }).message, prazoEstourado: true, locks };
  }
  return { status: r.status, saida: (r.stdout ?? "").trim(), erro: (r.stderr ?? r.error?.message ?? "").trim() };
}
