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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#161511]/60 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-[#F4F1EA] text-[#161511] border border-[rgba(22,21,17,0.14)] rounded-[26px] p-6 sm:p-8 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.35)] my-8 space-y-6">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full text-[#5D594E] hover:text-[#161511] bg-white/70 hover:bg-white border border-[rgba(22,21,17,0.1)] transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 pb-4 border-b border-[rgba(22,21,17,0.1)]">
          <div className="w-12 h-12 rounded-full bg-[#161511] text-[#F4F1EA] flex items-center justify-center shadow-xs">
            <BookOpen className="w-5 h-5 text-[#5CC8CF]" />
          </div>
          <div>
            <h2 className="font-serif text-xl sm:text-2xl text-[#161511]">
              {lang === 'uz' ? 'Professional Podkast Qanday Yaratiladi?' : 'Как Создается Профессиональный Подкаст?'}
            </h2>
            <p className="text-xs text-[#5D594E]">
              {lang === 'uz'
                ? 'Gemini 3.8 TTS Live, toifalar, temp, tembr va audio eksport qo\'llanmasi'
                : 'Руководство по Gemini 3.8 TTS Live, категориям, тембру, темпу и экспорту'}
            </p>
          </div>
        </div>

        {/* Content sections */}
        <div className="space-y-4 text-xs sm:text-sm text-[#5D594E] max-h-[60vh] overflow-y-auto pr-2">
          {/* Section 1 */}
          <div className="p-5 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-2 shadow-xs">
            <h3 className="font-mono text-xs uppercase tracking-wider text-[#0A5A62] font-semibold flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#0E7C86]" />
              <span>01 — Kategoriya va Tinglovchi Auditoryasi</span>
            </h3>
            <p className="text-[#5D594E] leading-relaxed text-xs">
              Muvaffaqiyatli podkast aniq yo'nalishga ega bo'lishi kerak. Tarixiy podkastlar tinglovchiga chuqur bilim va o'tmish ruhini yetkazsa, komedik podkastlar kundalik hayotdagi qiziq holatlarni kulgi orqali ko'taradi. Har bir kategoriya o'ziga xos ritm va musiqa talab qiladi.
            </p>
          </div>

          {/* Section 2 */}
          <div className="p-5 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-2 shadow-xs">
            <h3 className="font-mono text-xs uppercase tracking-wider text-[#0A5A62] font-semibold flex items-center gap-2">
              <Gauge className="w-4 h-4 text-[#0E7C86]" />
              <span>02 — Temp (Nutq Tezligi) va Ritm</span>
            </h3>
            <ul className="space-y-1.5 text-xs text-[#5D594E]">
              <li>• <strong className="text-[#161511]">0.85x - 0.90x (Vazmin / Sekin):</strong> Tarixiy voqealar, falsafa va chuqur mulohazali hikoyalar uchun. Tinglovchiga har bir so'zni his qilish imkonini beradi.</li>
              <li>• <strong className="text-[#161511]">1.0x (Standart):</strong> Yangiliklar, ta'limiy mavzular va intervyular.</li>
              <li>• <strong className="text-[#161511]">1.15x - 1.25x (Jonli va Tezkor):</strong> Komedik hikoyalar, qiziqarli hayotiy dialoglar va yoshlarbop trendlar.</li>
            </ul>
          </div>

          {/* Section 3 */}
          <div className="p-5 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-2 shadow-xs">
            <h3 className="font-mono text-xs uppercase tracking-wider text-[#0A5A62] font-semibold flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-[#0E7C86]" />
              <span>03 — Tembr va Ovoz Personasi</span>
            </h3>
            <p className="text-xs text-[#5D594E] leading-relaxed">
              Ovoz tembri — bu sizning brendingiz. Boy bariton salobat va ishonch bag'ishlasa, yorqin tenor do'stona muhit yaratadi. Gemini 3.8 da o'zingizning ovozingizni sozlab, unga o'zbekcha toza talaffuz va boy rezonans bera olasiz.
            </p>
          </div>

          {/* Section 4 */}
          <div className="p-5 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-2 shadow-xs">
            <h3 className="font-mono text-xs uppercase tracking-wider text-[#0A5A62] font-semibold flex items-center gap-2">
              <Music className="w-4 h-4 text-[#0E7C86]" />
              <span>04 — Jonli Tovushlar va Fon Musiqasi</span>
            </h3>
            <p className="text-xs text-[#5D594E] leading-relaxed">
              Matnga tabiiylik bag'ishlash uchun maxsus teglardan foydalaning: <code className="text-[#C4552D] font-mono bg-[#F4F1EA] px-1.5 py-0.5 rounded border border-[rgba(22,21,17,0.1)]">&lt;breath&gt;</code> (yengil nafas), <code className="text-[#C4552D] font-mono bg-[#F4F1EA] px-1.5 py-0.5 rounded border border-[rgba(22,21,17,0.1)]">&lt;laugh&gt;</code> (kulgi) va <code className="text-[#0E7C86] font-mono bg-[#F4F1EA] px-1.5 py-0.5 rounded border border-[rgba(22,21,17,0.1)]">|ha|</code> (jonli tasdiq). Fon musiqasi esa ovozdan 15-20% pastroq bo'lishi maqsadga muvofiqdir.
            </p>
          </div>

          {/* Section 5 */}
          <div className="p-5 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-2 shadow-xs">
            <h3 className="font-mono text-xs uppercase tracking-wider text-[#0A5A62] font-semibold flex items-center gap-2">
              <Download className="w-4 h-4 text-[#0E7C86]" />
              <span>05 — Tinglash va Eksport Qilish</span>
            </h3>
            <p className="text-xs text-[#5D594E] leading-relaxed">
              Podkastni yuklab olishdan avval pleerda to'liq tinglab ko'ring. Tayyor bo'lgach, WAV (24kHz Studio Master) yoki MP3 (192k/320k) formatida to'g'ridan-to'g'ri yuklab oling va Telegram, Spotify yoki YouTube ga joylang!
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-[rgba(22,21,17,0.1)] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn-pill btn-solid text-xs font-semibold cursor-pointer shadow-xs"
          >
            {lang === 'uz' ? 'Tushunarli, Podkast yaratamiz!' : 'Понятно, создаем подкаст!'}
          </button>
        </div>
      </div>
    </div>
  );
};
