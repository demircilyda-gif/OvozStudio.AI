# Experiment 2 Report — Tiggo 8 Hybrid v4 (Scenes 1–2, 16 turns, 1 sub-block)

- **Generated at:** 2026-11-27T11:35:45.834Z
- **Pipeline:** Real `synthesizeDialogueInMacroBlocks` (`strictTimeWindow: true`, `bypassCache: true`, `maxExtraTtsCalls: 0`, `useDeliveryEmotions: true`, dictionary `Hybrid → gibrid`, BS.1770-4 loudness leveling to `-18 LUFS`, stitched via `stitchDialogueTurnsClient`)
- **Base styles:** Азиз (M) = `warm, relaxed, friendly` | Вероника (F) = `lively, casual, friendly`

## Summary

| Variant | Voices (M + F) | WAV File | QA | TTS Calls / Time | Align Calls / Time | Overall LUFS / Peak | "laugh" spoken aloud? |
|---|---|---|---|---|---|---|---|
| **A** | Charon + Kore | `/audio/experiments/exp2-A-kore.wav` (4.30 MB, 94.0s) | `saved (run 1)` — QA-лог из RAM не сохранён | 1 (run 1) | 1 полный (run 1) + 1 короткий 14s verify (run 2, 4.17s) | **-18.17 LUFS** / -1.83 dBFS | ✅ NO |
| **B** | Charon + Aoede | `/audio/experiments/exp2-B-aoede.wav` (4.30 MB, 94.0s) | `saved (run 1)` — QA-лог из RAM не сохранён | 1 (run 1) | 1 полный (run 1) + 1 короткий 14s verify (run 2, 2.99s) | **-18.14 LUFS** / -1.04 dBFS | ✅ NO |
| **C** | Charon + Zephyr | `/audio/experiments/exp2-C-zephyr.wav` (4.30 MB, 94.0s) | **16/16 ok** (run 2) | 1 (run 1, прерван) + 1 (run 2, 15.56s) | 1 прерванный (run 1) + 1 полный (run 2, 10.94s) | **-18.18 LUFS** / -1.00 dBFS | ✅ NO |

## Учёт вызовов за оба запуска, статус вариантов A/B и выравнивание громкости

### 1. Сколько всего вызовов ушло за оба запуска эксперимента 2
- **Запуск 1 (`11:27–11:32Z`, прерван перезапуском сервера на варианте C):**
  - TTS (`gemini-3.8-flash-tts`): **3 вызова** — по 1 на варианты A (`11:30:01Z`), B (`11:30:40Z`) и C (`11:30:56Z`).
  - Выравнивание (`gemini-4-hydrogen`): **2 завершённых** (A и B) + **1 прерванный** (C).
- **Запуск 2 (`11:35Z`, режим дозапуска `resumeExisting`):**
  - TTS (`gemini-3.8-flash-tts`): **1 вызов** — только вариант C (`15.56s`).
  - Выравнивание (`gemini-4-hydrogen`): **1 полный вызов** для варианта C (`10.94s`) + **2 коротких проверочных вызова** по первым 14 с уже сохранённых `exp2-A-kore.wav` (`4.17s`) и `exp2-B-aoede.wav` (`2.99s`) для проверки тега `<laugh>`.
- **Итого за оба запуска эксперимента 2:** **4 вызова TTS** и **6 вызовов выравнивания** (3 полных завершённых + 1 прерванный на C в запуске 1 + 2 коротких 14-секундных проверочных для A и B в запуске 2).

