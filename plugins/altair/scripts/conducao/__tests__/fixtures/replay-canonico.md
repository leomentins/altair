---
cycle: REPLAY-21-ciclo-gravado
opened: 2026-10-06
---

## 1. Goal

### 1.5 Modo de Execução

## 3. Tasks

### F0 — fase F0 (**Modelo:** sonnet)

#### T1 — tarefa T1

- **Objetivo:** tarefa T1
- **satisfies:** [AC-REPLAY21-1]
- **Inputs:** `README.md`
- **Outputs:** `src/t1.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T1`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F0/T1 — tarefa T1`

#### T2 — tarefa T2

- **Objetivo:** tarefa T2
- **satisfies:** [—] (fechamento-de-fase)
- **Inputs:** `README.md` · T1
- **Outputs:** `src/t2.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T2`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F0/T2 — tarefa T2`

### F1 — fase F1 (**Modelo:** opus)

#### T3 — tarefa T3

- **Objetivo:** tarefa T3
- **satisfies:** [AC-REPLAY21-2]
- **Inputs:** `README.md` · T2
- **Outputs:** `src/t3.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T3`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F1/T3 — tarefa T3`

#### T4 — tarefa T4

- **Objetivo:** tarefa T4
- **satisfies:** [AC-REPLAY21-3]
- **Inputs:** `README.md` · T3
- **Outputs:** `src/t4.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T4`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F1/T4 — tarefa T4`

#### T5 — tarefa T5

- **Objetivo:** tarefa T5
- **satisfies:** [AC-REPLAY21-4]
- **Inputs:** `README.md` · T3
- **Outputs:** `src/t5.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T5`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F1/T5 — tarefa T5`

#### T6 — tarefa T6

- **Objetivo:** tarefa T6
- **satisfies:** [AC-REPLAY21-5, AC-REPLAY21-6]
- **Inputs:** `README.md` · T3
- **Outputs:** `src/t6.mjs` (create)
- **Steps:** faz; publica com `db-publish`
- **Verificação:** `echo T6`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F1/T6 — tarefa T6`

#### T7 — tarefa T7

- **Objetivo:** tarefa T7
- **satisfies:** [AC-REPLAY21-7]
- **Inputs:** `README.md` · T3
- **Outputs:** `src/t7.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T7`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F1/T7 — tarefa T7`

#### T8 — tarefa T8

- **Objetivo:** tarefa T8
- **satisfies:** [AC-REPLAY21-8]
- **Inputs:** `README.md` · T4 · T5
- **Outputs:** `src/t8.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T8`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F1/T8 — tarefa T8`

#### T9 — tarefa T9

- **Objetivo:** tarefa T9
- **satisfies:** [—] (fechamento-de-fase)
- **Inputs:** `README.md` · T3 · T4 · T5 · T6 · T7 · T8
- **Outputs:** `src/t9.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T9`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F1/T9 — tarefa T9`

### F2 — fase F2 (**Modelo:** opus)

#### T10 — tarefa T10

- **Objetivo:** tarefa T10
- **satisfies:** [AC-REPLAY21-9]
- **Inputs:** `README.md` · T9
- **Outputs:** `src/t10.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T10`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F2/T10 — tarefa T10`

#### T11 — tarefa T11

- **Objetivo:** tarefa T11
- **satisfies:** [AC-REPLAY21-10]
- **Inputs:** `README.md` · T10
- **Outputs:** `src/t11.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T11`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F2/T11 — tarefa T11`

#### T12 — tarefa T12

- **Objetivo:** tarefa T12
- **satisfies:** [AC-REPLAY21-11]
- **Inputs:** `README.md` · T11
- **Outputs:** `src/t12.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T12`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F2/T12 — tarefa T12`

#### T13 — tarefa T13

- **Objetivo:** tarefa T13
- **satisfies:** [—] (fechamento-de-fase)
- **Inputs:** `README.md` · T10 · T11 · T12
- **Outputs:** `src/t13.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T13`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F2/T13 — tarefa T13`

### F3 — fase F3 (**Modelo:** opus)

#### T14 — tarefa T14

- **Objetivo:** tarefa T14
- **satisfies:** [AC-REPLAY21-12, AC-REPLAY21-13]
- **Inputs:** `README.md` · T13
- **Outputs:** `src/t14.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T14`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F3/T14 — tarefa T14`

#### T15 — tarefa T15

- **Objetivo:** tarefa T15
- **satisfies:** [AC-REPLAY21-14]
- **Inputs:** `README.md` · T14
- **Outputs:** `src/t15.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T15`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F3/T15 — tarefa T15`

#### T16 — tarefa T16

- **Objetivo:** tarefa T16
- **satisfies:** [—] (fechamento-de-fase)
- **Inputs:** `README.md` · T14 · T15
- **Outputs:** `src/t16.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T16`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F3/T16 — tarefa T16`

### F4 — fase F4 (**Modelo:** opus)

#### T17 — tarefa T17

- **Objetivo:** tarefa T17
- **satisfies:** [AC-REPLAY21-15, AC-REPLAY21-16]
- **Inputs:** `README.md` · T16
- **Outputs:** `src/t17.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T17`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F4/T17 — tarefa T17`

#### T18 — tarefa T18

- **Objetivo:** tarefa T18
- **satisfies:** [AC-REPLAY21-17]
- **Inputs:** `README.md` · T17
- **Outputs:** `src/t18.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T18`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F4/T18 — tarefa T18`

#### T19 — tarefa T19

- **Objetivo:** tarefa T19
- **satisfies:** [AC-REPLAY21-18, AC-REPLAY21-19]
- **Inputs:** `README.md` · T12 · T18
- **Outputs:** `src/t19.mjs` (create)
- **Steps:** faz; publica com `db-publish`
- **Verificação:** `echo T19`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F4/T19 — tarefa T19`

#### T20 — tarefa T20

- **Objetivo:** tarefa T20
- **satisfies:** [—] (review-gate)
- **Inputs:** `README.md` · T17 · T18 · T19
- **Outputs:** `src/t20.mjs` (create)
- **Steps:** faz
- **Verificação:** `echo T20`.
- **Esperado:** exit 0.
- **Falha-se:** exit 1.
- **Commit:** `REPLAY-21-ciclo-gravado-F4/T20 — tarefa T20`

## 4. Pronto
