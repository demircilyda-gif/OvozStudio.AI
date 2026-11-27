# Эксперимент 3 — Суб-блок №3 Tiggo 8 Hybrid v4 (технический текст, 03:25–04:49)

- **Дата прогона:** 2026-11-27T14:01:31.185Z
- **Сцена / суб-блок:** Суб-блок №3 (`4-SAHNA. Tog‘ yo‘li, rekuperatsiya, 540° kamera va yordamchilar`, 11 реплик, `03:25–04:49`, сумма окон `79 с`)
- **Параметры движка:** без изменений; `bypassCache: true`, `maxExtraTtsCalls: 0`, `strictTimeWindow: true`, словарь произношения включён, выравнивание громкости BS.1770-4 до `-18 LUFS`.
- **Базовые стили:** Азиз (M) = `warm, relaxed, friendly` | Вероника (F) = `lively, casual, friendly`
- **Итого API-вызовов:** TTS (`gemini-3.8-flash-tts`) = **3**, выравниваний = **3** (повторы при ошибке API: 0).
- **Таймкоды в WAV:** суб-блоки №2 и №3 сдвинуты к `00:00` (`exp3-ref-sb2.wav`: сдвиг `-01:33`, граница `02:30` звучит на `00:57`; `exp3-A/B/C`: сдвиг `-03:25`) с полным сохранением всех интервалов и пауз между репликами.

## Файлы для прослушивания

| Файл | Описание | Размер / Длина | QA | Вызовы TTS / Выравнивание |
|---|---|---|---|---|
| `/audio/experiments/exp3-ref-sb1.wav` | Референс: Суб-блок №1 (`00:00–01:33`, 16 реплик). Скопировано из `exp2-A-kore.wav` (в серверном кэше `data/dubbing-block-cache/` файл суб-блока №1 `cb8c86f1178206250d23b7b0.json` отсутствует; `exp2-A-kore.wav` — идентичный суб-блок №1, Charon + Kore, эмоции ВКЛ, -18 LUFS) | 4.30 MB | ref | 0 (из файла) |
| `/audio/experiments/exp3-ref-sb2.wav` | Референс: Суб-блок №2 из текущей полной озвучки (`01:33–03:21`, 17 реплик, `Charon + Kore`, эмоции ВКЛ, кэш `31074d9bd79c89ccd54a3b91.json`; точка `02:30` = `00:57` в WAV) | 5.04 MB, 110.0s | ok | 0 (из кэша) |
| `/audio/experiments/exp3-A-kore-noemo.wav` | **Variant A (Charon + Kore, эмоции ВЫКЛ)** (`03:25–04:49`, 11 реплик) | 3.89 MB, 85.0s | **11/11** | 1 (16.8s) / 1 (10.1s) |
| `/audio/experiments/exp3-B-aoede.wav` | **Variant B (Charon + Aoede, эмоции ВКЛ)** (`03:25–04:49`, 11 реплик) | 3.89 MB, 85.0s | **11/11** | 1 (16.0s) / 1 (10.2s) |
| `/audio/experiments/exp3-C-zephyr.wav` | **Variant C (Charon + Zephyr, эмоции ВКЛ)** (`03:25–04:49`, 11 реплик) | 3.89 MB, 85.0s | **11/11** | 1 (17.7s) / 1 (10.7s) |

## Сводное сравнение акустики (проверка гипотезы «тяжёлого голоса»)

> **Ориентиры:** более **лёгкий/разговорный** голос обычно имеет более высокий центроид спектра (Гц), менее отрицательный наклон спектра (дБ), более высокую F0 (для женского голоса) и меньшую MFCC-дистанцию до `ref-sb1` / `ref-sb2 (до 02:30)`.

### Азиз (Charon во всех вариантах)

| Участок / Вариант | Реплик | Медиана F0 (диапазон) | Средний центроид (яркость) | Наклон спектра | HNR | Средний LUFS до | MFCC до SB1 | MFCC до SB2 (<02:30) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ref-sb1 (00:00–01:33, Charon+Kore, эмо ВКЛ) | 8 | 132 Гц (110–179) | 491 Гц | -10.4 дБ | 0.56 | — | 0.0 | 12.8 |
| ref-sb2 ДО 02:30 (01:33–02:30, Charon+Kore) | 4 | 117 Гц (99–127) | 702 Гц | -9.2 дБ | 0.50 | -18.7 LUFS | 12.8 | 0.0 |
| ref-sb2 ПОСЛЕ 02:30 (02:30–03:21, Charon+Kore) | 4 | 128 Гц (122–137) | 531 Гц | -11.1 дБ | 0.60 | -17.2 LUFS | 9.5 | 18.0 |
| ref-sb3 ТЕКУЩАЯ (03:25–04:49, Charon+Kore, эмо ВКЛ) | 5 | 119 Гц (114–140) | 486 Гц | -11.7 дБ | 0.58 | -15.9 LUFS | 8.4 | 19.2 |
| exp3-A (Charon+Kore, эмо ВЫКЛ) | 5 | 131 Гц (110–134) | 553 Гц | -9.2 дБ | 0.55 | -17.9 LUFS | 6.6 | 16.8 |
| exp3-B (Charon+Aoede, эмо ВКЛ) | 5 | 128 Гц (126–139) | 554 Гц | -9.9 дБ | 0.57 | -17.7 LUFS | 10.8 | 22.0 |
| exp3-C (Charon+Zephyr, эмо ВКЛ) | 5 | 124 Гц (105–136) | 485 Гц | -11.2 дБ | 0.59 | -19.3 LUFS | 12.4 | 23.6 |

