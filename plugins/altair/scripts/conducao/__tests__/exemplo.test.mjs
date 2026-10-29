/**
 * exemplo.test.mjs — o projeto de exemplo do repositório (`exemplo/`) conduzido de
 * ponta a ponta, sem rede.
 *
 * Copia o projeto para um tmp, faz dele um repositório git com um origin bare local
 * e conduz o ciclo do plano público (`docs/planos/EXEMPLO-1-despedida.md`, lido pelo
 * embutido `superpowers`) como a condutora conduz: `proximo` → `abrir` (a filha
 * busca a tentativa, trabalha e empurra) → `trazer` → `conferir` (a Verificação
 * embrulhada roda) → `registrar-conferencia`, até o `fechar-ciclo` e a marca de
 * encerramento do ciclo. A declaração não tem CI (`"ci": false`): a fase e o ciclo fecham
 * pela Verificação da última tarefa. Ao fim, o `auditar` confere o rastro.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(AQUI, "..", "conducao.mjs");
const EXEMPLO = path.resolve(AQUI, "..", "..", "..", "..", "..", "exemplo");
const CICLO = "EXEMPLO-1-despedida";
const RAMO = `ciclo-${CICLO}`;

function gitEm(dir) {
  return (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function configurar(g) {
  for (const [k, v] of [["core.hooksPath", "/dev/null"], ["user.name", "teste"], ["user.email", "teste@example.invalid"], ["commit.gpgsign", "false"]]) g("config", k, v);
}

function ambiente(t) {
  const raiz = mkdtempSync(path.join(tmpdir(), "altair-conducao-exemplo-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const origin = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin]);

  const maestra = path.join(raiz, "maestra");
  cpSync(EXEMPLO, maestra, { recursive: true });
  const g = gitEm(maestra);
  g("init", "-q", "-b", "main");
  configurar(g);
  g("remote", "add", "origin", origin);
  g("add", "-A");
  g("commit", "-q", "-m", "projeto de exemplo");
  g("push", "-q", "origin", "main");
  g("checkout", "-q", "-b", RAMO);
  g("push", "-q", "origin", RAMO);

  const filha = path.join(raiz, "filha");
  execFileSync("git", ["clone", "-q", origin, filha]);
  const f = gitEm(filha);
  configurar(f);

  const cli = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, "--repo", maestra, "--ciclo", CICLO], {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const linhas = r.stdout.split("\n").filter(Boolean);
    return { status: r.status, stderr: r.stderr, saida: linhas.length === 1 ? JSON.parse(linhas[0]) : null, linhas };
  };
  const ok = (...args) => {
    const r = cli(...args);
    assert.equal(r.status, 0, `${args.join(" ")} → ${r.status}\n${r.stderr}\n${r.linhas.join("\n")}`);
    return r.saida;
  };

  /** A filha busca a tentativa, escreve os arquivos, commita com o subject da tarefa e empurra de volta. */
  const filhaTrabalha = (ref, arquivos, subject) => {
    f("fetch", "-q", "origin", `+${ref}:refs/remotes/tentativa`);
    f("checkout", "-q", "--detach", "refs/remotes/tentativa");
    for (const [rel, conteudo] of Object.entries(arquivos)) writeFileSync(path.join(filha, rel), conteudo);
    f("add", "-A");
    f("commit", "-q", "-m", subject);
    f("push", "-q", "origin", `HEAD:${ref}`);
  };

  return { maestra, g, cli, ok, filhaTrabalha };
}

/** O trabalho que a filha faz em cada tarefa do plano de exemplo. */
const TRABALHO = {
  T1: [{ "src/despedida.mjs": "/** A despedida do projeto de exemplo. */\nexport function despedida(nome) {\n  return `até logo, ${nome}`;\n}\n" }, "EXEMPLO-1-despedida-F1/T1 — despedida"],
  T2: [{ "README.md": "# Projeto de exemplo\n\nSaudação em `src/saudacao.mjs`, despedida em `src/despedida.mjs`.\n" }, "EXEMPLO-1-despedida-F1/T2 — fechamento de F1"],
};

