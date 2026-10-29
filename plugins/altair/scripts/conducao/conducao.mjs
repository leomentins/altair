#!/usr/bin/env node
/**
 * conducao.mjs — verbos da condução de ciclo por sessão (VEGA-22).
 *
 * Sem estado próprio: cada chamada relê o plano congelado (ler-plano.mjs), as
 * marcas no git local da worktree conduzida e a entrada que a maestra
 * observou, e devolve UMA linha JSON. O script nunca chama ferramenta de
 * sessão — quem abre, avisa e arquiva é a maestra (D-VEGA22-2).
 *
 *   proximo  --repo <worktree> --ciclo <id> [--entrada <arquivo|json>] [--reinicio <arquivo>] [--ponte-ativa-desde <iso>] [--nivel maestra]
 *      `--nivel maestra`: as `filhas` da entrada são as condutoras (cada uma com `fase`); emite
 *      criar-condutora · esperar (condutora-viva) · arquivar · criar-fechamento. Sem a flag, o laço da condutora.
 *      o `--reinicio` só vale confirmado pela ponte (`reinicioConfirmado`): sem confirmação é
 *      ignorado, com uma linha de aviso no stderr
 *   reinicio-valido --arquivo <ponte-reinicio.json> [--ponte-ativa-desde <iso>]
 *      exit 0 confirmado · 1 não confirmado (o `proximo` o ignoraria) · 2 uso
 *   conferir T<k> --repo <worktree> --ciclo <id>
 *      exit 1 com `perguntar binario-ausente` quando o primeiro executável de algum
 *      segmento da Verificação não está no PATH (achado T10 da T18); palavra-chave de shell não conta.
 *      `saidaForaDoGit` + `avisoSaida` quando a tentativa trazida acrescentou padrão a um `.gitignore`
 *   retomar  --repo <worktree> --ciclo <id>
 *   auditar  --nota <arquivo> [--repo <repo>]
 *   auditar  --ciclo <id> --ref <ref> [--repo <repo>] [--exigir-fases F1,F2] [--exigir-encerramentos F1,ciclo]
 *      exit 1 com violação, fase pedida sem condução ou encerramento pedido ausente (T22)
 *
 * Pré-voo (T30, D-VEGA29-15) — `--ciclo` opcional:
 *   pre-voo --repo <projeto> [--ciclo <id>]
 *      confere plugin carregado, instalação única, ponte com Restart e tráfego não essencial pelo
 *      contrato do host que a declaração dá (v5); falha ⇒ `perguntar pre-voo` com `falhas`
 *      ({ conferencia, encontrado, remedio }), exit 1, e nenhuma filha abre. Com `--ciclo`, avisa
 *      (sem parar) a tarefa de julgamento em tier `mecanico`. O `abrir` não o roda: quem conduz roda
 *      no começo da sessão
 *
 * CI da proposta (T14) — sem --ciclo:
 *   ci --push-em <iso> --runs <arquivo|json> --pr <arquivo|json> [--sha <sha>] [--agora <iso>] [--prazo-min <n>]
 *      esperar · avisar (sem-run | proposta-desalinhada) · ler-run; sempre exit 0
 *   conferir-workflows [--repo <repo>]
 *      exit 1 com workflow de gatilho `push` fora de `main` que lê `secrets.`
 *
 * Verbos de git (git-conducao.mjs, T10) — todos com --repo e --ciclo; saem 1
 * quando a resposta é `perguntar`:
 *   autorizar-fase F<n> --sim <texto>
 *      aposentado (D-VEGA29-14): recusa, exit 1, e aponta o `autorizar-ciclo`
 *   autorizar-ciclo F<n> --sim <texto>
 *      o sim do operador à fase de partida e às seguintes (ruling de 27/10/2026): cada fase nova, e re-plano
 *      sem ruling, sai `herdar-autorizacao` (origem `ciclo`) enquanto nenhuma task mudar de classe ou
 *      sensibilidade desde o sim; task sensível de fase herdada pelo ciclo pergunta por nonce
 *   herdar-autorizacao F<n> --nonce <x>
 *      autorização herdada pelo re-plano de ruling do `/intra-plan` (F4.17): refaz o `proximo` e só
 *      grava `Conducao: F<n> autorizada` (trailers `Conducao-Herdada`, `Conducao-Replano`) quando ele
 *      devolve `herdar-autorizacao` da mesma fase e do mesmo nonce
 *   abrir T<k> --tentativa <n> --nonce <x> --modo-maestra <modo> [--falhou <n-1> --coberta sim|nao|ambiente [--motivo <texto>]]
 *      `--modo-maestra` = o `session_context.permission_mode` do `get_session` da maestra; fora de `auto`
 *      sai `perguntar modo-da-maestra` sem gravar nada (P19 do ATRM-51)
 *      grava também o brief da filha em `refs/conducao-brief/<ciclo>/T<k>/<n>` e devolve `partida`,
 *      o prompt curto do `create_session` (ruling F3.2a)
 *   trazer T<k> --tentativa <n> [--sha <sha8>] [--sessao <id>] [--aprovado <sha>]
 *      aceita merge de origin/main na faixa (só por fast-forward; o que veio do main não pergunta) e
 *      caminho clínico de tela no segmento que os Steps nomeiam (C24 do VEGA-28, P21/P24 do ATRM-51)
 *      `--aprovado` aceita o SHA inteiro ou prefixo único de 7+ caracteres da ponta;
 *      o que não confere sai `perguntar` com motivo `aprovado-nao-confere` (P24 do ATRM-51)
 *   conferir-carimbo T<k>
 *   registrar-conferencia T<k> --verificacao verde|declarada-pos-merge --publicacao feita|nao-se-aplica [--sessao <id>] [--sim <texto>] [--operador <texto>]
 *      `--publicacao feita` exige `--sim` = o texto do operador autorizando a publicação daquela task (F4.17)
 *      task de conferência do operador por pergunta (`(conferencia-do-operador)`, T14): sem `--operador <texto
 *      do operador dizendo sim>` não grava e sai `perguntar conferencia-do-operador` (opções sim · nao)
 *   registrar-conferencia T<k> --manual --sim <texto> --publicacao feita|nao-se-aplica
 *   registrar-conferencia T<k> --maestra --verificacao verde|declarada-pos-merge --publicacao feita|nao-se-aplica --sessao <id da maestra>
 *   registrar-conferencia T<k> --rodada nao|needs-rework [--operador <texto>] [--sessao <id>]
 *      só task de conferência do operador (T14, 7-a): o não dele grava `Conducao: T<k> tentativa <n> rodada`,
 *      que encerra a tentativa sem ser feita nem falha, e o `proximo` abre a n+1. Por pergunta, `--operador`
 *      = o texto do operador dizendo não (obrigatório), e o 3º não sai `perguntar teto-de-rodadas`. Por arquivo
 *      (caso declarado no adaptador, por exemplo um gate de UX por arquivo; `needs-rework` é o mesmo não): o approval do
 *      HEAD diz não (`verdict: NEEDS_REWORK`) com `rodada` abaixo do teto do rito (3 ⇒ `perguntar
 *      teto-de-rodadas`), e o brief entrega a rodada B ou C
 *   registrar-conferencia T<k> --rodada carimbo [--sessao <id>]
 *      mesma task, caso por arquivo, approval em NEEDS_REWORK, tentativa trazida que só acrescenta carimbo (`notes/reviews/<sha8>.md`
 *      do ciclo ou o destino de carimbo do adaptador; outro arquivo ⇒ `rodada-carimbo-fora-do-carimbo`):
 *      grava `Conducao: T<k> tentativa <n> carimbo`, que não conta como rodada nem no teto
 *   recusar-publicacao T<k> [--motivo <texto>]
 *   reverter-trazido T<k> [--motivo <texto>]
 *   registrar-falha T<k> --tentativa <n> --coberta sim|nao|ambiente [--motivo <texto>]
 *   empurrar-copia
 *   esperar-filha T<k> --tentativa <n> --teto-chamador-min <n> [--max-min 10] [--intervalo-s 30] [--desde <sha>] [--aviso-tratado <linha>]
 *      `--desde`: a ponta já vista não conta como `andou`; `--aviso-tratado`: o aviso com essa linha
 *      (já tratado por mensagem) é marcado visto e a espera segue (P25/P27 do ATRM-51)
 *      sai quando a referência da tentativa anda no origin, some, no prazo ou com a rede falhando
 *      (ruling 18.4a, T18), ou `avisou` quando a referência irmã `refs/conducao-aviso/…` anda,
 *      com a `linha` do aviso (P22 do ATRM-51) — a maestra roda em segundo plano; exit 0, ou 2 sem o teto de
 *      quem chama ou com --max-min acima dele (achado T13 da T18)
 *   limpar
 *   encerrar-sessao --fase F<n>|ciclo --nonce <x>
 *      marca `Conducao: F<n> sessao encerrada` (trailer `Conducao-Encerrada`) e empurra a cópia (T21);
 *      `--fase ciclo` é a do `fechar-ciclo`: a sessão que a grava para (T22)
 *
 * Log de eventos (log-eventos.mjs, T13): toda saída do `proximo` vira evento
 * `intencao`; a dos verbos de git, `registrado` (`intencao` quando pergunta).
 * O que a maestra observou entra por
 *   registrar-evento --acao <a> [--fase F<n>] [--task T<k>] [--tentativa <n>] [--sessao <id>]
 *                    [--estado <e>] [--sha <sha>] [--nonce <x>] [--quando <ISO>]
 * com procedência `observado`. Falha ao gravar o log avisa no stderr e não
 * muda a saída nem o exit do verbo.
 *
 * Ações do `proximo`: arquivar · abrir · trazer · esperar · perguntar · herdar-autorizacao ·
 * fechar-fase · encerrar-sessao · fechar-ciclo · parar; no nível da maestra, criar-condutora ·
 * criar-fechamento. Toda ação leva nonce determinístico por ciclo, alvo,
 * tentativa e HEAD: o mesmo estado repetido emite a mesma ação com o mesmo
 * nonce. `arquivar <sessão>` (D-VEGA22-25) não depende do HEAD e vem antes de
 * toda outra ação.
 *
 * Entrada (JSON):
 *   { "filhas": [{ "sessao", "task", "tentativa", "nonce", "estado", "aviso", "arquivamentos" }],
 *     "agora": "<ISO>",
 *     "tetoPonte": 16,
 *     "ci": { "sha": "…", "veredito": "verde|vermelho", "run": <id> },
 *     "sessaoMaestra": "<id da sessão que chama>",
 *     "proposta": { "numero": <N>, "state": "OPEN|MERGED|CLOSED" },
 *     "aprovacoes": [{ "task": "T<k>", "nonce": "…" }] }
 * `ci` é o veredito que a maestra leu por dentro do run (`ler-run`); o
 * `proximo` não lê run nenhum (limite declarado, T21). `sessaoMaestra` só
 * entra no texto da próxima sessão, nunca na decisão. `proposta` é o
 * `gh pr view --json number,state` da proposta do ciclo: só o `MERGED` decide
 * (T22 — depois do merge o `proximo` não emite nada).
 * `aprovacoes` é o "sim" do operador, num turno dele, a uma pergunta de task com
 * publicação ou caminho clínico: vale só para o nonce perguntado (D-VEGA22-21).
 * Desde o F4.17 do ATRM-51 (ruling do operador, 23/10/2026) a pergunta só sai
 * quando a última autorização não é da fase em curso: o sim gravado na fase
 * (o `autorizar-ciclo` da fase de partida, ou o da fase reautorizada) cobre as
 * tasks sensíveis dela em toda tentativa, enquanto o plano congelado nele
 * valer. A publicação em si segue pedindo o sim por task (skill §Publicar).
 *
 * `arquivamentos` são os nonces de `arquivar` que a maestra já executou na
 * filha: o mesmo nonce 2 vezes sem `ARCHIVED` vira `perguntar`.
 *
 * Vigia de filha (T12): regra de falha única em `regraVigia` (regras.mjs); as falhas contadas
 * são só os commits `Conducao: T<k> tentativa <n> falhou` com
 * `coberta-por-reinicio: nao`, então a contagem sobrevive à troca de maestra.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants as fsConstants, existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as adaptador from "./adaptador.mjs";
import { BOTOES } from "./botoes.mjs";
import * as gitConducao from "./git-conducao.mjs";
import * as logEventos from "./log-eventos.mjs";
import * as pergunta from "./pergunta.mjs";
import { preVoo } from "./pre-voo.mjs";
import { ErroGitPrazo, tentarGit } from "./git-exec.mjs";
import { RE, lerMarcas } from "./marcas.mjs";
import {
  contextoDaDecisao,
  maestraArquivarCondutora,
  maestraVigiarCondutora,
  maestraCriarCondutora,
  maestraCriarFechamento,
  regraAbrir,
  regraArquivar,
  regraAutorizarFase,
  regraEncerrarSessao,
  regraEsperar,
  regraFaseForaDoPlano,
  regraFazerMaestra,
  regraFecharCiclo,
  regraFecharFase,
  regraPublicacaoRecusada,
  regraReabertaSemFechamento,
  regraReplano,
  regraSemSaida,
  regraTrazer,
  regraTrazidaSemConferencia,
  regraVigia,
  regraWorkstation,
} from "./regras.mjs";
import { casoDeConferencia, opcoesDaConferencia } from "./verbos.mjs";
import {
  ErroPlano,
  codigoDoPlano,
  git,
  lerPlanoCongelado,
  lerPlanoNoCommit,
  tasksQueMudaramDeClasse,
} from "./ler-plano.mjs";

const { parsePhaseCommit, sameCycle } = createRequire(import.meta.url)("../../hooks/lib/phase-commit-regex.js");

/**
 * A Verificação roda embrulhada: sem as variáveis de produção que a declaração
 * do adaptador lista (`verificacao.variaveisDeProducao`, `env -u`) e com a
 * marca que ela nomeia (`verificacao.marcaSemCofre`, ligada em `=1`), que o
 * guard de cofre do projeto lê. Sem o campo, nenhuma variável sai e a marca é
 * `MARCA_SEM_COFRE_PADRAO`. O `env -u` não alcança credencial em arquivo
 * (token de CLI, cofre): limite declarado. `GH_TOKEN` fica — a Verificação lê CI por `gh`.
 */