### Вероника (Kore / Aoede / Zephyr)

| Участок / Вариант | Реплик | Медиана F0 (диапазон) | Средний центроид (яркость) | Наклон спектра | HNR | Средний LUFS до | MFCC до SB1 | MFCC до SB2 (<02:30) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ref-sb1 (00:00–01:33, Charon+Kore, эмо ВКЛ) | 8 | 201 Гц (182–231) | 592 Гц | -10.5 дБ | 0.64 | — | 0.0 | 5.1 |
| ref-sb2 ДО 02:30 (01:33–02:30, Charon+Kore) | 5 | 192 Гц (183–231) | 664 Гц | -9.5 дБ | 0.67 | -17.1 LUFS | 5.1 | 0.0 |
| ref-sb2 ПОСЛЕ 02:30 (02:30–03:21, Charon+Kore) | 4 | 183 Гц (172–192) | 740 Гц | -10.2 дБ | 0.66 | -14.7 LUFS | 5.3 | 5.3 |
| ref-sb3 ТЕКУЩАЯ (03:25–04:49, Charon+Kore, эмо ВКЛ) | 6 | 186 Гц (173–203) | 620 Гц | -9.8 дБ | 0.68 | -15.0 LUFS | 5.0 | 5.9 |
| exp3-A (Charon+Kore, эмо ВЫКЛ) | 6 | 202 Гц (167–229) | 543 Гц | -11.5 дБ | 0.70 | -16.8 LUFS | 5.9 | 7.0 |
| exp3-B (Charon+Aoede, эмо ВКЛ) | 6 | 187 Гц (162–205) | 581 Гц | -11.8 дБ | 0.63 | -17.7 LUFS | 8.9 | 12.1 |
| exp3-C (Charon+Zephyr, эмо ВКЛ) | 6 | 205 Гц (194–215) | 534 Гц | -12.9 дБ | 0.73 | -20.0 LUFS | 11.4 | 13.2 |

## Эксперимент 3 — Variant A (Charon + Kore, эмоции ВЫКЛ)

WAV: `/audio/experiments/exp3-A-kore-noemo.wav` (сдвиг `-03:25`). QA: **11/11**, TTS: 1 (16.80s), выравнивание: 1 (10.07s).

| # | Спикер | Таймкод | В WAV | Клип/Окно | QA | F0 (Гц / полут.) | Центроид (яркость) | Наклон | LUFS до → после | Отправленный style | Отправленный текст |
|---:|---|---|---|---|---|---:|---:|---:|---|---|---|
| 01 | Вероника | 03:25–03:31 | 00:00.00–00:04.55 | 4.55s/6.0s | ok | 229 Гц (+2.1 st) | 508 Гц | -12.1 дБ | -15.2 → -18.0 | `lively, casual, friendly` | Qara, ikkalamiz tepalikka chiqyapmiz. Elektr motor bu yerda yordam beradimi? |
| 02 | Азиз | 03:31–03:37 | 00:06.00–00:11.92 | 5.92s/6.0s | ok | 133 Гц (+0.3 st) | 499 Гц | -10.3 дБ | -17.6 → -18.0 | `warm, relaxed, friendly` | Yordam beradi. Elektr motorda uch yuz o'n nyuton-metr moment bor — tortish darhol seziladi. |
| 03 | Вероника | 03:37–03:42 | 00:12.00–00:16.93 | 4.93s/5.0s | ok | 175 Гц (-2.5 st) | 468 Гц | -14.2 дБ | -17.8 → -18.0 | `lively, casual, friendly` | Voy-bo'! Mashina juda tekis va yumshoq ketyapti. Privodi qanaqa? |
| 04 | Азиз | 03:42–03:58 | 00:17.01–00:30.86 | 13.85s/16.0s | ok | 134 Гц (+0.4 st) | 531 Гц | -9.7 дБ | -18.9 → -18.0 | `warm, relaxed, friendly` | Oldi privod. Bugungi yo'nalishimiz — asfalt va maydonchaga oddiy chiqish. Bu mashina aynan shunday yo'llar uchun yaratilgan. Agar to'liq privod va tuproq tepalik kerak bo'lsa, u Tiggo to'qqiz gibrid — u haqida alohida sonimiz bor. |
| 05 | Вероника | 03:58–04:02 | 00:33.00–00:35.82 | 2.82s/4.0s | ok | 186 Гц (-1.4 st) | 597 Гц | -11.6 дБ | -17.4 → -18.0 | `lively, casual, friendly` | Mashina pastga tushganda o'zi zaryadlanishi rostmi? |
| 06 | Азиз | 04:02–04:10 | 00:37.00–00:43.09 | 6.09s/8.0s | ok | 122 Гц (-1.3 st) | 549 Гц | -10.3 дБ | -18.6 → -18.0 | `warm, relaxed, friendly` | Rost. Mashina sekinlashganda elektr energiyasining bir qismi batareyaga qaytadi. Bu rekuperatsiya deyiladi. |
| 07 | Вероника | 04:10–04:16 | 00:45.00–00:50.45 | 5.45s/6.0s | ok | 218 Гц (+1.3 st) | 454 Гц | -14.2 дБ | -17.4 → -18.0 | `lively, casual, friendly` | Voy, menga yoqdi! Sen pastga tushyapsan, mashina esa o'zini zaryadlayapti. Zo'r ekan! |
| 08 | Вероника | 04:20–04:24 | 00:55.00–00:58.63 | 3.63s/4.0s | ok | 226 Гц (+2.0 st) | 534 Гц | -9.5 дБ | -17.2 → -18.0 | `lively, casual, friendly` | Bu yer tor, bir tomonida toshlar bor. Qanday qayrilib olamiz? |
| 09 | Азиз | 04:24–04:34 | 00:59.00–01:07.10 | 8.10s/10.0s | ok | 131 Гц (+0.0 st) | 571 Гц | -8.1 дБ | -17.2 → -18.0 | `warm, relaxed, friendly` | Oson. besh yuz qirq darajali kamera mashina atrofini ham, tagini ham ko'rsatib turadi. Men monitorga va yon-atrofga qarayman. |
| 10 | Вероника | 04:35–04:40 | 01:10.00–01:13.65 | 3.65s/5.0s | ok | 167 Гц (-3.3 st) | 701 Гц | -7.3 дБ | -15.8 → -18.0 | `lively, casual, friendly` | Trassada, uzoq yo'lda masofani ushlaydigan yordamchi bormi? |
| 11 | Азиз | 04:40–04:49 | 01:15.00–01:23.19 | 8.19s/9.0s | ok | 110 Гц (-3.1 st) | 615 Гц | -7.7 дБ | -17.1 → -18.0 | `warm, relaxed, friendly` | Premium komplektatsiyasida bor: adaptiv kruiz-kontrol va polosada ushlab turish. Ular yordam beradi, lekin yo'lga baribir haydovchi qaraydi. |

