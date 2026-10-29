"use strict";
// .claude/hooks/lib/phase-commit-regex.js
// Reconhecedor de commit de fase/task de ciclo, compartilhado pelo escritor do
// presente (`presente-post-commit.js`) e pelo projetor da linha do tempo
// (`linha-do-tempo.mjs`). Extraído pra módulo único depois de review apontar
// 3 cópias literais idênticas — próxima edição do padrão só precisa mudar aqui.
//
// FORMA RECONHECIDA: "<ciclo-id>-F<n>[.<m>][<letra>][<sep-task>{T<k>|D-<ruling>}][-<qualificador>] <sep> <descrição>"
//   sep      ∈ { — (em-dash), – (en-dash), : , - (hífen) }
//   sep-task ∈ { / , . }  — "HN-24-F2/T6" e "HN-24-F2.T6" são a mesma coisa
//
// O SLOT DO MEIO TEM DUAS FORMAS, EXCLUSIVAS ENTRE SI (05/09/2026, HN-37 F8):
// `T<k>` é trabalho que nasce de TASK do §3; `D-<id>` é trabalho que nasce de
// RULING cravado no §1.3 — "HN-37-maquina-de-estado-F8/D-HN37-36 — …". Ciclo de
// meta-infra executa os dois, e até aqui só o primeiro existia na gramática.
//
// CALIBRAÇÃO DO SLOT DE RULING (05/09/2026, corpus `git log --all` = 4598
// subjects — os QUATRO baldes, que têm de FECHAR na soma):
//
//              trigger   revert   near-miss   unrelated   soma
//   antes        485        2         66        4045      4598
//   depois       488        2         63        4045      4598
//
// Os 3 recuperados são reais (`d056b72d`, `8cff60ea`, `c0459162`), já tinham
// aterrissado e foram ao §13 à mão — o canário do SessionStart os acusou
// nominalmente, que é o balde funcionando, não o buraco fechado. E, sobre os
// 485 que o regex anterior JÁ reconhecia: 0 rótulo divergente, 0 descrição
// divergente, 0 perdido.
//
// ⚠️ CONFERIR CONTRA P3 ANTES DE ALARGAR DE NOVO (rationale §13, "MEDIDO E
// REJEITADO"): alargar o separador para `-{1,2}` rendia 402 → 402, ganho ZERO,
// e foi recusado porque o near-miss já pegava o caso. O operando aqui é outro
// — 3 commits recuperados, não 0 — e a frequência é MAIOR que a da reversão
// (falha 13), aceita a **1 em 2.299** (2 reversões de fase em 4598 subjects,
// remedido HOJE no mesmo corpus: o `1 em 4.400` de 30/08 é de um corpus menor
// e não se cita ao lado destes números). "O near-miss reclama alto" é razão
// para não alargar quando o ganho é zero; não é razão quando ele foi medido.
//
// O RÓTULO NÃO ALARGA JUNTO — ver §phaseLabel. Esta é a diferença de desenho
// em relação à falha 13, onde produtor e consumidores alargaram no mesmo
// commit: aqui os consumidores não precisam alargar PORQUE o rótulo não muda.
//
// CALIBRAÇÃO EMPÍRICA (2026-07-30, corpus `git log --all` = 3659 commits,
// 404 commits de ciclo). A versão anterior exigia em-dash literal e nada além
// de `F<n>[.<m>]`, e enxergava 355/404 (87,9%) — os 12% invisíveis são a causa
// -raiz de ~1 mês de §13 mudo: `soft-mode` nunca via commit nenhum, e o
// registry registrou isso como "não houve commit de fase na janela". Esta
// versão vê 402/404 (99,5%), 0 falso-positivo sobre os controles negativos.
//
// RESIDUAL DECLARADO (2/404): commit multi-fase `A25-F1F2F3 — …` (um commit
// fechando 3 fases). NÃO é suportado de propósito — torcer a regra por 0,5%
// custa mais que o ganho. Cai em `skip-unrecognized` (classe de quase-acerto),
// que reclama alto em vez de sumir calado.
//
// PRINCÍPIO (RFC 9413 §2.2 — rejeição do robustness principle como default):
// tolerância NÃO é ilimitada. A gramática aceita é fechada e testada; o que
// fica fora é REPORTADO, nunca adivinhado.
// Separador: travessão/meia-risca/hífen exigem espaço dos DOIS lados (senão
// "SC-1-F1a-fix" leria "-fix" como separador); dois-pontos pode vir colado,
// que é como se escreve naturalmente ("OPS-7-F0: texto").
//
// ⚠️ O SLOT DE RULING VAI ATÉ O SEPARADOR — não há qualificador depois dele.
// Regra TOTAL, não omissão: "HN-37-F8/D-HN37-36-fix — x" rende
// `ruling: "D-HN37-36-fix"`, e é assim de propósito. A review levantou isto
// como bug e propôs fechar a forma (exigir que o id termine em segmento
// numérico); MEDIDO e REFUTADO no mesmo dia — os 1579 ids `D-…` distintos do
// grafo `.agents/` têm de 2 a 6 segmentos e muitos terminam em PALAVRA
// ("D-A2-PHONE-LGPD-UNMASKED", "D-A1-OPERATION-EXECUTORS-RLS-REFINE") ou em
// letra minúscula ("D-HN28-6d", "D-N10-12a"). Não existe sinal textual que
// separe "id + qualificador colado" de "id mais longo" — é a mesma classe da
// falha 11 (continuação de trailer), onde 2 revisores provaram que o sinal não
// existe e o ruling do operador foi: só resolver o caso SEM ambiguidade, nunca
// adivinhar. Aqui a saída de não-adivinhar é a regra total acima.
// O que isso NÃO custa: `description` continua sendo fatia CONTÍGUA do subject
// nos dois casos, então a linha do §13 reproduz o que o autor escreveu, sempre.
// Fronteira medida no mesmo levantamento: 0 dos 1579 ids começa por minúscula,
// que é o que sustenta o `[A-Z0-9]+` do 1º segmento.
//
// EXCEÇÃO ÚNICA, LITERAL (13/10/2026, ruling 16b): ciclo de teste `zz-test-…`.
// Views, roadmap e censo do banco do harness o filtram por
// `NOT LIKE 'zz-test-%'`, que é case-sensitive — o id TEM de ser minúsculo, e
// com `[A-Z0-9]` sozinho nenhum ciclo `zz-test-*` passava do `plan-check`
// (`commit-nao-reconhecido`). A cauda é a de `RE_SESSAO`
// (`.claude/scripts/estado/lib/sessao.mjs`): `[a-z0-9-]`, sem maiúscula nem
// ponto. Não é alargar para minúscula: `foo-F1 — x` segue fora.
const TRIGGER_REGEX =
  /^(zz-test-[a-z0-9-]+|[A-Z0-9][A-Za-z0-9.-]*)-F(\d+(?:\.\d+)?[a-z]?)(?:[/.](?:(T\d+(?:\.\d+)?[a-z]?)|(D-[A-Z0-9]+(?:-[A-Za-z0-9]+)+)))?(?:-[A-Za-z0-9.]+)?(?:\s+[—–-]\s+|\s*:\s+)(.+)/;

