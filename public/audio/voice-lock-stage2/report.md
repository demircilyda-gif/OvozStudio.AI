# ЭТАП 2 — Контрольная полная озвучка Tiggo 8 в режиме Voice Lock (`full_speaker_tracks`)

- **Дата запуска (UTC):** 2026-11-28T08:34:39.497Z
- **Сценарий:** `scripts/fixtures/01_tiggo_8_hybrid_uz_dublyaj_v4.txt` (79 реплик, длительность видео 512.00 с)
- **Кэш:** ВЫКЛЮЧЕН (`bypassCache: true`)
- **Модели:** TTS = `gemini-3.8-flash-tts`, Alignment & Identity QA = `gemini-4-hydrogen`
- **Общий статус прогона:** ❌ НЕ ПРОЙДЕН (FAIL)
- **Voice Identity QA:** ✅ ПРОЙДЕН ДЛЯ ОБОИХ ВЕДУЩИХ
- **Общее время выполнения:** 170.8 с

## 1. Использованные постоянные голоса и счётчики API-вызовов

| Ведущий | voiceId | voiceType | identityVersion | Реплик | Parts в 1 TTS | Raw длительность | TTS вызовов | Alignment вызовов | Identity QA вызовов | Статус трека |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---|
| Азиз | `voice_din40bswsfcy` | `prompted` | `aziz-m2-v1` | 37 | 37 | 229.38 с | 1 | 1 | 1 | ❌ failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) |
| Вероника | `voice_jobdfz42xizz` | `prompted` | `veronika-f1-v1` | 42 | 42 | 215.15 с | 1 | 1 | 1 | ✅ ok |