## Эксперимент 3 — Variant B (Charon + Aoede, эмоции ВКЛ)

WAV: `/audio/experiments/exp3-B-aoede.wav` (сдвиг `-03:25`). QA: **11/11**, TTS: 1 (15.98s), выравнивание: 1 (10.20s).

| # | Спикер | Таймкод | В WAV | Клип/Окно | QA | F0 (Гц / полут.) | Центроид (яркость) | Наклон | LUFS до → после | Отправленный style | Отправленный текст |
|---:|---|---|---|---|---|---:|---:|---:|---|---|---|
| 01 | Вероника | 03:25–03:31 | 00:00.00–00:04.45 | 4.45s/6.0s | ok | 197 Гц (+0.9 st) | 615 Гц | -11.4 дБ | -16.3 → -18.0 | `lively, casual, friendly` | Qara, ikkalamiz tepalikka chiqyapmiz. Elektr motor bu yerda yordam beradimi? |
| 02 | Азиз | 03:31–03:37 | 00:06.00–00:11.64 | 5.64s/6.0s | ok | 133 Гц (+0.6 st) | 554 Гц | -10.8 дБ | -17.2 → -18.0 | `warm, relaxed, friendly` | Yordam beradi. Elektr motorda uch yuz o'n nyuton-metr moment bor — tortish darhol seziladi. |
| 03 | Вероника | 03:37–03:42 | 00:12.00–00:17.13 | 5.13s/5.0s | ok | 169 Гц (-1.8 st) | 570 Гц | -11.5 дБ | -18.2 → -18.0 | `lively, casual, friendly, surprised` | Voy-bo'! Mashina juda tekis va yumshoq ketyapti. Privodi qanaqa? |
| 04 | Азиз | 03:42–03:58 | 00:17.21–00:30.33 | 13.12s/16.0s | ok | 139 Гц (+1.3 st) | 584 Гц | -9.4 дБ | -18.0 → -18.0 | `warm, relaxed, friendly` | Oldi privod. Bugungi yo'nalishimiz — asfalt va maydonchaga oddiy chiqish. Bu mashina aynan shunday yo'llar uchun yaratilgan. Agar to'liq privod va tuproq tepalik kerak bo'lsa, u Tiggo to'qqiz gibrid — u haqida alohida sonimiz bor. |
| 05 | Вероника | 03:58–04:02 | 00:33.00–00:35.75 | 2.75s/4.0s | ok | 194 Гц (+0.6 st) | 711 Гц | -9.6 дБ | -17.4 → -18.0 | `lively, casual, friendly, curious` | Mashina pastga tushganda o'zi zaryadlanishi rostmi? |
| 06 | Азиз | 04:02–04:10 | 00:37.00–00:42.88 | 5.88s/8.0s | ok | 126 Гц (-0.3 st) | 548 Гц | -10.0 дБ | -18.3 → -18.0 | `warm, relaxed, friendly` | Rost. Mashina sekinlashganda elektr energiyasining bir qismi batareyaga qaytadi. Bu rekuperatsiya deyiladi. |
| 07 | Вероника | 04:10–04:16 | 00:45.00–00:51.49 | 6.49s/6.0s | ok | 205 Гц (+1.6 st) | 563 Гц | -11.4 дБ | -17.3 → -18.0 | `lively, casual, friendly, delighted` | Voy, menga yoqdi! Sen pastga tushyapsan, mashina esa o'zini zaryadlayapti. Zo'r ekan! |
| 08 | Вероника | 04:20–04:24 | 00:55.00–00:58.69 | 3.69s/4.0s | ok | 162 Гц (-2.5 st) | 485 Гц | -13.2 дБ | -19.4 → -18.1 | `lively, casual, friendly, worried` | Bu yer tor, bir tomonida toshlar bor. Qanday qayrilib olamiz? |
| 09 | Азиз | 04:24–04:34 | 00:59.00–01:05.96 | 6.96s/10.0s | ok | 128 Гц (-0.1 st) | 594 Гц | -8.3 дБ | -17.9 → -18.0 | `warm, relaxed, friendly` | Oson. besh yuz qirq darajali kamera mashina atrofini ham, tagini ham ko'rsatib turadi. Men monitorga va yon-atrofga qarayman. |
| 10 | Вероника | 04:35–04:40 | 01:10.00–01:13.24 | 3.24s/5.0s | ok | 180 Гц (-0.6 st) | 541 Гц | -13.7 дБ | -17.5 → -18.0 | `lively, casual, friendly, curious` | Trassada, uzoq yo'lda masofani ushlaydigan yordamchi bormi? |
| 11 | Азиз | 04:40–04:49 | 01:15.00–01:22.55 | 7.55s/9.0s | ok | 128 Гц (+0.0 st) | 490 Гц | -11.2 дБ | -17.3 → -18.0 | `warm, relaxed, friendly` | Premium komplektatsiyasida bor: adaptiv kruiz-kontrol va polosada ushlab turish. Ular yordam beradi, lekin yo'lga baribir haydovchi qaraydi. |

