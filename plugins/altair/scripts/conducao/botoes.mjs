/**
 * Botões do loop da condução (VEGA-22) — a ÚNICA fonte de botão que o código
 * da condução lê (D-VEGA22-24). Cada botão traz valor, origem e o sinal medido
 * que o faz mudar; o contrato vivo que os cita é `skills/conducao/references/contrato.md`
 * (bumpado na T18 com a medição da F3 em mãos).
 *
 * Ajustar aqui, nunca no ponto de uso: botão espalhado é botão que ninguém
 * acha quando a oferta (teto, capacidade da ponte) ou a demanda (o que pede
 * o operador) muda.
 */
export const BOTOES = Object.freeze({
  /**
   * Teto de filhas quando a entrada da maestra não traz o da ponte.
   * Origem: `--capacity 16` da ponte de filhas (`systemctl show` de 15/10,
   * §2.2#14 do canonico do VEGA-22), mantido quando ela foi aposentada
   * (decisao/filha-herdeira-da-maestra): a filha nasce na ponte do operador
   * (`instalar-ponte.sh`, `--capacity 64`), que divide a capacidade com a
   * maestra e as sessões do operador — 16 filhas + maestra cabem com folga.
   * Muda quando: a capacidade da ponte do operador baixar de teto + maestra +
   * sessões do operador, ou a condução pedir mais largura que isto.
   */
  tetoFilhasPadrao: 16,

  /**
   * Largura do ciclo quando o plano não a declara (plano anterior à T5).
   * Origem: leitura conservadora da T5 (`DECLARACOES_PADRAO.largura`) — o
   * plano velho nunca disse que suas tasks rodam juntas.
   * Muda quando: nunca para cima sem declaração do plano; é o piso seguro.
   */
  larguraPadrao: 1,

  /**
   * Falhas de ambiente (`--coberta ambiente`) de uma task antes de o `proximo`
   * parar e perguntar (`teto-de-falhas-ambiente`). Não somam ao teto de 2 do
   * trabalho, mas ambiente que cai três vezes na mesma task não é acaso.
   * Origem: ATRM-51 F0 (22/10/2026) — a T3 caiu 2 vezes por ambiente antes de
   * passar; a 3ª no mesmo lugar pede o operador, não outra tentativa.
   * Muda quando: um ciclo conduzido medir ambiente legítimo caindo 3+ vezes.
   */
  tetoFalhasAmbiente: 3,

  /**
   * Minutos de silêncio da filha caída (`status_bucket` `FAILED`, sem aviso)
   * depois da mensagem da maestra (`cutucar`) antes de a vigia contar falha
   * de ambiente e reabrir a tentativa (T18 do VEGA-29, sota E2.B2: a sessão
   * servida pela ponte que cai volta com uma mensagem, sem reiniciar a ponte).
   * Origem: chute — a filha que volta responde no turno seguinte, em segundos;
   * 10 minutos é folga para a ponte servir a sessão de novo, não medição.
   * Muda quando: um ciclo conduzido medir a filha cutucada voltando depois disto.
   */
  silencioFilhaCaidaMin: 10,

  /**
   * Minutos de silêncio da condutora caída (`status_bucket` `FAILED`) depois
   * da mensagem da maestra (`cutucar`, `proximo --nivel maestra`) antes de a
   * maestra perguntar ao operador (`perguntar condutora-caida`, situação
   * `caida`) em vez de esperar sem prazo (T39 do VEGA-29, no molde da T18).
   * Origem: o mesmo chute de `silencioFilhaCaidaMin` — a condutora é uma
   * sessão servida pela mesma ponte, e volta com a mensagem no turno seguinte.
   * Muda quando: um ciclo conduzido medir a condutora cutucada voltando depois
   * disto, ou a pergunta saindo com a condutora ainda a caminho de voltar.
   */
  silencioCondutoraCaidaMin: 10,

  /**
   * Prazo de uma task sem `**Prazo:**` declarado, em minutos.
   * Origem: chute inicial do VEGA-22 (sem medição de duração de filha com
   * task real — a sonda de 15/10 não trouxe `usage`, M11).
   * Muda quando: a T18 medir a duração das filhas do ciclo conduzido.
   */
  prazoPadraoMin: 120,

  /**
   * Minutos depois do push de fim de fase sem run do CI nascer para o
   * `conducao.mjs ci` decidir "sem run" e avisar o operador com o estado de
   * mesclagem da proposta (proposta `CONFLICTING` não gera run —
   * `dev-discipline.md` §Veredito de CI item 1).
   * Origem: F0 do VEGA-22 mediu o run nascendo no mesmo minuto do push
   * (`minutos_ate_o_run_nascer: 0`, `notes/premissas-f0.md`); 15 é folga
   * para fila do GitHub, não medição.
   * Muda quando: a T18 medir run nascendo depois disto em proposta saudável.
   * Não se aplica a projeto sem CI (`ci: false` no adaptador, T15): ali a
   * fase fecha pela Verificação da última tarefa e nenhum run é esperado.
   */
  prazoRunCiMin: 15,

  // Publicação, caminhos clínicos e telas dos Steps são do projeto: vêm do
  // código do adaptador (`publicacao`, `caminhosClinicos`,
  // `telasClinicasDosSteps`, `foraDasTelasDosSteps`; T20).

  /**
   * Superfícies de instrução: o que a maestra (ou o harness dela) lê como
   * instrução ou permissão no turno seguinte — settings, skills, regras,
   * agentes, `AGENTS.md`, MCP e o que decide CI e revisão. Trabalho de filha
   * que toca isto pergunta antes de trazer, separado do alcance dos hooks.
   * Origem: MAJOR do security-reviewer no fechamento de F2, ruling 16.1a de
   * o operador (15/10/2026).
   * Muda quando: nasce arquivo que o harness lê como instrução fora daqui.
   * A pasta de configuração do host não tem nome no núcleo (T30, D-VEGA29-15):
   * vale qualquer pasta oculta da raiz (o glob começa por `.*`), que pergunta
   * a mais, nunca a menos; o arquivo de instrução que o host lê pelo nome vem
   * da declaração (`sessao.instrucoes`), somado a esta lista.
   */
  superficiesDeInstrucao: Object.freeze([
    ".*/settings*.json",
    ".*/skills/**",
    ".*/rules/**",
    ".*/agents/**",
    ".*/commands/**",
    ".*/workflows/**",
    ".*/launch.json",
    "**/AGENTS.md",
    ".mcp.json",
    // Código do adaptador do projeto (T20): o núcleo o carrega e executa na
    // maestra — filha que o muda pergunta antes de trazer.
    ".altair/**",
    ".github/workflows/**",
    ".github/CODEOWNERS",
  ]),

  /**
   * Base fixa do alcance: o que os hooks de commit da maestra executam, mais
   * a pasta de estado do host (pasta oculta, glob `.*`) e os verbos de
   * publicação. Trabalho de filha que toca isto pergunta antes de trazer
   * (D-VEGA22-17). A T8 deriva e confere a lista contra os próprios hooks;
   * aqui mora só o valor.
   * Origem: esboço §Paradas para o operador, §2.2#8 e rulings 1a e PD-2 do
   * plan-review v1; `.squawk.toml` e `packages/flow-synthesis/src/spec/**`
   * entraram na T8, achados pela extração (o `pre-commit` roda o validador
   * de flow, que lê o schema ao lado, e o squawk com essa config) — a
   * medição §2.2#8 só olhou a pasta do host.
   * Muda quando: um hook de commit passa a chamar algo fora dela (o teste da
   * T8 falha).
   */
  baseAlcance: Object.freeze([
    ".husky/**",
    ".*/hooks/**",
    ".*/scripts/**",
    ".*/state/**",
    ".*/rules/financial.md",
    "**/package.json",
    "turbo.json",
    "pnpm-lock.yaml",
    // Review da execução (T19): o pnpm e o node leem estes ao rodar a
    // Verificação ou os hooks — `.npmrc` (`script-shell`) e `.pnpmfile.cjs`
    // executam código sem passar por package.json.
    "**/.npmrc",
    ".pnpmfile.cjs",
    "pnpm-workspace.yaml",
    ".nvmrc",
    ".envrc",
    ".gitattributes",
    "**/*.config.js",
    "**/*.config.mjs",
    "**/*.config.cjs",
    "**/*.config.ts",
    "**/eslint.config.*",
    "**/vitest.config.*",
    "**/.prettierrc*",
    "**/prettier.config.*",
    ".squawk.toml",
    "packages/flow-synthesis/src/spec/**",
    "packages/database/scripts/**",
    "packages/database/supabase/config.toml",
    "**/vercel.json",
  ]),
});
