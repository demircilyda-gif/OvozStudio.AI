export interface TimbrePreset {
  id: string;
  value: number; // mapped on XYPad (-1.0 to +1.0)
  labelUz: string;
  labelRu: string;
  descUz: string;
  descRu: string;
  promptUz: string;
}

export const TIMBRE_PRESETS: TimbrePreset[] = [
  {
    id: 'deep_bass',
    value: -0.75,
    labelUz: 'Chuqur bas',
    labelRu: 'Глубокий бас',
    descUz: 'Tarixiy, jiddiy va vazmin epik mavzular',
    descRu: 'Для серьезных, исторических и эпических тем',
    promptUz: 'Chuqur jarangdor bas rezonans, salobatli va vazmin',
  },
  {
    id: 'baritone',
    value: 0.0,
    labelUz: 'Salobatli bariton',
    labelRu: 'Благородный баритон',
    descUz: 'Barcha podkastlar uchun ideal universal ovoz',
    descRu: 'Универсальный эталон для любых подкастов и аудиокниг',
    promptUz: 'Iliq, salobatli va boy bariton',
  },
  {
    id: 'tenor',
    value: 0.70,
    labelUz: 'Yorqin tenor',
    labelRu: 'Яркий тенор',
    descUz: 'Quvnoq, chaqqon, zamonaviy va jonli suhbatlar',
    descRu: 'Для энергичных, комедийных и живых диалогов',
    promptUz: 'Yorqin, tiniq va jarangdor tenor diksiya',
  },
  {
    id: 'soprano',
    value: 0.90,
    labelUz: 'Mayin soprano',
    labelRu: 'Мягкое сопрано',
    descUz: 'Tinchlantiruvchi, nafis va samimiy lirik ohang',
    descRu: 'Успокаивающий, мягкий и душевный женский тембр',
    promptUz: 'Mayin, nafis va samimiy soprano diksiyasi',
  },
];

export function getTimbrePresetByValue(val: number): TimbrePreset {
  if (val <= -0.4) return TIMBRE_PRESETS[0];
  if (val >= 0.8) return TIMBRE_PRESETS[3];
  if (val >= 0.35) return TIMBRE_PRESETS[2];
  return TIMBRE_PRESETS[1];
}