## Эксперимент 3 — Variant C (Charon + Zephyr, эмоции ВКЛ)

WAV: `/audio/experiments/exp3-C-zephyr.wav` (сдвиг `-03:25`). QA: **11/11**, TTS: 1 (17.72s), выравнивание: 1 (10.70s).

| # | Спикер | Таймкод | В WAV | Клип/Окно | QA | F0 (Гц / полут.) | Центроид (яркость) | Наклон | LUFS до → после | Отправленный style | Отправленный текст |
|---:|---|---|---|---|---|---:|---:|---:|---|---|---|
| 01 | Вероника | 03:25–03:31 | 00:00.00–00:04.43 | 4.43s/6.0s | ok | 202 Гц (-0.3 st) | 687 Гц | -10.5 дБ | -17.5 → -18.0 | `lively, casual, friendly` | Qara, ikkalamiz tepalikka chiqyapmiz. Elektr motor bu yerda yordam beradimi? |
| 02 | Азиз | 03:31–03:37 | 00:06.00–00:11.46 | 5.46s/6.0s | ok | 105 Гц (-2.8 st) | 453 Гц | -12.3 дБ | -20.5 → -18.2 | `warm, relaxed, friendly` | Yordam beradi. Elektr motorda uch yuz o'n nyuton-metr moment bor — tortish darhol seziladi. |
| 03 | Вероника | 03:37–03:42 | 00:12.00–00:16.64 | 4.64s/5.0s | ok | 215 Гц (+0.8 st) | 403 Гц | -14.9 дБ | -21.1 → -18.0 | `lively, casual, friendly, surprised` | Voy-bo'! Mashina juda tekis va yumshoq ketyapti. Privodi qanaqa? |
| 04 | Азиз | 03:42–03:58 | 00:17.00–00:31.26 | 14.26s/16.0s | ok | 124 Гц (+0.0 st) | 493 Гц | -10.8 дБ | -20.7 → -18.1 | `warm, relaxed, friendly` | Oldi privod. Bugungi yo'nalishimiz — asfalt va maydonchaga oddiy chiqish. Bu mashina aynan shunday yo'llar uchun yaratilgan. Agar to'liq privod va tuproq tepalik kerak bo'lsa, u Tiggo to'qqiz gibrid — u haqida alohida sonimiz bor. |
| 05 | Вероника | 03:58–04:02 | 00:33.00–00:35.81 | 2.81s/4.0s | ok | 194 Гц (-1.0 st) | 663 Гц | -12.1 дБ | -20.3 → -18.0 | `lively, casual, friendly, curious` | Mashina pastga tushganda o'zi zaryadlanishi rostmi? |
| 06 | Азиз | 04:02–04:10 | 00:37.00–00:43.61 | 6.61s/8.0s | ok | 136 Гц (+1.7 st) | 508 Гц | -11.9 дБ | -21.0 → -18.1 | `warm, relaxed, friendly` | Rost. Mashina sekinlashganda elektr energiyasining bir qismi batareyaga qaytadi. Bu rekuperatsiya deyiladi. |
| 07 | Вероника | 04:10–04:16 | 00:45.00–00:50.73 | 5.73s/6.0s | ok | 214 Гц (+0.8 st) | 457 Гц | -13.0 дБ | -21.3 → -18.0 | `lively, casual, friendly, delighted` | Voy, menga yoqdi! Sen pastga tushyapsan, mashina esa o'zini zaryadlayapti. Zo'r ekan! |
| 08 | Вероника | 04:20–04:24 | 00:55.00–00:58.94 | 3.94s/4.0s | ok | 197 Гц (-0.7 st) | 506 Гц | -12.4 дБ | -21.5 → -18.0 | `lively, casual, friendly, worried` | Bu yer tor, bir tomonida toshlar bor. Qanday qayrilib olamiz? |
| 09 | Азиз | 04:24–04:34 | 00:59.02–01:06.66 | 7.64s/10.0s | ok | 111 Гц (-1.9 st) | 532 Гц | -9.8 дБ | -17.8 → -18.0 | `warm, relaxed, friendly` | Oson. besh yuz qirq darajali kamera mashina atrofini ham, tagini ham ko'rsatib turadi. Men monitorga va yon-atrofga qarayman. |
| 10 | Вероника | 04:35–04:40 | 01:10.00–01:13.23 | 3.23s/5.0s | ok | 209 Гц (+0.3 st) | 486 Гц | -14.7 дБ | -18.4 → -18.0 | `lively, casual, friendly, curious` | Trassada, uzoq yo'lda masofani ushlaydigan yordamchi bormi? |
| 11 | Азиз | 04:40–04:49 | 01:15.00–01:22.82 | 7.82s/9.0s | ok | 132 Гц (+1.1 st) | 441 Гц | -11.4 дБ | -16.4 → -18.0 | `warm, relaxed, friendly` | Premium komplektatsiyasida bor: adaptiv kruiz-kontrol va polosada ushlab turish. Ular yordam beradi, lekin yo'lga baribir haydovchi qaraydi. |