// Reconhecedor FROUXO — não dispara nada, só classifica o que foi ignorado.
// Um subject que bate aqui e não bate no TRIGGER_REGEX é um QUASE-ACERTO:
// alguém quis marcar uma fase e o formato escapou. Sem esta distinção,
// "não havia trabalho" e "havia trabalho e eu não reconheci" produzem o
// mesmo evento no log — foi assim que a falha durou um mês.
//
// ⚠️ NÃO ancorado em `^` (alargado 19/08/2026, NEXS-20 T18 —
// AE-NEXS20-LEDGER-NEARMISS-CEGO-A-CONVENTIONAL-COMMITS). A versão anterior
// ancorava, e `[A-Z0-9]` como 1º caractere fazia TODA a gramática de
// Conventional Commits escapar por baixo da distinção: `test(NEXS-20-F3): …`
// e `fix(HN-31-F2): …` não batiam no TRIGGER nem no NEAR_MISS, então caíam em
// `skip-unrelated` — o balde declarado "silêncio correto" — em vez de
// `skip-unrecognized`, o balde que reclama alto. É o modo de falha que este
// comentário descreve, reencenado pela forma que a distinção não previa.
// MEDIDO na branch do NEXS-20: 3 commits (`c56c6c33`, `55e74b75` e a 1ª volta
// de `f695c90b`), um deles gravado no §13 à mão. É a causa-raiz nomeável do
// `commits-nao-observados×2` que o canário do SessionStart vinha acusando sem
// diagnóstico.
// A fronteira à esquerda continua fechada — o id tem de começar em maiúscula/
// dígito e vir depois de algo que NÃO é caractere de id —, então `node-F1` e
// `foo-F2` seguem fora. O TRIGGER_REGEX NÃO se alarga junto: o objetivo não é
// aceitar a forma nova (o `**Commit:**` do plano segue sendo a forma), é
// deixar de perdê-la em silêncio.
// O id `zz-test-…` (exceção literal do TRIGGER_REGEX acima) entra aqui também:
// produtor mais largo que o frouxo faria o quase-acerto de ciclo de teste cair
// em `unrelated`, calado.
const NEAR_MISS_REGEX =
  /(?:^|[^A-Za-z0-9.-])(zz-test-[a-z0-9-]*?|[A-Z0-9][A-Za-z0-9.-]*?)-F\d/;