test("o projeto de exemplo é conduzido de ponta a ponta: proximo, abrir, trazer, conferir, encerrar", (t) => {
  const a = ambiente(t);

  // Sem sim, o proximo pede o sim do ciclo ao operador declarado.
  const p0 = a.ok("proximo", "--entrada", "{}");
  assert.equal(p0.acao, "perguntar", JSON.stringify(p0));
  assert.equal(p0.motivo, "autorizar-ciclo");
  a.ok("autorizar-ciclo", "F1", "--sim", "sim, pode conduzir a F1");

  const feitas = [];
  let encerrou = false;
  for (let passo = 0; passo < 40; passo++) {
    const p = a.ok("proximo", "--entrada", JSON.stringify({ sessaoMaestra: "session_maestra_f1" }));
    if (p.acao === "fechar-ciclo") {
      // A última fase fecha com o ciclo: a marca é `Conducao-Encerrada: ciclo`.
      assert.deepEqual(p.conduzidas, ["F1"]);
      a.ok("encerrar-sessao", "--fase", "ciclo", "--nonce", p.nonce);
      encerrou = true;
      break;
    }
    // `abrir` (tarefa comum) e `fechar-fase` (a tarefa que fecha a fase) abrem uma tentativa.
    assert.ok(["abrir", "fechar-fase"].includes(p.acao), JSON.stringify(p));
    const tarefa = p.acao === "abrir" ? p.tarefas[0] : { task: p.task, tentativa: p.tentativa ?? 1, nonce: p.nonce };
    assert.equal(p.acao === "abrir" ? p.tarefas.length : 1, 1, "largura 1 abre uma tarefa por vez");
    const s = a.ok("abrir", tarefa.task, "--tentativa", String(tarefa.tentativa), "--nonce", tarefa.nonce, "--modo-maestra", "auto");
    assert.match(s.partida, new RegExp(`contrato da operária — ${tarefa.task} · nonce \`${tarefa.nonce}\``));
    const [arquivos, subject] = TRABALHO[tarefa.task];
    a.filhaTrabalha(s.ref, arquivos, subject);
    a.ok("trazer", tarefa.task, "--tentativa", String(tarefa.tentativa), "--sessao", `s-${tarefa.task}`);
    const c = a.ok("conferir", tarefa.task);
    assert.match(c.verificacao, /^env ALTAIR_SEM_COFRE_PRODUCAO=1 bash -c /, "sem campo verificacao: só a marca padrão");
    execFileSync("bash", ["-c", c.verificacao], { cwd: a.maestra, stdio: "pipe" });
    a.ok("registrar-conferencia", tarefa.task, "--verificacao", "verde", "--publicacao", "nao-se-aplica", "--sessao", `s-${tarefa.task}`);
    feitas.push(tarefa.task);
  }
  assert.deepEqual(feitas, ["T1", "T2"]);
  assert.ok(encerrou, "o ciclo chegou ao fechar-ciclo");
  assert.equal(a.g("log", "-1", "--format=%(trailers:key=Conducao-Encerrada,valueonly)"), "ciclo");
  const depois = a.ok("proximo", "--entrada", "{}");
  assert.equal(depois.motivo, "close-cycle-em-sessao-limpa", JSON.stringify(depois));

  // O rastro da condução passa pelo auditar.
  const aud = a.cli("auditar", "--ref", "HEAD", "--exigir-fases", "F1", "--exigir-encerramentos", "ciclo");
  assert.equal(aud.status, 0, aud.stderr + aud.linhas.join("\n"));
  assert.deepEqual(aud.saida.violacoes, []);
  assert.deepEqual(aud.saida.tasks.map((x) => x.task), ["T1", "T2"]);
});
