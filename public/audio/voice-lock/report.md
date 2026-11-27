# Этап 1 — Подбор постоянных голосов Voice Remix (Voice Lock)

- **Дата прогона:** 2026-11-27T18:03:15.902Z
- **Модель создания и синтеза:** `gemini-3.8-flash-tts` (официальный Gemini Voice Remix `ai.voices.create`, `store: true`, `type: "prompted"`, без Voice Replication)
- **Модель оценки консистентности:** `gemini-4-hydrogen`
- **Громкость всех WAV-файлов:** выровнена по BS.1770-4 до `-18 LUFS`, true peak `≤ -1.0 dBFS`
- **Счётчик API-вызовов:**
  - Voice Remix `ai.voices.create`: **6** (ровно 6 — без повторов)
  - TTS `gemini-3.8-flash-tts`: **6** (ровно 6 — без повторов)
  - Анализ `gemini-4-hydrogen`: **6** успешных (всего **11**: в первом проходе ответы 5 вызовов не сохранились из-за бага поля `hWrap.result` вместо `hWrap.value`, после исправления выполнен повторный анализ уже сохранённых 6 WAV без новых вызовов TTS/Voice Remix)
  - Read-only `ai.voices.list`: **1** (для восстановления ID F3 без повторного создания)
  - Повторы при ошибках API: **0**

> Победители **не** выбираются автоматически — ниже таблицы для вашего прослушивания и сравнения с эталоном (`exp3-ref-sb1.wav` и `exp3-ref-sb2.wav` до `00:57`).

## Эталоны (первые 02:30 полной озвучки)

| Эталон | Спикер | Медиана F0 | Центроид спектра | Наклон спектра | Файл для прослушивания |
|---|---|---:|---:|---:|---|
| `exp3-ref-sb1.wav` (00:00–01:33) | Азиз (Charon) | 132 Гц | 491 Гц | -10.4 дБ | `/audio/experiments/exp3-ref-sb1.wav` |
| `exp3-ref-sb2.wav` (< 00:57 = 01:33–02:30) | Азиз (Charon) | 117 Гц | 701 Гц | -9.2 дБ | `/audio/experiments/exp3-ref-sb2.wav` |
| `exp3-ref-sb1.wav` (00:00–01:33) | Вероника (Kore) | 201 Гц | 592 Гц | -10.5 дБ | `/audio/experiments/exp3-ref-sb1.wav` |
| `exp3-ref-sb2.wav` (< 00:57 = 01:33–02:30) | Вероника (Kore) | 194 Гц | 668 Гц | -9.5 дБ | `/audio/experiments/exp3-ref-sb2.wav` |

## Мужские кандидаты (на основе Charon — Азиз)

### Таблица для прослушивания и акустического сравнения

| Кандидат | Exact Voice ID | Sample WAV | UZ-Test WAV | F0 (P10–P90) | Центроид | Наклон | MFCC до SB1 / SB2<00:57 / Общ. | LUFS (после) / True Peak | Hydrogen Consistency |
|---|---|---|---|---:|---:|---:|---:|---|---|
| **M1** (Aziz Lock M1 - Bright Charon) | `voice_a8bj2wkarpve` | [`M1-sample.wav`](/audio/voice-lock/M1-sample.wav) (10.88s, -18.07 LUFS / -1.08 dBFS) | [`M1-uz-test.wav`](/audio/voice-lock/M1-uz-test.wav) (19.57s) | 140 Гц (114–209) | 497 Гц | -11.9 дБ | 18.3 / 25.7 / **20.3** | -18.0 LUFS / -1.31 dBFS | Да (7/10), диктор-сдвиг: нет |
| **M2** (Aziz Lock M2 - Airy Conversational) | `voice_din40bswsfcy` | [`M2-sample.wav`](/audio/voice-lock/M2-sample.wav) (10.36s, -18.06 LUFS / -1.13 dBFS) | [`M2-uz-test.wav`](/audio/voice-lock/M2-uz-test.wav) (22.16s) | 115 Гц (85–188) | 483 Гц | -10.5 дБ | 7.2 / 15.8 / **9.2** | -18.1 LUFS / -1.05 dBFS | Да (7/10), диктор-сдвиг: нет |
| **M3** (Aziz Lock M3 - Youthful Reviewer) | `voice_gmmmtjwifmt8` | [`M3-sample.wav`](/audio/voice-lock/M3-sample.wav) (10.84s, -18 LUFS / -2.54 dBFS) | [`M3-uz-test.wav`](/audio/voice-lock/M3-uz-test.wav) (21.93s) | 132 Гц (104–214) | 464 Гц | -12.5 дБ | 11.2 / 17.3 / **12.3** | -18.0 LUFS / -3.70 dBFS | Да (7/10), диктор-сдвиг: нет |

### Подробности, промпты и разбор `gemini-4-hydrogen`