/**
 * @param {string} subject subject do commit (1ª linha)
 * @returns {{cycleId:string, phase:string, task:string|null, ruling:string|null,
 *            description:string}|null}
 */
function parsePhaseCommit(subject) {
  const m = TRIGGER_REGEX.exec(subject || "");
  if (!m) return null;
  const ruling = m[4] || null;
  return {
    cycleId: m[1],
    phase: m[2],
    task: m[3] || null,
    ruling,
    // O id do ruling entra na DESCRIÇÃO, não no rótulo — é o que mantém o
    // alargamento sem consumidor a alargar junto (ver §phaseLabel). A dobra é
    // uma fatia CONTÍGUA do subject (`D-HN37-36 — texto`), então a linha do §13
    // continua sendo o subject verbatim menos o prefixo de ciclo/fase, e um
    // `grep D-HN37-36 canonico.md` acha a fase que executou o ruling.
    //
    // Dobrar AQUI, e não no trigger: o backfill e o trigger são dois call sites
    // do mesmo parse, e consumidor mais estreito que o produtor é a 5ª, a 7ª e
    // a 12ª falha da pilha. Um lugar só não tem como divergir.
    description: ruling ? `${ruling} — ${m[5]}` : m[5],
  };
}

// Reversão de um commit de fase. `git revert` gera `Revert "<subject original>"`
// e o subject resultante NÃO bate no TRIGGER_REGEX — o `R` de `Revert` começa
// um id plausível, mas o que vem depois é espaço, não `-F<n>`.
//
// MEDIDO 30/08/2026 (HN-36 T6): `3d551181` (`Revert "HN-36-ci-gate-real-F2 — …"`)
// caiu em `skip-unrecognized` — reclamou alto, como projetado — e não produziu
// evento nem âncora; as duas linhas do §13 foram escritas à mão. O backfill
// também recusa, porque usa este mesmo reconhecedor. Frequência no corpus:
// 1 em 4.400 subjects — pequena E CRESCENTE POR DESENHO, porque a prova por
// quebra deliberada + reversão na mesma task virou método do harness (T6/T7).
//
// Desembrulha EXATAMENTE uma camada. Reversão de reversão fica FORA, residual
// declarado como o `A25-F1F2F3`: `Revert "Revert "X""` não parse (o miolo
// começa em `Revert `, que não casa `-F\d`) e cai no near-miss, que reclama
// alto — o balde certo para "havia trabalho e eu não reconheci".
//
// `description` é o subject VERBATIM DA REVERSÃO, nunca o do original: o §13
// registra o que aconteceu, e o que aconteceu foi o recuo. Herdar a descrição
// do original faria a linha afirmar que a fase avançou quando ela voltou —
// pior que o silêncio que este bloco cura.
const REVERT_REGEX = /^Revert "(.+)"$/;

/**
 * @param {string} subject subject do commit (1ª linha)
 * @returns {{cycleId:string, phase:string, task:string|null, description:string,
 *            revert:true, revertedSubject:string}|null}
 */
function parseRevert(subject) {
  const m = REVERT_REGEX.exec(subject || "");
  if (!m) return null;
  const interno = parsePhaseCommit(m[1]);
  if (!interno) return null;
  return {
    ...interno,
    description: subject,
    revert: true,
    revertedSubject: m[1],
  };
}

