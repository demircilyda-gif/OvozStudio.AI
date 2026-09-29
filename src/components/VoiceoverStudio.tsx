import React, { useState, useRef, useMemo, useEffect } from 'react';
import { VoiceProfile, VoiceoverFormat, VideoSourceMode, DubbingTimelineSegment } from '../types/podcast';
import {
  Film,
  Sparkles,
  Play,
  Pause,
  Download,
  Copy,
  Clock,
  Check,
  FileText,
  Volume2,
  Tv,
  BookOpen,
  ShoppingBag,
  Sliders,
  CheckCircle2,
  Upload,
  Save,
  ShieldCheck,
  Eraser,
  Eye,
  Info,
  Video,
  Link as LinkIcon,
  FileVideo,
  Globe,
  RefreshCw,
  VolumeX,
  Volume1,
  AlertCircle,
  Trash2,
  Edit3,
  ExternalLink,
  Layers,
  ArrowRight,
} from 'lucide-react';
import {
  cleanScriptForSpeech,
  stripAllStageConditions,
  detectScriptConditions,
} from '../utils/audioUtils';

interface VoiceoverStudioProps {
  voices: VoiceProfile[];
  selectedVoiceId: string;
  onSelectVoiceId: (id: string) => void;
  onSaveToCMS?: (item: any) => void;
  onOpenDocumentModal?: () => void;
  lang: 'uz' | 'ru';
}

interface UploadedMediaInfo {
  name: string;
  size: number;
  type: string;
  url: string;
  base64?: string;
  isVideo: boolean;
}