#### M1 — Aziz Lock M1 - Bright Charon
- **Voice ID:** `voice_a8bj2wkarpve` (`base_voice: Charon`, `expire_time: 2027-11-27T17:36:22.872155191Z`)
- **Remix Prompt:** Keep the core identity of Charon, but give it a brighter spectral balance and less heavy chest resonance. A light, relaxed, friendly Uzbek car-video host speaking naturally to a friend, never like a news announcer.
- **Файлы:** sample `/audio/voice-lock/M1-sample.wav` | uz-test `/audio/voice-lock/M1-uz-test.wav`
- **Одна личность на всех 3 репликах:** `ДА` (оценка **7/10**), уход в «диктора» на техническом тексте: `НЕТ`
- **Разбор по репликам A / B / C:** Тембр стабилен: A — легкая усмешка, B и C — нейтральная информативная подача без резкого утяжеления.
- **Эмоции / естественность:** Смешок в начале части A звучит естественно, эмоции плавно сменяются ровным тоном.
- **Вывод Hydrogen:** Единый мужской голос с устойчивым тембром и чистым узбекским произношением во всех частях.

#### M2 — Aziz Lock M2 - Airy Conversational
- **Voice ID:** `voice_din40bswsfcy` (`base_voice: Charon`, `expire_time: 2027-11-27T17:36:51.959511053Z`)
- **Remix Prompt:** Keep the core identity of Charon. Make the baseline voice airy, close and conversational, naturally smiling, with soft projection and clear Uzbek pronunciation. Avoid formal narrator and announcer delivery.
- **Файлы:** sample `/audio/voice-lock/M2-sample.wav` | uz-test `/audio/voice-lock/M2-uz-test.wav`
- **Одна личность на всех 3 репликах:** `ДА` (оценка **7/10**), уход в «диктора» на техническом тексте: `НЕТ`
- **Разбор по репликам A / B / C:** Единый мужской тембр во всех частях: A — мягкая шутливая интонация, B и C — спокойный информативный тон без перехода в дикторский.
- **Эмоции / естественность:** Смех в части A звучит естественно, эмоциональная подача живая и легкая.
- **Вывод Hydrogen:** Голос уверенно сохраняет единую идентичность и естественный разговорный тембр на протяжении всех трех фрагментов.

#### M3 — Aziz Lock M3 - Youthful Reviewer
- **Voice ID:** `voice_gmmmtjwifmt8` (`base_voice: Charon`, `expire_time: 2027-11-27T17:37:24.208393166Z`)
- **Remix Prompt:** Keep Charon recognizable, but make him sound like a friendly, energetic Uzbek car reviewer: bright, casual and youthful, with natural warmth and no heavy authoritative register.
- **Файлы:** sample `/audio/voice-lock/M3-sample.wav` | uz-test `/audio/voice-lock/M3-uz-test.wav`
- **Одна личность на всех 3 репликах:** `ДА` (оценка **7/10**), уход в «диктора» на техническом тексте: `НЕТ`
- **Разбор по репликам A / B / C:** В A тембр чуть светлее и выше; в B и C голос становится спокойнее, глубже и ровнее, сохраняя общую основу.
- **Эмоции / естественность:** Часть A звучит живо и с лёгкой усмешкой (мужской голос без тега смеха), вполне естественно.
- **Вывод Hydrogen:** Стабильный мужской голос с единой идентичностью и плавным переходом к нейтральной подаче.

## Женские кандидаты (на основе Kore — Вероника)

### Таблица для прослушивания и акустического сравнения

| Кандидат | Exact Voice ID | Sample WAV | UZ-Test WAV | F0 (P10–P90) | Центроид | Наклон | MFCC до SB1 / SB2<00:57 / Общ. | LUFS (после) / True Peak | Hydrogen Consistency |
|---|---|---|---|---:|---:|---:|---:|---|---|
| **F1** (Veronika Lock F1 - Light Playful Kore) | `voice_jobdfz42xizz` | [`F1-sample.wav`](/audio/voice-lock/F1-sample.wav) (8.2s, -18 LUFS / -4.23 dBFS) | [`F1-uz-test.wav`](/audio/voice-lock/F1-uz-test.wav) (18.29s) | 203 Гц (151–289) | 628 Гц | -9.9 дБ | 8.3 / 10.0 / **8.6** | -18.0 LUFS / -4.76 dBFS | Да (7/10), диктор-сдвиг: нет |
| **F2** (Veronika Lock F2 - Airy Smiling Kore) | `voice_5okyophj33qp` | [`F2-sample.wav`](/audio/voice-lock/F2-sample.wav) (8.16s, -18 LUFS / -1.48 dBFS) | [`F2-uz-test.wav`](/audio/voice-lock/F2-uz-test.wav) (18.32s) | 167 Гц (133–240) | 582 Гц | -9.6 дБ | 8.4 / 9.9 / **8.6** | -18.0 LUFS / -2.16 dBFS | Да (7/10), диктор-сдвиг: нет |
| **F3** (Veronika Lock F3 - Warm Reviewer Kore) | `voice_1khn46alyxjk` | [`F3-sample.wav`](/audio/voice-lock/F3-sample.wav) (17.24s, -18 LUFS / -2.57 dBFS) | [`F3-uz-test.wav`](/audio/voice-lock/F3-uz-test.wav) (16.48s) | 211 Гц (158–293) | 603 Гц | -8.9 дБ | 8.9 / 11.3 / **9.6** | -18.0 LUFS / -3.48 dBFS | Да (7/10), диктор-сдвиг: нет |