/**
 * Os dois ids se referem ao MESMO ciclo?
 *
 * O commit carrega o id CURTO (`HN-31-F1 — …` ⇒ `HN-31`) e a pasta carrega o id
 * LONGO (`HN-31-substrato-multilane`). Ninguém escreve `HN-31-substrato-multilane-F1`
 * no subject, então exigir igualdade é exigir uma forma que o corpus não tem.
 *
 * MEDIDO 13/08/2026: o backfill do escritor antigo do §13 (apagado no hotfix
 * ledger-no-git) comparava com `!==` e recusava
 * `HN-31-F1 — …` para o ciclo `HN-31-substrato-multilane`, saindo com
 * "nenhum dos 1 commits do range é do ciclo" — culpando o id que o operador
 * passou. O MESMO arquivo já resolvia o canonico por prefixo 148 linhas acima,
 * e o trigger já roteava por prefixo: o backfill era o único consumidor estrito.
 * É a 5ª das cinco falhas empilhadas reencenada — consumidor com reconhecedor
 * mais estreito que o produtor —, e desta vez no componente cujo trabalho é
 * REPARAR o que o produtor não gravou. As duas pontas quebradas ao mesmo tempo.
 *
 * Prefixo nos DOIS sentidos, sempre na fronteira de `-`: qual dos lados vem do
 * commit e qual vem da pasta é decisão do call site, e um predicado que só
 * funciona numa ordem vira o mesmo bug com outro nome. A fronteira impede
 * `HN-3` de casar `HN-31`.
 */
function sameCycle(a, b) {
  if (!a || !b) return false;
  const x = String(a);
  const y = String(b);
  return x === y || x.startsWith(y + "-") || y.startsWith(x + "-");
}

/**
 * Rótulo da fase pro §13/§13.3: "F2" ou "F2/T6" quando a task é nomeada.
 *
 * ⚠️ `ruling` É IGNORADO AQUI DE PROPÓSITO — commit de ruling rotula `F8`, o
 * mesmo que um commit de fase sem task. O rótulo é a chave estrutural que 6
 * consumidores medidos leem, e admitir uma 3ª forma quebra CINCO deles e
 * inverte um contador no sexto (varredura de 05/09/2026 sobre `.claude/` e
 * `.agents/`, cada um provado com a string `F8/D-HN37-36` nos módulos reais):
 *
 *   1. `report-assemble.mjs` §FASE_CELULA — ancorada em `$`; a célula de §13.3
 *      não casa, a fase da row sai `null` e incrementa `semFase`.
 *   2. `report-assemble.mjs` §cobertura §3×desfecho — `comDesfecho.has("F8")`
 *      passa a ser falso e a fase aparece como SEM desfecho no report.
 *   3. `report-assemble.mjs` §agrupamento de âncoras — `F8` e `F8/D-…` viram
 *      dois grupos distintos em "Commits por fase".
 *   4. o dispatch do escritor antigo do §13 (apagado no hotfix ledger-no-git)
 *      §desfechoPresente — a chave consultada era `F${phase}` e a linha gravada
 *      seria `F8/D-…`: o dedup parava de ver o desfecho que já existia e
 *      ESCREVIA UM SEGUNDO.
 *   5. o backfill do mesmo escritor antigo §desfechoPresente — cópia própria,
 *      mesmo modo.
 *   6. `planning-pipeline/replay.mjs` §HN33_ANCHOR_RE — exige `F<n>/T<k>`
 *      literal; a row SOME do denominador do drill de bijeção, sem erro.
 *
 * O leitor de marcas do mesmo escritor antigo (§ENTRY_TYPE_RE) truncaria para
 * `F8` em silêncio, o que
 * salvaria a leitura do §13.1 e deixaria o §13.3 divergente da mesma linha —
 * duas verdades sobre o mesmo arquivo, que é a 5ª falha da pilha.
 *
 * Então o id do ruling viaja na DESCRIÇÃO (ver §parsePhaseCommit), que é texto
 * livre por contrato. Alargar o rótulo é possível — exige alargar os 6 no MESMO
 * commit, como manda a falha 13 — e não foi feito porque o ganho é de
 * apresentação e o custo é o gate de fechamento e o dedup de desfecho.
 */
function phaseLabel({ phase, task }) {
  return task ? `F${phase}/${task}` : `F${phase}`;
}

/**
 * Classifica um subject que NÃO disparou.
 * @returns {"near-miss"|"unrelated"}
 */
function classifySkip(subject) {
  return NEAR_MISS_REGEX.test(subject || "") ? "near-miss" : "unrelated";
}

module.exports = {
  TRIGGER_REGEX,
  NEAR_MISS_REGEX,
  REVERT_REGEX,
  parsePhaseCommit,
  parseRevert,
  phaseLabel,
  classifySkip,
  sameCycle,
};
