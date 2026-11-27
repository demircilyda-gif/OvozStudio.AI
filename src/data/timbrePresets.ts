export interface TimbrePreset {
  id: string;
  labelUz: string;
  labelRu: string;
  descUz: string;
  descRu: string;
  value: number; // -1 to +1
}

export const TIMBRE_PRESETS: TimbrePreset[] = [
  {
    id: 'deep-bass',
    labelUz: 'Chuqur Bas',
    labelRu: 'Глубокий бас',
    descUz: 'Salobatli, past va kinematografik tembr',
    descRu: 'Глубокий, бархатный, кинематографичный тембр',
    value: -0.75,
  },
  {
    id: 'warm-baritone',
    labelUz: 'Iliq Bariton',
    labelRu: 'Тёплый баритон',
    descUz: 'Samimiy podkast va suhbat uchun iliq tembr',
    descRu: 'Тёплый и мягкий тембр для подкастов',
    value: -0.25,
  },
  {
    id: 'natural-studio',
    labelUz: 'Tabiiy Studiya',
    labelRu: 'Естественный',
    descUz: 'Muvozanatli standart studiya ovozi',
    descRu: 'Сбалансированный студийный голос',
    value: 0,
  },
  {
    id: 'bright-clarity',
    labelUz: 'Yorqin & Aniq',
    labelRu: 'Яркий / Чёткий',
    descUz: 'Reklama, Reels va yangiliklar uchun tiniq tembr',
    descRu: 'Звонкий и чёткий тембр для рекламы и Reels',
    value: 0.65,
  },
];

export function getTimbrePresetByValue(value: number): TimbrePreset {
  const safeVal = Number.isFinite(value) ? value : 0;
  let closest = TIMBRE_PRESETS[2];
  let minDiff = Math.abs(safeVal - closest.value);

  for (const preset of TIMBRE_PRESETS) {
    const diff = Math.abs(safeVal - preset.value);
    if (diff < minDiff) {
      minDiff = diff;
      closest = preset;
    }
  }

  return closest;
}