### Подробности, промпты и разбор `gemini-4-hydrogen`

#### F1 — Veronika Lock F1 - Light Playful Kore
- **Voice ID:** `voice_jobdfz42xizz` (`base_voice: Kore`, `expire_time: 2027-11-27T17:37:56.472050304Z`)
- **Remix Prompt:** Keep the core identity of Kore, but make the baseline voice lighter, brighter and more playful. A lively, curious Uzbek car-video host, never firm or news-like.
- **Файлы:** sample `/audio/voice-lock/F1-sample.wav` | uz-test `/audio/voice-lock/F1-uz-test.wav`
- **Одна личность на всех 3 репликах:** `ДА` (оценка **7/10**), уход в «диктора» на техническом тексте: `НЕТ`
- **Разбор по репликам A / B / C:** Во всех частях (A, B, C) сохраняется единый женский тембр с плавной сменой настроения.
- **Эмоции / естественность:** Смех звучит естественно и не проговаривается текстом, эмоции живые.
- **Вывод Hydrogen:** Голос стабильно сохраняет единую индивидуальность во всех репликах без ухода в дикторскую подачу.

#### F2 — Veronika Lock F2 - Airy Smiling Kore
- **Voice ID:** `voice_5okyophj33qp` (`base_voice: Kore`, `expire_time: 2027-11-27T17:38:26.560109297Z`)
- **Remix Prompt:** Keep Kore recognizable. Make her voice airy, naturally smiling and conversational, with a light youthful timbre and clear Uzbek pronunciation. Avoid formal presenter delivery.
- **Файлы:** sample `/audio/voice-lock/F2-sample.wav` | uz-test `/audio/voice-lock/F2-uz-test.wav`
- **Одна личность на всех 3 репликах:** `ДА` (оценка **7/10**), уход в «диктора» на техническом тексте: `НЕТ`
- **Разбор по репликам A / B / C:** В A голос игривый и светлый; в B переходит в спокойный заинтересованный тон; в C слышна лёгкая тревога, тембр и подача остаются едиными.
- **Эмоции / естественность:** Смех в части A звучит естественно, не проговаривается словом. Эмоциональные оттенки во всех частях переданы живо.
- **Вывод Hydrogen:** Во всех трёх фрагментах сохраняется единый узнаваемый женский голос с естественным узбекским произношением без ухода в дикторскую подачу.

#### F3 — Veronika Lock F3 - Warm Reviewer Kore
- **Voice ID:** `voice_1khn46alyxjk` (`base_voice: Kore`, `expire_time: 2027-11-27T17:38:58.565777820Z`)
- **Remix Prompt:** Keep the core identity of Kore, but make her a warm, lively Uzbek car reviewer with bright reactions, friendly curiosity and soft projection. Never sound like a news announcer.
- **Файлы:** sample `/audio/voice-lock/F3-sample.wav` | uz-test `/audio/voice-lock/F3-uz-test.wav`
- **Одна личность на всех 3 репликах:** `ДА` (оценка **7/10**), уход в «диктора» на техническом тексте: `НЕТ`
- **Разбор по репликам A / B / C:** A — игривая подача со смехом; B — ровный любознательный тон; C — легкая обеспокоенность при сохранении тембра.
- **Эмоции / естественность:** Смех в части A звучит естественно (легкий смешок), эмоции переданы живо.
- **Вывод Hydrogen:** Единый женский голос сохраняет стабильную идентичность и естественное узбекское произношение во всех трех репликах.

## Тестовые реплики (3 отдельные parts в одном запросе TTS)

### Мужские (M1, M2, M3)
- **A** (`style: "gently amused"`): Qani, yana bir marta!
- **B** (`style: ""`): Bu zaryadlanadigan gibrid. Chery’da tizim CSH — Chery Super gibrid deyiladi. Bir butun besh litrli turbo motor va unga juft elektr motor bor.
- **C** (`style: ""`): Premium komplektatsiyasida adaptiv kruiz-kontrol va polosada ushlab turish bor. Ular yordam beradi, lekin yo‘lga baribir haydovchi qaraydi.

### Женские (F1, F2, F3)
- **A** (`style: "gently amused"`): Aytgandim-ku, baribir sendan o‘zib ketaman deb! <laugh>
- **B** (`style: "slightly curious"`): Endi yana batareya haqida gaplashaylik. Bizda issiq, yomg‘ir, suv bor — zarar qilmaydimi?
- **C** (`style: "slightly concerned"`): Bu yer tor, bir tomonida toshlar bor. Qanday qayrilib olamiz?
