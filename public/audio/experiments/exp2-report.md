# Experiment 2 Report — Tiggo 8 Hybrid v4 (Scenes 1–2, 16 turns, 1 sub-block)

- **Generated at:** 2026-11-27T11:35:45.834Z
- **Pipeline:** Real `synthesizeDialogueInMacroBlocks` (`strictTimeWindow: true`, `bypassCache: true`, `maxExtraTtsCalls: 0`, `useDeliveryEmotions: true`, dictionary `Hybrid → gibrid`, BS.1770-4 loudness leveling to `-18 LUFS`, stitched via `stitchDialogueTurnsClient`)
- **Base styles:** Азиз (M) = `warm, relaxed, friendly` | Вероника (F) = `lively, casual, friendly`

## Summary

| Variant | Voices (M + F) | WAV File | QA | TTS Calls / Time | Align Calls / Time | "laugh" spoken aloud? |
|---|---|---|---|---|---|---|
| **A** | Charon + Kore | `/audio/experiments/exp2-A-kore.wav` (4.30 MB, 94.0s) | **16/16** | 1 (saved WAV) | 1 (4.17s verify) | ✅ NO |
| **B** | Charon + Aoede | `/audio/experiments/exp2-B-aoede.wav` (4.30 MB, 94.0s) | **16/16** | 1 (saved WAV) | 1 (2.99s verify) | ✅ NO |
| **C** | Charon + Zephyr | `/audio/experiments/exp2-C-zephyr.wav` (4.30 MB, 94.0s) | **16/16** | 1 (15.56s) | 1 (10.94s) | ✅ NO |

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