## Референс: текущий Суб-блок №3 из полной озвучки (Charon + Kore, эмоции ВКЛ)

Кэш: `data/dubbing-block-cache/4f71470482f2487da3664117.json` (0 вызовов TTS).

| # | Спикер | Таймкод | В WAV | Клип/Окно | QA | F0 (Гц / полут.) | Центроид (яркость) | Наклон | LUFS до → после | Отправленный style | Отправленный текст |
|---:|---|---|---|---|---|---:|---:|---:|---|---|---|
| 01 | Вероника | 03:25–03:31 | 00:00.00–00:04.61 | 4.61s/6.0s | ok | 194 Гц (+0.7 st) | 628 Гц | -9.0 дБ | -16.2 → -18.0 | `lively, casual, friendly` | Qara, ikkalamiz tepalikka chiqyapmiz. Elektr motor bu yerda yordam beradimi? |
| 02 | Азиз | 03:31–03:37 | 00:06.00–00:11.61 | 5.61s/6.0s | ok | 114 Гц (-0.7 st) | 403 Гц | -14.4 дБ | -14.6 → -18.0 | `warm, relaxed, friendly` | Yordam beradi. Elektr motorda uch yuz o'n nyuton-metr moment bor — tortish darhol seziladi. |
| 03 | Вероника | 03:37–03:42 | 00:12.00–00:17.02 | 5.02s/5.0s | ok | 173 Гц (-1.2 st) | 567 Гц | -10.2 дБ | -15.8 → -18.0 | `lively, casual, friendly, surprised` | Voy-bo'! Mashina juda tekis va yumshoq ketyapti. Privodi qanaqa? |
| 04 | Азиз | 03:42–03:58 | 00:17.10–00:30.85 | 13.75s/16.0s | ok | 123 Гц (+0.6 st) | 461 Гц | -12.0 дБ | -16.0 → -18.0 | `warm, relaxed, friendly` | Oldi privod. Bugungi yo'nalishimiz — asfalt va maydonchaga oddiy chiqish. Bu mashina aynan shunday yo'llar uchun yaratilgan. Agar to'liq privod va tuproq tepalik kerak bo'lsa, u Tiggo to'qqiz gibrid — u haqida alohida sonimiz bor. |
| 05 | Вероника | 03:58–04:02 | 00:33.00–00:35.91 | 2.91s/4.0s | ok | 203 Гц (+1.6 st) | 667 Гц | -9.7 дБ | -13.7 → -18.0 | `lively, casual, friendly, curious` | Mashina pastga tushganda o'zi zaryadlanishi rostmi? |
| 06 | Азиз | 04:02–04:10 | 00:37.00–00:43.27 | 6.27s/8.0s | ok | 117 Гц (-0.3 st) | 440 Гц | -12.6 дБ | -16.9 → -18.0 | `warm, relaxed, friendly` | Rost. Mashina sekinlashganda elektr energiyasining bir qismi batareyaga qaytadi. Bu rekuperatsiya deyiladi. |
| 07 | Вероника | 04:10–04:16 | 00:45.00–00:50.97 | 5.97s/6.0s | ok | 178 Гц (-0.8 st) | 621 Гц | -9.7 дБ | -15.1 → -18.0 | `lively, casual, friendly, delighted` | Voy, menga yoqdi! Sen pastga tushyapsan, mashina esa o'zini zaryadlayapti. Zo'r ekan! |
| 08 | Вероника | 04:20–04:24 | 00:55.00–00:58.68 | 3.68s/4.0s | ok | 202 Гц (+1.4 st) | 561 Гц | -11.8 дБ | -14.6 → -18.0 | `lively, casual, friendly, worried` | Bu yer tor, bir tomonida toshlar bor. Qanday qayrilib olamiz? |
| 09 | Азиз | 04:24–04:34 | 00:59.00–01:06.49 | 7.49s/10.0s | ok | 140 Гц (+2.8 st) | 636 Гц | -8.9 дБ | -15.6 → -18.0 | `warm, relaxed, friendly` | Oson. besh yuz qirq darajali kamera mashina atrofini ham, tagini ham ko'rsatib turadi. Men monitorga va yon-atrofga qarayman. |
| 10 | Вероника | 04:35–04:40 | 01:10.00–01:13.40 | 3.40s/5.0s | ok | 178 Гц (-0.8 st) | 675 Гц | -8.3 дБ | -14.7 → -18.0 | `lively, casual, friendly, curious` | Trassada, uzoq yo'lda masofani ushlaydigan yordamchi bormi? |
| 11 | Азиз | 04:40–04:49 | 01:15.00–01:22.55 | 7.55s/9.0s | ok | 119 Гц (+0.0 st) | 491 Гц | -10.4 дБ | -16.3 → -18.0 | `warm, relaxed, friendly` | Premium komplektatsiyasida bor: adaptiv kruiz-kontrol va polosada ushlab turish. Ular yordam beradi, lekin yo'lga baribir haydovchi qaraydi. |