export const SEM_COFRE = `${adaptador.MARCA_SEM_COFRE_PADRAO}=1`;

// ── nonce ────────────────────────────────────────────────────────────────────

export function nonce(ciclo, alvo, tentativa, head) {
  return createHash("sha256")
    .update([ciclo, alvo, String(tentativa), head].join("\0"))
    .digest("hex")
    .slice(0, 16);
}

// ── marcas no git ────────────────────────────────────────────────────────────

// A gramática e a leitura moram em `marcas.mjs` (VEGA-29 T5); `lerMarcas` segue exportada daqui.
export { lerMarcas };

/** Referências locais de tentativa: `refs/conducao-local/<ciclo>/T<k>/<n>`. */
export function lerRefsLocais(repo, ciclo) {
  const prefixo = `refs/conducao-local/${ciclo}/`;
  const bruto = git(repo, ["for-each-ref", "--format=%(refname)%1f%(objectname)%1f%(subject)%1f%(committerdate:unix)", prefixo]);
  const refs = [];
  for (const l of bruto.split("\n")) {
    if (!l) continue;
    const [nome, sha, subject, quando] = l.split("\x1f");
    // Só `T<k>/<n>` logo abaixo do prefixo: `copia` e `trazida/…` são outra coisa.
    const m = /^(T\d{1,3})\/(\d+)$/.exec(nome.slice(prefixo.length));
    if (!m) continue;
    const mk = RE.marcador.exec(subject ?? "");
    const valido = mk && mk[1] === m[1] && Number(mk[2]) === Number(m[2]);
    // `abertaEm` (epoch s) é a data do marcador: a vigia mede o prazo a partir dela.
    refs.push({ ref: nome, sha, task: m[1], tentativa: Number(m[2]), nonce: valido ? mk[3] : null, abertaEm: Number(quando) || null });
  }
  return refs;
}

/**
 * Estado por task derivado só das marcas e das referências locais. `trazidas`
 * são os registros do `trazer` ainda sem conferência nem revert (T10): a task
 * fica fora do conjunto pronto até um dos dois.
 */
export function estadoDasTasks(marcas, refs, trazidas = []) {
  const feitas = new Set();
  const recusadas = new Set();
  const encerradas = new Map(); // task → Set(tentativa) falhou|revertida
  const maxTent = new Map();
  const subir = (t, n) => maxTent.set(t, Math.max(maxTent.get(t) ?? 0, n));
  const encerrar = (t, n) => {
    if (!encerradas.has(t)) encerradas.set(t, new Set());
    encerradas.get(t).add(n);
  };
  for (const m of marcas) {
    if (m.tipo === "conferida") feitas.add(m.task);
    else if (m.tipo === "recusada") recusadas.add(m.task);
    // Rodada da conferência por arquivo dizendo não: encerra a tentativa sem ser
    // feita nem falha — a seguinte é a próxima rodada da mesma task. A de
    // carimbo também encerra, e o brief da seguinte acha a rodada pelo git.
    else if (m.tipo === "falhou" || m.tipo === "revertida" || m.tipo === "rodada" || m.tipo === "carimbo") {
      encerrar(m.task, m.tentativa);
      subir(m.task, m.tentativa);
    } else if (m.tipo === "marcador") subir(m.task, m.tentativa);
  }
  // Falhas contadas = commits `falhou` com `coberta-por-reinicio: nao` (ou sem
  // o trailer): queda coberta pelo registro de reinício não conta (T12).
  const falhas = new Map();
  // Falha de ambiente (P7 do ATRM-51) não conta no teto de trabalho, mas tem teto
  // próprio (`TETO_FALHAS_AMBIENTE`): sem ele, quem classifica reabriria para sempre.
  const falhasAmbiente = new Map();
  const falhadas = new Set(); // `T<k>/<n>` com commit `falhou`
  const decididos = new Set(); // nonces de tentativa já decididas: conferida, falhou, revertida, rodada, carimbo
  for (const m of marcas) {
    if (m.tipo === "falhou") {
      falhadas.add(`${m.task}/${m.tentativa}`);
      if (!m.coberta) falhas.set(m.task, (falhas.get(m.task) ?? 0) + 1);
      if (m.ambiente) falhasAmbiente.set(m.task, (falhasAmbiente.get(m.task) ?? 0) + 1);
    }
    const n = m.trailers?.["Conducao-Nonce"];
    if (n && (m.tipo === "conferida" || m.tipo === "falhou" || m.tipo === "revertida" || m.tipo === "rodada" || m.tipo === "carimbo")) decididos.add(n);
  }
  // Verificação vermelha: revertida sem o commit `falhou` da mesma tentativa é
  // falha decidida ainda por gravar (a gravação sai no `abrir` seguinte).
  const revertidasSemFalha = new Map();
  for (const m of marcas)
    if (m.tipo === "revertida" && !feitas.has(m.task) && !falhadas.has(`${m.task}/${m.tentativa}`))
      revertidasSemFalha.set(m.task, { tentativa: m.tentativa, nonce: m.trailers?.["Conducao-Nonce"] ?? null });

  const emVoo = new Map();
  for (const r of refs) {
    subir(r.task, r.tentativa);
    if (feitas.has(r.task) || encerradas.get(r.task)?.has(r.tentativa)) continue;
    const atual = emVoo.get(r.task);
    if (!atual || r.tentativa > atual.tentativa) emVoo.set(r.task, r);
  }
  for (const t of recusadas) if (feitas.has(t)) recusadas.delete(t);
  const pendentes = new Map();
  for (const r of trazidas) {
    subir(r.task, r.tentativa);
    if (feitas.has(r.task) || encerradas.get(r.task)?.has(r.tentativa)) continue;
    pendentes.set(r.task, r);
  }
  return { feitas, recusadas, emVoo, falhas, falhasAmbiente, maxTent, trazidas: pendentes, decididos, revertidasSemFalha };
}

// ── decisão (pura) ───────────────────────────────────────────────────────────

const AVISO_RE = /^(T\d{1,3})-(OK|FALHA)\s+(\S+)(?:\s+.*)?\s+(\S+)$/;

/** Aviso da filha: `T<k>-OK <sha8> <nonce>` ou `T<k>-FALHA <motivo…> <nonce>`. */
export function lerAviso(aviso) {
  const m = AVISO_RE.exec(String(aviso ?? "").trim());
  if (!m) return null;
  return { task: m[1], tipo: m[2], arg: m[3], nonce: m[4] };
}

/**
 * Estado da filha como a entrada o traz, sem depender de caixa nem do prefixo
 * da API (P16 do ATRM-51, C24 do VEGA-28): `archived`, ` Archived ` e
 * `SESSION_STATUS_ARCHIVED` são `ARCHIVED`. Antes, só a forma exata contava, e
 * a filha arquivada voltava a ser arquivada e ocupava vaga do teto.
 */
export function estadoDaFilha(estado) {
  if (typeof estado !== "string") return estado;
  return estado.trim().toUpperCase().replace(/^SESSION_STATUS_/, "");
}

/**
 * Mudança de plano que o sim do operador não cobre (F4.17, review de segurança):
 * task que muda de classe, task que ganha ou perde publicação ou caminho
 * clínico, e task já sensível que troca o que publica, o caminho clínico que
 * toca ou a fase. Task nova comum (classe `null` → `comum`) não conta (C24 do
 * VEGA-28: o re-plano da T10–T12 do ATRM-52 evitou task nova só para não
 * derrubar a herança). `ids` restringe às tasks dadas; sem ele, todas.
 */
export function mudancasQuePerguntam(de, para, ids = null) {
  const todos = ids ?? [...new Set([...de.porId.keys(), ...para.porId.keys()])];
  const sensivel = (t) => Boolean(t && (t.publicacao.length || t.clinica.length));
  const out = [];
  for (const id of todos) {
    const a = de.porId.get(id);
    const b = para.porId.get(id);
    const classeDe = a?.classe ?? null;
    const classePara = b?.classe ?? null;
    if (classeDe !== classePara && !(classeDe === null && classePara === "comum")) {
      out.push({ task: id, de: classeDe, para: classePara });
      continue;
    }
    // Segmento de tela clínica dos Steps libera o `trazer` (P21/P24): mudá-lo é mudar sensibilidade.
    // As telas são do adaptador que leu cada plano (`codigoDoPlano`).
    const segA = JSON.stringify(gitConducao.segmentosDosSteps(a?.passos ?? [], codigoDoPlano(de)));
    const segB = JSON.stringify(gitConducao.segmentosDosSteps(b?.passos ?? [], codigoDoPlano(para)));
    if (sensivel(a) !== sensivel(b) || (a && b && segA !== segB) || (!a && segB !== "[]")) out.push({ task: id, sensibilidade: true });
    else if (
      sensivel(a) &&
      (JSON.stringify(a.publicacao) !== JSON.stringify(b.publicacao) ||
        JSON.stringify(a.clinica) !== JSON.stringify(b.clinica) ||
        a.fase !== b.fase)
    )
      out.push({ task: id, sensibilidade: true });
  }
  return out;
}

/**
 * Mudança de alcance que só o ruling do operador (`/intra-plan`) carrega: task que
 * nasce ou some, ou que troca `**Outputs:**` (Output declarado libera o
 * `trazer`), Verificação (a maestra a executa) ou estação. A herança pelo sim
 * do ciclo sem ruling exige lista vazia (review do hotfix pós-ATRM-52).
 */
export function mudancasDeAlcance(de, para) {
  const ids = [...new Set([...de.porId.keys(), ...para.porId.keys()])];
  return ids.filter((id) => {
    const a = de.porId.get(id);
    const b = para.porId.get(id);
    if (!a || !b) return true;
    return (
      JSON.stringify(a.outputs) !== JSON.stringify(b.outputs) ||
      a.verificacao !== b.verificacao ||
      a.estacao !== b.estacao ||
      a.fase !== b.fase
    );
  });
}

/** Campos do plano parseado que decidem a condução de uma task (T22 passo 1). */
const CAMPOS_DO_PLANO = ["fase", "deps", "classe", "outputs", "publicacao", "estacao"];

/**
 * Tasks cujo plano parseado mudou entre dois planos: as que nasceram, sumiram
 * ou mudaram algum de `CAMPOS_DO_PLANO`. Blob diferente com lista vazia é
 * mudança que não toca a condução (§13, nota, typo).
 */
export function diferencaDoPlano(antigo, novo) {
  const ids = [...new Set([...antigo.porId.keys(), ...novo.porId.keys()])];
  const out = [];
  for (const id of ids) {
    const de = antigo.porId.get(id);
    const para = novo.porId.get(id);
    if (!de || !para) {
      out.push({ task: id, mudou: de ? "sumiu" : "nasceu" });
      continue;
    }
    const campos = CAMPOS_DO_PLANO.filter((c) => JSON.stringify(de[c]) !== JSON.stringify(para[c]));
    if (campos.length)
      out.push({ task: id, mudou: "campos", campos: Object.fromEntries(campos.map((c) => [c, { de: de[c], para: para[c] }])) });
  }
  return out;
}

/**
 * Re-plano de ruling do `/intra-plan` (F4.17): subject
 * `<ciclo>-F<n>/D-<CICLO>-<N> — re-plano de <alvo>: …`, reconhecido pelo
 * `phase-commit-regex.js` do harness, do mesmo ciclo. Devolve o id do ruling
 * ou null. `reconhecer` existe para a contraprova (regex desligado ⇒ null).
 */