- **Итого TTS вызовов (`gemini-3.8-flash-tts`):** **2** (цель: ровно 2, автоповторов: 0)
- **Итого Alignment вызовов (`gemini-4-hydrogen`):** **2**
- **Итого Identity QA вызовов (`gemini-4-hydrogen`):** **2**
- **Аудит чистоты вызовов (проверено по перехваченным payload'ам):**
  - `Charon` / `Kore` / `prebuiltVoiceConfig` использовались: **НЕТ (подтверждено)**
  - `kie.ai` использовался: **НЕТ (подтверждено)**
  - `multiSpeakerVoiceConfig` использовался: **НЕТ (подтверждено)**
  - Переданные `voiceConfig`: `{"voice":"voice_jobdfz42xizz"}` (42 parts), `{"voice":"voice_din40bswsfcy"}` (37 parts)

## 2. Voice Identity QA (`gemini-4-hydrogen`: эталон `sample_audio` vs начало / середина / конец по 30с)

| Ведущий | voiceId | Начало (30с) | Середина (30с) | Конец (30с) | Дрейф | Уверенность | Вердикт | Пояснение |
|---|---|---|---|---|---|---:|---|---|
| Азиз | `voice_din40bswsfcy` | ✅ да | ✅ да | ✅ да | ✅ нет | 0.96 | ✅ PASS | Тембр голоса, резонанс и индивидуальные особенности диктора во всех трёх сегментах (начало, середина, конец) полностью совпадают с эталонным образцом. Смены диктора или заметного дрейфа голоса не обнаружено. |
| Вероника | `voice_jobdfz42xizz` | ✅ да | ✅ да | ✅ да | ✅ нет | 0.95 | ✅ PASS | Во всех трех сегментах (начало, середина, конец) звучит один и тот же женский голос, соответствующий эталонному образцу по тембру и резонансу. Небольшие эмоциональные интонационные изменения естественны для дубляжа и не указывают на смену диктора. |

## 3. Локальные акустические метрики (F0, центроид спектра, наклон, HNR, MFCC)

### Азиз (`voice_din40bswsfcy`, `aziz-m2-v1`)

| Отрезок | F0 медиана (P10–P90) | Центроид спектра | Наклон спектра | HNR proxy |
|---|---:|---:|---:|---:|
| beginning (0.0–30.0s) | 111.6 Hz (89.9–186.0) | 487.0 Hz | -10.49 dB | 0.568 |
| middle (99.7–129.7s) | 131.9 Hz (99.6–187.5) | 424.0 Hz | -12.59 dB | 0.616 |
| end (199.4–229.4s) | 118.8 Hz (92.7–155.8) | 353.0 Hz | -12.54 dB | 0.614 |

- MFCC-расстояние: начало↔середина = **5.41**, начало↔конец = **9.83**, середина↔конец = **8.77**

### Вероника (`voice_jobdfz42xizz`, `veronika-f1-v1`)

| Отрезок | F0 медиана (P10–P90) | Центроид спектра | Наклон спектра | HNR proxy |
|---|---:|---:|---:|---:|
| beginning (0.0–30.0s) | 216.2 Hz (160.0–296.3) | 573.0 Hz | -10.70 dB | 0.692 |
| middle (92.6–122.6s) | 205.1 Hz (152.9–282.4) | 581.0 Hz | -10.27 dB | 0.689 |
| end (185.2–215.2s) | 180.5 Hz (147.2–263.7) | 617.0 Hz | -9.34 dB | 0.673 |

- MFCC-расстояние: начало↔середина = **8.48**, начало↔конец = **6.05**, середина↔конец = **9.19**

## 4. Громкость (LUFS) и True Peak

- **Мастер-дорожка (`tiggo8-M2-F1-master.wav`):** длительность **512.00 с**, integrated loudness = **-18.19 LUFS**, sample peak = **-1.03 dBFS**, true peak (4×) = **-1.01 dBFS**
- **Обычные реплики (цель -18 LUFS):** 77 шт., среднее = **-17.99 LUFS** (мин -18.28, макс -16.95)
- **Тихие реплики `softly` (цель -21 LUFS):** 2 шт., среднее = **-21.00 LUFS**
- **Максимальный True Peak среди всех клипов:** **-1.01 dBFS** (✅ ≤ -1.0 dBFS)
- **Статистика QA/синхронизации:** ok=58, adjusted=21, overflow=0, qaOk=42, qaFailed=37, needsShorten=7

## 5. Полный список отправленных стилей (Safe Voice Lock Emotions)

| Отправленный `style` | Количество реплик |
|---|---:|
| `(пусто — нейтрально)` | 45 |
| `pleased` | 7 |
| `slightly curious` | 6 |
| `gently amused` | 4 |
| `smiling` | 3 |
| `pleasantly surprised` | 3 |
| `lightly excited` | 2 |
| `slightly doubtful` | 2 |
| `slightly concerned` | 2 |
| `gently reassuring` | 2 |
| `softly` | 2 |
| `warmly` | 1 |

## 6. Порепликовый отчёт QA, выравнивания, стилей и громкости (79 реплик)

| # | Таймкод | Ведущий | Отправленный `style` | Raw отрезок (с) | Найдено | Conf | Клип / Окно (с) | Сдвиг (с) | Sync | QA | LUFS до → после | True Peak | Метод |
|---:|---|---|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | 0.0–4.0 | Вероника | `lightly excited` | 0.00–2.81 | ✅ | 0.98 | 2.78 / 4.00 | +0.00 | ok | ok | -12.5 → -18.0 | -6.17 dBFS | transcribe_aligned |
| 2 | 4.0–6.0 | Азиз | `gently amused` | 0.00–1.92 | ✅ | 0.99 | 1.89 / 2.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -19.3 → -18.0 | -2.60 dBFS | transcribe_aligned |
| 3 | 18.0–20.0 | Азиз | `""` | 1.92–4.08 | ✅ | 0.99 | 1.92 / 2.00 | +0.00 | adjusted | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -18.8 → -18.1 | -1.20 dBFS | transcribe_aligned |
| 4 | 20.0–25.0 | Вероника | `smiling` | 3.14–8.63 | ✅ | 0.98 | 5.24 / 5.00 | +0.00 | ok | ok | -14.6 → -18.0 | -5.03 dBFS | transcribe_aligned |
| 5 | 34.0–39.0 | Азиз | `""` | 4.08–9.63 | ✅ | 0.99 | 4.94 / 5.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -17.4 → -18.0 | -1.94 dBFS | transcribe_aligned |
| 6 | 39.0–44.0 | Вероника | `slightly doubtful` | 14.29–19.66 | ✅ | 0.98 | 4.93 / 5.00 | +0.02 | ok | ok | -14.4 → -18.0 | -4.79 dBFS | transcribe_aligned |
| 7 | 44.0–51.0 | Азиз | `""` | 9.63–17.02 | ✅ | 0.99 | 6.38 / 7.00 | +0.03 | adjusted | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -16.7 → -18.0 | -2.50 dBFS | transcribe_aligned |
| 8 | 51.0–55.0 | Вероника | `slightly curious` | 19.66–23.98 | ✅ | 0.98 | 3.94 / 4.00 | +0.00 | ok | ok | -13.4 → -18.0 | -5.38 dBFS | transcribe_aligned |
| 9 | 55.0–61.0 | Азиз | `""` | 17.02–24.45 | ✅ | 0.99 | 5.91 / 6.00 | +0.02 | adjusted | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -18.5 → -18.1 | -1.20 dBFS | transcribe_aligned |
| 10 | 61.0–66.0 | Вероника | `""` | 23.98–29.11 | ✅ | 0.98 | 4.70 / 5.00 | +0.01 | ok | ok | -13.1 → -18.0 | -6.06 dBFS | transcribe_aligned |
| 11 | 66.0–71.0 | Азиз | `""` | 24.45–30.98 | ✅ | 0.99 | 5.03 / 5.00 | +0.00 | adjusted | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -18.8 → -18.1 | -1.20 dBFS | transcribe_aligned |
| 12 | 71.0–75.0 | Вероника | `""` | 29.11–33.16 | ✅ | 0.98 | 3.67 / 4.00 | +0.11 | adjusted | ok | -13.6 → -18.0 | -5.47 dBFS | transcribe_aligned |
| 13 | 75.0–79.0 | Азиз | `""` | 30.98–34.70 | ✅ | 0.99 | 3.17 / 4.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -17.2 → -18.0 | -2.43 dBFS | transcribe_aligned |
| 14 | 79.0–81.0 | Вероника | `""` | 33.16–35.13 | ✅ | 0.98 | 1.47 / 2.00 | +0.00 | ok | ok | -13.6 → -18.0 | -5.45 dBFS | transcribe_aligned |
| 15 | 81.0–89.0 | Азиз | `""` | 34.70–44.40 | ✅ | 0.99 | 7.98 / 8.00 | +0.00 | adjusted | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -18.8 → -18.0 | -1.19 dBFS | transcribe_aligned |
| 16 | 89.0–93.0 | Вероника | `pleased` | 35.13–39.47 | ✅ | 0.98 | 3.86 / 4.00 | +0.06 | adjusted | ok | -13.7 → -18.0 | -5.68 dBFS | transcribe_aligned |
| 17 | 93.0–98.0 | Вероника | `""` | 39.47–43.90 | ✅ | 0.98 | 4.10 / 5.00 | +0.01 | ok | ok | -13.3 → -18.0 | -6.04 dBFS | transcribe_aligned |
| 18 | 98.0–118.0 | Азиз | `""` | 44.40–60.06 | ✅ | 0.99 | 15.17 / 20.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -19.0 → -18.0 | -1.19 dBFS | transcribe_aligned |
| 19 | 118.0–122.0 | Вероника | `""` | 43.90–47.26 | ✅ | 0.98 | 2.93 / 4.00 | +0.00 | ok | ok | -13.4 → -18.0 | -5.53 dBFS | transcribe_aligned |
| 20 | 122.0–131.0 | Азиз | `""` | 60.06–68.78 | ✅ | 0.99 | 8.21 / 9.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -18.9 → -18.0 | -1.18 dBFS | transcribe_aligned |
| 21 | 131.0–133.0 | Вероника | `slightly curious` | 47.26–48.97 | ✅ | 0.98 | 1.27 / 2.00 | +0.00 | ok | ok | -14.2 → -18.0 | -5.25 dBFS | transcribe_aligned |
| 22 | 133.0–135.0 | Азиз | `""` | 68.78–71.03 | ✅ | 0.99 | 1.38 / 2.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -19.7 → -18.0 | -2.68 dBFS | transcribe_aligned |
| 23 | 135.0–140.0 | Вероника | `""` | 48.97–55.85 | ✅ | 0.98 | 5.55 / 5.00 | +0.00 | adjusted | ok | -12.4 → -18.0 | -6.26 dBFS | transcribe_aligned |
| 24 | 140.0–142.0 | Азиз | `""` | 71.03–73.44 | ✅ | 0.99 | 1.69 / 2.00 | +0.64 | adjusted | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -17.7 → -18.0 | -2.93 dBFS | transcribe_aligned |
| 25 | 142.0–150.0 | Вероника | `pleased` | 55.85–65.45 | ✅ | 0.98 | 8.01 / 8.00 | +0.41 | adjusted | ok | -14.6 → -18.0 | -4.43 dBFS | transcribe_aligned |
| 26 | 150.0–155.0 | Азиз | `""` | 73.44–77.38 | ✅ | 0.99 | 3.23 / 5.00 | +0.50 | adjusted | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -17.7 → -18.0 | -2.18 dBFS | transcribe_aligned |
| 27 | 155.0–159.0 | Вероника | `slightly concerned` | 65.45–68.89 | ✅ | 0.98 | 2.80 / 4.00 | +0.00 | ok | ok | -14.3 → -18.0 | -4.59 dBFS | transcribe_aligned |
| 28 | 159.0–168.0 | Азиз | `gently reassuring` | 77.38–86.00 | ✅ | 0.99 | 8.11 / 9.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -17.8 → -18.0 | -2.11 dBFS | transcribe_aligned |
| 29 | 168.0–174.0 | Вероника | `slightly curious` | 68.89–75.42 | ✅ | 0.98 | 5.92 / 6.00 | +0.00 | adjusted | ok | -15.1 → -18.0 | -4.13 dBFS | transcribe_aligned |
| 30 | 174.0–186.0 | Азиз | `""` | 86.00–98.42 | ✅ | 0.99 | 11.62 / 12.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -18.6 → -18.0 | -1.25 dBFS | transcribe_aligned |
| 31 | 186.0–189.0 | Вероника | `pleasantly surprised` | 75.42–79.69 | ✅ | 0.98 | 3.31 / 3.00 | +0.00 | adjusted | ok | -14.5 → -18.0 | -4.66 dBFS | transcribe_aligned |
| 32 | 189.0–195.0 | Азиз | `""` | 98.42–104.88 | ✅ | 0.99 | 5.54 / 6.00 | +0.39 | adjusted | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -16.9 → -18.0 | -3.22 dBFS | transcribe_aligned |
| 33 | 195.0–201.0 | Вероника | `""` | 79.69–85.03 | ✅ | 0.98 | 4.81 / 6.00 | +0.01 | ok | ok | -14.4 → -18.0 | -4.37 dBFS | transcribe_aligned |
| 34 | 205.0–211.0 | Вероника | `""` | 85.03–89.81 | ✅ | 0.98 | 4.02 / 6.00 | +0.00 | ok | ok | -14.0 → -18.0 | -4.78 dBFS | transcribe_aligned |
| 35 | 211.0–217.0 | Азиз | `""` | 104.88–110.92 | ✅ | 0.99 | 5.29 / 6.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -17.1 → -18.0 | -2.67 dBFS | transcribe_aligned |
| 36 | 217.0–222.0 | Вероника | `pleasantly surprised` | 89.81–94.81 | ✅ | 0.98 | 4.85 / 5.00 | +0.00 | ok | ok | -15.5 → -18.0 | -3.85 dBFS | transcribe_aligned |
| 37 | 222.0–238.0 | Азиз | `""` | 110.92–124.22 | ✅ | 0.99 | 12.82 / 16.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -17.4 → -18.0 | -2.17 dBFS | transcribe_aligned |
| 38 | 238.0–242.0 | Вероника | `slightly curious` | 94.81–99.17 | ✅ | 0.98 | 3.92 / 4.00 | +0.00 | adjusted | ok | -13.8 → -18.0 | -5.52 dBFS | transcribe_aligned |
| 39 | 242.0–250.0 | Азиз | `""` | 124.22–130.25 | ✅ | 0.99 | 5.92 / 8.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -17.2 → -18.0 | -2.74 dBFS | transcribe_aligned |
| 40 | 250.0–256.0 | Вероника | `pleased` | 99.17–105.36 | ✅ | 0.98 | 5.57 / 6.00 | +0.00 | ok | ok | -13.3 → -18.0 | -5.67 dBFS | transcribe_aligned |
| 41 | 260.0–264.0 | Вероника | `slightly concerned` | 105.36–110.03 | ✅ | 0.98 | 3.92 / 4.00 | +0.00 | adjusted | ok | -15.7 → -18.0 | -4.14 dBFS | transcribe_aligned |
| 42 | 264.0–274.0 | Азиз | `""` | 130.25–137.35 | ✅ | 0.99 | 6.71 / 10.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -17.8 → -18.0 | -1.67 dBFS | transcribe_aligned |
| 43 | 275.0–280.0 | Вероника | `slightly curious` | 110.03–114.16 | ✅ | 0.98 | 3.30 / 5.00 | +0.00 | ok | ok | -15.1 → -18.0 | -3.85 dBFS | transcribe_aligned |
| 44 | 280.0–289.0 | Азиз | `""` | 137.35–144.38 | ✅ | 0.99 | 6.52 / 9.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -17.8 → -18.0 | -1.91 dBFS | transcribe_aligned |
| 45 | 289.0–296.0 | Вероника | `""` | 114.16–120.73 | ✅ | 0.98 | 5.94 / 7.00 | +0.00 | ok | ok | -14.5 → -18.0 | -4.37 dBFS | transcribe_aligned |
| 46 | 296.0–305.0 | Азиз | `""` | 144.38–151.81 | ✅ | 0.99 | 7.10 / 9.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -16.6 → -18.0 | -3.04 dBFS | transcribe_aligned |
| 47 | 305.0–311.0 | Вероника | `pleased` | 120.73–125.08 | ✅ | 0.98 | 3.86 / 6.00 | +0.00 | ok | ok | -17.8 → -18.0 | -3.57 dBFS | transcribe_aligned |
| 48 | 311.0–313.0 | Азиз | `pleased` | 151.81–153.94 | ✅ | 0.99 | 1.63 / 2.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -15.9 → -18.0 | -3.77 dBFS | transcribe_aligned |
| 49 | 313.0–319.0 | Вероника | `""` | 125.08–129.56 | ✅ | 0.98 | 3.89 / 6.00 | +0.00 | ok | ok | -14.3 → -18.0 | -4.80 dBFS | transcribe_aligned |
| 50 | 319.0–325.0 | Азиз | `""` | 153.94–158.85 | ✅ | 0.99 | 4.57 / 6.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -17.2 → -18.0 | -2.17 dBFS | transcribe_aligned |
| 51 | 325.0–330.0 | Вероника | `""` | 129.56–134.66 | ✅ | 0.98 | 4.35 / 5.00 | +0.00 | ok | ok | -19.8 → -18.3 | -1.20 dBFS | transcribe_aligned |
| 52 | 330.0–340.0 | Азиз | `""` | 158.85–168.22 | ✅ | 0.99 | 8.67 / 10.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -17.4 → -18.0 | -2.21 dBFS | transcribe_aligned |
| 53 | 340.0–350.0 | Вероника | `""` | 134.66–142.28 | ✅ | 0.98 | 7.18 / 10.00 | +0.00 | ok | ok | -17.6 → -18.0 | -1.86 dBFS | transcribe_aligned |
| 54 | 354.0–358.0 | Вероника | `""` | 142.28–146.13 | ✅ | 0.98 | 3.23 / 4.00 | +0.00 | ok | ok | -18.3 → -18.0 | -2.43 dBFS | transcribe_aligned |
| 55 | 358.0–363.0 | Азиз | `softly` | 168.22–172.00 | ✅ | 0.99 | 3.37 / 5.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -19.2 → -21.0 | -3.38 dBFS | transcribe_aligned |
| 56 | 363.0–371.0 | Вероника | `softly` | 146.13–153.96 | ✅ | 0.98 | 6.92 / 8.00 | +0.00 | ok | ok | -17.8 → -21.0 | -4.62 dBFS | transcribe_aligned |
| 57 | 375.0–381.0 | Вероника | `pleased` | 153.96–160.00 | ✅ | 0.98 | 5.66 / 6.00 | +0.00 | ok | ok | -18.2 → -18.0 | -1.32 dBFS | transcribe_aligned |
| 58 | 387.0–390.0 | Азиз | `""` | 172.00–175.28 | ✅ | 0.99 | 2.69 / 3.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -16.6 → -18.0 | -3.29 dBFS | transcribe_aligned |
| 59 | 390.0–393.0 | Вероника | `slightly doubtful` | 160.00–162.93 | ✅ | 0.98 | 2.48 / 3.00 | +0.00 | ok | ok | -15.4 → -18.0 | -2.29 dBFS | transcribe_aligned |
| 60 | 393.0–397.0 | Азиз | `""` | 175.28–179.47 | ✅ | 0.99 | 3.91 / 4.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -18.0 → -18.0 | -1.40 dBFS | transcribe_aligned |
| 61 | 397.0–401.0 | Вероника | `gently amused` | 162.93–168.50 | ✅ | 0.98 | 4.47 / 4.00 | +0.00 | adjusted | ok | -16.9 → -18.0 | -2.15 dBFS | transcribe_aligned |
| 62 | 401.0–406.0 | Азиз | `""` | 179.79–185.26 | ✅ | 0.99 | 4.38 / 5.00 | +0.55 | adjusted | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -16.1 → -18.0 | -3.09 dBFS | transcribe_aligned |
| 63 | 406.0–409.0 | Вероника | `slightly curious` | 169.39–172.25 | ✅ | 0.98 | 2.30 / 3.00 | +0.01 | ok | ok | -15.0 → -18.0 | -4.47 dBFS | transcribe_aligned |
| 64 | 409.0–413.0 | Азиз | `""` | 185.26–188.56 | ✅ | 0.99 | 2.42 / 4.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -16.6 → -18.0 | -3.08 dBFS | transcribe_aligned |
| 65 | 425.0–429.0 | Азиз | `smiling` | 188.56–192.71 | ✅ | 0.99 | 2.98 / 4.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -17.5 → -18.0 | -2.70 dBFS | transcribe_aligned |
| 66 | 429.0–435.0 | Вероника | `pleasantly surprised` | 172.25–179.79 | ✅ | 0.98 | 5.98 / 6.00 | +0.00 | adjusted | ok | -14.7 → -18.0 | -3.96 dBFS | transcribe_aligned |
| 67 | 435.0–444.0 | Азиз | `""` | 192.71–203.00 | ✅ | 0.99 | 8.87 / 9.00 | +0.07 | adjusted | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -18.4 → -18.0 | -1.20 dBFS | transcribe_aligned |
| 68 | 444.0–447.0 | Вероника | `""` | 179.79–182.93 | ✅ | 0.98 | 2.71 / 3.00 | +0.02 | ok | ok | -16.8 → -18.0 | -2.83 dBFS | transcribe_aligned |
| 69 | 447.0–452.0 | Азиз | `""` | 203.00–208.04 | ✅ | 0.99 | 4.26 / 5.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -18.8 → -18.0 | -1.01 dBFS | transcribe_aligned |
| 70 | 452.0–455.0 | Вероника | `gently amused` | 182.93–185.97 | ✅ | 0.98 | 2.19 / 3.00 | +0.00 | ok | ok | -14.3 → -18.0 | -5.02 dBFS | transcribe_aligned |
| 71 | 455.0–461.0 | Азиз | `gently reassuring` | 208.04–214.18 | ✅ | 0.99 | 5.18 / 6.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -17.6 → -18.0 | -3.02 dBFS | transcribe_aligned |
| 72 | 461.0–465.0 | Вероника | `pleased` | 185.97–190.59 | ✅ | 0.98 | 3.94 / 4.00 | +0.00 | ok | ok | -14.2 → -18.0 | -4.75 dBFS | transcribe_aligned |
| 73 | 474.0–477.0 | Вероника | `lightly excited` | 190.59–193.97 | ✅ | 0.98 | 2.56 / 3.00 | +0.00 | ok | ok | -13.9 → -18.0 | -5.61 dBFS | transcribe_aligned |
| 74 | 477.0–479.0 | Азиз | `gently amused` | 214.18–217.24 | ✅ | 0.99 | 2.74 / 2.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -18.1 → -18.0 | -1.49 dBFS | transcribe_aligned |
| 75 | 480.0–491.0 | Вероника | `""` | 193.97–205.88 | ✅ | 0.98 | 10.91 / 11.00 | +0.00 | adjusted | ok | -16.3 → -18.0 | -3.01 dBFS | transcribe_aligned |
| 76 | 491.0–498.0 | Азиз | `""` | 217.74–224.69 | ✅ | 0.99 | 6.90 / 7.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -18.8 → -18.0 | -1.20 dBFS | transcribe_aligned |
| 77 | 498.0–506.0 | Вероника | `""` | 205.88–213.53 | ✅ | 0.98 | 7.02 / 8.00 | +0.00 | ok | ok | -16.2 → -18.0 | -2.22 dBFS | transcribe_aligned |
| 78 | 506.0–510.0 | Азиз | `warmly` | 225.50–229.38 | ✅ | 0.99 | 3.51 / 4.00 | +0.00 | ok | failed (clip_duration_ratio (turn 34: 2.73s vs exp 1.46s, ratio=1.88)) | -19.0 → -18.0 | -1.49 dBFS | transcribe_aligned |
| 79 | 510.0–512.0 | Вероника | `smiling` | 213.53–215.15 | ✅ | 0.98 | 0.79 / 2.00 | +0.00 | ok | ok | -13.4 → -16.9 | -4.76 dBFS | transcribe_aligned |

## 7. Сохранённые артефакты

- `public/audio/voice-lock-stage2/tiggo8-aziz-M2-raw.wav`
- `public/audio/voice-lock-stage2/tiggo8-veronika-F1-raw.wav`
- `public/audio/voice-lock-stage2/tiggo8-M2-F1-master.wav`
- `public/audio/voice-lock-stage2/report.md`