## Референс: Суб-блок №2 из текущей полной озвучки (exp3-ref-sb2.wav)

WAV: `/audio/experiments/exp3-ref-sb2.wav` (сдвиг `-01:33`, кэш `31074d9bd79c89ccd54a3b91.json`, 0 вызовов TTS). Переломный момент `02:30` = реплика #10 (`00:57` в WAV).

| # | Спикер | Таймкод | В WAV | Клип/Окно | QA | F0 (Гц / полут.) | Центроид (яркость) | Наклон | LUFS до → после | Отправленный style | Отправленный текст |
|---:|---|---|---|---|---|---:|---:|---:|---|---|---|
| 01 | Вероника | 01:33–01:38 | 00:00.00–00:04.33 | 4.33s/5.0s | ok | 231 Гц (+3.6 st) | 472 Гц | -12.1 дБ | -15.9 → -18.0 | `lively, casual, friendly` | Endi oddiy tilda tushuntir: benzin motor nima qiladi, elektr motor-chi? |
| 02 | Азиз | 01:38–01:58 | 00:05.00–00:21.21 | 16.21s/20.0s | ok | 127 Гц (+0.5 st) | 523 Гц | -9.9 дБ | -17.8 → -18.0 | `warm, relaxed, friendly` | Bu zaryadlanadigan gibrid. Chery'da tizim CSH — Chery Super gibrid deyiladi. bir butun besh litrli turbo motor va unga juft elektr motor bor. Bularni 1DHT transmissiyasi bog'laydi. Akkumulyatorni tashqi stansiyadan ham zaryadlash mumkin. |
| 03 | Вероника | 01:58–02:02 | 00:25.00–00:27.96 | 2.96s/4.0s | ok | 231 Гц (+3.6 st) | 704 Гц | -8.4 дБ | -17.6 → -18.0 | `lively, casual, friendly` | Demak, qaysi motor ishlashini o'zim tanlashim kerakmi? |
| 04 | Азиз | 02:02–02:11 | 00:29.00–00:37.78 | 8.78s/9.0s | ok | 111 Гц (-1.9 st) | 498 Гц | -9.6 дБ | -18.8 → -18.0 | `warm, relaxed, friendly` | Shart emas. Ikkita rejim bor: EV elektr, HEV gibrid. Mashina zaryad va yuklamaga qarab qaysi rejimda yurishni o'zi hal qiladi. |
| 05 | Вероника | 02:11–02:13 | 00:38.00–00:39.44 | 1.44s/2.0s | ok | 188 Гц (+0.0 st) | 779 Гц | -8.6 дБ | -17.3 → -18.0 | `lively, casual, friendly, curious` | Ot kuchi qancha bu yerda? |
| 06 | Азиз | 02:13–02:15 | 00:40.00–00:41.38 | 1.38s/2.0s | ok | 124 Гц (+0.1 st) | 1077 Гц | -9.3 дБ | -19.8 → -18.1 | `warm, relaxed, friendly` | uch yuz qirq yetti ot kuchi. |
| 07 | Вероника | 02:15–02:20 | 00:42.00–00:47.32 | 5.32s/5.0s | ok | 192 Гц (+0.4 st) | 742 Гц | -8.9 дБ | -18.1 → -18.0 | `lively, casual, friendly` | Endi kundalik ishlarim: uy, ish, sportzal, do'kon. Benzinsiz qancha yuraman? |
| 08 | Азиз | 02:20–02:22 | 00:47.40–00:49.40 | 2.00s/2.0s | ok | 99 Гц (-3.9 st) | 708 Гц | -8.1 дБ | -18.4 → -18.0 | `warm, relaxed, friendly` | Elektrda to'qson besh kilometrgacha. |
| 09 | Вероника | 02:22–02:30 | 00:49.48–00:56.88 | 7.40s/8.0s | ok | 183 Гц (-0.4 st) | 623 Гц | -9.4 дБ | -16.8 → -18.0 | `lively, casual, friendly, happy` | Aha, demak ish kunlari elektrda yurishim mumkin, ikki kunga yetadi. Birinchi savolimga javob shu. Uzoq yo'lga chiqsam-chi? |
| 10 | Азиз | 02:30–02:35 | 00:57.00–01:01.59 | 4.59s/5.0s | ok | 133 Гц (+1.2 st) | 478 Гц | -12.2 дБ | -18.2 → -18.0 | `warm, relaxed, friendly` | To'la bak va to'liq zaryad bilan bir ming ikki yuz kilometrgacha yursa bo'ladi. |
| 11 | Вероника | 02:35–02:39 | 01:02.00–01:04.71 | 2.71s/4.0s | ok | 172 Гц (-1.5 st) | 739 Гц | -9.5 дБ | -13.7 → -18.0 | `lively, casual, friendly, worried` | Zaryadlash esimdan chiqib, yonimda rozetka bo'lmasa-chi? |
| 12 | Азиз | 02:39–02:48 | 01:06.00–01:14.36 | 8.36s/9.0s | ok | 122 Гц (-0.2 st) | 502 Гц | -11.1 дБ | -17.4 → -18.0 | `warm, relaxed, friendly, reassuring` | Hechqisi yo'q. Bakda benzin bor ekan, mashina gibrid rejimida yuraveradi. Uyda yo ishda muntazam zaryadlab tursang, ko'proq elektrda yurasan. |
| 13 | Вероника | 02:48–02:54 | 01:15.00–01:21.16 | 6.16s/6.0s | ok | 183 Гц (-0.4 st) | 671 Гц | -8.7 дБ | -14.7 → -18.0 | `lively, casual, friendly, curious` | Endi yana batareya haqida gaplashaylik. Bizda issiq, yomg'ir, suv bor — zarar qilmaydimi? |
| 14 | Азиз | 02:54–03:06 | 01:21.24–01:34.05 | 12.81s/12.0s | ok | 137 Гц (+1.8 st) | 537 Гц | -10.7 дБ | -16.6 → -18.0 | `warm, relaxed, friendly` | Batareya yaxshi himoyalangan: IP68 klassi, harorat nazorati bor. Chery Tiggo sakkiz CSH batareyasini sho'r suvda ellik uch soatdan ortiq sinagan — na suv kirishi, na qisqa tutashuv bo'lgan. |
| 15 | Вероника | 03:06–03:09 | 01:34.13–01:38.24 | 4.11s/3.0s | ok | 183 Гц (-0.5 st) | 941 Гц | -15.0 дБ | -15.0 → -18.0 | `lively, casual, friendly, surprised` | ellik uch soat?! Bu ikki sutkadan ham ko'p-ku! |
| 16 | Азиз | 03:09–03:15 | 01:38.32–01:45.05 | 6.73s/6.0s | ok | 123 Гц (-0.1 st) | 607 Гц | -10.4 дБ | -16.4 → -18.0 | `warm, relaxed, friendly` | Bu hali hammasi emas. Jizzaxda batareyani olovda sinashgan, harorat sakkiz yuz ellik darajaga yetgan. |
| 17 | Вероника | 03:15–03:21 | 01:45.13–01:50.01 | 4.88s/6.0s | ok | 192 Гц (+0.4 st) | 610 Гц | -7.8 дБ | -15.3 → -18.0 | `lively, casual, friendly` | Ha, demak suvdan ham, olovdan ham o'tgan ekan. Unda ko'nglim tinch. |