### 2. Почему варианты A и B не пересобирались во втором запуске
- В запуске 1 варианты A (`exp2-A-kore.wav`, `11:30:01Z`) и B (`exp2-B-aoede.wav`, `11:30:40Z`) успели полностью завершиться и записаться на диск, но сервер перезапустился до завершения варианта C и до записи `exp2-report.md` (поэтому порепликовые QA-статусы и значения «LUFS до» из оперативной памяти запуска 1 для A и B не сохранились на диск).
- Между запуском 1 и запуском 2 **движок дубляжа не менялся** — правка касалась только скрипта `exp2Runner.ts` (добавлена опция `resumeExisting`), чтобы не тратить повторно 2 вызова TTS-квоты на A и B. Из-за этого в таблицах A и B указано `saved (run 1)`, а порепликовый QA для них не перепроверялся заново.

### 3. Был ли применён код выравнивания громкости (BS.1770-4) к вариантам A и B
- **Да, применён в полном объёме.** Все изменения пунктов 1–6 (включая `loudnessLeveler.ts` с целевым уровнем `-18 LUFS`, `dubbingStyle.ts`, `pronunciationDictionary.ts`, `batchDialogueEngine.ts`, `batchAudioSlicer.ts` и `clientMasterStitcher.ts`) уже были собраны и работали на сервере до старта запуска 1.
- Прямой замер итоговых WAV-файлов подтверждает это:
  - `exp2-A-kore.wav`: интегральная громкость **`-18.17 LUFS`**, пик `-1.83 dBFS` (по репликам от `-19.2` до `-17.6 LUFS`, кроме реплики #03 с 1.73 с тишины).
  - `exp2-B-aoede.wav`: интегральная громкость **`-18.14 LUFS`**, пик `-1.04 dBFS` (по репликам от `-18.2` до `-17.4 LUFS`).
  - `exp2-C-zephyr.wav`: интегральная громкость **`-18.18 LUFS`**, пик `-1.00 dBFS`.

## Причина сдвига реплики #03 в варианте A (`exp2-A-kore.wav`)

**Короткий ответ:** это **тишина внутри самого клипа #03 (`1.73 с` в начале)**, попавшая туда на этапе **нарезки (`batchAudioSlicer.ts`)** и не срезанная краевым триммером `trimSilenceEdgesPcm`. Склейщик `clientMasterStitcher.ts` поставил клип #03 ровно в расписанный таймкод `00:18.00` (без сдвига), а физического наложения голосов на #04 нет — между концом #03 и началом #04 стоит чистая пауза `0.08 с`, но клип #04 сдвинут вправо на `+1.23 с`.

### Пошаговый замер PCM `exp2-A-kore.wav` (окно 50 мс)
- **`00:17.95–00:17.99`**: абсолютный цифровой ноль (`maxAbs = 0`, `-inf dB`) — межрепликовая тишина от `clientMasterStitcher.ts`.
- **`00:18.0003`**: начало клипа #03 — **ровно по таймкоду сценария `00:18.00`**.
- **`00:18.00–00:19.72` (1.73 с)**: внутри клипа #03 идёт тихий фоновый шум/пауза TTS (`rms = -58.8 … -73.3 dB`, не цифровой ноль) с двумя крошечными всплесками дыхания/шума: `maxAbs = 105` на `18.00–18.05s`, `maxAbs = 120` на `18.1822s` (3 сэмпла `>= 110`) и `maxAbs = 288` на `19.0012s` (32 сэмпла `>= 110`).
- **`00:19.73–00:21.10` (1.37 с)**: фактическая речь Азиза (`"Hammaga salom, men Azizman."`). Сама фраза длится всего `1.37 с` и легко поместилась бы в окно `2.00 с` (`00:18–00:20`). На `21.10–21.14` — плавный fade-out 120 мс (клип #03 получил длину `3.14 с > 2.00 с` и статус `overflow`).
- **`00:21.14–00:21.22` (0.08 с)**: абсолютный цифровой ноль (`MIN_GAP_BETWEEN_TURNS_SEC = 0.08` в `src/utils/clientMasterStitcher.ts:268, 304`). Акустического наложения реплик #03 и #04 нет.
- **`00:21.23–00:26.21`**: клип #04 (Вероника, по сценарию `00:20.00–00:25.00`) сдвинут склейщиком вправо на **`+1.23 с`** (сама речь Вероники слышна с `00:21.54` до `00:26.21`).

### Почему это произошло в коде (`server/services/dubbing/batchAudioSlicer.ts`)
1. **Захват паузы на границе с `<laugh>` (`batchAudioSlicer.ts:1343–1420`):** реплика #02 заканчивалась на `<laugh>` перед переходом `1-SAHNA → 2-SAHNA`. В сырой записи Mode A между смехом и приветствием Азиза образовалась длинная пауза/выдох (~2 с). Выравнивание (`gemini-4-hydrogen`) либо выставило `startSec` реплики #03 рано в этой паузе, либо привязка `startSample` (`lines 1344–1359`) зацепилась за раннюю паузу/`prevEndSample`, включив ~1.73 с тишины перед первым словом Азиза.
2. **Сбой краевого триммера `trimSilenceEdgesPcm` (`batchAudioSlicer.ts:688–709`):** нарезанный клип проходит через `trimSilenceEdgesPcm(slice, 20)`, который обрезает тишину слева по жёсткому **порогу одного сэмпла `Math.abs(sample) < 110`** (≈ `-49.5 dBFS`), без RMS-окна и без проверки длительности сигнала. Поскольку в фоновой паузе TTS на `00:18.00–00:18.20` попались единичные сэмплы шума/вдоха около `110` (после выравнивания громкости `maxAbs = 105` на `18.00–18.05s` и `120` на `18.1822s`, а до ослабления к `-18 LUFS` они уже были `>= 110`), цикл обрезки остановился в самом начале клипа и оставил внутри все `1.73 с` тишины.
3. **Почему в таблице Variant A ниже указано `0.24s` у #03 и `6.16s` у #04:** скрипт-инспектор сохранённого WAV резал аудио строго по расписанным слотам `[18.00..20.00]` и `[20.00..26.20]`, не зная о сдвиге #04 на `21.23`, поэтому отнёс продолжение речи Азиза (`20.00–21.14`) к слоту Вероники #04.

### Explicit Check: `<laugh>` on Turns #01 & #02

- **Variant A (Kore)**: spoken-aloud = `NO`
  - Turn #01 heard: `Aytgandim-ku, baribir sendan o'zib ketaman deb.`
  - Turn #02 heard: `Qani, yana bir marta.`
- **Variant B (Aoede)**: spoken-aloud = `NO`
  - Turn #01 heard: `Aytgandim-ku, baribir sendan o‘zib ketaman deb.`
  - Turn #02 heard: `Qani, yana bir marta.`
- **Variant C (Zephyr)**: spoken-aloud = `NO`
  - Turn #01 heard: `Aytgandim-ku, baribir sendan o'zib ketaman deb!`
  - Turn #02 heard: `Qani, yana bir marta!`

## Variant A (Charon + Kore)

| # | Спикер | Таймкод сценария | Факт в WAV | Клип / Окно | QA | LUFS до → после | Отправленный style | Отправленный текст в TTS |
|---:|---|---|---|---|---|---|---|---|
| 01 | Вероника | 00:00.00–00:04.00 | 00:00.01–00:03.79 | 3.78s / 4.00s | saved (run 1) | — → -17.9 LUFS | `lively, casual, friendly, excited, amused` | Aytgandim-ku, baribir sendan o'zib ketaman deb! <laugh> |
| 02 | Азиз | 00:04.00–00:06.00 | 00:04.07–00:06.20 | 2.13s / 2.00s | saved (run 1) | — → -17.7 LUFS | `warm, relaxed, friendly, amused, inviting` | Qani, yana bir marta! <laugh> |
| 03 | Азиз | 00:18.00–00:20.00 | 00:19.76–00:20.00 | 0.24s / 2.00s | saved (run 1) | — → -16.7 LUFS | `warm, relaxed, friendly` | Hammaga salom, men Azizman. |
| 04 | Вероника | 00:20.00–00:25.00 | 00:20.00–00:26.16 | 6.16s / 5.00s | saved (run 1) | — → -18.1 LUFS | `lively, casual, friendly, smiling` | Men esa Veronika. Bugun biz bilan yetti o'rinli Tiggo sakkiz gibrid krossoveri. |
| 05 | Азиз | 00:34.00–00:39.00 | 00:34.02–00:38.90 | 4.88s / 5.00s | saved (run 1) | — → -18.1 LUFS | `warm, relaxed, friendly` | Rejamiz shunday: mashinani ko'ramiz, tog' yo'lida haydaymiz va zaryadkaga kiramiz. |
| 06 | Вероника | 00:39.00–00:44.00 | 00:39.11–00:43.88 | 4.77s / 5.00s | saved (run 1) | — → -18.0 LUFS | `lively, casual, friendly, doubtful, curious` | Avval bitta savol: benzinli mashina bor-ku, gibrid nega kerak? Tashvishi ko'p-ku. |
| 07 | Азиз | 00:44.00–00:51.00 | 00:44.05–00:50.18 | 6.13s / 7.00s | saved (run 1) | — → -18.1 LUFS | `warm, relaxed, friendly` | Javoblar bir nechta. Har qanday oilaviy safar boshlanadigan narsadan boshlaymiz: yo'lovchilar va yukdan. |
| 08 | Вероника | 00:51.00–00:55.00 | 00:51.50–00:54.96 | 3.46s / 4.00s | saved (run 1) | — → -17.9 LUFS | `lively, casual, friendly, curious` | Tashqaridan katta oilaviy krossover. Ichida uch qator bormi? |
| 09 | Азиз | 00:55.00–01:01.00 | 00:55.07–01:00.96 | 5.89s / 6.00s | saved (run 1) | — → -18.0 LUFS | `warm, relaxed, friendly` | Uch qator, yetti o'rin. Disklar o'n to'qqiz dyuym, bu Premium komplektatsiyasi. Luxury'da o'n sakkiz bo'ladi. |
| 10 | Вероника | 01:01.00–01:06.00 | 01:01.03–01:06.00 | 4.97s / 5.00s | saved (run 1) | — → -19.2 LUFS | `lively, casual, friendly` | Xo'p, qara. Gibrid bo'lsa, ichida batareya bor. U salondagi joyni toraytirmaydimi? |
| 11 | Азиз | 01:06.00–01:11.00 | 01:06.00–01:11.00 | 5.00s / 5.00s | saved (run 1) | — → -17.8 LUFS | `warm, relaxed, friendly` | Yo'q. Batareya pastda, kuzov tagida joylashgan. Shuning uchun salonda to'liq yetti o'rin bor. |
| 12 | Вероника | 01:11.00–01:15.00 | 01:11.00–01:15.00 | 4.00s / 4.00s | saved (run 1) | — → -17.9 LUFS | `lively, casual, friendly` | Endi yukxonadan gaplashaylik. Aytaylik, yetti kishi yo'lga chiqdik. |
| 13 | Азиз | 01:15.00–01:19.00 | 01:15.00–01:19.00 | 4.00s / 4.00s | saved (run 1) | — → -17.6 LUFS | `warm, relaxed, friendly` | Unda uchinchi qator ortida bir yuz to'qson uch litr joy qoladi. |
| 14 | Вероника | 01:19.00–01:21.00 | 01:19.00–01:21.00 | 2.00s / 2.00s | saved (run 1) | — → -19.0 LUFS | `lively, casual, friendly` | Agar besh kishi bo'lsak-chi? |
| 15 | Азиз | 01:21.00–01:29.00 | 01:21.01–01:29.00 | 7.99s / 8.00s | saved (run 1) | — → -18.1 LUFS | `warm, relaxed, friendly` | Unda uchinchi qatorni yig'amiz, hajm ancha ochiladi. Juda ko'p joy kerak bo'lsa, ikkinchi qatorni ham yig'amiz — bir ming to'qqiz yuz o'ttiz litrgacha yetadi. |
| 16 | Вероника | 01:29.00–01:33.00 | 01:29.00–01:33.39 | 4.39s / 4.00s | saved (run 1) | — → -18.6 LUFS | `lively, casual, friendly, pleased, smiling` | Zo'r-ku! Demak, o'zim tanlayman: yuk ko'pmi yoki yo'lovchi. |

## Variant B (Charon + Aoede)

| # | Спикер | Таймкод сценария | Факт в WAV | Клип / Окно | QA | LUFS до → после | Отправленный style | Отправленный текст в TTS |
|---:|---|---|---|---|---|---|---|---|
| 01 | Вероника | 00:00.00–00:04.00 | 00:00.00–00:02.80 | 2.80s / 4.00s | saved (run 1) | — → -17.8 LUFS | `lively, casual, friendly, excited, amused` | Aytgandim-ku, baribir sendan o'zib ketaman deb! <laugh> |
| 02 | Азиз | 00:04.00–00:06.00 | 00:04.09–00:07.62 | 3.53s / 2.00s | saved (run 1) | — → -17.9 LUFS | `warm, relaxed, friendly, amused, inviting` | Qani, yana bir marta! <laugh> |
| 03 | Азиз | 00:18.00–00:20.00 | 00:18.02–00:19.64 | 1.62s / 2.00s | saved (run 1) | — → -17.4 LUFS | `warm, relaxed, friendly` | Hammaga salom, men Azizman. |
| 04 | Вероника | 00:20.00–00:25.00 | 00:20.03–00:25.44 | 5.41s / 5.00s | saved (run 1) | — → -18.1 LUFS | `lively, casual, friendly, smiling` | Men esa Veronika. Bugun biz bilan yetti o'rinli Tiggo sakkiz gibrid krossoveri. |
| 05 | Азиз | 00:34.00–00:39.00 | 00:34.02–00:38.56 | 4.54s / 5.00s | saved (run 1) | — → -18.0 LUFS | `warm, relaxed, friendly` | Rejamiz shunday: mashinani ko'ramiz, tog' yo'lida haydaymiz va zaryadkaga kiramiz. |
| 06 | Вероника | 00:39.00–00:44.00 | 00:39.27–00:43.91 | 4.64s / 5.00s | saved (run 1) | — → -18.2 LUFS | `lively, casual, friendly, doubtful, curious` | Avval bitta savol: benzinli mashina bor-ku, gibrid nega kerak? Tashvishi ko'p-ku. |
| 07 | Азиз | 00:44.00–00:51.00 | 00:44.05–00:49.36 | 5.31s / 7.00s | saved (run 1) | — → -18.0 LUFS | `warm, relaxed, friendly` | Javoblar bir nechta. Har qanday oilaviy safar boshlanadigan narsadan boshlaymiz: yo'lovchilar va yukdan. |
| 08 | Вероника | 00:51.00–00:55.00 | 00:51.31–00:54.89 | 3.58s / 4.00s | saved (run 1) | — → -17.4 LUFS | `lively, casual, friendly, curious` | Tashqaridan katta oilaviy krossover. Ichida uch qator bormi? |
| 09 | Азиз | 00:55.00–01:01.00 | 00:55.02–01:00.87 | 5.85s / 6.00s | saved (run 1) | — → -18.0 LUFS | `warm, relaxed, friendly` | Uch qator, yetti o'rin. Disklar o'n to'qqiz dyuym, bu Premium komplektatsiyasi. Luxury'da o'n sakkiz bo'ladi. |
| 10 | Вероника | 01:01.00–01:06.00 | 01:01.03–01:05.80 | 4.77s / 5.00s | saved (run 1) | — → -18.0 LUFS | `lively, casual, friendly` | Xo'p, qara. Gibrid bo'lsa, ichida batareya bor. U salondagi joyni toraytirmaydimi? |
| 11 | Азиз | 01:06.00–01:11.00 | 01:06.03–01:10.96 | 4.93s / 5.00s | saved (run 1) | — → -18.0 LUFS | `warm, relaxed, friendly` | Yo'q. Batareya pastda, kuzov tagida joylashgan. Shuning uchun salonda to'liq yetti o'rin bor. |
| 12 | Вероника | 01:11.00–01:15.00 | 01:11.09–01:14.92 | 3.83s / 4.00s | saved (run 1) | — → -18.0 LUFS | `lively, casual, friendly` | Endi yukxonadan gaplashaylik. Aytaylik, yetti kishi yo'lga chiqdik. |
| 13 | Азиз | 01:15.00–01:19.00 | 01:15.49–01:18.66 | 3.17s / 4.00s | saved (run 1) | — → -17.8 LUFS | `warm, relaxed, friendly` | Unda uchinchi qator ortida bir yuz to'qson uch litr joy qoladi. |
| 14 | Вероника | 01:19.00–01:21.00 | 01:19.02–01:20.44 | 1.42s / 2.00s | saved (run 1) | — → -18.1 LUFS | `lively, casual, friendly` | Agar besh kishi bo'lsak-chi? |
| 15 | Азиз | 01:21.00–01:29.00 | 01:21.01–01:28.85 | 7.84s / 8.00s | saved (run 1) | — → -17.9 LUFS | `warm, relaxed, friendly` | Unda uchinchi qatorni yig'amiz, hajm ancha ochiladi. Juda ko'p joy kerak bo'lsa, ikkinchi qatorni ham yig'amiz — bir ming to'qqiz yuz o'ttiz litrgacha yetadi. |
| 16 | Вероника | 01:29.00–01:33.00 | 01:29.08–01:32.89 | 3.81s / 4.00s | saved (run 1) | — → -17.8 LUFS | `lively, casual, friendly, pleased, smiling` | Zo'r-ku! Demak, o'zim tanlayman: yuk ko'pmi yoki yo'lovchi. |

## Variant C (Charon + Zephyr)

| # | Спикер | Таймкод сценария | Факт в WAV | Клип / Окно | QA | LUFS до → после | Отправленный style | Отправленный текст в TTS |
|---:|---|---|---|---|---|---|---|---|
| 01 | Вероника | 00:00.00–00:04.00 | 00:00.00–00:03.22 | 3.22s / 4.00s | ok | -16.9 → -18.0 LUFS | `lively, casual, friendly, excited, amused` | Aytgandim-ku, baribir sendan o'zib ketaman deb! <laugh> |
| 02 | Азиз | 00:04.00–00:06.00 | 00:04.00–00:05.76 | 1.76s / 2.00s | ok | -18.2 → -18.0 LUFS | `warm, relaxed, friendly, amused, inviting` | Qani, yana bir marta! <laugh> |
| 03 | Азиз | 00:18.00–00:20.00 | 00:18.00–00:19.69 | 1.69s / 2.00s | ok | -16.3 → -18.0 LUFS | `warm, relaxed, friendly` | Hammaga salom, men Azizman. |
| 04 | Вероника | 00:20.00–00:25.00 | 00:20.00–00:25.73 | 5.73s / 5.00s | ok | -19.0 → -18.0 LUFS | `lively, casual, friendly, smiling` | Men esa Veronika. Bugun biz bilan yetti o'rinli Tiggo sakkiz gibrid krossoveri. |
| 05 | Азиз | 00:34.00–00:39.00 | 00:34.00–00:38.93 | 4.93s / 5.00s | ok | -18.4 → -18.0 LUFS | `warm, relaxed, friendly` | Rejamiz shunday: mashinani ko'ramiz, tog' yo'lida haydaymiz va zaryadkaga kiramiz. |
| 06 | Вероника | 00:39.00–00:44.00 | 00:39.01–00:43.92 | 4.91s / 5.00s | ok | -18.4 → -18.0 LUFS | `lively, casual, friendly, doubtful, curious` | Avval bitta savol: benzinli mashina bor-ku, gibrid nega kerak? Tashvishi ko'p-ku. |
| 07 | Азиз | 00:44.00–00:51.00 | 00:44.00–00:50.22 | 6.22s / 7.00s | ok | -16.2 → -18.0 LUFS | `warm, relaxed, friendly` | Javoblar bir nechta. Har qanday oilaviy safar boshlanadigan narsadan boshlaymiz: yo'lovchilar va yukdan. |
| 08 | Вероника | 00:51.00–00:55.00 | 00:51.00–00:54.54 | 3.54s / 4.00s | ok | -17.8 → -18.0 LUFS | `lively, casual, friendly, curious` | Tashqaridan katta oilaviy krossover. Ichida uch qator bormi? |
| 09 | Азиз | 00:55.00–01:01.00 | 00:55.00–01:00.92 | 5.92s / 6.00s | ok | -19.3 → -18.0 LUFS | `warm, relaxed, friendly` | Uch qator, yetti o'rin. Disklar o'n to'qqiz dyuym, bu Premium komplektatsiyasi. Luxury'da o'n sakkiz bo'ladi. |
| 10 | Вероника | 01:01.00–01:06.00 | 01:01.00–01:05.92 | 4.92s / 5.00s | ok | -18.7 → -18.0 LUFS | `lively, casual, friendly` | Xo'p, qara. Gibrid bo'lsa, ichida batareya bor. U salondagi joyni toraytirmaydimi? |
| 11 | Азиз | 01:06.00–01:11.00 | 01:06.00–01:10.93 | 4.93s / 5.00s | ok | -20.3 → -18.0 LUFS | `warm, relaxed, friendly` | Yo'q. Batareya pastda, kuzov tagida joylashgan. Shuning uchun salonda to'liq yetti o'rin bor. |
| 12 | Вероника | 01:11.00–01:15.00 | 01:11.01–01:14.92 | 3.91s / 4.00s | ok | -18.8 → -18.0 LUFS | `lively, casual, friendly` | Endi yukxonadan gaplashaylik. Aytaylik, yetti kishi yo'lga chiqdik. |
| 13 | Азиз | 01:15.00–01:19.00 | 01:15.00–01:18.56 | 3.56s / 4.00s | ok | -19.4 → -18.0 LUFS | `warm, relaxed, friendly` | Unda uchinchi qator ortida bir yuz to'qson uch litr joy qoladi. |
| 14 | Вероника | 01:19.00–01:21.00 | 01:19.00–01:20.32 | 1.32s / 2.00s | ok | -18.1 → -18.0 LUFS | `lively, casual, friendly` | Agar besh kishi bo'lsak-chi? |
| 15 | Азиз | 01:21.00–01:29.00 | 01:21.00–01:28.94 | 7.94s / 8.00s | ok | -19.9 → -18.0 LUFS | `warm, relaxed, friendly` | Unda uchinchi qatorni yig'amiz, hajm ancha ochiladi. Juda ko'p joy kerak bo'lsa, ikkinchi qatorni ham yig'amiz — bir ming to'qqiz yuz o'ttiz litrgacha yetadi. |
| 16 | Вероника | 01:29.00–01:33.00 | 01:29.02–01:33.22 | 4.20s / 4.00s | ok | -19.6 → -18.0 LUFS | `lively, casual, friendly, pleased, smiling` | Zo'r-ku! Demak, o'zim tanlayman: yuk ko'pmi yoki yo'lovchi. |
