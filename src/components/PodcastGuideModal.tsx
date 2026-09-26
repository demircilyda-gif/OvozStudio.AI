import React from 'react';
import { BookOpen, X, Sparkles, Mic, Layers, Gauge, Volume2, Music, Download } from 'lucide-react';

interface PodcastGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'uz' | 'ru';
}

export const PodcastGuideModal: React.FC<PodcastGuideModalProps> = ({
  isOpen,
  onClose,
  lang,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-zinc-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-zinc-900 border border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-2xl my-8 space-y-6">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-zinc-400 hover:text-white bg-zinc-800/60 hover:bg-zinc-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 pb-4 border-b border-zinc-800">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 p-0.5 shadow-lg shadow-cyan-500/20">
            <div className="w-full h-full bg-zinc-950 rounded-[14px] flex items-center justify-center">
              <BookOpen className="w-6 h-6 text-cyan-400" />
            </div>
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">
              {lang === 'uz' ? 'Professional Podkast Qanday Yaratiladi?' : 'Как Создается Профессиональный Подкаст?'}
            </h2>
            <p className="text-xs text-zinc-400">
              {lang === 'uz'
                ? 'Gemini 3.8 TTS Live, toifalar, temp, tembr va audio eksport qo\'llanmasi'
                : 'Руководство по Gemini 3.8 TTS Live, категориям, тембру, темпу и экспорту'}
            </p>
          </div>
        </div>

        {/* Content sections */}
        <div className="space-y-4 text-xs sm:text-sm text-zinc-300 max-h-[60vh] overflow-y-auto pr-2">
          {/* Section 1 */}
          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-zinc-800 space-y-2">
            <h3 className="font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-400" />
              <span>1. Kategoriya va Tinglovchi Auditoryasi</span>
            </h3>
            <p className="text-zinc-400 leading-relaxed text-xs">
              Muvaffaqiyatli podkast aniq yo'nalishga ega bo'lishi kerak. Tarixiy podkastlar tinglovchiga chuqur bilim va o'tmish ruhini yetkazsa, komedik podkastlar kundalik hayotdagi qiziq holatlarni kulgi orqali ko'taradi. Har bir kategoriya o'ziga xos ritm va musiqa talab qiladi.
            </p>
          </div>

          {/* Section 2 */}
          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-zinc-800 space-y-2">
            <h3 className="font-bold text-white flex items-center gap-2">
              <Gauge className="w-4 h-4 text-cyan-400" />
              <span>2. Temp (Nutq Tezligi) va Ritm</span>
            </h3>
            <ul className="space-y-1.5 text-xs text-zinc-400">
              <li>• <strong>0.85x - 0.90x (Vazmin / Sekin):</strong> Tarixiy voqealar, falsafa va chuqur mulohazali hikoyalar uchun. Tinglovchiga har bir so'zni his qilish imkonini beradi.</li>
              <li>• <strong>1.0x (Standart):</strong> Yangiliklar, ta'limiy mavzular va intervyular.</li>
              <li>• <strong>1.15x - 1.25x (Jonli va Tezkor):</strong> Komedik hikoyalar, qiziqarli hayotiy dialoglar va yoshlarbop trendlar.</li>
            </ul>
          </div>

          {/* Section 3 */}
          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-zinc-800 space-y-2">
            <h3 className="font-bold text-white flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-emerald-400" />
              <span>3. Tembr va Ovoz Personasi</span>
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Ovoz tembri — bu sizning brendingiz. Boy bariton salobat va ishonch bag'ishlasa, yorqin tenor do'stona muhit yaratadi. Gemini 3.8 da o'zingizning ovozingizni sozlab, unga o'zbekcha toza talaffuz va boy rezonans bera olasiz.
            </p>
          </div>

          {/* Section 4 */}
          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-zinc-800 space-y-2">
            <h3 className="font-bold text-white flex items-center gap-2">
              <Music className="w-4 h-4 text-purple-400" />
              <span>4. Jonli Tovushlar va Fon Musiqasi</span>
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Matnga tabiiylik bag'ishlash uchun maxsus teglardan foydalaning: <code className="text-cyan-400 font-mono bg-zinc-900 px-1 py-0.5 rounded">&lt;breath&gt;</code> (yengil nafas), <code className="text-cyan-400 font-mono bg-zinc-900 px-1 py-0.5 rounded">&lt;laugh&gt;</code> (kulgi) va <code className="text-cyan-400 font-mono bg-zinc-900 px-1 py-0.5 rounded">|ha|</code> (jonli tasdiq). Fon musiqasi esa ovozdan 15-20% pastroq bo'lishi maqsadga muvofiqdir.
            </p>
          </div>

          {/* Section 5 */}
          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-zinc-800 space-y-2">
            <h3 className="font-bold text-white flex items-center gap-2">
              <Download className="w-4 h-4 text-blue-400" />
              <span>5. Tinglash va Eksport Qilish</span>
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Podkastni yuklab olishdan avval pleerda to'liq tinglab ko'ring. Tayyor bo'lgach, WAV (24kHz Studio Master) yoki MP3 (192k/320k) formatida to'g'ridan-to'g'ri yuklab oling va Telegram, Spotify yoki YouTube ga joylang!
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-bold text-xs"
          >
            {lang === 'uz' ? 'Tushunarli, Podkast yaratamiz!' : 'Понятно, создаем подкаст!'}
          </button>
        </div>
      </div>
    </div>
  );
};