export function rulingDoReplano(subject, ciclo, reconhecer = parsePhaseCommit) {
  const p = reconhecer(subject);
  if (!p || !p.ruling || !sameCycle(p.cycleId, ciclo)) return null;
  return p.description.startsWith(`${p.ruling} — re-plano de `) ? p.ruling : null;
}

/**
 * A ordem das regras do `proximo` (VEGA-29 T7): a primeira que devolve ação
 * decide. É o contrato da decisão — a rede de arquivamento antes de tudo, o
 * fechamento e a autorização antes da fase, e dentro dela trazer antes da
 * vigia, a vigia antes da maestra e do abrir (ela preenche `reabrir`), e a
 * pergunta `sem-saida` por último, sempre decidindo.
 */
export const ORDEM_DAS_REGRAS = Object.freeze([
  regraArquivar,
  regraFaseForaDoPlano,
  regraFecharCiclo,
  regraEncerrarSessao,
  regraAutorizarFase,
  regraReplano,
  regraReabertaSemFechamento,
  regraPublicacaoRecusada,
  regraTrazidaSemConferencia,
  regraTrazer,
  regraVigia,
  regraFazerMaestra,
  regraAbrir,
  regraEsperar,
  regraWorkstation,
  regraFecharFase,
  regraSemSaida,
]);

/**
 * O contexto da decisão (regras.mjs `contextoDaDecisao`), com a fábrica de
 * ações `acao` e os auxiliares desta casa injetados. Os campos estão descritos lá.
 */
export function contextoDoProximo({ ciclo, head, plano, planoBlob, planoHead, planoHeadBlob, diffPlano, autorizacoes, estado, entrada = {}, agora = null, reinicioEm = null, encerradas = new Set(), repo = null, replanos = null, reconhecer = parsePhaseCommit, autorizacaoDoCiclo = null, conferencia = [], temCi = true }, acao) {
  return contextoDaDecisao(
    { ciclo, head, plano, planoBlob, planoHead, planoHeadBlob, diffPlano, autorizacoes, estado, entrada, agora, reinicioEm, encerradas, repo, replanos, reconhecer, autorizacaoDoCiclo, conferencia, temCi },
    {
      acao,
      nonce,
      lerAviso,
      estadoDaFilha,
      diferencaDoPlano,
      mudancasQuePerguntam,
      mudancasDeAlcance,
      rulingDoReplano,
      tasksQueMudaramDeClasse,
      textoDaProximaSessao,
      textoDoFechamento,
      casoDeConferencia,
      opcoesDaConferencia,
      tetoPadrao: BOTOES.tetoFilhasPadrao,
      tetoFalhasAmbiente: BOTOES.tetoFalhasAmbiente,
      silencioFilhaCaidaMin: BOTOES.silencioFilhaCaidaMin,
      epoch,
    },
  );
}

/**
 * A ação do `proximo`, decidida sem I/O: a primeira das `ORDEM_DAS_REGRAS`
 * que decide, sobre o contexto de `contextoDoProximo` (parâmetros lá). A
 * fábrica `acao` põe em toda ação o nonce do HEAD, o ciclo e o blob do plano.
 */
export function decidir(params) {
  const { ciclo, head, planoBlob } = params;
  const fabrica = (tipo, alvo, tentativa, campos) => ({
    acao: tipo,
    nonce: nonce(ciclo, alvo, tentativa, head),
    ciclo,
    head,
    plano: planoBlob,
    ...campos,
  });
  // A pergunta das regras sai pelo construtor único (pergunta.mjs, T12).
  const ctx = contextoDoProximo(params, pergunta.comPergunta(fabrica));
  for (const regra of ORDEM_DAS_REGRAS) {
    const decidida = regra(ctx);
    if (decidida) return decidida;
  }
  throw new Error("decidir: nenhuma regra decidiu — regraSemSaida, a última, sempre decide");
}

/**
 * Ordem do nível da maestra (`proximo --nivel maestra`): arquivar a condutora
 * encerrada antes de criar a seguinte, a vigia da condutora viva (T39) antes
 * de toda espera, o fechamento do ciclo antes da fase, e a criação da
 * condutora por último, sempre decidindo.
 */
export const ORDEM_DA_MAESTRA = Object.freeze([maestraArquivarCondutora, maestraVigiarCondutora, maestraCriarFechamento, maestraCriarCondutora]);

/**
 * A ação do nível da maestra, sem I/O (regras.mjs §nível da maestra): as
 * `filhas` da entrada são as condutoras, cada uma com a `fase`; `plano` é o
 * do HEAD — a maestra não abre neta, então não lê o plano congelado.
 */
export function decidirMaestra({ ciclo, head, plano, planoBlob, encerradas = new Set(), autorizadas = new Set(), cicloAutorizado = false, entrada = {}, repo = null, agora = Math.floor(Date.now() / 1000) }) {
  const fabrica = (tipo, alvo, tentativa, campos) => ({
    acao: tipo,
    nonce: nonce(ciclo, alvo, tentativa, head),
    ciclo,
    head,
    plano: planoBlob,
    nivel: "maestra",
    ...campos,
  });
  const acao = pergunta.comPergunta(fabrica);
  const ctx = {
    ciclo,
    head,
    planoBlob,
    repo,
    plano,
    encerradas,
    autorizadas,
    cicloAutorizado,
    entrada,
    acao,
    nonce,
    condutoras: (Array.isArray(entrada.filhas) ? entrada.filhas : []).map((f) => ({
      ...f,
      estado: estadoDaFilha(f?.estado),
      ...(f?.statusBucket !== undefined ? { statusBucket: estadoDaFilha(f.statusBucket) } : {}),
    })),
    agora,
    silencioCondutoraCaidaMin: BOTOES.silencioCondutoraCaidaMin,
    epoch,
    textoDaProximaSessao,
    textoDoFechamento,
  };
  for (const regra of ORDEM_DA_MAESTRA) {
    const decidida = regra(ctx);
    if (decidida) return decidida.nivel ? decidida : { ...decidida, nivel: "maestra" };
  }
  throw new Error("decidirMaestra: nenhuma regra decidiu — maestraCriarCondutora, a última, sempre decide");
}

/** Raiz do plugin que carrega a skill e os verbos da condução (`<raiz>/scripts/conducao/`). */
const RAIZ_DOS_VERBOS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Texto da próxima sessão maestra (T21), na forma de `/write-plan`
 * §Granularidade de sessão: o comando da sessão nova e o pré-voo da skill,
 * com o arquivamento da sessão que encerra antes do `retomar` (uma maestra
 * por ciclo).
 */
export function textoDaProximaSessao({ ciclo, fase, repo, sessao, peloCiclo = false, anterior = "maestra anterior", primeira = false, autorizada = false }) {
  const arvore = repo ?? "<worktree do ciclo conduzido>";
  const operador = adaptador.nomeDoOperador(repo);
  const verbos = `node ${RAIZ_DOS_VERBOS}/scripts/conducao/conducao.mjs`;
  return [
    `Conduzir ${ciclo} — ${fase}, pela skill ${RAIZ_DOS_VERBOS}/skills/conducao/SKILL.md (worktree conduzida: ${arvore}).`,
    primeira
      ? `Pré-voo da skill §1; no passo 2, sem ${anterior} a arquivar.`
      : `Pré-voo da skill §1; no passo 2, archive_session da ${anterior} ${sessao ?? "<id da sessão que encerrou>"} antes do retomar.`,
    `${verbos} retomar --repo ${arvore} --ciclo ${ciclo}`,
    autorizada
      ? `${verbos} proximo --repo ${arvore} --ciclo ${ciclo} → ${fase} já autorizada: executar a ação emitida.`
      : peloCiclo
      ? `${verbos} proximo --repo ${arvore} --ciclo ${ciclo} → herdar-autorizacao ${fase} pelo sim do ciclo: gravar com herdar-autorizacao, sem pedir a ${operador}.`
      : `${verbos} proximo --repo ${arvore} --ciclo ${ciclo} → perguntar autorizar-ciclo ${fase}: pedir o sim do ciclo a ${operador}.`,
  ].join("\n");
}

/**
 * Texto da sessão limpa do `/close-cycle` (T22). Até o VEGA-22 entrar no
 * `main`, o `/close-cycle` e os verbos da condução vêm desta árvore, por
 * caminho absoluto: o `auditar` do Ato A e o `limpar` do Step 10.0.
 */
export function textoDoFechamento({ ciclo, repo, sessao, conduzidas, exigirEncerramentos, anterior = "maestra anterior" }) {
  const arvore = repo ?? "<worktree do ciclo conduzido>";
  const verbos = `node ${RAIZ_DOS_VERBOS}/scripts/conducao/conducao.mjs`;
  return [
    `/close-cycle ${ciclo}`,
    `Ciclo conduzido (worktree: ${arvore}); archive_session da ${anterior} ${sessao ?? "<id da sessão que encerrou>"} antes do Ato A.`,
    `Até o merge do VEGA-22, ler o /close-cycle do projeto e rodar os verbos da condução por esta árvore (${RAIZ_DOS_VERBOS}):`,
    `- Ato A §8.9: ${verbos} auditar --repo ${arvore} --ciclo ${ciclo} --ref HEAD --exigir-fases ${conduzidas.join(",")} --exigir-encerramentos ${exigirEncerramentos.join(",")} — diferente de 0 ⇒ parar.`,
    `- Step 10.0: ${verbos} limpar --repo ${arvore} --ciclo ${ciclo}`,
  ].join("\n");
}

/**
 * `encerrar-sessao`: commit vazio `Conducao: F<n> sessao encerrada` no ramo
 * conduzido, com `Conducao-Encerrada: F<n>` e o nonce nos trailers, e a cópia
 * empurrada. O id da sessão não entra: `/clear` o mantém, e compará-lo
 * prenderia o laço. A marca já presente não grava outra.
 */
export function encerrarSessao({ repo, ciclo, fase, nonce: n }) {
  if (!/^(F\d{1,2}|ciclo)$/.test(fase ?? "")) throw new ErroPlano("uso", `encerrar-sessao exige --fase F<n>|ciclo, veio ${JSON.stringify(fase ?? null)}`);
  if (!/^[0-9A-Za-z_-]{4,64}$/.test(n ?? "")) throw new ErroPlano("uso", `encerrar-sessao exige --nonce, veio ${JSON.stringify(n ?? null)}`);
  const ja = lerMarcas(repo).find((m) => m.tipo === "encerrada" && m.fase === fase);
  if (!ja)
    git(repo, ["commit", "-q", "--allow-empty", "-m", `Conducao: ${fase} sessao encerrada`, "-m", `Conducao-Encerrada: ${fase}\nConducao-Nonce: ${n}`]);
  const sha = ja?.sha ?? git(repo, ["rev-parse", "HEAD"]).trim();
  return gitConducao.comCopia(repo, ciclo, { acao: "encerrada", ciclo, fase, nonce: n, sha, jaEstava: !!ja });
}

// ── verbos ───────────────────────────────────────────────────────────────────

const CICLO_TASK_RE = (ciclo) =>
  new RegExp(`^${ciclo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(F\\d{1,2})[/.](T\\d{1,3}) — `);

/** Antes da primeira autorização: a fase sugerida é a primeira com task sem commit dela (sugestão, nunca prova). */
function faseSugerida(repo, ciclo, plano) {
  const re = CICLO_TASK_RE(ciclo);
  const comCommit = new Set();
  for (const s of git(repo, ["log", "--format=%s", "HEAD"]).split("\n")) {
    const m = re.exec(s);
    if (m) comCommit.add(m[2]);
  }
  return plano.fases.find((f) => f.tasks.some((t) => !comCommit.has(t)))?.id ?? null;
}

function erroComoPergunta(ciclo, head, e) {
  return pergunta.perguntar({
    acao: "perguntar",
    nonce: nonce(ciclo, "plano", 0, head),
    ciclo,
    head,
    motivo: e.codigo,
    detalhe: e.message,
  });
}