export const VoiceoverStudio: React.FC<VoiceoverStudioProps> = ({
  voices,
  selectedVoiceId,
  onSelectVoiceId,
  onSaveToCMS,
  onOpenDocumentModal,
  lang,
}) => {
  // Source Mode: File Upload vs URL vs Text Generator
  const [sourceMode, setSourceMode] = useState<VideoSourceMode>('file_upload');

  // Format & Timing
  const [format, setFormat] = useState<VoiceoverFormat>('reels_shorts');
  const [targetDuration, setTargetDuration] = useState<string>('30s');
  const [topic, setTopic] = useState<string>("Sun'iy intellekt va kelajak texnologiyalari");
  const [stylePreset, setStylePreset] = useState<'cinematic' | 'energetic_sales' | 'storytelling' | 'documentary' | 'whisper'>('energetic_sales');

  // Media Source State
  const [uploadedMedia, setUploadedMedia] = useState<UploadedMediaInfo | null>(null);
  const [embeddedVideoUrl, setEmbeddedVideoUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [inputUrl, setInputUrl] = useState<string>('');
  const [urlStatus, setUrlStatus] = useState<any>(null);
  const [isUrlChecking, setIsUrlChecking] = useState(false);

  // Analysis & Segments
  const [isAnalyzingMedia, setIsAnalyzingMedia] = useState(false);
  const [analysisProgressText, setAnalysisProgressText] = useState<string>('');
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [timelineSegments, setTimelineSegments] = useState<DubbingTimelineSegment[]>([]);

  // Script & Editing
  const [script, setScript] = useState<string>(
    `[00:00 - 00:05] [Dinamik]: Video uchun birinchi sahna dublyaji...\n[00:05 - 00:12] [Kinematik]: Ikkinchi sahna va voqealar rivoji...\n[00:12 - 00:20] [Jiddiy]: Asosiy xulosa va yakun.`
  );

  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isGeneratingSubtitles, setIsGeneratingSubtitles] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Audio & Dubbing Playback State
  const [resultAudio, setResultAudio] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [srtSubtitles, setSrtSubtitles] = useState<string>('');
  const [vttSubtitles, setVttSubtitles] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [muteOriginalVideo, setMuteOriginalVideo] = useState(true);
  const [copiedSubtitle, setCopiedSubtitle] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'srt' | 'vtt'>('srt');

  // Playback & Karaoke Subtitle Controls
  const [playbackTime, setPlaybackTime] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [originalVolume, setOriginalVolume] = useState<number>(0.15);
  const [subtitleStyle, setSubtitleStyle] = useState<'reels_yellow' | 'classic_white' | 'neon_cyan' | 'cinema'>('reels_yellow');
  const [showSubtitleOverlay, setShowSubtitleOverlay] = useState<boolean>(true);

  // Helper to convert "MM:SS" to seconds
  const parseTimeToSeconds = (t: string) => {
    if (!t) return 0;
    const parts = t.split(':').map(Number);
    if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
    if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    return 0;
  };

  // Find currently active timeline segment
  const activeSegmentIndex = useMemo(() => {
    return timelineSegments.findIndex((seg) => {
      const s = parseTimeToSeconds(seg.start);
      const e = parseTimeToSeconds(seg.end);
      return playbackTime >= s && playbackTime <= e;
    });
  }, [timelineSegments, playbackTime]);

  const activeSegment = activeSegmentIndex >= 0 ? timelineSegments[activeSegmentIndex] : null;

  // Jump to specific segment
  const handleSeekToSegment = (index: number) => {
    const seg = timelineSegments[index];
    if (!seg) return;
    const s = parseTimeToSeconds(seg.start);
    setPlaybackTime(s);
    if (audioRef.current) {
      audioRef.current.currentTime = s;
    }
    if (videoRef.current) {
      videoRef.current.currentTime = s;
    }
  };

  // Playback speed change
  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) audioRef.current.playbackRate = speed;
    if (videoRef.current) videoRef.current.playbackRate = speed;
  };

  // Original video audio level (ducking)
  const handleOriginalVolumeChange = (vol: number) => {
    setOriginalVolume(vol);
    if (videoRef.current) {
      videoRef.current.volume = vol;
      videoRef.current.muted = vol === 0;
    }
  };

  // Media references for sync playback
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [scriptViewMode, setScriptViewMode] = useState<'timeline' | 'full' | 'pure'>('timeline');
  const [cleanNotice, setCleanNotice] = useState<string | null>(null);

  // Active voice profile
  const activeVoice = voices.find((v) => v.id === selectedVoiceId) || voices[0];

  // Script condition analysis
  const conditionAnalysis = useMemo(() => detectScriptConditions(script), [script]);

  // Estimated reading speed (approx 2.4 words per second in Uzbek)
  const currentTextToEstimate = scriptViewMode === 'pure' ? conditionAnalysis.cleanText : script;
  const wordCount = currentTextToEstimate.trim().split(/\s+/).filter(Boolean).length;
  const estimatedSeconds = Math.round((wordCount / 2.4) * 10) / 10;

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (uploadedMedia?.url) {
        URL.revokeObjectURL(uploadedMedia.url);
      }
    };
  }, [uploadedMedia]);

  // Handle local file selection
  const processSelectedFile = (file: File) => {
    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.name);
    const objectUrl = URL.createObjectURL(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string)?.split(',')[1];
      setUploadedMedia({
        name: file.name,
        size: file.size,
        type: file.type || (isVideo ? 'video/mp4' : 'audio/mp3'),
        url: objectUrl,
        base64,
        isVideo,
      });
      // Suggest reel format if vertical video
      if (isVideo) {
        setFormat('reels_shorts');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processSelectedFile(file);
  };

  // Analyze uploaded video/audio: Transcribe original speech & Translate to synchronized Uzbek
  const handleAnalyzeAndTranslateMedia = async () => {
    if (!uploadedMedia?.base64) {
      alert(lang === 'uz' ? 'Iltimos, avval video yoki audio fayl yuklang' : 'Сначала загрузите видео или аудио файл');
      return;
    }

    setIsAnalyzingMedia(true);
    setAnalysisProgressText(
      lang === 'uz' ? '1/3. Asl ovoz va nutq tahlil qilinmoqda...' : '1/3. Анализ оригинальной аудиодорожки...'
    );

    try {
      setTimeout(() => {
        setAnalysisProgressText(
          lang === 'uz' ? '2/3. Nutq xronometraji va taymkodlar o\'qilmoqda...' : '2/3. Распознавание таймкодов речи...'
        );
      }, 2500);

      setTimeout(() => {
        setAnalysisProgressText(
          lang === 'uz' ? '3/3. O\'zbek tiliga xronometraj bo\'yicha sinxron tarjima...' : '3/3. Синхронный перевод на узбекский язык...'
        );
      }, 5500);

      const res = await fetch('/api/voiceover/transcribe-and-translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaBase64: uploadedMedia.base64,
          mimeType: uploadedMedia.type,
          targetDuration,
          stylePreset,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Tahlil jarayonida xatolik');
      }

      const data = await res.json();

      if (data.detectedLanguage) {
        setDetectedLanguage(data.detectedLanguage);
      }
      if (data.suggestedTopic) {
        setTopic(data.suggestedTopic);
      }
      if (Array.isArray(data.segments) && data.segments.length > 0) {
        setTimelineSegments(data.segments);
        setScriptViewMode('timeline');
      }
      if (data.fullTimedScript) {
        setScript(data.fullTimedScript);
      } else if (data.cleanUzbekScript) {
        setScript(data.cleanUzbekScript);
      }
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsAnalyzingMedia(false);
      setAnalysisProgressText('');
    }
  };

  // Check URL (YouTube, Reels, TikTok, Direct)
  const handleCheckUrl = async () => {
    if (!inputUrl.trim()) return;
    setIsUrlChecking(true);
    setUrlStatus(null);

    try {
      const res = await fetch('/api/voiceover/fetch-media-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: inputUrl }),
      });
      const data = await res.json();
      setUrlStatus(data);

      if (data.type === 'direct_file' && data.mediaBase64) {
        setUploadedMedia({
          name: 'Video_from_URL.mp4',
          size: Math.round(data.mediaBase64.length * 0.75),
          type: data.mimeType || 'video/mp4',
          url: `data:${data.mimeType};base64,${data.mediaBase64}`,
          base64: data.mediaBase64,
          isVideo: true,
        });
        setEmbeddedVideoUrl(null);
      } else if (data.embedUrl) {
        setEmbeddedVideoUrl(data.embedUrl);
      }

      // If YouTube transcript was fetched and translated automatically
      if (data.segments && Array.isArray(data.segments) && data.segments.length > 0) {
        setTimelineSegments(data.segments);
        setScriptViewMode('timeline');
        if (data.fullTimedScript) setScript(data.fullTimedScript);
        else if (data.cleanUzbekScript) setScript(data.cleanUzbekScript);
        if (data.detectedLanguage) setDetectedLanguage(data.detectedLanguage);
        if (data.suggestedTopic) setTopic(data.suggestedTopic);
      } else if (data.embedUrl) {
        // If segments weren't automatically provided, automatically generate them right away!
        handleGenerateVideoSubtitles(data.videoTitle || 'YouTube Video');
      }
    } catch (e: any) {
      setUrlStatus({ status: 'error', message: e.message });
    } finally {
      setIsUrlChecking(false);
    }
  };

  // Generate or regenerate AI video subtitles and timecodes
  const handleGenerateVideoSubtitles = async (overrideTopic?: string) => {
    setIsGeneratingSubtitles(true);
    try {
      const topicToUse = overrideTopic || topic || "Video Dublyaji";
      const res = await fetch('/api/voiceover/generate-video-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topicToUse,
          targetDuration,
          stylePreset,
        }),
      });

      if (!res.ok) throw new Error('Subtitr va taymkodlar yaratishda xatolik');
      const data = await res.json();
      if (data.segments && Array.isArray(data.segments) && data.segments.length > 0) {
        setTimelineSegments(data.segments);
        setScriptViewMode('timeline');
      }
      if (data.fullTimedScript) setScript(data.fullTimedScript);
      else if (data.cleanUzbekScript) setScript(data.cleanUzbekScript);
      if (data.suggestedTopic) setTopic(data.suggestedTopic);
      if (data.detectedLanguage) setDetectedLanguage(data.detectedLanguage);
    } catch (err: any) {
      alert(`Xatolik: ${err.message}`);
    } finally {
      setIsGeneratingSubtitles(false);
    }
  };

  // Add a new empty timeline segment manually
  const handleAddSegment = () => {
    const lastSeg = timelineSegments[timelineSegments.length - 1];
    let newStart = '00:00';
    let newEnd = '00:05';
    if (lastSeg) {
      newStart = lastSeg.end;
      const [m, s] = lastSeg.end.split(':').map(Number);
      const totalSec = (m || 0) * 60 + (s || 0) + 5;
      const nm = Math.floor(totalSec / 60).toString().padStart(2, '0');
      const ns = (totalSec % 60).toString().padStart(2, '0');
      newEnd = `${nm}:${ns}`;
    }
    const newSeg: DubbingTimelineSegment = {
      start: newStart,
      end: newEnd,
      originalText: lang === 'uz' ? '[Yangi sahna]' : '[Новая сцена]',
      uzbekText: lang === 'uz' ? 'Yangi dublyaj gapi...' : 'Новая реплика дубляжа...',
    };
    setTimelineSegments((prev) => [...prev, newSeg]);
    setScriptViewMode('timeline');
  };

  // Delete a timeline segment
  const handleDeleteSegment = (idx: number) => {
    setTimelineSegments((prev) => prev.filter((_, i) => i !== idx));
  };

  // Strip stage directions / conditions
  const handleStripConditions = () => {
    const cleaned = stripAllStageConditions(script);
    setScript(cleaned);
    setCleanNotice(
      lang === 'uz'
        ? "✅ Ssenariy barcha shartlar, skobkalar va vaqt belgilaridan tozalandi! Faqat toza nutq qoldi."
        : '✅ Сценарий очищен от всех ремарок, скобок и таймкодов! Остался только чистый текст речи.'
    );
    setTimeout(() => setCleanNotice(null), 4000);
  };

  // Generate text script with AI
  const handleGenerateScript = async () => {
    setIsGeneratingScript(true);
    try {
      const res = await fetch('/api/voiceover/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          topic,
          targetDuration,
          stylePreset,
          voicePersona: activeVoice?.name || 'Mening Ovozim',
        }),
      });

      if (!res.ok) throw new Error('Ssenariy yaratishda xatolik');
      const data = await res.json();
      if (data.fullTimedScript) {
        setScript(data.fullTimedScript);
      } else if (data.script) {
        setScript(data.script);
      }
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // Synthesize voiceover into Uzbek TTS
  const handleSynthesize = async () => {
    // If in timeline mode, compile latest segments into speech script
    let textToVoice = script;
    if (scriptViewMode === 'timeline' && timelineSegments.length > 0) {
      textToVoice = timelineSegments.map((s) => `[${s.start} - ${s.end}] ${s.uzbekText}`).join('\n');
    }

    if (!textToVoice.trim()) return;
    setIsSynthesizing(true);

    try {
      const res = await fetch('/api/voiceover/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToVoice,
          voiceProfile: {
            voiceName: activeVoice?.name,
            voiceId: activeVoice?.voiceId || activeVoice?.id,
            baseVoice: activeVoice?.baseVoice,
            timbre: activeVoice?.timbre,
            tempo: activeVoice?.tempo,
          },
          speechStyle: stylePreset,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Dublyaj sintezida xatolik');
      }

      const data = await res.json();
      setResultAudio(data.audioBase64);
      setAudioDuration(data.durationSeconds || 0);
      setSrtSubtitles(data.srtSubtitles || '');
      setVttSubtitles(data.vttSubtitles || '');
      setIsPlaying(false);
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Synchronized Play / Pause for Video + Uzbek Dubbed Audio
  const togglePlay = () => {
    const audioEl = audioRef.current;
    const videoEl = videoRef.current;

    if (!audioEl && !videoEl) return;

    if (isPlaying) {
      if (audioEl) audioEl.pause();
      if (videoEl) videoEl.pause();
      setIsPlaying(false);
    } else {
      if (audioEl && videoEl) {
        videoEl.currentTime = audioEl.currentTime;
        videoEl.play().catch(() => {});
        audioEl.play().catch(() => {});
      } else if (audioEl) {
        audioEl.play().catch(() => {});
      } else if (videoEl) {
        videoEl.play().catch(() => {});
      }
      setIsPlaying(true);
    }
  };

  // Copy Subtitles
  const copySubtitles = () => {
    const textToCopy = activeSubTab === 'srt' ? srtSubtitles : vttSubtitles;
    navigator.clipboard.writeText(textToCopy);
    setCopiedSubtitle(true);
    setTimeout(() => setCopiedSubtitle(false), 2000);
  };

  // Download Subtitles
  const downloadSrt = () => {
    const blob = new Blob([activeSubTab === 'srt' ? srtSubtitles : vttSubtitles], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dubbing-${format}.${activeSubTab}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download Audio WAV
  const downloadAudio = () => {
    if (!resultAudio) return;
    const byteCharacters = atob(resultAudio);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dubbing-${format}-${Date.now()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Save to CMS Library
  const handleSaveToCMS = () => {
    if (!onSaveToCMS) return;
    onSaveToCMS({
      title: `Dublyaj: ${topic.slice(0, 45)}`,
      category: 'Ovozlashtirish & Dublyaj',
      description: `${format} formati uchun ${targetDuration}lik professional o'zbekcha dublyaj.`,
      tags: ['Dublyaj', 'Reels', format, 'Subtitr'],
      script,
      voiceName: activeVoice.name,
      durationSeconds: audioDuration || 30,
      rawAudioWavBase64: resultAudio || '',
      ambientSound: 'none',
      ambientVolume: 0,
    });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  // Update a single segment's uzbek text
  const handleUpdateSegmentUzbek = (index: number, newUzbekText: string) => {
    setTimelineSegments((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], uzbekText: newUzbekText };
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-purple-950/70 via-zinc-900 to-indigo-950/70 border border-purple-500/30 p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-semibold border border-purple-500/40 flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-purple-400" />
                {lang === 'uz' ? 'Reels & Video Dublyaj Studiyasi' : 'Студия Дубляжа Reels и Видео'}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-mono border border-cyan-500/30">
                Gemini Multimodal STT + Flash TTS
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              {lang === 'uz' ? 'Instagram Reels, Shorts va Video Дубляж' : 'Дубляж Reels, Shorts и Видео на Узбекский'}
            </h1>
            <p className="text-zinc-400 text-sm mt-1 max-w-2xl">
              {lang === 'uz'
                ? 'Asl rolikni yuklang (inglizcha, ruscha va b.), AI uni taymkodlari bilan eshitadi va o\'zbek tilida aynan o\'sha vaqtga moslab («qanday aytilgan bo\'lsa, shunday») sinxron ovozlashtiradi.'
                : 'Загрузите оригинал (Reels/Shorts). AI распознает таймкоды оригинала и синхронно переведет с точным дубляжом на узбекский язык («как озвучено, так и озвучивать»).'}
            </p>
          </div>

          {/* Active Voice Pill */}
          <div className="bg-zinc-950/80 border border-purple-500/30 p-3.5 rounded-xl flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 font-bold text-base">
              {activeVoice?.name?.[0] || 'V'}
            </div>
            <div>
              <p className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
                {lang === 'uz' ? 'Dublyaj Ovozi:' : 'Голос Дубляжа:'}
              </p>
              <p className="text-sm font-bold text-white flex items-center gap-1.5">
                {activeVoice?.name}
                {activeVoice?.isReplicatedVoice && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* STEP 1: Source Selection Mode Tabs */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/40 flex items-center justify-center text-xs font-bold">1</span>
            {lang === 'uz' ? 'Dublyaj Uchun Manbani Tanlang' : 'Выберите Источник для Дубляжа'}
          </h2>

          {/* 3 Source Switchers */}
          <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs">
            <button
              onClick={() => setSourceMode('file_upload')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                sourceMode === 'file_upload'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'Video / Audio Fayl' : 'Файл Видео/Аудио'}</span>
            </button>

            <button
              onClick={() => setSourceMode('video_url')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                sourceMode === 'video_url'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <LinkIcon className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'Havola (Reels / Link)' : 'Ссылка (Reels/Link)'}</span>
            </button>

            <button
              onClick={() => setSourceMode('script_text')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                sourceMode === 'script_text'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'Matn / Ssenariy' : 'Текст / Сценарий'}</span>
            </button>
          </div>
        </div>

        {/* Source Mode 1: File Upload (Drag & Drop or Pick) */}
        {sourceMode === 'file_upload' && (
          <div className="space-y-4">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInputChange}
              accept="video/mp4,video/quicktime,video/webm,video/x-m4v,audio/mp3,audio/wav,audio/m4a,audio/webm"
              className="hidden"
            />

            {!uploadedMedia ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`p-8 rounded-2xl border-2 border-dashed text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 ${
                  isDragging
                    ? 'border-purple-500 bg-purple-950/20 scale-[1.01]'
                    : 'border-zinc-800 bg-zinc-950/60 hover:border-purple-500/50 hover:bg-zinc-950'
                }`}
              >
                <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <FileVideo className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {lang === 'uz'
                      ? 'Reels yoki videoni bu yerga tashlang yoki tanlang'
                      : 'Перетащите сюда Reels или видео файл (MP4, MOV, MP3)'}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    {lang === 'uz'
                      ? 'MP4, MOV, WebM, MP3, M4A formatlari qo\'llab-quvvatlanadi (Reels 9:16 yoki 16:9)'
                      : 'Поддерживаются MP4, MOV, WebM, MP3, M4A (Reels 9:16 или 16:9)'}
                  </p>
                </div>
                <button
                  type="button"
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-purple-600/20"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{lang === 'uz' ? 'Faylni Tanlash' : 'Выбрать файл'}</span>
                </button>
              </div>
            ) : (
              /* Uploaded File Details & Video Preview */
              <div className="bg-zinc-950 border border-purple-500/30 rounded-2xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300">
                      {uploadedMedia.isVideo ? <Video className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="text-xs sm:text-sm font-bold text-white truncate max-w-xs sm:max-w-md">
                        {uploadedMedia.name}
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        {(uploadedMedia.size / (1024 * 1024)).toFixed(2)} MB • {uploadedMedia.type}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>{lang === 'uz' ? 'Boshqa fayl' : 'Заменить'}</span>
                    </button>
                    <button
                      onClick={() => {
                        setUploadedMedia(null);
                        setTimelineSegments([]);
                        setDetectedLanguage(null);
                      }}
                      className="p-1.5 text-zinc-500 hover:text-red-400 rounded-lg hover:bg-zinc-900 transition-colors cursor-pointer"
                      title="O'chirish"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Video Preview and Dubbing Action */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                  {uploadedMedia.isVideo ? (
                    <div className="md:col-span-5 bg-black rounded-xl overflow-hidden border border-zinc-800 relative aspect-[9/16] sm:aspect-video max-h-72 flex items-center justify-center mx-auto group">
                      <video
                        ref={videoRef}
                        src={uploadedMedia.url}
                        controls
                        onTimeUpdate={() => {
                          if (videoRef.current && !audioRef.current) {
                            setPlaybackTime(videoRef.current.currentTime);
                          }
                        }}
                        muted={muteOriginalVideo && Boolean(resultAudio)}
                        className="w-full h-full object-contain"
                      />

                      {/* Live Karaoke Subtitle Overlay on Video */}
                      {showSubtitleOverlay && activeSegment && (
                        <div className="absolute bottom-10 left-3 right-3 flex justify-center text-center pointer-events-none z-20 transition-all duration-150">
                          <div
                            className={`transition-all max-w-[92%] ${
                              subtitleStyle === 'reels_yellow'
                                ? 'bg-black/90 text-amber-300 font-black text-xs sm:text-sm px-3.5 py-1.5 rounded-xl shadow-2xl border border-amber-400/60 uppercase tracking-wide drop-shadow-md'
                                : subtitleStyle === 'classic_white'
                                ? 'bg-black/85 text-white font-bold text-xs sm:text-sm px-3.5 py-1.5 rounded-lg shadow-xl'
                                : subtitleStyle === 'neon_cyan'
                                ? 'bg-black/90 text-cyan-300 font-extrabold text-xs sm:text-sm px-3.5 py-1.5 rounded-xl border border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.6)]'
                                : 'bg-zinc-950/95 text-amber-100 font-serif italic text-xs sm:text-sm px-4 py-1.5 rounded-lg border-b-2 border-amber-500 shadow-xl'
                            }`}
                          >
                            {activeSegment.uzbekText}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="md:col-span-5 bg-zinc-900 p-4 rounded-xl border border-zinc-800 flex items-center gap-3">
                      <Volume2 className="w-8 h-8 text-purple-400 shrink-0" />
                      <audio src={uploadedMedia.url} controls className="w-full" />
                    </div>
                  )}

                  <div className="md:col-span-7 space-y-3">
                    <div className="p-3 bg-purple-950/30 border border-purple-500/20 rounded-xl space-y-1 text-xs">
                      <p className="font-semibold text-purple-200 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        {lang === 'uz' ? 'Avtomatik Sinxron Dublyaj Algoritmi:' : 'Алгоритм Синхронного Дубляжа:'}
                      </p>
                      <p className="text-zinc-400 leading-relaxed text-[11px]">
                        {lang === 'uz'
                          ? 'Gemini rolikdagi nutqni eshitib, xronometraj bo\'yicha (taymkodlar) segmentlarga ajratadi va o\'zbek tiliga xuddi shu vaqt ichida jaranglaydigan qilib tarjima qiladi.'
                          : 'Gemini анализирует речь, разбивает на таймкоды оригинала и генерирует перевод с идеальной укладкой в губы и длительность фраз.'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleAnalyzeAndTranslateMedia}
                      disabled={isAnalyzingMedia}
                      className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-purple-600/30 cursor-pointer"
                    >
                      <Sparkles className={`w-4 h-4 ${isAnalyzingMedia ? 'animate-spin' : ''}`} />
                      <span>
                        {isAnalyzingMedia
                          ? analysisProgressText || (lang === 'uz' ? 'Tahlil qilinmoqda...' : 'Анализ...')
                          : lang === 'uz'
                          ? '⚡ Videoni Tahlil Qilish & O\'zbekcha Dublyaj Yaratish'
                          : '⚡ Анализировать Видео и Создать Дубляж'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Source Mode 2: Link Input (YouTube, Shorts, Instagram Reels, TikTok) */}
        {sourceMode === 'video_url' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Globe className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="url"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="https://www.instagram.com/reel/... yoki https://youtube.com/shorts/..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-3.5 py-2.5 text-xs sm:text-sm text-zinc-200 focus:outline-none focus:border-purple-500"
                />
              </div>

              <button
                type="button"
                onClick={handleCheckUrl}
                disabled={isUrlChecking || !inputUrl.trim()}
                className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-all shadow-md shadow-purple-600/20 whitespace-nowrap cursor-pointer"
              >
                {isUrlChecking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <LinkIcon className="w-4 h-4" />}
                <span>{lang === 'uz' ? 'Havolani Tekshirish' : 'Проверить ссылку'}</span>
              </button>
            </div>

            {/* URL Status & Embedded Player */}
            {embeddedVideoUrl && (
              <div className="bg-zinc-950 border border-purple-500/40 rounded-2xl p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs sm:text-sm font-bold text-white">
                      {urlStatus?.platform || 'Video'}: {topic || 'YouTube Rolik'}
                    </span>
                  </div>
                  {timelineSegments.length > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold border border-emerald-500/30 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      {lang === 'uz' ? 'Subtitrlar va taymkodlar sinxronlandi' : 'Субтитры синхронизированы'}
                    </span>
                  )}
                </div>

                <div className="aspect-video w-full rounded-xl overflow-hidden border border-zinc-800 bg-black relative max-h-80 mx-auto">
                  <iframe
                    src={embeddedVideoUrl}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>

                {/* Subtitle & Timecode Action Banner */}
                {timelineSegments.length > 0 ? (
                  <div className="p-3 bg-purple-950/40 border border-purple-500/30 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <span className="text-zinc-200 flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      {lang === 'uz'
                        ? `🎉 ${timelineSegments.length} ta aniq taymkod va sahna subtitrlari tayyorlandi!`
                        : `🎉 ${timelineSegments.length} сцен с точными таймкодами и субтитрами готовы!`}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleGenerateVideoSubtitles()}
                      disabled={isGeneratingSubtitles}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-purple-300 border border-purple-500/30 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingSubtitles ? 'animate-spin' : ''}`} />
                      <span>{isGeneratingSubtitles ? 'Yangilanmoqda...' : lang === 'uz' ? 'Qaytadan yangilash' : 'Обновить'}</span>
                    </button>
                  </div>
                ) : (
                  <div className="p-4 bg-gradient-to-r from-purple-950/60 to-indigo-950/60 border border-purple-500/40 rounded-xl space-y-2.5">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      <span className="text-xs sm:text-sm font-bold text-white">
                        {lang === 'uz' ? 'Ushbu Video Uchun Subtitr va Taymkodlarni Yaratish' : 'Сгенерировать Субтитры и Таймкоды для этого Видео'}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-300">
                      {lang === 'uz'
                        ? `AI «${topic || 'Video'}» roligini tahlil qilib, aniq taymkodlar ([00:00 - 00:05], [00:05 - 00:12]) va o'zbekcha sinxron dublyaj matnini tuzib beradi.`
                        : `AI разобьет видео «${topic || 'Видео'}» на таймкоды ([00:00 - 00:05], [00:05 - 00:12]) и подготовит реплики дубляжа.`}
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 pt-1">
                      <input
                        type="text"
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        placeholder="Mavzu yoki qahramon nomi (masalan: Artur Deyn jangi)..."
                        className="flex-1 bg-zinc-950 border border-purple-500/30 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-400"
                      />
                      <button
                        type="button"
                        onClick={() => handleGenerateVideoSubtitles()}
                        disabled={isGeneratingSubtitles}
                        className="px-5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-purple-600/30 cursor-pointer whitespace-nowrap"
                      >
                        <Sparkles className={`w-3.5 h-3.5 ${isGeneratingSubtitles ? 'animate-spin' : ''}`} />
                        <span>{isGeneratingSubtitles ? 'Yaratilmoqda...' : lang === 'uz' ? '⚡ AI Taymkod va Subtitr Yaratish' : '⚡ Создать Таймкоды и Субтитры'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {urlStatus && !embeddedVideoUrl && (
              <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-3">
                <div className="flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <div className="space-y-1 text-xs">
                    <p className="font-semibold text-white">
                      {urlStatus.platform || 'Havola Holati'}: {urlStatus.message}
                    </p>
                    {urlStatus.recommendation && (
                      <p className="text-zinc-400">{urlStatus.recommendation}</p>
                    )}
                  </div>
                </div>

                {/* Helpful instructions */}
                <div className="p-3 bg-purple-950/40 border border-purple-500/30 rounded-xl space-y-2 text-xs">
                  <p className="font-semibold text-purple-200 flex items-center gap-1.5">
                    <ExternalLink className="w-3.5 h-3.5 text-purple-400" />
                    {lang === 'uz'
                      ? 'Nima uchun fayl yuklash eng qulay usul?'
                      : 'Почему загрузка файла удобнее всего?'}
                  </p>
                  <p className="text-zinc-400 text-[11px] leading-relaxed">
                    {lang === 'uz'
                      ? 'Ijtimoiy tarmoqlar server orqali to\'g\'ridan-to\'g\'ri yuklashni cheklashi mumkin. Faylni (MP4) yuklaganingizda esa Gemini bevosita videodagi audio ovozini eshitib, mukammal taymkodlar bilan dublyaj qiladi.'
                      : 'Загрузив MP4-файл, Gemini напрямую прослушивает аудиодорожку любого качества без ограничений API.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Source Mode 3: Text / AI Script */}
        {sourceMode === 'script_text' && (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={lang === 'uz' ? 'Mavzu (masalan: Yangi brend taqdimoti)...' : 'Тема озвучки...'}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-zinc-200 focus:outline-none focus:border-purple-500"
              />

              <div className="flex items-center gap-2">
                {onOpenDocumentModal && (
                  <button
                    type="button"
                    onClick={onOpenDocumentModal}
                    className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-cyan-300 border border-cyan-500/40 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all hover:scale-105 cursor-pointer whitespace-nowrap"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{lang === 'uz' ? 'PDF / Maqola' : 'Из PDF'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleGenerateScript}
                  disabled={isGeneratingScript || !topic.trim()}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-purple-600/20 whitespace-nowrap cursor-pointer"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isGeneratingScript ? 'animate-spin' : ''}`} />
                  {isGeneratingScript ? 'Yozilmoqda...' : lang === 'uz' ? 'AI Ssenariy' : 'AI Сценарий'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* STEP 2: Timeline, Script Editor & Dubbing Segments */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Script / Timeline Editor (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/40 flex items-center justify-center text-xs font-bold">2</span>
                <h3 className="text-sm font-semibold text-white">
                  {lang === 'uz' ? 'Sinxron Dublyaj Matni & Taymkodlar' : 'Текст Дубляжа и Таймкоды'}
                </h3>
                {detectedLanguage && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-semibold border border-emerald-500/30">
                    {detectedLanguage}
                  </span>
                )}
              </div>

              {/* View Mode Switcher */}
              <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs">
                <button
                  type="button"
                  onClick={() => setScriptViewMode('timeline')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                    scriptViewMode === 'timeline'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{lang === 'uz' ? '⏱️ Taymlayn va Taymkodlar' : '⏱️ Таймлайн и Таймкоды'}</span>
                  {timelineSegments.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.2 rounded-full bg-purple-950 text-[10px] font-bold text-purple-300 border border-purple-500/40">
                      {timelineSegments.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setScriptViewMode('full')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                    scriptViewMode === 'full'
                      ? 'bg-purple-600 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <FileText className="w-3 h-3" />
                  <span>{lang === 'uz' ? 'To\'liq Ssenariy' : 'Полный'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setScriptViewMode('pure')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                    scriptViewMode === 'pure'
                      ? 'bg-emerald-700 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  <span>{lang === 'uz' ? 'Faqat Ovoz' : 'Только речь'}</span>
                </button>
              </div>
            </div>

            {/* Notification / Clean Strip Button */}
            {cleanNotice && (
              <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-xs text-emerald-200 flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{cleanNotice}</span>
              </div>
            )}

            {/* Mode A: Interactive Timeline Segments (Original vs Uzbek) */}
            {scriptViewMode === 'timeline' ? (
              timelineSegments.length > 0 ? (
                <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span className="flex items-center gap-1.5 font-medium text-purple-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      {lang === 'uz'
                        ? `${timelineSegments.length} ta sahna taymkodlari. Har bir replikani tahrirlashingiz mumkin:`
                        : `${timelineSegments.length} сцен с таймкодами. Вы можете редактировать узбекский текст:`}
                    </span>
                    <button
                      type="button"
                      onClick={handleAddSegment}
                      className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-cyan-300 border border-cyan-500/30 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <span>+ {lang === 'uz' ? 'Sahna qo\'shish' : 'Добавить сцену'}</span>
                    </button>
                  </div>

                  {timelineSegments.map((seg, idx) => {
                    const isActive = activeSegmentIndex === idx;
                    return (
                      <div
                        key={idx}
                        className={`p-3.5 rounded-xl transition-all space-y-2 relative group ${
                          isActive
                            ? 'bg-purple-950/70 border-2 border-purple-400 shadow-xl shadow-purple-600/25 ring-2 ring-purple-400/40 scale-[1.008]'
                            : 'bg-zinc-950 border border-zinc-800 hover:border-purple-500/40'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            {/* Clickable time badge to seek */}
                            <button
                              type="button"
                              onClick={() => handleSeekToSegment(idx)}
                              className={`px-2.5 py-1 rounded-lg font-mono text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                                isActive
                                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                                  : 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              }`}
                              title={lang === 'uz' ? "Shu vaqtdan tinglash / ko'rish" : 'Перейти к этому времени'}
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>{seg.start} - {seg.end}</span>
                            </button>

                            {isActive && (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold flex items-center gap-1 animate-pulse">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                {lang === 'uz' ? 'Hozir jaranglamoqda' : 'Сейчас звучит'}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-500">#{idx + 1}-sahna</span>
                            <button
                              type="button"
                              onClick={() => handleDeleteSegment(idx)}
                              className="p-1 text-zinc-600 hover:text-red-400 rounded transition-colors cursor-pointer"
                              title="O'chirish"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Original phrase */}
                        {seg.originalText && (
                          <div className="p-2 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-[11px] text-zinc-400 italic">
                            <span className="font-semibold text-zinc-300 not-italic mr-1.5">Asl matn / Sahna:</span>
                            "{seg.originalText}"
                          </div>
                        )}

                        {/* Editable Uzbek Dubbing text */}
                        <div>
                          <label className="text-[10px] font-semibold text-purple-300 flex items-center gap-1 mb-1">
                            <Edit3 className="w-3 h-3 text-purple-400" />
                            {lang === 'uz' ? 'O\'zbekcha Dublyaj (Sinxron):' : 'Узбекский Дубляж:'}
                          </label>
                          <input
                            type="text"
                            value={seg.uzbekText}
                            onChange={(e) => handleUpdateSegmentUzbek(idx, e.target.value)}
                            className="w-full bg-zinc-900 border border-purple-500/30 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-400 font-medium"
                          />
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={handleAddSegment}
                      className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>+ {lang === 'uz' ? 'Yangi Sahna / Taymkod Qo\'shish' : 'Добавить новую сцену'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleGenerateVideoSubtitles()}
                      disabled={isGeneratingSubtitles}
                      className="px-3.5 py-2 bg-purple-950/60 hover:bg-purple-900/80 text-purple-300 border border-purple-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                      <span>{isGeneratingSubtitles ? 'Yaratilmoqda...' : lang === 'uz' ? 'AI Bilan Qaytadan Yaratish' : 'Пересоздать через AI'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Empty state when no segments created yet */
                <div className="p-8 text-center bg-zinc-950/80 border border-dashed border-zinc-800 rounded-2xl space-y-4">
                  <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 mx-auto">
                    <Clock className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      {lang === 'uz' ? 'Taymkodlar hali shakllantirilmadi' : 'Таймкоды еще не созданы'}
                    </h4>
                    <p className="text-xs text-zinc-400 max-w-md mx-auto mt-1 leading-relaxed">
                      {lang === 'uz'
                        ? `Video uchun 1 klikda AI taymkodlar ([00:00 - 00:05], [00:05 - 00:12]) va sinxron o'zbekcha dublyaj ssenariysini yarating:`
                        : `Создайте точные таймкоды ([00:00 - 00:05], [00:05 - 00:12]) и синхронный узбекский дубляж для видео в 1 клик:`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleGenerateVideoSubtitles()}
                      disabled={isGeneratingSubtitles}
                      className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-md shadow-purple-600/30 cursor-pointer"
                    >
                      <Sparkles className={`w-3.5 h-3.5 ${isGeneratingSubtitles ? 'animate-spin' : ''}`} />
                      <span>{isGeneratingSubtitles ? 'Yaratilmoqda...' : lang === 'uz' ? '⚡ 1-Klikda AI Taymkod va Subtitr Yaratish' : '⚡ Создать Таймкоды и Субтитры (AI)'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleAddSegment}
                      className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>+ {lang === 'uz' ? 'Qo\'lda 1-Taymkodni Qo\'shish' : 'Добавить таймкод вручную'}</span>
                    </button>
                  </div>
                </div>
              )
            ) : scriptViewMode === 'full' ? (
              /* Mode B: Full Timed Script Textarea */
              <div className="space-y-2">
                <textarea
                  rows={9}
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 text-xs sm:text-sm text-zinc-200 font-mono leading-relaxed focus:outline-none focus:border-purple-500 resize-y"
                  placeholder="[00:00 - 00:05] [Dinamik]: Sahnangiz matni..."
                />
                {conditionAnalysis.hasConditions && (
                  <button
                    type="button"
                    onClick={handleStripConditions}
                    className="px-3 py-1 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Eraser className="w-3.5 h-3.5 text-amber-400" />
                    <span>{lang === 'uz' ? 'Shartlarni tozalash' : 'Очистить от условий'}</span>
                  </button>
                )}
              </div>
            ) : (
              /* Mode C: Pure Spoken Speech */
              <div className="space-y-2">
                <textarea
                  rows={9}
                  value={conditionAnalysis.cleanText}
                  onChange={(e) => setScript(e.target.value)}
                  className="w-full bg-zinc-950 border border-emerald-500/30 rounded-xl p-3.5 text-xs sm:text-sm text-emerald-100 font-sans leading-relaxed focus:outline-none focus:border-emerald-500 resize-y"
                  placeholder="Faqat o'qiladigan toza matn..."
                />
              </div>
            )}

            {/* Target Duration & Style Preset Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-zinc-800">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-zinc-400" />
                  {lang === 'uz' ? 'Xronometraj:' : 'Хронометраж:'}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {['15s', '30s', '60s', '2m', '5m'].map((dur) => (
                    <button
                      key={dur}
                      onClick={() => setTargetDuration(dur)}
                      className={`flex-1 min-w-[45px] py-1.5 px-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer text-center ${
                        targetDuration === dur
                          ? 'bg-purple-600 text-white border-purple-400 font-bold'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      {dur}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-zinc-400" />
                  {lang === 'uz' ? 'Dublyaj ohangi:' : 'Настроение:'}
                </label>
                <select
                  value={stylePreset}
                  onChange={(e) => setStylePreset(e.target.value as any)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-purple-500"
                >
                  <option value="energetic_sales">Yuqori energiya & Reels (Dinamik)</option>
                  <option value="cinematic">Kinematik & Sirli (Cinematic)</option>
                  <option value="documentary">Hujjatli & Qat'iy diktor (Documentary)</option>
                  <option value="storytelling">Iliq hikoyachi & Samimiy (Storytelling)</option>
                  <option value="whisper">Mayin & Shivirlash (Whisper)</option>
                </select>
              </div>
            </div>

            {/* Synthesize CTA */}
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-zinc-400 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  {lang === 'uz'
                    ? 'Skobkalar va shartlar ovozda mutlaqo o\'qilmaydi.'
                    : 'Условия и ремарки не озвучиваются голосом.'}
                </span>
              </div>

              <button
                onClick={handleSynthesize}
                disabled={isSynthesizing || (!script.trim() && timelineSegments.length === 0)}
                className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-purple-600/25 cursor-pointer whitespace-nowrap"
              >
                <Volume2 className={`w-4 h-4 ${isSynthesizing ? 'animate-pulse' : ''}`} />
                {isSynthesizing
                  ? (lang === 'uz' ? 'Ovozlashtirilmoqda...' : 'Синтез речи...')
                  : (lang === 'uz' ? '🎙️ O\'zbekcha Ovozda Dublyaj Qilish (TTS)' : '🎙️ Озвучить на Узбекском')}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Synchronized Audio Player, Video Sync & Subtitles (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Audio Result & Sync Player */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/40 flex items-center justify-center text-xs font-bold">3</span>
                {lang === 'uz' ? 'Sinxron Dublyaj Natijasi' : 'Результат Дубляжа'}
              </h3>

              {uploadedMedia?.isVideo && resultAudio && (
                <button
                  type="button"
                  onClick={() => setMuteOriginalVideo(!muteOriginalVideo)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border transition-colors cursor-pointer ${
                    muteOriginalVideo
                      ? 'bg-purple-950/60 border-purple-500/40 text-purple-300'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-300'
                  }`}
                  title="Asl video ovozini o'chirish/yoqish"
                >
                  {muteOriginalVideo ? <VolumeX className="w-3 h-3 text-purple-400" /> : <Volume1 className="w-3 h-3" />}
                  <span>{muteOriginalVideo ? 'Asl ovoz o\'chiq' : 'Asl ovoz yoniq'}</span>
                </button>
              )}
            </div>

            {resultAudio ? (
              <div className="space-y-4">
                <audio
                  ref={audioRef}
                  src={`data:audio/wav;base64,${resultAudio}`}
                  onTimeUpdate={() => {
                    if (audioRef.current) {
                      setPlaybackTime(audioRef.current.currentTime);
                    }
                  }}
                  onEnded={() => setIsPlaying(false)}
                />

                {/* Player Box */}
                <div className="p-4 rounded-xl bg-zinc-950 border border-purple-500/30 flex items-center gap-4">
                  <button
                    onClick={togglePlay}
                    className="w-12 h-12 rounded-xl bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center transition-transform hover:scale-105 shadow-md shadow-purple-600/30 cursor-pointer"
                  >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                  </button>

                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span>
                        {lang === 'uz' ? 'Vaqt:' : 'Время:'}{' '}
                        <span className="text-purple-300 font-mono font-bold">
                          {Math.floor(playbackTime / 60).toString().padStart(2, '0')}:
                          {Math.floor(playbackTime % 60).toString().padStart(2, '0')}
                        </span>{' '}
                        / <span className="text-white font-mono">{audioDuration}s</span>
                      </span>
                      {uploadedMedia?.isVideo && (
                        <span className="text-purple-400 font-semibold">• Video sinxron</span>
                      )}
                    </div>

                    {/* Visualizer Wave */}
                    <div className="flex items-center gap-1 mt-2 h-7">
                      {[40, 70, 30, 90, 60, 100, 80, 50, 95, 45, 85, 65, 30, 75, 55, 90, 40].map((h, i) => (
                        <div
                          key={i}
                          className={`w-1 rounded-full transition-all ${
                            isPlaying ? 'bg-purple-400 animate-pulse' : 'bg-zinc-700'
                          }`}
                          style={{ height: `${h}%` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Speed & Audio Ducking Controls */}
                <div className="p-3.5 bg-zinc-950 rounded-xl border border-zinc-800 space-y-3 text-xs">
                  {/* Playback Speed */}
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400 font-medium flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-zinc-400" />
                      {lang === 'uz' ? 'Dublyaj tezligi:' : 'Скорость речи:'}
                    </span>
                    <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800">
                      {[0.8, 1.0, 1.1, 1.25].map((spd) => (
                        <button
                          key={spd}
                          type="button"
                          onClick={() => handleSpeedChange(spd)}
                          className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer transition-colors ${
                            playbackSpeed === spd
                              ? 'bg-purple-600 text-white font-bold'
                              : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          {spd}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Original Video Background Volume (Ducking) */}
                  {uploadedMedia?.isVideo && (
                    <div className="space-y-1.5 pt-2 border-t border-zinc-800/80">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-zinc-400 flex items-center gap-1.5">
                          <Volume2 className="w-3.5 h-3.5 text-purple-400" />
                          {lang === 'uz' ? 'Asl video foni (Ducking):' : 'Фон видео (Ducking):'}
                        </span>
                        <span className="font-mono text-purple-300 font-bold">
                          {Math.round(originalVolume * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={originalVolume}
                        onChange={(e) => handleOriginalVolumeChange(parseFloat(e.target.value))}
                        className="w-full accent-purple-500 cursor-pointer h-1.5 bg-zinc-800 rounded-lg"
                      />
                    </div>
                  )}

                  {/* Subtitle Theme for Video Overlay */}
                  <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                        {lang === 'uz' ? 'Videodagi subtitr uslubi:' : 'Стиль субтитров на видео:'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowSubtitleOverlay(!showSubtitleOverlay)}
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded cursor-pointer ${
                          showSubtitleOverlay ? 'bg-purple-500/20 text-purple-300' : 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        {showSubtitleOverlay ? (lang === 'uz' ? 'Yoniq' : 'Вкл') : (lang === 'uz' ? 'O\'chiq' : 'Выкл')}
                      </button>
                    </div>

                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { id: 'reels_yellow', label: '🟨 Reels', desc: 'Sariq' },
                        { id: 'classic_white', label: '⬜ Oq', desc: 'Klassik' },
                        { id: 'neon_cyan', label: '🟦 Neon', desc: 'Moviy' },
                        { id: 'cinema', label: '🎬 Kino', desc: 'Dramatik' },
                      ].map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => setSubtitleStyle(st.id as any)}
                          className={`py-1 px-1.5 rounded-lg text-center text-[10px] font-medium border transition-colors cursor-pointer ${
                            subtitleStyle === st.id
                              ? 'bg-purple-950 border-purple-500 text-purple-200 font-bold'
                              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                          }`}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Actions: Save to CMS & Download WAV */}
                <div className="space-y-2">
                  {onSaveToCMS && (
                    <button
                      onClick={handleSaveToCMS}
                      className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 border border-zinc-700 transition-all hover:scale-[1.01] cursor-pointer"
                    >
                      {isSaved ? <Check className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4 text-purple-400" />}
                      <span>{isSaved ? 'CMS Kutubxonasiga Saqlandi!' : 'CMS Kutubxonasiga Saqlash'}</span>
                    </button>
                  )}

                  <button
                    onClick={downloadAudio}
                    className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-md shadow-purple-600/20"
                  >
                    <Download className="w-4 h-4" />
                    {lang === 'uz' ? 'WAV Audioni Yuklab Olish' : 'Скачать WAV аудио'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-8 rounded-xl bg-zinc-950/60 border border-dashed border-zinc-800 text-center space-y-2">
                <Volume2 className="w-8 h-8 text-zinc-600 mx-auto" />
                <p className="text-xs text-zinc-400 font-medium">
                  {lang === 'uz' ? 'Dublyaj audio hali yaratilmadi' : 'Дубляж еще не сгенерирован'}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {lang === 'uz'
                    ? 'Chap paneldagi "O\'zbekcha Ovozda Dublyaj Qilish" tugmasini bosing.'
                    : 'Нажмите "Озвучить на Узбекском" на панели слева.'}
                </p>
              </div>
            )}
          </div>

          {/* Subtitles Box (SRT / VTT) */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/40 flex items-center justify-center text-xs font-bold">4</span>
                {lang === 'uz' ? 'Sinxron Subtitrlar (SRT / VTT)' : 'Синхронные Субтитры (SRT / VTT)'}
              </h3>

              {/* Subtitle Format Tabs */}
              <div className="flex items-center bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-xs">
                <button
                  onClick={() => setActiveSubTab('srt')}
                  className={`px-2.5 py-1 rounded-md font-mono cursor-pointer ${
                    activeSubTab === 'srt' ? 'bg-purple-600 text-white font-bold' : 'text-zinc-400'
                  }`}
                >
                  .SRT
                </button>
                <button
                  onClick={() => setActiveSubTab('vtt')}
                  className={`px-2.5 py-1 rounded-md font-mono cursor-pointer ${
                    activeSubTab === 'vtt' ? 'bg-purple-600 text-white font-bold' : 'text-zinc-400'
                  }`}
                >
                  .VTT
                </button>
              </div>
            </div>

            {srtSubtitles ? (
              <div className="space-y-3">
                <pre className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 text-[11px] text-zinc-300 font-mono max-h-56 overflow-y-auto leading-relaxed">
                  {activeSubTab === 'srt' ? srtSubtitles : vttSubtitles}
                </pre>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={copySubtitles}
                    className="py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copiedSubtitle ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedSubtitle ? 'Nusxalandi!' : 'Nusxa olish'}
                  </button>
                  <button
                    onClick={downloadSrt}
                    className="py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm shadow-purple-600/20 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    .{activeSubTab.toUpperCase()} Yuklab Olish
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-zinc-950/60 border border-zinc-800 text-center text-xs text-zinc-500">
                {lang === 'uz'
                  ? 'Subtitrlar audio sintez qilingandan so\'ng avtomatik paydo bo\'ladi.'
                  : 'Субтитры появятся автоматически после озвучивания.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