## Референс: Суб-блок №1 (exp3-ref-sb1.wav)

WAV: `/audio/experiments/exp3-ref-sb1.wav`. Скопировано из `exp2-A-kore.wav` (в серверном кэше `data/dubbing-block-cache/` файл суб-блока №1 `cb8c86f1178206250d23b7b0.json` отсутствует; `exp2-A-kore.wav` — идентичный суб-блок №1, Charon + Kore, эмоции ВКЛ, -18 LUFS).

| # | Спикер | Таймкод | В WAV | Клип/Окно | QA | F0 (Гц / полут.) | Центроид (яркость) | Наклон | LUFS до → после | Отправленный style | Отправленный текст |
|---:|---|---|---|---|---|---:|---:|---:|---|---|---|
| 01 | Вероника | 00:00–00:04 | 00:00.00–00:04.00 | 4.00s/4.0s | ref (exp2-A) | 231 Гц (+2.4 st) | 665 Гц | -9.0 дБ | — → -17.9 | `lively, casual, friendly, excited, amused` | Aytgandim-ku, baribir sendan o'zib ketaman deb! <laugh> |
| 02 | Азиз | 00:04–00:06 | 00:04.00–00:17.96 | 13.96s/2.0s | ref (exp2-A) | 130 Гц (-0.2 st) | 331 Гц | -10.3 дБ | — → -18.0 | `warm, relaxed, friendly, amused, inviting` | Qani, yana bir marta! <laugh> |
| 03 | Азиз | 00:18–00:20 | 00:18.00–00:20.00 | 2.00s/2.0s | ref (exp2-A) | 134 Гц (+0.2 st) | 469 Гц | -9.1 дБ | — → -20.4 | `warm, relaxed, friendly` | Hammaga salom, men Azizman. |
| 04 | Вероника | 00:20–00:25 | 00:20.00–00:33.96 | 13.96s/5.0s | ref (exp2-A) | 190 Гц (-0.9 st) | 588 Гц | -11.2 дБ | — → -18.3 | `lively, casual, friendly, smiling` | Men esa Veronika. Bugun biz bilan yetti o'rinli Tiggo sakkiz gibrid krossoveri. |
| 05 | Азиз | 00:34–00:39 | 00:34.00–00:39.00 | 5.00s/5.0s | ref (exp2-A) | 110 Гц (-3.2 st) | 560 Гц | -8.8 дБ | — → -18.1 | `warm, relaxed, friendly` | Rejamiz shunday: mashinani ko'ramiz, tog' yo'lida haydaymiz va zaryadkaga kiramiz. |
| 06 | Вероника | 00:39–00:44 | 00:39.00–00:44.00 | 5.00s/5.0s | ref (exp2-A) | 197 Гц (-0.4 st) | 679 Гц | -9.5 дБ | — → -18.2 | `lively, casual, friendly, doubtful, curious` | Avval bitta savol: benzinli mashina bor-ku, gibrid nega kerak? Tashvishi ko'p-ku. |
| 07 | Азиз | 00:44–00:51 | 00:44.00–00:51.00 | 7.00s/7.0s | ref (exp2-A) | 110 Гц (-3.2 st) | 540 Гц | -9.6 дБ | — → -18.0 | `warm, relaxed, friendly` | Javoblar bir nechta. Har qanday oilaviy safar boshlanadigan narsadan boshlaymiz: yo'lovchilar va yukdan. |
| 08 | Вероника | 00:51–00:55 | 00:51.00–00:55.00 | 4.00s/4.0s | ref (exp2-A) | 182 Гц (-1.7 st) | 672 Гц | -9.7 дБ | — → -18.1 | `lively, casual, friendly, curious` | Tashqaridan katta oilaviy krossover. Ichida uch qator bormi? |
| 09 | Азиз | 00:55–01:01 | 00:55.00–01:01.00 | 6.00s/6.0s | ref (exp2-A) | 121 Гц (-1.6 st) | 494 Гц | -11.5 дБ | — → -17.8 | `warm, relaxed, friendly` | Uch qator, yetti o'rin. Disklar o'n to'qqiz dyuym, bu Premium komplektatsiyasi. Luxury'da o'n sakkiz bo'ladi. |
| 10 | Вероника | 01:01–01:06 | 01:01.00–01:06.00 | 5.00s/5.0s | ref (exp2-A) | 224 Гц (+1.9 st) | 608 Гц | -11.4 дБ | — → -18.9 | `lively, casual, friendly` | Xo'p, qara. Gibrid bo'lsa, ichida batareya bor. U salondagi joyni toraytirmaydimi? |
| 11 | Азиз | 01:06–01:11 | 01:06.00–01:11.00 | 5.00s/5.0s | ref (exp2-A) | 158 Гц (+3.1 st) | 528 Гц | -9.4 дБ | — → -17.8 | `warm, relaxed, friendly` | Yo'q. Batareya pastda, kuzov tagida joylashgan. Shuning uchun salonda to'liq yetti o'rin bor. |
| 12 | Вероника | 01:11–01:15 | 01:11.00–01:15.00 | 4.00s/4.0s | ref (exp2-A) | 220 Гц (+1.6 st) | 501 Гц | -9.8 дБ | — → -17.9 | `lively, casual, friendly` | Endi yukxonadan gaplashaylik. Aytaylik, yetti kishi yo'lga chiqdik. |
| 13 | Азиз | 01:15–01:19 | 01:15.00–01:19.00 | 4.00s/4.0s | ref (exp2-A) | 179 Гц (+5.2 st) | 540 Гц | -12.9 дБ | — → -17.6 | `warm, relaxed, friendly` | Unda uchinchi qator ortida bir yuz to'qson uch litr joy qoladi. |
| 14 | Вероника | 01:19–01:21 | 01:19.00–01:21.00 | 2.00s/2.0s | ref (exp2-A) | 198 Гц (-0.2 st) | 600 Гц | -9.0 дБ | — → -19.0 | `lively, casual, friendly` | Agar besh kishi bo'lsak-chi? |
| 15 | Азиз | 01:21–01:29 | 01:21.00–01:29.00 | 8.00s/8.0s | ref (exp2-A) | 134 Гц (+0.2 st) | 468 Гц | -11.4 дБ | — → -18.2 | `warm, relaxed, friendly` | Unda uchinchi qatorni yig'amiz, hajm ancha ochiladi. Juda ko'p joy kerak bo'lsa, ikkinchi qatorni ham yig'amiz — bir ming to'qqiz yuz o'ttiz litrgacha yetadi. |
| 16 | Вероника | 01:29–01:33 | 01:29.00–01:33.96 | 4.96s/4.0s | ref (exp2-A) | 203 Гц (+0.2 st) | 422 Гц | -14.6 дБ | — → -18.6 | `lively, casual, friendly, pleased, smiling` | Zo'r-ku! Demak, o'zim tanlayman: yuk ko'pmi yoki yo'lovchi. |