/** Epoch em segundos de um instante ISO ou de um número (já em segundos); null se ilegível. */
function epoch(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const ms = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * A unidade de usuário da ponte, da declaração (`sessao.ponte.unidade`, v5):
 * o núcleo não nomeia host nem ponte (T30, D-VEGA29-15). Declaração ilegível
 * ou sem o campo ⇒ `null`.
 */
function unidadeDaPonte(repo) {
  try {
    return adaptador.lerAdaptador(repo).sessao.ponte?.unidade ?? null;
  } catch {
    return null;
  }
}

/**
 * Hora (epoch s) em que a ponte entrou em `active` pela última vez — o
 * `ActiveEnterTimestamp` da unidade de usuário. `null` quando não se lê
 * (sem systemd de usuário, unidade ausente ou não declarada, nunca ativa).
 */
export function ponteAtivaDesde(unidade) {
  if (!unidade) return null;
  try {
    const v = execFileSync("systemctl", ["--user", "show", unidade, "-p", "ActiveEnterTimestamp", "--value", "--timestamp=unix"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
    const m = /^@(\d+)$/.exec(v);
    return m && Number(m[1]) > 0 ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * O registro do `reiniciar-ponte.sh` só cobre queda se a ponte de fato
 * (re)subiu depois dele: o verbo pede o restart com `--no-block` e grava o
 * registro ANTES (a sessão que chamou morre com o restart), então o arquivo
 * pode existir sem reinício nenhum. Confirmado = `ativaDesde` (epoch s, o
 * `ActiveEnterTimestamp`) ≥ `quando`. Registro velho confirmado por uma subida
 * posterior não estende a cobertura: o `proximo` só cobre tentativa ABERTA
 * antes de `quando` (`cobertaPorReinicio`).
 */
export function reinicioConfirmado(reinicio, ativaDesde) {
  if (!reinicio || typeof reinicio !== "object") return { valido: false, motivo: "sem-registro" };
  const quando = epoch(reinicio.quando);
  if (quando === null) return { valido: false, motivo: "registro-sem-hora" };
  if (ativaDesde === null || ativaDesde === undefined) return { valido: false, motivo: "ponte-sem-hora-de-subida", quando: reinicio.quando };
  const subida = new Date(ativaDesde * 1000).toISOString();
  if (ativaDesde < quando) return { valido: false, motivo: "ponte-nao-subiu-depois-do-registro", quando: reinicio.quando, ativaDesde: subida };
  return { valido: true, quando: reinicio.quando, ativaDesde: subida };
}

/** Lê o arquivo do `--reinicio` e o confirma pela ponte; devolve `{ reinicio, confirmacao }`. */
function carregarReinicio(arquivo, ativaDesdeFlag, repo) {
  if (!arquivo || !existsSync(arquivo)) return { reinicio: null, confirmacao: null };
  let reg;
  try {
    reg = JSON.parse(readFileSync(arquivo, "utf8"));
  } catch {
    return { reinicio: null, confirmacao: { valido: false, motivo: "registro-ilegivel" } };
  }
  const ativaDesde = ativaDesdeFlag !== undefined ? epoch(ativaDesdeFlag) : ponteAtivaDesde(unidadeDaPonte(repo));
  const confirmacao = reinicioConfirmado(reg, ativaDesde);
  return { reinicio: confirmacao.valido ? reg : null, confirmacao };
}

/**
 * Problemas de forma da entrada da maestra (T17, 20-a): lista vazia = entrada
 * legível. Confere o que o `proximo` lê (SKILL §2 passo 1) — campo de cima
 * desconhecido (typo como `filha`), lista que não é lista, campo de filha ou
 * de aprovação com tipo errado, `ci` que não é objeto, `tetoPonte` não
 * inteiro, `agora` ilegível. Campo a mais dentro de uma filha
 * passa: a sessão traz o que a API der.
 */
export function problemasDaEntrada(entrada, { nivel = null } = {}) {
  const objeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!objeto(entrada)) return [`a entrada é ${Array.isArray(entrada) ? "lista" : typeof entrada}, esperado objeto`];
  const out = [];
  const tipo = (onde, v, ok, esperado) => {
    if (v !== undefined && v !== null && !ok(v)) out.push(`${onde}: ${JSON.stringify(v)?.slice(0, 60)}, esperado ${esperado}`);
  };
  const texto = (v) => typeof v === "string";
  const inteiro = (v) => Number.isInteger(v) && v >= 0;
  for (const k of Object.keys(entrada)) if (!CAMPOS_DA_ENTRADA.includes(k)) out.push(`campo desconhecido: ${k}`);
  const lista = (nome, item) => {
    const v = entrada[nome];
    if (v === undefined || v === null) return;
    if (!Array.isArray(v)) return out.push(`${nome}: esperado lista`);
    v.forEach((x, i) => (objeto(x) ? item(x, `${nome}[${i}]`) : out.push(`${nome}[${i}]: esperado objeto`)));
  };
  lista("filhas", (f, onde) => {
    for (const k of ["sessao", "task", "nonce", "estado", "statusBucket", "aviso", "fase"]) tipo(`${onde}.${k}`, f[k], texto, "texto");
    // Quando a maestra mandou a mensagem do `cutucar` à filha caída (T18).
    tipo(`${onde}.cutucadaEm`, f.cutucadaEm, (v) => epoch(v) !== null, "instante ISO ou epoch em segundos");
    // Quando quem conduz viu a queda em curso pela primeira vez (T40): `cutucadaEm` anterior não conta.
    tipo(`${onde}.caidaEm`, f.caidaEm, (v) => epoch(v) !== null, "instante ISO ou epoch em segundos");
    // `caidaEm` no futuro (relógio, ms no lugar de s) faria todo `cutucadaEm` contar como de queda velha: `cutucar` sem fim.
    if (f.caidaEm != null && epoch(f.caidaEm) !== null && epoch(f.caidaEm) > (epoch(entrada.agora) ?? Date.now() / 1000) + 60)
      out.push(`${onde}.caidaEm: ${JSON.stringify(f.caidaEm)}, depois de agora`);
    tipo(`${onde}.tentativa`, f.tentativa, inteiro, "inteiro >= 0");
    tipo(`${onde}.arquivamentos`, f.arquivamentos, (a) => Array.isArray(a) && a.every(texto), "lista de textos");
    // Nível da maestra: a condutora sem sessão, fase ou estado não se arquiva nem
    // se distingue de nenhuma — vira pergunta, nunca espera calada.
    if (nivel === "maestra")
      for (const k of ["sessao", "fase", "estado"]) if (!texto(f[k]) || !f[k].trim()) out.push(`${onde}.${k}: ausente, esperado texto (nível da maestra)`);
  });
  lista("aprovacoes", (a, onde) => {
    for (const k of ["task", "nonce"]) tipo(`${onde}.${k}`, a[k], texto, "texto");
  });
  tipo("ci", entrada.ci, objeto, "objeto");
  if (objeto(entrada.ci)) {
    tipo("ci.sha", entrada.ci.sha, texto, "texto");
    // Veredito fora de `verde|vermelho` (`em-curso`) é CI sem veredito: `ci-pendente`, não forma errada.
    tipo("ci.veredito", entrada.ci.veredito, texto, "texto");
  }
  tipo("proposta", entrada.proposta, objeto, "objeto");
  if (objeto(entrada.proposta)) tipo("proposta.state", entrada.proposta.state, texto, "texto");
  tipo("tetoPonte", entrada.tetoPonte, inteiro, "inteiro >= 0");
  tipo("agora", entrada.agora, (v) => epoch(v) !== null, "instante ISO ou epoch em segundos");
  tipo("sessaoMaestra", entrada.sessaoMaestra, texto, "texto");
  return out;
}

/** Campos de cima que o `proximo` lê da entrada (SKILL §2 passo 1). */
const CAMPOS_DA_ENTRADA = Object.freeze(["filhas", "aprovacoes", "ci", "proposta", "tetoPonte", "agora", "sessaoMaestra"]);

/**
 * `reinicio` é o registro que `reiniciar-ponte.sh` grava em todo reinício da
 * ponte (`ponte-reinicio.json`; vale o `quando`), já confirmado pela CLI
 * (`reinicioConfirmado`); a maestra o passa com `--reinicio <arquivo>`.
 * `entrada.agora` fixa o relógio da vigia (testes, replay); sem ele vale o
 * relógio da máquina.
 */
export function proximo({ repo, ciclo, entrada = {}, entradaErro = null, reinicio = null, nivel = null }) {
  const head = git(repo, ["rev-parse", "HEAD"]).trim();
  // Fronteira (T17, 20-a): entrada que não se lê, ou de forma errada, vira
  // pergunta; nunca decisão calada (filhas não-lista lidas como nenhuma filha).
  const problemas = entradaErro ? [entradaErro] : problemasDaEntrada(entrada, { nivel });
  if (problemas.length)
    return pergunta.perguntar({
      acao: "perguntar",
      nonce: nonce(ciclo, "entrada", 0, head),
      ciclo,
      head,
      motivo: "entrada-invalida",
      problemas,
      detalhe: `a entrada do proximo não se lê: ${problemas.join("; ")} — nada foi decidido; refazer a entrada (SKILL §2 passo 1)`,
    });
  const marcas = lerMarcas(repo);
  const autorizacoes = marcas.filter((m) => m.tipo === "autorizada");
  let noHead;
  try {
    noHead = lerPlanoNoCommit(repo, "HEAD", ciclo);
  } catch (e) {
    if (e instanceof ErroPlano) return erroComoPergunta(ciclo, head, e);
    throw e;
  }
  const encerradas = new Set(marcas.filter((m) => m.tipo === "encerrada").map((m) => m.fase));
  // Nível da maestra (A1): cria a condutora de cada fase e a sessão de
  // fechamento; o laço da condutora, abaixo, fica como está.
  if (nivel === "maestra")
    return decidirMaestra({
      ciclo,
      head,
      plano: noHead.plano,
      planoBlob: noHead.blob,
      encerradas,
      autorizadas: new Set(autorizacoes.map((a) => a.fase)),
      cicloAutorizado: autorizacoes.some((m) => m.ciclo),
      entrada,
      repo,
      agora: entrada.agora !== undefined ? epoch(entrada.agora) : Math.floor(Date.now() / 1000),
    });
  const ultima = autorizacoes.at(-1);
  if (!ultima) {
    const fase = faseSugerida(repo, ciclo, noHead.plano);
    return pergunta.perguntar({
      acao: "perguntar",
      nonce: nonce(ciclo, fase ?? "ciclo", 0, head),
      ciclo,
      head,
      plano: null,
      motivo: "autorizar-ciclo",
      fase,
      sugestao: true,
      planoNovo: noHead.blob,
      planoAnterior: null,
      mudaramDeClasse: [],
      ci: entrada.ci ?? null,
    });
  }
  let congelado;
  try {
    congelado = lerPlanoCongelado(repo, ciclo, ultima);
  } catch (e) {
    if (e instanceof ErroPlano) return erroComoPergunta(ciclo, head, e);
    throw e;
  }
  const diffPlano =
    noHead.blob !== congelado.blob ? git(repo, ["diff", congelado.blob, noHead.blob]) : null;
  // Commits que mexeram no canonico desde a autorização (F4.17), pela linha do
  // ciclo (`--first-parent`): merge entra só quando muda o canonico em relação
  // ao primeiro pai, e aí o subject dele nunca é de ruling e a herança cai na
  // pergunta. Merge de origin/main que não muda o canonico do ciclo fica de
  // fora (C24 do VEGA-28: o `--full-history` o listava porque o main tem outra
  // versão do canonico). Canonico em outro caminho ⇒ null, sem herança.
  const replanos =
    diffPlano && noHead.caminho === congelado.caminho
      ? git(repo, ["log", "--first-parent", "--format=%H%x1f%s", `${ultima.sha}..HEAD`, "--", noHead.caminho])
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const [sha, subject = ""] = l.split("\x1f");
            return { sha, subject };
          })
      : null;
  // O último sim do operador ao ciclo (`autorizar-ciclo`), com o plano congelado
  // nele: a régua do que o sim cobre. Marca ilegível não cobre nada.
  const marcaDoCiclo = autorizacoes.findLast((m) => m.ciclo) ?? null;
  let autorizacaoDoCiclo = null;
  if (marcaDoCiclo) {
    try {
      autorizacaoDoCiclo = { sha: marcaDoCiclo.sha, plano: lerPlanoCongelado(repo, ciclo, marcaDoCiclo).plano };
    } catch (e) {
      if (!(e instanceof ErroPlano)) throw e;
      process.stderr.write(`conducao: sim do ciclo ${marcaDoCiclo.sha.slice(0, 8)} ignorado (${e.codigo}) — cada fase pede o sim de ${adaptador.nomeDoOperador(repo)}\n`);
    }
  }
  const decl = adaptador.lerAdaptador(repo);
  return decidir({
    ciclo,
    head,
    autorizacaoDoCiclo,
    plano: congelado.plano,
    planoBlob: congelado.blob,
    planoHead: noHead.plano,
    planoHeadBlob: noHead.blob,
    diffPlano,
    autorizacoes,
    estado: estadoDasTasks(marcas, lerRefsLocais(repo, ciclo), gitConducao.lerTrazidas(repo, ciclo)),
    entrada,
    agora: entrada.agora !== undefined ? epoch(entrada.agora) : Math.floor(Date.now() / 1000),
    reinicioEm: reinicio ? epoch(reinicio.quando) : null,
    encerradas,
    repo,
    replanos,
    // Casos de conferência do operador que o adaptador declara (T14) e se o
    // projeto tem CI da proposta (T15, 5-a).
    conferencia: decl.conferencia,
    temCi: decl.ci,
  });
}

/**
 * `herdar-autorizacao F<n> --nonce <x>` (F4.17): grava a autorização herdada
 * pelo re-plano de ruling ou pelo sim do ciclo (`autorizar-ciclo`, origem
 * `ciclo`). Não confia em quem chama: refaz o `proximo` e só
 * grava quando ele devolve `herdar-autorizacao` da mesma fase e do mesmo nonce.
 */
export function herdarAutorizacao({ repo, ciclo, fase, nonce: n }) {
  if (!/^F\d{1,2}$/.test(fase ?? "")) throw new ErroPlano("uso", `herdar-autorizacao exige F<n>, veio ${JSON.stringify(fase ?? null)}`);
  if (!/^[0-9a-f]{16}$/.test(n ?? "")) throw new ErroPlano("uso", `herdar-autorizacao exige --nonce, veio ${JSON.stringify(n ?? null)}`);
  const p = proximo({ repo, ciclo });
  if (p.acao !== "herdar-autorizacao" || p.fase !== fase || p.nonce !== n)
    throw new ErroPlano(
      "heranca-recusada",
      `o proximo devolve ${p.acao}${p.motivo ? ` ${p.motivo}` : ""}${p.fase ? ` ${p.fase}` : ""} (nonce ${p.nonce}), não herdar-autorizacao ${fase} ${n}`,
    );
  const r = gitConducao.registrarHeranca({ repo, ciclo, fase, autorizacao: p.autorizacao, replanos: p.replanos, planoNovo: p.planoNovo, origem: p.origem ?? "replano" });
  process.stderr.write(`conducao: ${p.aviso}\n`);
  return { ...r, aviso: p.aviso };
}

/** Aspas simples de shell. */
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export function embrulharSemProducao(comando, { marcaSemCofre = adaptador.MARCA_SEM_COFRE_PADRAO, variaveisDeProducao = [] } = {}) {
  const partes = ["env", ...variaveisDeProducao.flatMap((v) => ["-u", v]), `${marcaSemCofre}=1`, "bash", "-c", shq(comando)];
  return partes.join(" ");
}

const BUILTINS = new Set([
  "cd", "test", "[", "[[", "export", "echo", "true", "false", ":", "exit", "return", "printf",
  "set", "unset", "shift", "read", "local", "source", ".", "pwd", "eval", "exec", "wait",
]);
/**
 * Palavras-chave de shell (C24 do VEGA-28: `for`/`do`/`done` da T10 do ATRM-52
 * saíam `binario-ausente`). As de PREFIXO vêm antes de um comando: pula-se a
 * palavra e o comando seguinte conta. As de SEGMENTO abrem cabeçalho sem
 * comando (`for x in …`, `case … in`): o segmento inteiro fica de fora. As de
 * FECHO não carregam comando.
 */
const PALAVRAS_DE_PREFIXO = new Set(["if", "then", "else", "elif", "do", "while", "until", "{", "!", "time"]);
const PALAVRAS_DE_SEGMENTO = new Set(["for", "case", "select", "function"]);
const PALAVRAS_DE_FECHO = new Set(["fi", "done", "esac", "}"]);

/**
 * Primeiro executável de cada segmento (`&&`, `||`, `;`, `|`, fim de linha),
 * fora de aspas e de parênteses, pulando atribuição `VAR=…`, palavra-chave de
 * shell e builtin. Palavra com `$` não se resolve sem rodar: fica de fora,
 * nunca acusada.
 */
export function executaveisDaVerificacao(comando) {
  const segmentos = [];
  let atual = "", aspa = null, prof = 0;
  for (let i = 0; i < comando.length; i++) {
    const c = comando[i];
    if (aspa) {
      if (c === "\\" && aspa === '"') { atual += c + (comando[++i] ?? ""); continue; }
      if (c === aspa) aspa = null;
      atual += c;
      continue;
    }
    if (c === "\\") { atual += c + (comando[++i] ?? ""); continue; }
    if (c === "'" || c === '"') { aspa = c; atual += c; continue; }
    if (c === "(") prof++;
    if (c === ")" && prof > 0) prof--;
    if (prof === 0 && (c === ";" || c === "|" || c === "\n" || (c === "&" && comando[i + 1] === "&"))) {
      if (c === "&" || (c === "|" && comando[i + 1] === "|")) i++;
      segmentos.push(atual);
      atual = "";
      continue;
    }
    atual += c;
  }
  segmentos.push(atual);
  const nomes = [];
  for (const seg of segmentos) {
    // Braço de `case` (`a) cmd`, `*) cmd`): o padrão antes do `)` não é comando.
    const palavras = seg.trim().replace(/^[^\s()]+\)(?:\s+(?=\S)|\s*$)/, "").split(/\s+/).filter(Boolean);
    let p = 0;
    while (p < palavras.length && (PALAVRAS_DE_PREFIXO.has(palavras[p]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(palavras[p]))) p++;
    if (PALAVRAS_DE_SEGMENTO.has(palavras[p])) continue;
    const primeira = palavras[p]?.replace(/^[({]+/, "").replace(/^(['"])(.*)\1$/, "$2");
    if (!primeira || primeira.includes("$") || BUILTINS.has(primeira) || PALAVRAS_DE_FECHO.has(primeira)) continue;
    nomes.push(primeira);
  }
  return [...new Set(nomes)];
}

function noPath(nome, repo, PATH = process.env.PATH ?? "") {
  const executavel = (f) => {
    try { accessSync(f, fsConstants.X_OK); return true; } catch { return false; }
  };
  if (nome.includes("/")) return executavel(path.resolve(repo, nome));
  return PATH.split(path.delimiter).filter(Boolean).some((d) => executavel(path.join(d, nome)));
}

/**
 * Verificação da task no plano congelado na última autorização, sem as variáveis de produção.
 * Binário ausente no PATH da maestra (achado T10 da T18: `npx --no-install deno`
 * sem deno na estação) vira `perguntar binario-ausente` com os nomes — a
 * Verificação crua nunca sai, para não ser trocada à mão em silêncio.
 */
export function conferir({ repo, ciclo, task }) {
  const autorizacoes = lerMarcas(repo).filter((m) => m.tipo === "autorizada");
  const ultima = autorizacoes.at(-1);
  if (!ultima) throw new ErroPlano("sem-autorizacao", `nenhuma fase de ${ciclo} autorizada — conferir lê só plano congelado`);
  const { blob, plano } = lerPlanoCongelado(repo, ciclo, ultima);
  const t = plano.porId.get(task);
  if (!t) throw new ErroPlano("task-ausente", `${task} não está no plano congelado ${blob}`);
  if (!t.verificacao) throw new ErroPlano("verificacao-ausente", `${task} sem comando de Verificação no plano`);
  const ausentes = executaveisDaVerificacao(t.verificacao).filter((n) => !noPath(n, repo));
  if (ausentes.length) return pergunta.perguntar({ acao: "perguntar", motivo: "binario-ausente", ciclo, task, plano: blob, binarios: ausentes });
  // Só aviso: erro ao medir não derruba o conferir, e sai dito como indeterminado.
  let saida;
  try {
    saida = saidaForaDoGit(repo, ciclo, task);
  } catch (e) {
    saida = [{ indeterminado: String(e?.stderr ?? e?.message ?? e).trim().split("\n")[0] }];
  }
  return {
    acao: "conferir",
    ciclo,
    task,
    plano: blob,
    posMerge: t.posMerge,
    comando: t.verificacao,
    verificacao: embrulharSemProducao(t.verificacao, adaptador.verificacaoDoProjeto(repo)),
    ...(saida.length
      ? {
          saidaForaDoGit: saida,
          avisoSaida:
            `a tentativa trazida acrescentou estes padrões a um .gitignore: o que a task gerou sob eles ficou na worktree da filha e não veio pelo trazer. Verificação vermelha por arquivo ausente aqui não é falha de trabalho — ler a filha antes de reverter, e perguntar a ${adaptador.nomeDoOperador(repo)} onde a Verificação roda.`,
        }
      : {}),
  };
}

/**
 * Padrões que a tentativa trazida da task acrescentou a um `.gitignore` (C24
 * do VEGA-28: a T11 do ATRM-52 gitignorou `demonstracao/saida/`, e a
 * Verificação, rodada na worktree do ciclo, leu um manifesto que só existia
 * na da filha). Sem trazida pendente da task, lista vazia.
 */
export function saidaForaDoGit(repo, ciclo, task) {
  const r = gitConducao.lerTrazidas(repo, ciclo).filter((x) => x.task === task).at(-1);
  if (!r?.base || !r?.ate) return [];
  const diff = git(repo, ["-c", "core.quotePath=false", "diff", "-U0", "--no-color", "--no-renames", r.base, r.ate, "--", ".gitignore", ":(glob)**/.gitignore"]);
  const out = [];
  let arquivo = null;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++ ")) arquivo = l === "+++ /dev/null" ? null : l.slice(4).replace(/^b\//, "");
    else if (arquivo && l.startsWith("+")) {
      const padrao = l.slice(1).trim();
      if (padrao && !padrao.startsWith("#") && !padrao.startsWith("!")) out.push({ arquivo, padrao });
    }
  }
  return out;
}

// ── retomar ──────────────────────────────────────────────────────────────────

function revParse(repo, ref) {
  try {
    return git(repo, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]).trim() || null;
  } catch {
    return null;
  }
}

function ancestral(repo, a, b) {
  const r = tentarGit(repo, ["merge-base", "--is-ancestor", a, b]);
  if (r.status === 0) return true;
  return r.status === 1 ? false : null; // 128: objeto ausente localmente
}

/** Referências da condução no origin (`refs/conducao/<ciclo>/…`), sem buscar objeto nenhum. */
function lerRefsOrigin(repo, ciclo) {
  const prefixo = `refs/conducao/${ciclo}/`;
  const bruto = git(repo, ["ls-remote", "origin", `${prefixo}*`]);
  const refs = new Map();
  for (const l of bruto.split("\n")) {
    const [sha, nome] = l.split("\t");
    if (sha && nome?.startsWith(prefixo)) refs.set(nome, sha);
  }
  return refs;
}

/**
 * Estado da condução reconstruído só do git local (marcas no ramo e
 * referências `refs/conducao-local/…`), conferido contra o origin. O origin
 * nunca é fonte: referência dele que diverge da local é relatada, nunca
 * buscada nem adotada (§5 do canonico do VEGA-22).
 */
export function retomar({ repo, ciclo }) {
  const head = git(repo, ["rev-parse", "HEAD"]).trim();
  let ramo = null;
  try {
    ramo = git(repo, ["symbolic-ref", "--short", "-q", "HEAD"]).trim() || null;
  } catch {
    ramo = null;
  }
  const marcas = lerMarcas(repo);
  const locais = lerRefsLocais(repo, ciclo);
  const trazidas = gitConducao.lerTrazidas(repo, ciclo);
  const estado = estadoDasTasks(marcas, locais, trazidas);
  const autorizadas = [...new Set(marcas.filter((m) => m.tipo === "autorizada").map((m) => m.fase))];
  const porNum = (a, b) => Number(a.slice(1)) - Number(b.slice(1));

  const divergencias = [];
  let origin;
  try {
    origin = lerRefsOrigin(repo, ciclo);
  } catch (e) {
    divergencias.push({ tipo: "origin-inacessivel", detalhe: String(e.stderr ?? e.message).trim().split("\n")[0] });
  }
  if (origin) {
    const copiaRef = `refs/conducao/${ciclo}/copia`;
    const copia = origin.get(copiaRef) ?? null;
    if (!copia && autorizadas.length) divergencias.push({ tipo: "copia-ausente", ref: copiaRef, local: head });
    else if (copia && copia !== head)
      divergencias.push({
        tipo: "copia-diverge",
        ref: copiaRef,
        origin: copia,
        local: head,
        // true: o origin tem commit da condução que o ramo local não tem.
        originAFrente: ancestral(repo, head, copia),
      });
    const prefixoLocal = `refs/conducao-local/${ciclo}/`;
    const vistos = new Set();
    for (const r of locais) {
      const nomeOrigin = `refs/conducao/${ciclo}/${r.ref.slice(prefixoLocal.length)}`;
      vistos.add(nomeOrigin);
      const sha = origin.get(nomeOrigin);
      if (!sha) divergencias.push({ tipo: "so-local", ref: r.ref, local: r.sha });
      else if (sha !== r.sha) divergencias.push({ tipo: "tentativa-diverge", ref: r.ref, origin: sha, local: r.sha });
    }
    for (const [nome, sha] of origin)
      if (nome !== copiaRef && !vistos.has(nome)) divergencias.push({ tipo: "so-no-origin", ref: nome, origin: sha });
  }

  return {
    acao: "retomar",
    ciclo,
    head,
    ramo,
    autorizadas,
    feitas: [...estado.feitas].sort(porNum),
    recusadas: [...estado.recusadas].sort(porNum),
    emVoo: [...estado.emVoo.values()]
      .sort((a, b) => porNum(a.task, b.task))
      .map((r) => ({ task: r.task, tentativa: r.tentativa, ref: r.ref, sha: r.sha, nonce: r.nonce })),
    trazidas: [...estado.trazidas.values()]
      .sort((a, b) => porNum(a.task, b.task))
      .map((r) => ({ task: r.task, tentativa: r.tentativa, ref: r.ref, ponta: r.ponta, nonce: r.nonce })),
    falhas: Object.fromEntries([...estado.falhas].sort(([a], [b]) => porNum(a, b))),
    falhasAmbiente: Object.fromEntries([...estado.falhasAmbiente].sort(([a], [b]) => porNum(a, b))),
    divergencias,
  };
}

// ── auditar ──────────────────────────────────────────────────────────────────

const VERIFICACOES = new Set(["verde", "declarada-pos-merge", "manual"]);
const PUBLICACOES = new Set(["feita", "nao-se-aplica"]);

/** Nota de pré-condições da T17: `ciclo_conduzido: <id>` e `ramo: <ramo>`, uma por linha. */
export function lerNota(texto) {
  const campo = (nome) => new RegExp(`^${nome}:[ \\t]*(\\S+)[ \\t]*$`, "m").exec(texto)?.[1] ?? null;
  return { ciclo: campo("ciclo_conduzido"), ramo: campo("ramo") };
}

/**
 * Confere o rastro de um ciclo conduzido nos commits do ramo — nunca na
 * referência de abertura, que a T10 apaga. Conduzidas são as fases com marca
 * de autorização; as anteriores (a F0 feita à mão) ficam fora e a saída o
 * declara. Regras por task conduzida: um commit `Conducao: T<k> conferida`
 * com os trailers da T10 (`manual` em task de estação workstation, sem sha
 * nem sessão de filha; `Conducao-Executor: maestra` com a sessão da maestra
 * em task de estação maestra), depois das conferências das tasks de `**Inputs:**` e
 * depois da marca da própria fase.
 *
 * Sem a nota (T22): `ciclo` e `ref` direto — a nota da T17 mora só na worktree
 * do VEGA-22 e o ramo do conduzido some no fechamento (`refs/pull/<N>/head`
 * fica). `exigirFases` e `exigirEncerramentos` viram violação quando falta a
 * marca de autorização da fase ou a `Conducao-Encerrada` pedida.
 */
export function auditar({ repo, nota = null, ciclo: cicloPedido = null, ref: refPedida = null, exigirFases = [], exigirEncerramentos = [] }) {
  let ciclo = cicloPedido;
  let ramo = null;
  let ref = refPedida;
  if (nota) {
    ({ ciclo, ramo } = lerNota(readFileSync(nota, "utf8")));
    if (!ciclo || !ramo)
      throw new ErroPlano("nota-incompleta", `${nota} sem ${!ciclo ? "ciclo_conduzido:" : "ramo:"} — a nota é a da T17`);
    ref = `refs/heads/${ramo}`;
  } else if (!ciclo || !ref) throw new ErroPlano("uso", "auditar exige --nota <arquivo> ou --ciclo <id> --ref <ref>");
  for (const f of exigirFases) if (!/^F\d{1,2}$/.test(f)) throw new ErroPlano("uso", `--exigir-fases: ${JSON.stringify(f)} não é F<n>`);
  for (const f of exigirEncerramentos)
    if (!/^(F\d{1,2}|ciclo)$/.test(f)) throw new ErroPlano("uso", `--exigir-encerramentos: ${JSON.stringify(f)} não é F<n> nem ciclo`);
  const ponta = revParse(repo, ref);
  if (!ponta) throw new ErroPlano("ramo-ausente", `${ref} não existe em ${repo}`);

  const marcas = lerMarcas(repo, ref);
  const autorizacoes = marcas.filter((m) => m.tipo === "autorizada");
  const conferidas = marcas.filter((m) => m.tipo === "conferida");
  const encerramentos = [...new Set(marcas.filter((m) => m.tipo === "encerrada").map((m) => m.fase))];
  // Exigências da chamada (T22): fase pedida sem marca de autorização e
  // encerramento pedido sem a marca `Conducao-Encerrada` saem como violação.
  const fasesAutorizadas = new Set(autorizacoes.map((m) => m.fase));
  const exigidas = [
    ...exigirFases.filter((f) => !fasesAutorizadas.has(f)).map((f) => ({ fase: f, regra: "fase-nao-conduzida" })),
    ...exigirEncerramentos.filter((f) => !encerramentos.includes(f)).map((f) => ({ fase: f, regra: "encerramento-ausente" })),
  ];
  const base = { acao: "auditar", ciclo, ramo, ref, ponta, encerramentos };
  if (!conferidas.length)
    return { ...base, plano: null, violacoes: [{ regra: "sem-conferencia", detalhe: `${ref} não tem nenhum commit de conferência` }, ...exigidas] };
  if (!autorizacoes.length)
    return { ...base, plano: null, violacoes: [{ regra: "sem-autorizacao", detalhe: `${ref} tem conferência sem marca de fase autorizada` }, ...exigidas] };

  const { blob, plano } = lerPlanoCongelado(repo, ciclo, autorizacoes.at(-1));
  const pos = (m) => marcas.indexOf(m);
  const autorizadaEm = new Map();
  for (const m of autorizacoes) if (!autorizadaEm.has(m.fase)) autorizadaEm.set(m.fase, pos(m));
  const conferidaDe = new Map();
  for (const m of conferidas) if (!conferidaDe.has(m.task)) conferidaDe.set(m.task, m);

  const conduzidas = plano.fases.filter((f) => autorizadaEm.has(f.id));
  const conduzidasIds = new Set(conduzidas.map((f) => f.id));
  const tasksConduzidas = new Set(conduzidas.flatMap((f) => f.tasks));
  // A declaração do adaptador só é lida se alguma conferência dispensou publicação.
  let decl = null;
  const declaracao = () => (decl ??= adaptador.lerAdaptador(repo));
  const violacoes = [];
  const tasks = [];
  for (const f of conduzidas)
    for (const id of f.tasks) {
      const t = plano.porId.get(id);
      const c = conferidaDe.get(id);
      if (!c) {
        violacoes.push({ task: id, fase: f.id, regra: "sem-conferencia" });
        continue;
      }
      const tr = c.trailers;
      const verif = tr["Conducao-Verificacao"] ?? null;
      tasks.push({ task: id, fase: f.id, conferida: c.sha, verificacao: verif });
      const faltando = ["Conducao-Task", "Conducao-Verificacao", "Conducao-Publicacao"];
      const pelaMaestra = tr["Conducao-Executor"] === "maestra";
      if (pelaMaestra) faltando.push("Conducao-Sessao-Maestra");
      else if (verif !== "manual") faltando.push("Conducao-Sha-Filha", "Conducao-Sessao-Filha", "Conducao-Nonce");
      const ausentes = faltando.filter((k) => !tr[k]);
      if (ausentes.length) violacoes.push({ task: id, regra: "trailers-ausentes", trailers: ausentes, sha: c.sha });
      if (tr["Conducao-Task"] && tr["Conducao-Task"] !== id)
        violacoes.push({ task: id, regra: "trailer-task-diverge", valor: tr["Conducao-Task"], sha: c.sha });
      if (verif && !VERIFICACOES.has(verif)) violacoes.push({ task: id, regra: "verificacao-invalida", valor: verif, sha: c.sha });
      const publ = tr["Conducao-Publicacao"];
      if (publ && !PUBLICACOES.has(publ)) violacoes.push({ task: id, regra: "publicacao-invalida", valor: publ, sha: c.sha });
      // Task que o plano liga a publicação só fecha `nao-se-aplica` com a
      // dispensa do operador (ruling 18.7, T18): o trailer com o papel (T16),
      // ou, em commit antigo, a frase legada que o adaptador declara.
      if (
        publ === "nao-se-aplica" &&
        t.publicacao.length &&
        !adaptador.dispensouPublicacao(declaracao(), { trailers: tr, corpo: git(repo, ["log", "-1", "--format=%B", c.sha]) })
      )
        violacoes.push({ task: id, regra: "nao-se-aplica-sem-sim", publicacao: t.publicacao, sha: c.sha });
      if (t.estacao === "workstation" && verif !== "manual")
        violacoes.push({ task: id, regra: "workstation-sem-manual", valor: verif, sha: c.sha });
      if ((t.estacao === "maestra") !== pelaMaestra)
        violacoes.push({ task: id, regra: pelaMaestra ? "maestra-fora-da-estacao" : "maestra-sem-executor", estacao: t.estacao, sha: c.sha });
      if (pos(c) < autorizadaEm.get(f.id))
        violacoes.push({ task: id, regra: "conferencia-antes-da-autorizacao", fase: f.id, sha: c.sha });
      for (const d of t.deps) {
        if (!tasksConduzidas.has(d)) continue;
        const cd = conferidaDe.get(d);
        if (cd && pos(cd) > pos(c)) violacoes.push({ task: id, regra: "conferida-antes-da-dependencia", dependencia: d, sha: c.sha });
      }
    }

  return {
    ...base,
    plano: blob,
    conduzidas: [...conduzidasIds],
    foraDaConducao: {
      fases: plano.fases.filter((f) => !conduzidasIds.has(f.id)).map((f) => f.id),
      motivo: "sem marca de fase autorizada — feitas à mão, fora da auditoria",
    },
    tasks,
    violacoes: [...violacoes, ...exigidas],
  };
}

// ── CI da proposta (T14) ─────────────────────────────────────────────────────

/** Folga de relógio entre a hora anotada do push e o `createdAt` do run. */
const FOLGA_RELOGIO_MS = 60_000;

/**
 * Decide o que o CI da proposta diz depois do push de fim de fase. Puro: os
 * runs (`gh run list --json databaseId,headSha,status,conclusion,createdAt,workflowName`)
 * e a proposta (`gh pr view --json number,state,mergeable,mergeStateStatus,headRefOid`)
 * vêm da maestra.
 *
 * - proposta que não aponta para o sha empurrado ⇒ `avisar`, `proposta-desalinhada`;
 * - nenhum run do sha nascido depois do push, dentro do prazo ⇒ `esperar`;
 * - nenhum run depois do prazo ⇒ `avisar`, `sem-run`, com o estado de
 *   mesclagem — proposta `CONFLICTING` não gera run e o required check fica
 *   pendente para sempre, sem vermelho (`dev-discipline.md` §Veredito de CI item 1);
 * - run em curso ⇒ `esperar`;
 * - todos terminados ⇒ `ler-run`: `conclusion` não é veredito (item 5, step com
 *   `continue-on-error` sai `success`), então a saída manda ler por dentro.
 */
export function decidirCi({ pushEm, runs, pr, agora = null, sha = null, prazoMin = BOTOES.prazoRunCiMin, veredito = vereditoDoCi() }) {
  const tPush = Date.parse(pushEm ?? "");
  if (Number.isNaN(tPush)) throw new ErroPlano("uso", `ci: --push-em inválido: ${pushEm}`);
  const tAgora = agora === null ? Date.now() : Date.parse(agora);
  if (Number.isNaN(tAgora)) throw new ErroPlano("uso", `ci: --agora inválido: ${agora}`);
  if (!Array.isArray(runs)) throw new ErroPlano("uso", "ci: --runs deve ser uma lista JSON");
  if (!pr || typeof pr !== "object" || Array.isArray(pr)) throw new ErroPlano("uso", "ci: --pr deve ser um objeto JSON");

  const alvo = sha ?? pr.headRefOid ?? null;
  const mesclagem = {
    proposta: pr.number ?? null,
    state: pr.state ?? null,
    mergeable: pr.mergeable ?? null,
    mergeStateStatus: pr.mergeStateStatus ?? null,
    headRefOid: pr.headRefOid ?? null,
  };
  const base = { pushEm: new Date(tPush).toISOString(), sha: alvo, prazoMin, mesclagem };
  const casaSha = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

  if (sha && pr.headRefOid && !casaSha(sha, pr.headRefOid))
    return {
      acao: "avisar",
      veredito: "proposta-desalinhada",
      ...base,
      aviso: `a proposta aponta para ${pr.headRefOid.slice(0, 8)}, não para o ${sha.slice(0, 8)} empurrado — empurrar antes de ler veredito`,
    };

  const dePush = runs.filter(
    (r) => (!alvo || casaSha(r.headSha ?? "", alvo)) && Date.parse(r.createdAt ?? "") >= tPush - FOLGA_RELOGIO_MS,
  );
  if (!dePush.length) {
    const prazoEm = tPush + prazoMin * 60_000;
    if (tAgora < prazoEm) return { acao: "esperar", motivo: "run-nao-nasceu", ...base, ate: new Date(prazoEm).toISOString() };
    const minutos = Math.floor((tAgora - tPush) / 60_000);
    const porque =
      pr.mergeable === "CONFLICTING"
        ? "a proposta está CONFLICTING, e proposta em conflito não gera run (§Veredito de CI item 1) — resolver o conflito e empurrar"
        : pr.state && pr.state !== "OPEN"
          ? `a proposta está ${pr.state}, não OPEN`
          : `mergeable=${pr.mergeable ?? "?"}, mergeStateStatus=${pr.mergeStateStatus ?? "?"}`;
    return {
      acao: "avisar",
      veredito: "sem-run",
      ...base,
      minutosDesdePush: minutos,
      aviso: `nenhum run do CI ${minutos} min depois do push (prazo ${prazoMin} min): ${porque}`,
    };
  }
  const emCurso = dePush.filter((r) => r.status !== "completed");
  if (emCurso.length) return { acao: "esperar", motivo: "run-em-curso", ...base, runs: emCurso.map((r) => r.databaseId ?? null) };
  return {
    acao: "ler-run",
    ...base,
    runs: dePush.map((r) => ({ id: r.databaseId ?? null, workflow: r.workflowName ?? null, conclusion: r.conclusion ?? null })),
    lerPorDentro: dePush.map((r) => `gh run view ${r.databaseId} --log`),
    aviso: veredito,
  };
}

/** Aviso do `ler-run` sem adaptador que diga onde mora o veredito do CI. */
const VEREDITO_PADRAO = "`conclusion` não é veredito: ler o run por dentro antes de avisar o operador";

/**
 * Onde mora o veredito do CI do projeto (`ci.veredito` do código do adaptador
 * de `repo`; sem `repo`, o da árvore do núcleo); ilegível ⇒ o padrão, com o
 * erro no stderr (o veredito sai igual, mas a falha do adaptador não some).
 */
function vereditoDoCi(repo = null) {
  try {
    return (repo ? adaptador.codigoDoAdaptador(repo) : adaptador.codigoDoNucleo()).ci?.veredito ?? VEREDITO_PADRAO;
  } catch (e) {
    process.stderr.write(`conducao: ci.veredito ilegível, vale o padrão — ${e.codigo ?? e.name}: ${e.message}\n`);
    return VEREDITO_PADRAO;
  }
}

const COMENTARIO_YAML = /(^|\s)#.*$/;

/** Lista YAML inline `[a, "b"]`, escalar, ou bloco `- a` logo abaixo da chave. */
function listaYaml(linhas, i, valorInline) {
  const limpa = (x) => x.trim().replace(/^["']|["']$/g, "");
  const v = valorInline.trim();
  if (v.startsWith("[")) return v.replace(/^\[|\]$/g, "").split(",").map(limpa).filter(Boolean);
  if (v) return [limpa(v)];
  const out = [];
  for (let j = i + 1; j < linhas.length; j++) {
    const m = linhas[j].match(/^\s*-\s+(.*)$/);
    if (m) out.push(limpa(m[1]));
    else if (linhas[j].trim()) break;
  }
  return out;
}

/**
 * O gatilho `push` de um workflow: `null` sem push; `{ soMain, branches }` com
 * push. `soMain` só quando `branches` é exatamente `[main]`, sem `tags` nem
 * `branches-ignore` — qualquer outra forma dispara em push fora de `main`.
 */
export function gatilhoDePush(texto) {
  const linhas = texto.split(/\r?\n/).map((l) => l.replace(COMENTARIO_YAML, "").replace(/\s+$/, ""));
  const reOn = /^["']?(on|true)["']?:/;
  const iOn = linhas.findIndex((l) => reOn.test(l));
  if (iOn < 0) return null;
  const inline = linhas[iOn].replace(/^["']?(on|true)["']?:\s*/, "");
  if (inline) return listaYaml(linhas, iOn, inline).includes("push") ? { soMain: false, branches: null } : null;
  let iPush = -1;
  let indPush = 0;
  for (let j = iOn + 1; j < linhas.length; j++) {
    const l = linhas[j];
    if (!l.trim()) continue;
    if (/^\S/.test(l)) break;
    const m = l.match(/^(\s+)(?:-\s+)?push:?\s*$/) ?? l.match(/^(\s+)push:(.*)$/);
    if (m) {
      iPush = j;
      indPush = m[1].length;
      break;
    }
  }
  if (iPush < 0) return null;
  const chaves = {};
  for (let j = iPush + 1; j < linhas.length; j++) {
    const l = linhas[j];
    if (!l.trim()) continue;
    if (l.match(/^(\s*)/)[1].length <= indPush) break;
    const m = l.match(/^\s*([\w-]+):\s*(.*)$/);
    if (m) chaves[m[1]] = listaYaml(linhas, j, m[2]);
  }
  const branches = chaves.branches ?? null;
  const soMain = !!branches?.length && branches.every((b) => b === "main") && !chaves.tags && !chaves["branches-ignore"];
  return {
    soMain,
    branches,
    ...(chaves.tags ? { tags: chaves.tags } : {}),
    ...(chaves["branches-ignore"] ? { branchesIgnore: chaves["branches-ignore"] } : {}),
  };
}

/** Linhas (1-based), fora de comentário, que leem `secrets.X` ou `secrets[…]`. */
function linhasComSecrets(texto) {
  const out = [];
  texto.split(/\r?\n/).forEach((l, i) => {
    if (/\bsecrets\s*(\.|\[)/.test(l.replace(COMENTARIO_YAML, ""))) out.push(i + 1);
  });
  return out;
}

/**
 * `conferir-workflows`: workflow com gatilho `push` que dispara fora de `main`
 * e lê `secrets.` deixa o push da filha (ramo ou `refs/conducao/*`) rodar
 * código com segredo do repositório. Sai 1 com qualquer um (§2.2#16 do
 * canonico do VEGA-22).
 */
export function conferirWorkflows({ repo }) {
  const pasta = path.join(repo, ".github", "workflows");
  if (!existsSync(pasta)) return { acao: "workflows", ok: true, conferidos: [], violacoes: [] };
  const conferidos = [];
  const violacoes = [];
  for (const nome of readdirSync(pasta).filter((n) => /\.ya?ml$/.test(n)).sort()) {
    const arquivo = `.github/workflows/${nome}`;
    const texto = readFileSync(path.join(pasta, nome), "utf8");
    const push = gatilhoDePush(texto);
    const secrets = linhasComSecrets(texto);
    conferidos.push({ arquivo, push: push ? (push.soMain ? "main" : "fora-de-main") : "sem-push", secrets: secrets.length });
    if (push && !push.soMain && secrets.length)
      violacoes.push({ arquivo, branches: push.branches, ...(push.tags ? { tags: push.tags } : {}), linhasSecrets: secrets });
  }
  return { acao: "workflows", ok: violacoes.length === 0, conferidos, violacoes };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function flag(argv, nome) {
  const i = argv.indexOf(nome);
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * `{ valor }` ou `{ erro }` — nunca lança (T17, 20-a): arquivo ausente ou JSON
 * ilegível é problema da entrada, que vira `perguntar entrada-invalida`, não
 * exceção com pilha (exit 2).
 */
function lerEntrada(valor, nome) {
  if (valor === undefined) return { valor: {} };
  let txt;
  try {
    txt = /^\s*[[{]/.test(valor) ? valor : readFileSync(valor, "utf8");
  } catch (e) {
    return { erro: `${nome}: arquivo ilegível (${e.code ?? e.message}): ${valor}` };
  }
  try {
    return { valor: JSON.parse(txt) };
  } catch (e) {
    return { erro: `${nome}: JSON ilegível (${e.message})` };
  }
}

const VERBOS_GIT = new Set([
  "autorizar-fase",
  "autorizar-ciclo",
  "abrir",
  "trazer",
  "conferir-carimbo",
  "registrar-conferencia",
  "recusar-publicacao",
  "reverter-trazido",
  "registrar-falha",
  "empurrar-copia",
  "limpar",
  "esperar-filha",
  "encerrar-sessao",
  "herdar-autorizacao",
]);

function inteiro(v) {
  return v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined;
}

/** Despacho dos verbos de git (T10). Uso errado vira `ErroPlano("uso")`, exit 1. */
function verboDeGit(verbo, resto, { repo, ciclo }) {
  const task = resto.find((a) => /^T\d{1,3}$/.test(a));
  const exigirTask = () => {
    if (!task) throw new ErroPlano("uso", `${verbo} exige T<k>`);
    return task;
  };
  switch (verbo) {
    case "autorizar-fase":
      // Aposentado (D-VEGA29-14, ruling 23-a do `/draft-review`): o sim vale
      // para o ciclo inteiro. Recusa antes de gravar qualquer marca.
      throw new ErroPlano(
        "verbo-aposentado",
        "autorizar-fase foi aposentado (D-VEGA29-14): o sim vale para o ciclo inteiro — autorizar-ciclo F<n> --sim <texto>; mudança de classe ou de sensibilidade e publicação seguem perguntando",
      );
    case "autorizar-ciclo":
      return gitConducao.autorizarCiclo({ repo, ciclo, fase: resto.find((a) => /^F\d{1,2}$/.test(a)), sim: flag(resto, "--sim") });
    case "abrir": {
      // P19 do ATRM-51: a filha nasce no modo de permissão da maestra, e o
      // `create_session` recusa modo mais permissivo que o de quem chama. Fora
      // de um modo sem clique, a filha pararia a cada comando sem ninguém para
      // clicar. A maestra passa o `session_context.permission_mode` do próprio
      // `get_session`; sem ele o verbo não abre. Os modos sem clique vêm do
      // adaptador (`sessao.modosSemClique`, default `["auto"]`; T15,
      // D-VEGA29-29) — o da sessão criadora, nunca o `--permission-mode` da ponte.
      const modoBruto = flag(resto, "--modo-maestra");
      if (modoBruto === undefined || !modoBruto.trim())
        throw new ErroPlano("uso", "abrir exige --modo-maestra <session_context.permission_mode do get_session da maestra>");
      const modo = modoBruto.trim().toLowerCase().replace(/^permission_mode_/, "");
      const decl = adaptador.lerAdaptador(repo);
      if (!adaptador.modoSemClique(decl, modo))
        return pergunta.perguntar({
          acao: "perguntar",
          motivo: "modo-da-maestra",
          ciclo,
          task: exigirTask(),
          modo,
          modosSemClique: [...decl.sessao.modosSemClique],
          detalhe: `a maestra está em ${modo}: a filha herdaria esse modo e pararia a cada comando. Pedir a ${decl.operador.nome} que volte a maestra a um modo sem clique (${decl.sessao.modosSemClique.join(", ")}); nada foi gravado.`,
        });
      const falhou = flag(resto, "--falhou");
      return gitConducao.abrir({
        repo,
        ciclo,
        task: exigirTask(),
        tentativa: inteiro(flag(resto, "--tentativa")),
        nonce: flag(resto, "--nonce"),
        falhou: falhou === undefined ? null : { tentativa: inteiro(falhou), coberta: flag(resto, "--coberta"), motivo: flag(resto, "--motivo") ?? null },
      });
    }
    case "registrar-falha":
      return gitConducao.registrarFalha({
        repo,
        ciclo,
        task: exigirTask(),
        tentativa: inteiro(flag(resto, "--tentativa")),
        coberta: flag(resto, "--coberta"),
        motivo: flag(resto, "--motivo") ?? null,
      });
    case "trazer":
      return gitConducao.trazer({
        repo,
        ciclo,
        task: exigirTask(),
        tentativa: inteiro(flag(resto, "--tentativa")),
        shaAvisado: flag(resto, "--sha") ?? null,
        sessao: flag(resto, "--sessao") ?? null,
        aprovado: flag(resto, "--aprovado") ?? null,
      });
    case "conferir-carimbo":
      return gitConducao.conferirCarimbo({ repo, ciclo, task: exigirTask() });
    case "registrar-conferencia":
      if (resto.includes("--rodada")) {
        // Allowlist: flag da conferência (ou qualquer outra) não passa calada pela rodada.
        const aceitas = new Set(["--rodada", "--operador", "--sessao", "--repo", "--ciclo"]);
        const alheias = resto.filter((a) => a.startsWith("--") && !aceitas.has(a));
        if (alheias.length) throw new ErroPlano("uso", `--rodada não combina com ${alheias.join(", ")}`);
        return gitConducao.registrarRodada({
          repo,
          ciclo,
          task: exigirTask(),
          rodada: flag(resto, "--rodada"),
          sessao: flag(resto, "--sessao") ?? null,
          operador: flag(resto, "--operador") ?? null,
        });
      }
      return gitConducao.registrarConferencia({
        repo,
        ciclo,
        task: exigirTask(),
        verificacao: flag(resto, "--verificacao"),
        publicacao: flag(resto, "--publicacao"),
        manual: resto.includes("--manual"),
        maestra: resto.includes("--maestra"),
        sim: flag(resto, "--sim") ?? null,
        sessao: flag(resto, "--sessao") ?? null,
        operador: flag(resto, "--operador") ?? null,
      });
    case "recusar-publicacao":
      return gitConducao.recusarPublicacao({ repo, ciclo, task: exigirTask(), motivo: flag(resto, "--motivo") });
    case "reverter-trazido":
      return gitConducao.reverterTrazido({ repo, ciclo, task: exigirTask(), motivo: flag(resto, "--motivo") });
    case "empurrar-copia":
      return { acao: "copia", ciclo, ...gitConducao.empurrarCopia({ repo, ciclo }) };
    case "esperar-filha": {
      const numero = (nome) => {
        if (!resto.includes(nome)) return undefined;
        const v = flag(resto, nome);
        if (v === undefined || !/^\d+$/.test(v)) throw new ErroPlano("uso", `${nome} exige inteiro >= 0, veio ${JSON.stringify(v ?? null)}`);
        return Number(v);
      };
      const maxMin = numero("--max-min");
      const intervaloS = numero("--intervalo-s");
      return gitConducao.esperarFilha({
        repo,
        ciclo,
        task: exigirTask(),
        tentativa: inteiro(flag(resto, "--tentativa")),
        tetoChamadorMin: numero("--teto-chamador-min"),
        desde: resto.includes("--desde") ? flag(resto, "--desde") ?? "" : null,
        avisoTratado: resto.includes("--aviso-tratado") ? flag(resto, "--aviso-tratado") ?? "" : null,
        ...(maxMin === undefined ? {} : { maxMin }),
        ...(intervaloS === undefined ? {} : { intervaloS }),
      });
    }
    case "herdar-autorizacao":
      return herdarAutorizacao({ repo, ciclo, fase: resto.find((a) => /^F\d{1,2}$/.test(a)), nonce: flag(resto, "--nonce") });
    case "encerrar-sessao":
      return encerrarSessao({ repo, ciclo, fase: flag(resto, "--fase"), nonce: flag(resto, "--nonce") });
    case "limpar": {
      const estado = estadoDasTasks(lerMarcas(repo), lerRefsLocais(repo, ciclo), gitConducao.lerTrazidas(repo, ciclo));
      return gitConducao.limpar({ repo, ciclo, emVoo: [...estado.emVoo.values()], trazidas: [...estado.trazidas.values()] });
    }
  }
  throw new ErroPlano("uso", `verbo de git desconhecido: ${verbo}`);
}

/**
 * Grava a saída no log de eventos do ciclo, na pasta que o adaptador declara;
 * a pergunta vai para onde o adaptador diz que ela grava (D-VEGA29-4), e com
 * ela o evento `pergunta` da decisão tipada (T12, só tokens). O log nunca
 * derruba o verbo.
 */
function logar(saida, procedencia, quando, decl) {
  try {
    const ehPergunta = saida?.acao === "perguntar";
    logEventos.registrar(saida, { procedencia, quando, pasta: ehPergunta ? decl.pastaDaPergunta : decl.pastaDoLog });
    if (ehPergunta) pergunta.gravar(saida, decl, { quando });
  } catch (e) {
    process.stderr.write(`conducao: log de eventos nao gravado: ${e.message}\n`);
  }
}

/** `registrar-evento`: o que a maestra observou, procedência `observado`. */
function registrarEvento(resto, ciclo, decl) {
  const acao = flag(resto, "--acao");
  if (!acao) throw new ErroPlano("uso", "registrar-evento exige --acao <a>");
  const saida = { acao, ciclo };
  for (const k of ["fase", "task", "sessao", "estado", "sha", "nonce"]) {
    const v = flag(resto, `--${k}`);
    if (v !== undefined) saida[k] = v;
  }
  const n = inteiro(flag(resto, "--tentativa"));
  if (n !== undefined) saida.tentativa = n;
  const r = logEventos.registrar(saida, { procedencia: "observado", quando: flag(resto, "--quando"), pasta: decl.pastaDoLog });
  return { acao: "evento-registrado", ciclo, ...r };
}

/**
 * Git que passou do prazo (T17, 20-a): desfecho nomeado `git-prazo-estourado`
 * como pergunta, com o comando e os `*.lock` achados sob o git-dir — o lock
 * que sobra é o que a próxima chamada encontraria. JSON no stdout (o `main`
 * sai 1); vai ao log quando há ciclo e o adaptador se lê.
 */
function gitPrazoEstourado(e, { verbo, repo, ciclo }) {
  const saida = pergunta.perguntar({
    acao: "perguntar",
    motivo: e.codigo,
    ...(ciclo ? { ciclo } : {}),
    verbo: verbo ?? null,
    comando: e.comando,
    prazoMs: e.prazoMs,
    locks: e.locks,
    detalhe: `${e.message} — nada além do que o git já tinha feito foi gravado; ver o lock antes de repetir`,
  });
  process.stderr.write(`conducao: ${e.codigo}: ${e.message}\n`);
  if (ciclo) {
    try {
      logar(saida, "intencao", undefined, adaptador.lerAdaptador(repo));
    } catch {
      // O adaptador ilegível não esconde o desfecho: o JSON sai igual.
    }
  }
  process.stdout.write(`${JSON.stringify(saida)}\n`);
}

/**
 * Recusa tipada do adaptador (`ErroAdaptador`: declaração ou código inválido)
 * ou do log (`ErroLogV0`: pasta do log com log v0, D-VEGA29-21) como pergunta,
 * com `motivo: e.codigo` — os verbos emitem JSON, e a recusa sai no mesmo
 * canal. A linha do stderr segue a de antes. Não vai ao log: o adaptador que
 * diz onde ele mora é o que não se leu, ou o log é o recusado. O `main` sai 1.
 */
function recusaComoPergunta(e, { verbo, ciclo }) {
  process.stderr.write(`conducao: ${e.codigo}: ${e.message}\n`);
  let saida;
  try {
    saida = pergunta.perguntar({
      acao: "perguntar",
      motivo: e.codigo,
      ...(ciclo ? { ciclo } : {}),
      verbo: verbo ?? null,
      detalhe: e.message,
    });
  } catch (p) {
    // Código fora da forma de motivo: a recusa já está no stderr; o JSON não sai, e o exit segue 1.
    process.stderr.write(`conducao: recusa sem pergunta (${p.message})\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(saida)}\n`);
}

export function main(argv) {
  const [verbo, ...resto] = argv;
  const repo = path.resolve(flag(resto, "--repo") ?? process.cwd());
  const ciclo = flag(resto, "--ciclo");
  const sair = (codigo, msg) => {
    process.stderr.write(`conducao: ${msg}\n`);
    return codigo;
  };
  try {
    if (verbo === "auditar") {
      const nota = flag(resto, "--nota");
      const ref = flag(resto, "--ref");
      if (!nota && !(ciclo && ref)) return sair(2, "auditar exige --nota <arquivo> ou --ciclo <id> --ref <ref>");
      const lista = (nome) => (flag(resto, nome) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      const saida = auditar({
        repo,
        ...(nota ? { nota: path.resolve(nota) } : { ciclo, ref }),
        exigirFases: lista("--exigir-fases"),
        exigirEncerramentos: lista("--exigir-encerramentos"),
      });
      process.stdout.write(`${JSON.stringify(saida)}\n`);
      return saida.violacoes.length ? 1 : 0;
    }
    if (verbo === "conferir-workflows") {
      const saida = conferirWorkflows({ repo });
      process.stdout.write(`${JSON.stringify(saida)}\n`);
      return saida.ok ? 0 : 1;
    }
    if (verbo === "ci") {
      const pr = flag(resto, "--pr");
      if (!pr) return sair(2, "ci exige --push-em <iso> --runs <json> --pr <json>");
      const prazo = inteiro(flag(resto, "--prazo-min"));
      const runs = lerEntrada(flag(resto, "--runs") ?? "[]", "--runs");
      const prLido = lerEntrada(pr, "--pr");
      const problemas = [runs.erro, prLido.erro].filter(Boolean);
      if (problemas.length) {
        const p = pergunta.perguntar({ acao: "perguntar", motivo: "entrada-invalida", ...(ciclo ? { ciclo } : {}), problemas, detalhe: `o ci não lê a entrada: ${problemas.join("; ")}` });
        process.stdout.write(`${JSON.stringify(p)}\n`);
        return 1;
      }
      const saida = decidirCi({
        pushEm: flag(resto, "--push-em"),
        runs: runs.valor,
        pr: prLido.valor,
        agora: flag(resto, "--agora") ?? null,
        sha: flag(resto, "--sha") ?? null,
        ...(prazo !== undefined ? { prazoMin: prazo } : {}),
        veredito: vereditoDoCi(repo),
      });
      process.stdout.write(`${JSON.stringify(saida)}\n`);
      return 0;
    }
    if (verbo === "reinicio-valido") {
      const arquivo = flag(resto, "--arquivo");
      if (!arquivo) return sair(2, "reinicio-valido exige --arquivo <ponte-reinicio.json>");
      const { confirmacao } = carregarReinicio(arquivo, flag(resto, "--ponte-ativa-desde"), repo);
      const saida = confirmacao ?? { valido: false, motivo: "sem-registro" };
      process.stdout.write(`${JSON.stringify(saida)}\n`);
      return saida.valido ? 0 : 1;
    }
    if (verbo === "pre-voo") {
      const saida = preVoo({ repo, ciclo: ciclo ?? null });
      if (ciclo && saida.acao === "perguntar") logar(saida, "intencao", undefined, adaptador.lerAdaptador(repo));
      process.stdout.write(`${JSON.stringify(saida)}\n`);
      return saida.acao === "perguntar" ? 1 : 0;
    }
    if (!ciclo) return sair(2, "--ciclo é obrigatório");
    const decl = adaptador.lerAdaptador(repo);
    if (verbo === "registrar-evento") {
      process.stdout.write(`${JSON.stringify(registrarEvento(resto, ciclo, decl))}\n`);
      return 0;
    }
    if (VERBOS_GIT.has(verbo)) {
      const saida = verboDeGit(verbo, resto, { repo, ciclo });
      logar(saida, saida.acao === "perguntar" ? "intencao" : "registrado", undefined, decl);
      process.stdout.write(`${JSON.stringify(saida)}\n`);
      // Escrita parcial (T17): a marca está no ramo, a cópia não — sai 1 com o JSON, para a maestra rodar o remédio.
      return saida.acao === "perguntar" || saida.acao === gitConducao.DESFECHO_SEM_COPIA ? 1 : 0;
    }
    let saida;
    if (verbo === "proximo") {
      const { reinicio, confirmacao } = carregarReinicio(flag(resto, "--reinicio"), flag(resto, "--ponte-ativa-desde"), repo);
      if (confirmacao && !confirmacao.valido)
        process.stderr.write(`conducao: registro de reinício ignorado (${confirmacao.motivo}) — a queda não fica coberta\n`);
      const nivel = resto.includes("--nivel") ? (flag(resto, "--nivel") ?? "") : null;
      if (nivel !== null && nivel !== "maestra") return sair(2, `--nivel aceita só maestra (veio ${nivel}); sem a flag, o laço da condutora`);
      const entrada = lerEntrada(flag(resto, "--entrada"), "--entrada");
      saida = proximo({
        nivel,
        repo,
        ciclo,
        entrada: entrada.valor ?? {},
        entradaErro: entrada.erro ?? null,
        reinicio,
      });
      logar(saida, "intencao", undefined, decl);
    }
    else if (verbo === "retomar") saida = retomar({ repo, ciclo });
    else if (verbo === "conferir") {
      const task = resto.find((a) => /^T\d{1,3}$/.test(a));
      if (!task) return sair(2, "conferir exige T<k>");
      saida = conferir({ repo, ciclo, task });
      if (saida.acao === "perguntar") {
        logar(saida, "intencao", undefined, decl);
        process.stdout.write(`${JSON.stringify(saida)}\n`);
        return 1;
      }
    } else
      return sair(2, `verbo desconhecido: ${verbo ?? "(nenhum)"} — proximo | conferir | retomar | auditar | pre-voo | registrar-evento | ${[...VERBOS_GIT].join(" | ")}`);
    process.stdout.write(`${JSON.stringify(saida)}\n`);
    return 0;
  } catch (e) {
    if (e instanceof ErroGitPrazo) {
      gitPrazoEstourado(e, { verbo, repo, ciclo });
      return 1;
    }
    if (e instanceof ErroPlano) return sair(e.codigo === "teto-do-chamador" ? 2 : 1, `${e.codigo}: ${e.message}`);
    if (e instanceof adaptador.ErroAdaptador || e instanceof logEventos.ErroLogV0) {
      recusaComoPergunta(e, { verbo, ciclo });
      return 1;
    }
    return sair(2, e.stack ?? String(e));
  }
}

const direto = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (direto) process.exitCode = main(process.argv.slice(2));

export const SCRIPT = fileURLToPath(import.meta.url);
