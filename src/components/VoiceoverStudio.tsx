import React, { useState, useRef, useMemo, useEffect } from 'react';
import { VoiceProfile, VoiceoverFormat, VideoSourceMode, DubbingTimelineSegment } from '../types/podcast';
import { authFetch } from '../utils/authFetch';
import { useGenerationCountdown } from '../hooks/useGenerationCountdown';
import {
  GenerationCountdownHUD,
  PreCalculationBadge,
} from './GenerationCountdownHUD';
import {
  Film,
  Sparkles,
  Play,
  Pause,
  Square,
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
  Lock,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getVoicePreviewUrl } from '../data/voicePreviews';
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
  const { isAuthenticated, requireAuth, useCredit, syncCredits, logGeneration } = useAuth();

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

  // Pipeline Stepper and Extracted Audio State
  const [pipelineCurrentStage, setPipelineCurrentStage] = useState<'idle' | 'download' | 'extract' | 'transcribe' | 'translate' | 'complete' | 'error'>('idle');
  const [extractedAudioBase64, setExtractedAudioBase64] = useState<string | null>(null);
  const [extractedAudioDuration, setExtractedAudioDuration] = useState<number>(0);
  const [pipelineVideoDuration, setPipelineVideoDuration] = useState<number>(0);
  const [pipelineAttemptLog, setPipelineAttemptLog] = useState<any | null>(null);
  const [showAttemptLogDetails, setShowAttemptLogDetails] = useState<boolean>(false);
  const [showAuditLogsModal, setShowAuditLogsModal] = useState<boolean>(false);
  const [auditLogsList, setAuditLogsList] = useState<any[]>([]);
  const [isLoadingAuditLogs, setIsLoadingAuditLogs] = useState<boolean>(false);

  // Analysis & Segments
  const [isAnalyzingMedia, setIsAnalyzingMedia] = useState(false);
  const [analysisProgressText, setAnalysisProgressText] = useState<string>('');
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [timelineSegments, setTimelineSegments] = useState<DubbingTimelineSegment[]>([]);

  // Custom original speech input (when video has no public captions)
  const [customSpeechText, setCustomSpeechText] = useState<string>('');
  const [isTranslatingCustomSpeech, setIsTranslatingCustomSpeech] = useState<boolean>(false);
  const [showCustomSpeechInput, setShowCustomSpeechInput] = useState<boolean>(false);

  // Script & Editing
  const [script, setScript] = useState<string>(
    `[00:00 - 00:05] [Dinamik]: Video uchun birinchi sahna dublyaji...\n[00:05 - 00:12] [Kinematik]: Ikkinchi sahna va voqealar rivoji...\n[00:12 - 00:20] [Jiddiy]: Asosiy xulosa va yakun.`
  );

  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isGeneratingSubtitles, setIsGeneratingSubtitles] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Pre-calculate estimated generation duration for dubbing
  const dubbingWordCount = (script || '').trim().split(/\s+/).filter(Boolean).length;
  const estimatedDubbingSeconds = Math.max(4, Math.round(3.0 + (dubbingWordCount / 85)));
  const dubbingCountdown = useGenerationCountdown(isSynthesizing, estimatedDubbingSeconds, lang);

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
  const [subtitleStyle, setSubtitleStyle] = useState<'reels_yellow' | 'classic_white' | 'neon_amber' | 'cinema'>('reels_yellow');
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

  // Built-in instant audio preview (Zero token usage, pre-saved files)
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const toggleVoicePreview = (voiceIdToPlay: string) => {
    if (isPlayingPreview) {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current.currentTime = 0;
      }
      setIsPlayingPreview(false);
      return;
    }
    const prof = voices.find((v) => v.id === voiceIdToPlay) || activeVoice;
    const url = prof?.sampleAudioUrl || getVoicePreviewUrl(voiceIdToPlay) || `/api/voices/preview/${voiceIdToPlay}`;
    if (!previewAudioRef.current) {
      previewAudioRef.current = new Audio(url);
    } else {
      previewAudioRef.current.src = url;
    }
    previewAudioRef.current.volume = 0.95;
    previewAudioRef.current.onended = () => setIsPlayingPreview(false);
    previewAudioRef.current.onerror = () => setIsPlayingPreview(false);
    previewAudioRef.current
      .play()
      .then(() => setIsPlayingPreview(true))
      .catch(() => setIsPlayingPreview(false));
  };

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

  // Fetch audit logs of recent attempts
  const fetchAuditLogs = async () => {
    setIsLoadingAuditLogs(true);
    try {
      const res = await authFetch('/api/voiceover/pipeline-logs');
      if (res.ok) {
        const data = await res.json();
        setAuditLogsList(data.logs || []);
      }
    } catch (e) {
      console.warn("Audit logs fetch failed:", e);
    } finally {
      setIsLoadingAuditLogs(false);
    }
  };

  // Analyze uploaded video/audio: Transcribe original speech & Translate to synchronized Uzbek
  const handleAnalyzeAndTranslateMedia = async () => {
    if (!uploadedMedia?.base64) {
      alert(lang === 'uz' ? 'Iltimos, avval video yoki audio fayl yuklang' : 'Сначала загрузите видео или аудио файл');
      return;
    }

    setIsAnalyzingMedia(true);
    setPipelineCurrentStage('extract');
    setAnalysisProgressText(
      lang === 'uz' ? '1/3. Audioni ajratish va tekshirish (FFmpeg)...' : '1/3. Извлечение аудио (FFmpeg)...'
    );

    const t1 = setTimeout(() => {
      setPipelineCurrentStage('transcribe');
      setAnalysisProgressText(
        lang === 'uz' ? '2/3. Nutqni so\'zma-so\'z aniqlash & Diarizatsiya (AI Engine)...' : '2/3. Распознавание речи и разделение говорящих...'
      );
    }, 2500);

    const t2 = setTimeout(() => {
      setPipelineCurrentStage('translate');
      setAnalysisProgressText(
        lang === 'uz' ? '3/3. O\'zbek tiliga xronometraj bo\'yicha sinxron tarjima...' : '3/3. Синхронный перевод на узбекский...'
      );
    }, 6000);

    try {
      const res = await authFetch('/api/voiceover/process-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaBase64: uploadedMedia.base64,
          mimeType: uploadedMedia.type,
          videoTitle: uploadedMedia.name,
        }),
      });

      clearTimeout(t1);
      clearTimeout(t2);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Tahlil jarayonida xatolik');
      }

      const data = await res.json();
      if (data.attemptLog) setPipelineAttemptLog(data.attemptLog);

      if (data.success) {
        setPipelineCurrentStage('complete');
        if (data.extractedAudioBase64) {
          setExtractedAudioBase64(data.extractedAudioBase64);
        }
        if (data.audioDuration) setExtractedAudioDuration(data.audioDuration);
        if (data.videoDuration) setPipelineVideoDuration(data.videoDuration);

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
      } else {
        setPipelineCurrentStage('error');
        alert(data.error || 'Pipeline jarayonida xatolik');
      }
    } catch (e: any) {
      clearTimeout(t1);
      clearTimeout(t2);
      setPipelineCurrentStage('error');
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsAnalyzingMedia(false);
      setAnalysisProgressText('');
    }
  };

  // Check URL (YouTube, Reels, TikTok, Twitter, Direct)
  const handleCheckUrl = async () => {
    if (!inputUrl.trim()) return;
    setIsUrlChecking(true);
    setUrlStatus(null);
    setPipelineAttemptLog(null);
    setPipelineCurrentStage('download');

    // Progress timers across the 4 stages for user feedback
    const t1 = setTimeout(() => setPipelineCurrentStage('extract'), 2000);
    const t2 = setTimeout(() => setPipelineCurrentStage('transcribe'), 4500);
    const t3 = setTimeout(() => setPipelineCurrentStage('translate'), 8000);

    try {
      const res = await authFetch('/api/voiceover/fetch-media-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: inputUrl }),
      });
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);

      const data = await res.json();
      setUrlStatus(data);
      if (data.attemptLog) setPipelineAttemptLog(data.attemptLog);

      if (data.status === 'success' || data.status === 'transcript_only') {
        setPipelineCurrentStage('complete');
        if (data.status === 'transcript_only') {
          setExtractedAudioBase64(null);
        } else if (data.audioBase64) {
          setExtractedAudioBase64(data.audioBase64);
        } else {
          setExtractedAudioBase64(null);
        }

        if (data.audioDuration) setExtractedAudioDuration(data.audioDuration);
        if (data.videoDuration) setPipelineVideoDuration(data.videoDuration);

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

        // Populating verbatim segments & Uzbek translation
        if (data.segments && Array.isArray(data.segments) && data.segments.length > 0) {
          setTimelineSegments(data.segments);
          setScriptViewMode('timeline');
          if (data.fullTimedScript) setScript(data.fullTimedScript);
          else if (data.cleanUzbekScript) setScript(data.cleanUzbekScript);
          if (data.detectedLanguage) setDetectedLanguage(data.detectedLanguage);
          if (data.suggestedTopic) setTopic(data.suggestedTopic);
        }
      } else {
        setPipelineCurrentStage('error');
        if (data.embedUrl) {
          setEmbeddedVideoUrl(data.embedUrl);
        }
        setTimelineSegments([]);
      }
    } catch (e: any) {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      setPipelineCurrentStage('error');
      setUrlStatus({ status: 'error', message: e.message });
    } finally {
      setIsUrlChecking(false);
    }
  };

  // Translate user's provided original speech text without hallucination
  const handleTranslateCustomSpeech = async () => {
    if (!customSpeechText.trim()) return;
    setIsTranslatingCustomSpeech(true);
    try {
      const res = await authFetch('/api/voiceover/translate-custom-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalText: customSpeechText.trim(),
          videoTitle: topic || "Video Dublyaji",
          targetDuration,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Nutqni tarjima qilishda xatolik');
      }

      const data = await res.json();
      if (data.segments && Array.isArray(data.segments) && data.segments.length > 0) {
        setTimelineSegments(data.segments);
        setScriptViewMode('timeline');
      }
      if (data.fullTimedScript) setScript(data.fullTimedScript);
      else if (data.cleanUzbekScript) setScript(data.cleanUzbekScript);
      if (data.detectedLanguage) setDetectedLanguage(data.detectedLanguage);
      if (data.suggestedTopic) setTopic(data.suggestedTopic);
      setShowCustomSpeechInput(false);
    } catch (err: any) {
      alert(`Xatolik: ${err.message}`);
    } finally {
      setIsTranslatingCustomSpeech(false);
    }
  };

  // Generate or regenerate AI video subtitles and timecodes
  const handleGenerateVideoSubtitles = async (overrideTopic?: string) => {
    setIsGeneratingSubtitles(true);
    try {
      const topicToUse = overrideTopic || topic || "Video Dublyaji";
      const res = await authFetch('/api/voiceover/generate-video-subtitles', {
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
    if (
      !requireAuth(
        () => {},
        lang === 'uz'
          ? "Video dublyaj ssenariysi yaratish faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq. Avval tizimga kiring!"
          : "Генерация сценария доступна только для зарегистрированных пользователей."
      )
    )
      return;

    setIsGeneratingScript(true);
    try {
      const res = await authFetch('/api/voiceover/generate-script', {
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
    if (
      !requireAuth(
        () => {},
        lang === 'uz'
          ? "Video ovozini sintez qilish faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq. Begonalar bepul API limitlarini sarflay olmaydi. Avval kiring!"
          : "Синтез озвучки доступен только для зарегистрированных пользователей."
      )
    )
      return;

    // If in timeline mode, compile latest segments into speech script
    let textToVoice = script;
    if (scriptViewMode === 'timeline' && timelineSegments.length > 0) {
      textToVoice = timelineSegments.map((s) => `[${s.start} - ${s.end}] ${s.uzbekText}`).join('\n');
    }

    if (!textToVoice.trim()) return;
    setIsSynthesizing(true);

    try {
      const res = await authFetch('/api/voiceover/synthesize', {
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
        let errMessage = lang === 'uz' ? 'Dublyaj sintezida xatolik yuz berdi' : 'Ошибка при синтезе дубляжа';
        try {
          const err = await res.json();
          errMessage = (lang === 'ru' && err.message_ru) ? err.message_ru : (err.message || err.error || errMessage);
        } catch {
          const raw = await res.text().catch(() => '');
          if (res.status === 504 || res.status === 500) {
            errMessage = lang === 'uz'
              ? 'Server javob berish vaqti tugadi yoki server band. Iltimos, qaytadan urinib ko\'ring.'
              : 'Время ожидания ответа сервера истекло. Пожалуйста, попробуйте еще раз.';
          } else if (raw) {
            errMessage = raw;
          }
        }
        throw new Error(errMessage);
      }

      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new Error(
          lang === 'uz'
            ? 'Serverdan kutilmagan javob qaytdi. Qaytadan urinib ko\'ring.'
            : 'Сервер вернул неожиданный ответ. Попробуйте еще раз.'
        );
      }
      setResultAudio(data.audioBase64);
      setAudioDuration(data.durationSeconds || 0);
      setSrtSubtitles(data.srtSubtitles || '');
      setVttSubtitles(data.vttSubtitles || '');
      setIsPlaying(false);

      // Sync remaining credits or fallback
      if (typeof data.creditsRemaining === 'number') {
        syncCredits(data.creditsRemaining);
      } else {
        await useCredit(1);
      }
      await logGeneration('dubbing', topic || 'Video Dublyaj', 1);
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
      <div className="border border-[rgba(22,21,17,0.14)] rounded-[22px] bg-[rgba(255,255,255,0.52)] backdrop-blur-md p-6 sm:p-7 relative overflow-hidden shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 relative z-10">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62] border border-[rgba(14,124,134,0.35)] rounded-full px-3 py-1 bg-white/60 flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-[#0E7C86]" />
                {lang === 'uz' ? 'Reels & Video Dublyaj Studiyasi' : 'Студия Дубляжа Reels и Видео'}
              </span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#C4552D] border border-[rgba(196,85,45,0.35)] rounded-full px-2.5 py-0.5 bg-[#C4552D]/5">
                Multimodal STT + Flash TTS
              </span>
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl text-[#161511] font-normal tracking-tight leading-tight">
              {lang === 'uz' ? (
                <>Instagram Reels, Shorts va Video <em>Dublyaj</em></>
              ) : (
                <>Дубляж Reels, Shorts и Видео на <em>Узбекский</em></>
              )}
            </h1>
            <p className="text-[#5D594E] text-sm mt-1.5 max-w-2xl leading-relaxed">
              {lang === 'uz'
                ? "Asl rolikni yuklang (inglizcha, ruscha va b.), AI uni taymkodlari bilan eshitadi va o'zbek tilida aynan o'sha vaqtga moslab («qanday aytilgan bo'lsa, shunday») sinxron ovozlashtiradi."
                : "Загрузите оригинал (Reels/Shorts). AI распознает таймкоды оригинала и синхронно переведет с точным дубляжом на узбекский язык («как озвучено, так и озвучивать»)."}
            </p>
          </div>

          {/* Action & Active Voice Pill */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                fetchAuditLogs();
                setShowAuditLogsModal(true);
              }}
              className="bg-white border border-[rgba(22,21,17,0.14)] hover:border-[#161511] p-2.5 sm:p-3 rounded-2xl flex items-center gap-2.5 text-[#161511] transition-all cursor-pointer shadow-xs"
              title="Pipeline urinishlari va server jurnali"
            >
              <div className="w-8 h-8 rounded-xl bg-[#0E7C86]/10 border border-[#0E7C86]/20 flex items-center justify-center text-[#0E7C86]">
                <FileText className="w-4 h-4" />
              </div>
              <div className="text-left">
                <p className="text-[10px] text-[#5D594E] uppercase font-mono tracking-wider">
                  {lang === 'uz' ? 'Jurnal:' : 'Лог:'}
                </p>
                <p className="text-xs font-bold text-[#161511] flex items-center gap-1">
                  <span>{lang === 'uz' ? 'Audit Jurnali' : 'Журнал'}</span>
                </p>
              </div>
            </button>

            <div className="bg-white border border-[rgba(22,21,17,0.14)] p-3 rounded-2xl flex items-center gap-3 shadow-xs">
              <button
                type="button"
                onClick={() => toggleVoicePreview(activeVoice.id)}
                className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-base transition-all cursor-pointer ${
                  isPlayingPreview
                    ? 'bg-[#0E7C86] text-white shadow-sm animate-pulse'
                    : 'bg-[#161511] text-[#F4F1EA] hover:bg-[#0A5A62]'
                }`}
                title={
                  isPlayingPreview
                    ? (lang === 'uz' ? "To'xtatish" : 'Остановить')
                    : (lang === 'uz' ? "Ovoz namunasini tinglash" : 'Прослушать голос')
                }
              >
                {isPlayingPreview ? (
                  <Square className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-current translate-x-0.5" />
                )}
              </button>
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] text-[#5D594E] uppercase font-mono tracking-wider font-semibold">
                    {lang === 'uz' ? 'Dublyaj Ovozi:' : 'Голос Дубляжа:'}
                  </p>
                  <span className="text-[10px] text-[#0E7C86] font-mono">
                    {isPlayingPreview ? '0s kutish' : 'Namuna'}
                  </span>
                </div>
                <select
                  value={selectedVoiceId}
                  onChange={(e) => onSelectVoiceId(e.target.value)}
                  className="bg-[#F4F1EA]/60 text-[#161511] font-semibold text-xs rounded-xl px-2 py-1 mt-0.5 border border-[rgba(22,21,17,0.1)] outline-none cursor-pointer max-w-[190px] truncate"
                >
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} {v.isReplicatedVoice ? '★ (Ovoz Nusxam)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* STEP 1: Source Selection Mode Tabs */}
      <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-[rgba(255,255,255,0.52)] backdrop-blur-sm p-6 space-y-4 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62] flex-1">
            <span>01 — Dublyaj uchun manbani tanlang</span>
            <span className="h-[1px] flex-1 bg-[rgba(22,21,17,0.14)] mr-3" />
          </div>

          {/* 3 Source Switchers */}
          <div className="flex items-center gap-1.5 bg-[#F4F1EA] p-1 rounded-full border border-[rgba(22,21,17,0.1)] text-xs">
            <button
              onClick={() => setSourceMode('file_upload')}
              className={`btn-pill text-xs py-1.5 px-3.5 transition-all flex items-center gap-1.5 cursor-pointer ${
                sourceMode === 'file_upload'
                  ? 'bg-[#161511] text-[#F4F1EA] font-semibold border-[#161511]'
                  : 'bg-transparent text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'Video / Audio Fayl' : 'Файл Видео/Аудио'}</span>
            </button>

            <button
              onClick={() => setSourceMode('video_url')}
              className={`btn-pill text-xs py-1.5 px-3.5 transition-all flex items-center gap-1.5 cursor-pointer ${
                sourceMode === 'video_url'
                  ? 'bg-[#161511] text-[#F4F1EA] font-semibold border-[#161511]'
                  : 'bg-transparent text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              <LinkIcon className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'Havola (Reels / Link)' : 'Ссылка (Reels/Link)'}</span>
            </button>

            <button
              onClick={() => setSourceMode('script_text')}
              className={`btn-pill text-xs py-1.5 px-3.5 transition-all flex items-center gap-1.5 cursor-pointer ${
                sourceMode === 'script_text'
                  ? 'bg-[#161511] text-[#F4F1EA] font-semibold border-[#161511]'
                  : 'bg-transparent text-[#5D594E] hover:text-[#161511]'
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
                    ? 'border-[#0E7C86] bg-[rgba(14,124,134,0.06)] scale-[1.01]'
                    : 'border-[rgba(22,21,17,0.2)] bg-white/70 hover:border-[#0E7C86] hover:bg-white'
                }`}
              >
                <div className="w-14 h-14 rounded-2xl bg-[#0E7C86]/10 border border-[#0E7C86]/20 flex items-center justify-center text-[#0E7C86]">
                  <FileVideo className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#161511]">
                    {lang === 'uz'
                      ? 'Reels yoki videoni bu yerga tashlang yoki tanlang'
                      : 'Перетащите сюда Reels или видео файл (MP4, MOV, MP3)'}
                  </p>
                  <p className="text-xs text-[#5D594E] mt-1">
                    {lang === 'uz'
                      ? "MP4, MOV, WebM, MP3, M4A formatlari qo'llab-quvvatlanadi (Reels 9:16 yoki 16:9)"
                      : 'Поддерживаются MP4, MOV, WebM, MP3, M4A (Reels 9:16 или 16:9)'}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-pill btn-solid text-xs py-2 px-4 flex items-center gap-1.5 shadow-xs"
                >
                  <Upload className="w-3.5 h-3.5 text-[#5CC8CF]" />
                  <span>{lang === 'uz' ? 'Faylni Tanlash' : 'Выбрать файл'}</span>
                </button>
              </div>
            ) : (
              /* Uploaded File Details & Video Preview */
              <div className="bg-white border border-[rgba(22,21,17,0.14)] rounded-2xl p-4 sm:p-5 space-y-4 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[rgba(22,21,17,0.08)] pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#0E7C86]/10 border border-[#0E7C86]/20 flex items-center justify-center text-[#0E7C86]">
                      {uploadedMedia.isVideo ? <Video className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="text-xs sm:text-sm font-bold text-[#161511] truncate max-w-xs sm:max-w-md">
                        {uploadedMedia.name}
                      </p>
                      <p className="text-[11px] text-[#5D594E] font-mono">
                        {(uploadedMedia.size / (1024 * 1024)).toFixed(2)} MB • {uploadedMedia.type}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="btn-pill btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-[#0E7C86]" />
                      <span>{lang === 'uz' ? 'Boshqa fayl' : 'Заменить'}</span>
                    </button>
                    <button
                      onClick={() => {
                        setUploadedMedia(null);
                        setTimelineSegments([]);
                        setDetectedLanguage(null);
                      }}
                      className="p-1.5 text-[#5D594E] hover:text-[#C4552D] rounded-full hover:bg-[rgba(196,85,45,0.08)] transition-colors cursor-pointer"
                      title="O'chirish"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Video Preview and Dubbing Action */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                  {uploadedMedia.isVideo ? (
                    <div className="md:col-span-5 bg-[#141414] rounded-xl overflow-hidden border border-[#2B2B27] relative aspect-[9/16] sm:aspect-video max-h-72 flex items-center justify-center mx-auto group">
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
                                : subtitleStyle === 'neon_amber'
                                ? 'bg-black/90 text-amber-300 font-extrabold text-xs sm:text-sm px-3.5 py-1.5 rounded-xl border border-amber-400 shadow-[0_0_15px_rgba(6,182,212,0.6)]'
                                : 'bg-zinc-950/95 text-amber-100 font-serif italic text-xs sm:text-sm px-4 py-1.5 rounded-lg border-b-2 border-amber-500 shadow-xl'
                            }`}
                          >
                            {activeSegment.uzbekText}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="md:col-span-5 bg-[#F4F1EA] p-4 rounded-xl border border-[rgba(22,21,17,0.1)] flex items-center gap-3">
                      <Volume2 className="w-8 h-8 text-[#0E7C86] shrink-0" />
                      <audio src={uploadedMedia.url} controls className="w-full" />
                    </div>
                  )}

                  <div className="md:col-span-7 space-y-3">
                    <div className="p-3.5 bg-[#F4F1EA] border border-[rgba(22,21,17,0.1)] rounded-xl space-y-1 text-xs">
                      <p className="font-semibold text-[#161511] flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[#0E7C86]" />
                        {lang === 'uz' ? 'Avtomatik Sinxron Dublyaj Algoritmi:' : 'Алгоритм Синхронного Дубляжа:'}
                      </p>
                      <p className="text-[#5D594E] leading-relaxed text-[11px]">
                        {lang === 'uz'
                          ? "Sun'iy intellekt rolikdagi nutqni eshitib, xronometraj bo'yicha (taymkodlar) segmentlarga ajratadi va o'zbek tiliga xuddi shu vaqt ichida jaranglaydigan qilib tarjima qiladi."
                          : 'ИИ анализирует речь, разбивает на таймкоды оригинала и генерирует перевод с идеальной укладкой в губы и длительность фраз.'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleAnalyzeAndTranslateMedia}
                      disabled={isAnalyzingMedia}
                      className="w-full btn-pill btn-solid text-xs sm:text-sm py-3 px-6 flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Sparkles className={`w-4 h-4 text-[#5CC8CF] ${isAnalyzingMedia ? 'animate-spin' : ''}`} />
                      <span>
                        {isAnalyzingMedia
                          ? analysisProgressText || (lang === 'uz' ? 'Tahlil qilinmoqda...' : 'Анализ...')
                          : lang === 'uz'
                          ? "⚡ Videoni Tahlil Qilish & O'zbekcha Dublyaj Yaratish"
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
                <Globe className="w-4 h-4 text-[#5D594E] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="url"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="https://www.instagram.com/reel/... yoki https://youtube.com/shorts/..."
                  className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-xl pl-10 pr-3.5 py-2.5 text-xs sm:text-sm text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                />
              </div>

              <button
                type="button"
                onClick={handleCheckUrl}
                disabled={isUrlChecking || !inputUrl.trim()}
                className="btn-pill btn-solid text-xs sm:text-sm py-2.5 px-5 flex items-center justify-center gap-1.5 shrink-0"
              >
                {isUrlChecking ? <RefreshCw className="w-4 h-4 animate-spin text-[#5CC8CF]" /> : <LinkIcon className="w-4 h-4 text-[#5CC8CF]" />}
                <span>{lang === 'uz' ? 'Havolani Tekshirish' : 'Проверить ссылку'}</span>
              </button>
            </div>

            {/* Platform Compatibility Status & Honest Limitation Notice */}
            <div className="p-4 rounded-2xl bg-[rgba(255,255,255,0.65)] border border-[rgba(22,21,17,0.14)] text-[12px] text-[#5D594E] space-y-1.5 shadow-2xs">
              <div className="flex items-center gap-2 text-[#161511] font-semibold">
                <span className="inline-block w-2 h-2 rounded-full bg-[#0E7C86]"></span>
                <span className="font-mono uppercase text-[11px] tracking-wider">{lang === "uz" ? "Platformalar bo'yicha holat:" : "Статус поддержки платформ:"}</span>
              </div>
              <p>
                {lang === "uz"
                  ? "• TikTok va to'g'ridan-to'g'ri MP4 havolalari avtomatik yuklanadi va to'liq qayta ishlanadi."
                  : "• TikTok и прямые MP4/MOV ссылки скачиваются и обрабатываются автоматически."}
              </p>
              <p className="text-[#C4552D] font-medium">
                {lang === "uz"
                  ? "• YouTube, Instagram va X / Twitter: Server IP-larida platformalar anti-bot va avtorizatsiya talab qiladi. Havola orqali yuklash cheklangan holatda tizim faylni qurilmangizdan (MP4/MP3) to'g'ridan-to'g'ri yuklashni taklif etadi."
                  : "• YouTube, Instagram и X / Twitter: Серверные IP блокируются защитой платформ (Sign in bot check / Meta auth / X guest token lock). При ограничении система сразу предлагает прямую загрузку MP4/MP3 с вашего устройства."}
              </p>
            </div>

            {/* 4-Stage Media Pipeline Stepper */}
            {(isUrlChecking || isAnalyzingMedia || pipelineCurrentStage !== 'idle') && (
              <div className="p-4 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-3 shadow-sm">
                <div className="flex items-center justify-between text-xs border-b border-[rgba(22,21,17,0.08)] pb-2">
                  <span className="font-bold text-[#161511] flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#0E7C86]" />
                    {lang === 'uz' ? 'OvozStudio Dublyaj Konveyeri (Pipeline):' : 'Конвейер Дубляжа (Pipeline):'}
                  </span>
                  <span className="text-[11px] font-mono text-[#0A5A62] font-semibold">
                    {pipelineCurrentStage === 'download' && (lang === 'uz' ? '1/4. Video yuklanmoqda...' : '1/4. Скачивание видео...')}
                    {pipelineCurrentStage === 'extract' && (lang === 'uz' ? '2/4. Audio ajratilmoqda (FFmpeg)...' : '2/4. Извлечение аудио (FFmpeg)...')}
                    {pipelineCurrentStage === 'transcribe' && (lang === 'uz' ? '3/4. Nutq aniqlanmoqda (Neural STT)...' : '3/4. Распознавание речи (Neural STT)...')}
                    {pipelineCurrentStage === 'translate' && (lang === 'uz' ? '4/4. O\'zbek tiliga sinxron tarjima...' : '4/4. Синхронный перевод на узбекский...')}
                    {pipelineCurrentStage === 'complete' && (lang === 'uz' ? '✅ Konveyer muvaffaqiyatli yakunlandi' : '✅ Конвейер успешно завершен')}
                    {pipelineCurrentStage === 'error' && (lang === 'uz' ? '⚠️ Xatolik yuz berdi' : '⚠️ Ошибка конвейера')}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {/* Step 1: Скачивание видео */}
                  <div className={`p-2.5 rounded-xl border text-xs transition-all flex items-center gap-2 ${
                    pipelineCurrentStage === 'download'
                      ? 'bg-[rgba(14,124,134,0.08)] border-[#0E7C86] text-[#0A5A62] ring-2 ring-[#0E7C86]/20'
                      : ['extract', 'transcribe', 'translate', 'complete'].includes(pipelineCurrentStage)
                      ? 'bg-[rgba(14,124,134,0.05)] border-[#0E7C86]/30 text-[#0A5A62]'
                      : 'bg-[#F4F1EA]/60 border-[rgba(22,21,17,0.1)] text-[#5D594E]'
                  }`}>
                    {pipelineCurrentStage === 'download' ? (
                      <RefreshCw className="w-3.5 h-3.5 text-[#0E7C86] animate-spin shrink-0" />
                    ) : ['extract', 'transcribe', 'translate', 'complete'].includes(pipelineCurrentStage) ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#0E7C86] shrink-0" />
                    ) : (
                      <Download className="w-3.5 h-3.5 shrink-0 text-[#5D594E]" />
                    )}
                    <div className="min-w-0">
                      <p className="font-bold truncate text-[11px]">1. {lang === 'uz' ? 'Video yuklash' : 'Скачивание'}</p>
                      <p className="text-[10px] text-[#5D594E] truncate font-mono">yt-dlp</p>
                    </div>
                  </div>

                  {/* Step 2: Извлечение аудио */}
                  <div className={`p-2.5 rounded-xl border text-xs transition-all flex items-center gap-2 ${
                    pipelineCurrentStage === 'extract'
                      ? 'bg-[rgba(14,124,134,0.08)] border-[#0E7C86] text-[#0A5A62] ring-2 ring-[#0E7C86]/20'
                      : ['transcribe', 'translate', 'complete'].includes(pipelineCurrentStage)
                      ? 'bg-[rgba(14,124,134,0.05)] border-[#0E7C86]/30 text-[#0A5A62]'
                      : 'bg-[#F4F1EA]/60 border-[rgba(22,21,17,0.1)] text-[#5D594E]'
                  }`}>
                    {pipelineCurrentStage === 'extract' ? (
                      <RefreshCw className="w-3.5 h-3.5 text-[#0E7C86] animate-spin shrink-0" />
                    ) : ['transcribe', 'translate', 'complete'].includes(pipelineCurrentStage) ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#0E7C86] shrink-0" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 shrink-0 text-[#5D594E]" />
                    )}
                    <div className="min-w-0">
                      <p className="font-bold truncate text-[11px]">2. {lang === 'uz' ? 'Audioni ajratish' : 'Извлечение'}</p>
                      <p className="text-[10px] text-[#5D594E] truncate font-mono">FFmpeg</p>
                    </div>
                  </div>

                  {/* Step 3: Распознавание речи */}
                  <div className={`p-2.5 rounded-xl border text-xs transition-all flex items-center gap-2 ${
                    pipelineCurrentStage === 'transcribe'
                      ? 'bg-[rgba(14,124,134,0.08)] border-[#0E7C86] text-[#0A5A62] ring-2 ring-[#0E7C86]/20'
                      : ['translate', 'complete'].includes(pipelineCurrentStage)
                      ? 'bg-[rgba(14,124,134,0.05)] border-[#0E7C86]/30 text-[#0A5A62]'
                      : 'bg-[#F4F1EA]/60 border-[rgba(22,21,17,0.1)] text-[#5D594E]'
                  }`}>
                    {pipelineCurrentStage === 'transcribe' ? (
                      <RefreshCw className="w-3.5 h-3.5 text-[#0E7C86] animate-spin shrink-0" />
                    ) : ['translate', 'complete'].includes(pipelineCurrentStage) ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#0E7C86] shrink-0" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 shrink-0 text-[#5D594E]" />
                    )}
                    <div className="min-w-0">
                      <p className="font-bold truncate text-[11px]">3. {lang === 'uz' ? 'Nutqni aniqlash' : 'Распознавание'}</p>
                      <p className="text-[10px] text-[#5D594E] truncate font-mono">Neural STT</p>
                    </div>
                  </div>

                  {/* Step 4: Перевод */}
                  <div className={`p-2.5 rounded-xl border text-xs transition-all flex items-center gap-2 ${
                    pipelineCurrentStage === 'translate'
                      ? 'bg-[rgba(14,124,134,0.08)] border-[#0E7C86] text-[#0A5A62] ring-2 ring-[#0E7C86]/20'
                      : pipelineCurrentStage === 'complete'
                      ? 'bg-[rgba(14,124,134,0.05)] border-[#0E7C86]/30 text-[#0A5A62]'
                      : 'bg-[#F4F1EA]/60 border-[rgba(22,21,17,0.1)] text-[#5D594E]'
                  }`}>
                    {pipelineCurrentStage === 'translate' ? (
                      <RefreshCw className="w-3.5 h-3.5 text-[#0E7C86] animate-spin shrink-0" />
                    ) : pipelineCurrentStage === 'complete' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#0E7C86] shrink-0" />
                    ) : (
                      <Globe className="w-3.5 h-3.5 shrink-0 text-[#5D594E]" />
                    )}
                    <div className="min-w-0">
                      <p className="font-bold truncate text-[11px]">4. {lang === 'uz' ? 'Sinxron tarjima' : 'Перевод'}</p>
                      <p className="text-[10px] text-[#5D594E] truncate font-mono">O'zbek tiliga</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Transcript Only Notice Card */}
            {urlStatus?.status === 'transcript_only' && (
              <div className="p-4 rounded-2xl bg-[rgba(201,138,18,0.08)] border border-[#C98A12]/30 space-y-2">
                <div className="flex items-center gap-2 text-[#C98A12] font-semibold text-xs sm:text-sm">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>
                    {lang === 'uz'
                      ? "Matn video tahlili orqali olindi (transcript_only rejimi)"
                      : "Транскрипт получен через видеоанализ (режим transcript_only)"}
                  </span>
                </div>
                <p className="text-[11px] text-[#5D594E] leading-relaxed">
                  {urlStatus.transcriptOnlyNotice ||
                    (lang === 'uz'
                      ? "YouTube to'g'ridan-to'g'ri audio oqimini yuklashni cheklagani sababli, audio fayl ajratilmadi va pleer ko'rsatilmaydi. Asl diktor ovozini eshitish va tayyor dublyajni to'liq montaj qilish uchun, iltimos, MP4 faylni yuklang."
                      : "Так как YouTube заблокировал прямое скачивание медиапотока, исходный аудиофайл не был извлечён и аудиоплеер не отображается. Для прослушивания оригинального аудио и полного монтажа дубляжа загрузите MP4 файл.")}
                </p>
              </div>
            )}

            {/* Extracted Original Audio Player Card */}
            {extractedAudioBase64 && (
              <div className="p-4 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-2.5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-[rgba(14,124,134,0.1)] text-[#0E7C86] border border-[#0E7C86]/20">
                      <Volume2 className="w-4 h-4" />
                    </span>
                    <div>
                      <p className="text-xs font-bold text-[#161511]">
                        {lang === 'uz' ? '🎧 Ajratib olingan asl audio oqim (Original Track)' : '🎧 Извлечённая аудиодорожка оригинала'}
                      </p>
                      <p className="text-[10px] text-[#5D594E]">
                        {lang === 'uz' ? 'FFmpeg orqali ajratilgan va STT ga uzatilgan haqiqiy audio' : 'Аудиодорожка, извлечённая через FFmpeg и переданная в анализатор'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {extractedAudioDuration > 0 && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#F4F1EA] text-[#5D594E] border border-[rgba(22,21,17,0.14)]">
                        Davomiyligi: {Math.round(extractedAudioDuration)}s
                      </span>
                    )}
                    <a
                      href={`data:audio/mp3;base64,${extractedAudioBase64}`}
                      download="extracted_original_audio.mp3"
                      className="btn-pill btn-ghost text-[11px] py-1 px-3 flex items-center gap-1.5"
                    >
                      <Download className="w-3 h-3 text-[#0E7C86]" />
                      <span>{lang === 'uz' ? 'MP3 Yuklab olish' : 'Скачать MP3'}</span>
                    </a>
                  </div>
                </div>

                <audio
                  src={`data:audio/mp3;base64,${extractedAudioBase64}`}
                  controls
                  className="w-full h-9 rounded-lg"
                />
              </div>
            )}

            {/* URL Status & Embedded Player */}
            {embeddedVideoUrl && (
              <div className="bg-[rgba(255,255,255,0.7)] border border-[rgba(22,21,17,0.14)] rounded-2xl p-4 sm:p-5 space-y-3 shadow-sm">
                <div className="flex items-center justify-between border-b border-[rgba(22,21,17,0.08)] pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#0E7C86] animate-pulse" />
                    <span className="text-xs sm:text-sm font-bold text-[#161511]">
                      {urlStatus?.platform || 'Video'}: {topic || 'YouTube Rolik'}
                    </span>
                  </div>
                  {timelineSegments.length > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full bg-[rgba(14,124,134,0.1)] text-[#0E7C86] text-xs font-semibold border border-[#0E7C86]/30 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      {lang === 'uz' ? 'Subtitrlar va taymkodlar sinxronlandi' : 'Субтитры синхронизированы'}
                    </span>
                  )}
                </div>

                {/* Video Monitor stage: dark screen accent */}
                <div className="aspect-video w-full rounded-xl overflow-hidden border border-[#2B2B27] bg-[#141414] relative max-h-80 mx-auto shadow-inner">
                  <iframe
                    src={embeddedVideoUrl}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>

                {/* Subtitle & Timecode Action Banner */}
                {timelineSegments.length > 0 && (
                  <div className="p-3 bg-white border border-[rgba(22,21,17,0.14)] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <span className="text-[#161511] flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="w-4 h-4 text-[#0E7C86] shrink-0" />
                      {lang === 'uz'
                        ? `🎉 ${timelineSegments.length} ta aniq taymkod va sahna subtitrlari tayyorlandi!`
                        : `🎉 ${timelineSegments.length} сцен с точными таймкодами и субтитрами готовы!`}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleGenerateVideoSubtitles()}
                      disabled={isGeneratingSubtitles}
                      className="btn-pill btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingSubtitles ? 'animate-spin' : ''} text-[#0E7C86]`} />
                      <span>{isGeneratingSubtitles ? 'Yangilanmoqda...' : lang === 'uz' ? 'Qaytadan yangilash' : 'Обновить'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Download Failure & Cloud Protection Banner */}
            {(urlStatus?.status === 'audio_upload_required' || (urlStatus?.status === 'error' && !embeddedVideoUrl)) && (
              <div className="p-4 sm:p-5 bg-white border border-[#C4552D]/30 rounded-2xl space-y-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[rgba(196,85,45,0.1)] border border-[#C4552D]/30 flex items-center justify-center text-[#C4552D] shrink-0 mt-0.5">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <div className="space-y-1 flex-1">
                    <h4 className="text-xs sm:text-sm font-bold text-[#161511]">
                      {lang === 'uz'
                        ? `Videoni to'g'ridan-to'g'ri yuklab bo'lmadi (${urlStatus.platform || 'Havola'})`
                        : `Не удалось напрямую скачать видео (${urlStatus.platform || 'Ссылка'})`}
                    </h4>
                    <p className="text-[11px] text-[#5D594E] leading-relaxed">
                      {urlStatus.message || (lang === 'uz'
                        ? 'Platforma server orqali to\'g\'ridan-to\'g\'ri video oqimini yuklashni cheklagan. Asl nutqni so\'zma-so\'z o\'zbekchaga o\'girish uchun quyidagi tugma orqali faylni yuklang:'
                        : 'Сервис ограничил скачивание видео с облачного сервера. Чтобы дословно перевести речь оригинала, загрузите видео или аудио файл:')}
                    </p>
                  </div>
                </div>

                {/* Primary Action Button */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSourceMode('file_upload');
                      fileInputRef.current?.click();
                    }}
                    className="w-full btn-pill btn-solid text-xs sm:text-sm py-3 px-4 flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4 text-[#5CC8CF]" />
                    <span>{lang === 'uz' ? '⚡ Qurilmadan yuklash (MP4 yoki MP3 fayl)' : '⚡ Загрузить с устройства (MP4 или MP3)'}</span>
                  </button>
                </div>

                {/* Collapsible Technical Attempt Log */}
                {pipelineAttemptLog && (
                  <div className="pt-2 border-t border-[rgba(22,21,17,0.08)]">
                    <button
                      type="button"
                      onClick={() => setShowAttemptLogDetails(!showAttemptLogDetails)}
                      className="text-[11px] font-mono text-[#0E7C86] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <FileText className="w-3 h-3" />
                      <span>{showAttemptLogDetails ? (lang === 'uz' ? 'Texnik jurnalni yashirish' : 'Скрыть тех-журнал') : (lang === 'uz' ? '🔍 Texnik urinish jurnalini ko\'rish' : '🔍 Показать тех-журнал попытки')}</span>
                    </button>

                    {showAttemptLogDetails && (
                      <div className="mt-2.5 p-3 rounded-xl bg-[#141414] border border-[#2B2B27] font-mono text-[10px] text-[#EDEAE2] space-y-1 overflow-x-auto shadow-inner">
                        <div className="flex justify-between border-b border-[#2B2B27] pb-1">
                          <span className="text-[#7D7A70]">Platforma:</span>
                          <span className="text-[#EDEAE2] font-bold">{pipelineAttemptLog.platform}</span>
                        </div>
                        <div className="flex justify-between border-b border-[#2B2B27] py-1">
                          <span className="text-[#7D7A70]">Downloader:</span>
                          <span className="text-[#EDEAE2]">{pipelineAttemptLog.downloaderVersion}</span>
                        </div>
                        <div className="flex justify-between border-b border-[#2B2B27] py-1">
                          <span className="text-[#7D7A70]">FFmpeg:</span>
                          <span className="text-[#EDEAE2]">{pipelineAttemptLog.ffmpegVersion}</span>
                        </div>
                        <div className="flex justify-between border-b border-[#2B2B27] py-1">
                          <span className="text-[#7D7A70]">Bosqich (Stage):</span>
                          <span className="text-[#C98A12] uppercase font-bold">{pipelineAttemptLog.stage}</span>
                        </div>
                        <div className="flex justify-between border-b border-[#2B2B27] py-1">
                          <span className="text-[#7D7A70]">Fayl hajmi:</span>
                          <span className="text-[#EDEAE2]">{pipelineAttemptLog.videoFileSize} bayt</span>
                        </div>
                        {pipelineAttemptLog.errorDetails && (
                          <div className="pt-1.5">
                            <span className="text-[#C4552D] font-bold block mb-1">Xatolik tafsiloti:</span>
                            <pre className="text-[#7D7A70] whitespace-pre-wrap text-[9px] bg-[#0E0E0D] p-2 rounded border border-[#2B2B27] max-h-24 overflow-y-auto">
                              {pipelineAttemptLog.errorDetails}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
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
                className="flex-1 bg-white border border-[rgba(22,21,17,0.14)] rounded-xl px-3.5 py-2 text-xs sm:text-sm text-[#161511] focus:outline-none focus:border-[#0E7C86] shadow-2xs"
              />

              <div className="flex items-center gap-2">
                {onOpenDocumentModal && (
                  <button
                    type="button"
                    onClick={onOpenDocumentModal}
                    className="btn-pill btn-ghost text-xs py-2 px-3 flex items-center gap-1.5 font-medium"
                  >
                    <Upload className="w-3.5 h-3.5 text-[#0E7C86]" />
                    <span>{lang === 'uz' ? 'PDF / Maqola' : 'Из PDF'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleGenerateScript}
                  disabled={isGeneratingScript || !topic.trim()}
                  className="btn-pill btn-teal text-xs sm:text-sm py-2 px-4 flex items-center gap-1.5 disabled:opacity-50"
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
          <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-[rgba(255,255,255,0.52)] backdrop-blur-sm p-6 space-y-4 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62]">
                <span>02 — Sinxron dublyaj matni & taymkodlar</span>
                {detectedLanguage && (
                  <span className="font-mono text-[10px] text-[#0E7C86] border border-[#0E7C86]/30 px-2 py-0.5 rounded-full bg-[#0E7C86]/5">
                    {detectedLanguage}
                  </span>
                )}
              </div>

              {/* View Mode Switcher */}
              <div className="flex items-center gap-1 bg-[#F4F1EA] p-1 rounded-full border border-[rgba(22,21,17,0.1)] text-xs">
                <button
                  type="button"
                  onClick={() => setScriptViewMode('timeline')}
                  className={`btn-pill text-xs py-1 px-3 transition-all flex items-center gap-1.5 cursor-pointer ${
                    scriptViewMode === 'timeline'
                      ? 'bg-[#161511] text-[#F4F1EA] font-semibold border-[#161511]'
                      : 'bg-transparent text-[#5D594E] hover:text-[#161511]'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{lang === 'uz' ? '⏱️ Taymlayn' : '⏱️ Таймлайн'}</span>
                  {timelineSegments.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.2 rounded-full bg-[#0E7C86] text-[10px] font-bold text-white">
                      {timelineSegments.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setScriptViewMode('full')}
                  className={`btn-pill text-xs py-1 px-3 transition-all flex items-center gap-1 cursor-pointer ${
                    scriptViewMode === 'full'
                      ? 'bg-[#161511] text-[#F4F1EA] font-semibold border-[#161511]'
                      : 'bg-transparent text-[#5D594E] hover:text-[#161511]'
                  }`}
                >
                  <FileText className="w-3 h-3" />
                  <span>{lang === 'uz' ? "To'liq" : 'Полный'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setScriptViewMode('pure')}
                  className={`btn-pill text-xs py-1 px-3 transition-all flex items-center gap-1 cursor-pointer ${
                    scriptViewMode === 'pure'
                      ? 'bg-[#161511] text-[#F4F1EA] font-semibold border-[#161511]'
                      : 'bg-transparent text-[#5D594E] hover:text-[#161511]'
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  <span>{lang === 'uz' ? 'Faqat Ovoz' : 'Только речь'}</span>
                </button>
              </div>
            </div>

            {/* Notification / Clean Strip Button */}
            {cleanNotice && (
              <div className="p-3 bg-[rgba(14,124,134,0.1)] border border-[#0E7C86]/30 rounded-xl text-xs text-[#0A5A62] flex items-center gap-2">
                <Check className="w-4 h-4 text-[#0E7C86] shrink-0" />
                <span>{cleanNotice}</span>
              </div>
            )}

            {/* Mode A: Interactive Timeline Segments (Original vs Uzbek) */}
            {scriptViewMode === 'timeline' ? (
              timelineSegments.length > 0 ? (
                <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                  <div className="flex items-center justify-between text-xs text-[#5D594E]">
                    <span className="flex items-center gap-1.5 font-medium text-[#0A5A62]">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#0E7C86]" />
                      {lang === 'uz'
                        ? `${timelineSegments.length} ta sahna taymkodlari. Har bir replikani tahrirlashingiz mumkin:`
                        : `${timelineSegments.length} сцен с таймкодами. Вы можете редактировать текст:`}
                    </span>
                    <button
                      type="button"
                      onClick={handleAddSegment}
                      className="btn-pill btn-ghost text-[11px] py-1 px-2.5 flex items-center gap-1 text-[#0E7C86]"
                    >
                      <span>+ {lang === 'uz' ? "Sahna qo'shish" : 'Добавить сцену'}</span>
                    </button>
                  </div>

                  {timelineSegments.map((seg, idx) => {
                    const isActive = activeSegmentIndex === idx;
                    return (
                      <div
                        key={idx}
                        className={`p-4 rounded-2xl transition-all space-y-2 relative group shadow-xs ${
                          isActive
                            ? 'bg-[rgba(14,124,134,0.06)] border-2 border-[#0E7C86] shadow-sm'
                            : 'bg-white border border-[rgba(22,21,17,0.14)] hover:border-[#161511]/30'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            {/* Clickable time badge to seek */}
                            <button
                              type="button"
                              onClick={() => handleSeekToSegment(idx)}
                              className={`btn-pill text-[11px] font-mono py-1 px-2.5 flex items-center gap-1.5 transition-all cursor-pointer ${
                                isActive
                                  ? 'bg-[#0E7C86] text-white shadow-xs'
                                  : 'bg-[#F4F1EA] text-[#0A5A62] border border-[rgba(14,124,134,0.3)]'
                              }`}
                              title={lang === 'uz' ? "Shu vaqtdan tinglash / ko'rish" : 'Перейти к этому времени'}
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>{seg.start} - {seg.end}</span>
                            </button>

                            {isActive && (
                              <span className="font-mono text-[10px] text-[#0E7C86] border border-[#0E7C86]/30 px-2 py-0.5 rounded-full bg-[#0E7C86]/5 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#0E7C86] pulse-teal-dot" />
                                {lang === 'uz' ? 'Hozir jaranglamoqda' : 'Сейчас звучит'}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {seg.speaker && (
                              <span className="font-mono text-[10px] text-[#5D594E] px-2 py-0.5 rounded-md bg-[#F4F1EA] border border-[rgba(22,21,17,0.1)]">
                                {seg.speaker}
                              </span>
                            )}
                            <span className="font-mono text-[10px] text-[#5D594E]">#{idx + 1}-sahna</span>
                            <button
                              type="button"
                              onClick={() => handleDeleteSegment(idx)}
                              className="p-1 text-[#5D594E] hover:text-[#C4552D] rounded-full hover:bg-[rgba(196,85,45,0.08)] transition-colors cursor-pointer"
                              title="O'chirish"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Dual View: Verbatim Original Speech and Uzbek Synchronized Translation */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                          {/* Original Verbatim Speech */}
                          <div className="p-3 rounded-xl bg-[#F4F1EA] border border-[rgba(22,21,17,0.08)] text-[11px] space-y-1">
                            <span className="font-mono uppercase tracking-wider text-[9px] text-[#5D594E] font-semibold flex items-center gap-1">
                              <span>🗣️ {lang === 'uz' ? 'Asl Nutq (Original):' : 'Оригинал:'}</span>
                            </span>
                            <p className="text-[#161511] italic font-mono text-[11px] leading-relaxed">
                              "{seg.originalText || (lang === 'uz' ? '[Nutqsiz sahna]' : '[Без речи]')}"
                            </p>
                          </div>

                          {/* Editable Uzbek Dubbing text */}
                          <div className="space-y-1">
                            <label className="font-mono uppercase tracking-wider text-[9px] font-semibold text-[#0A5A62] flex items-center gap-1">
                              <Edit3 className="w-3 h-3 text-[#0E7C86]" />
                              <span>{lang === 'uz' ? "O'zbekcha Dublyaj (Sinxron):" : 'Узбекский Дубляж:'}</span>
                            </label>
                            <textarea
                              rows={2}
                              value={seg.uzbekText}
                              onChange={(e) => handleUpdateSegmentUzbek(idx, e.target.value)}
                              className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-1.5 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86] font-medium resize-none leading-relaxed shadow-2xs"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={handleAddSegment}
                      className="btn-pill btn-ghost text-xs py-2 px-3.5 flex items-center gap-1.5"
                    >
                      <span>+ {lang === 'uz' ? 'Yangi Sahna / Taymkod Qo\'shish' : 'Добавить новую сцену'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleGenerateVideoSubtitles()}
                      disabled={isGeneratingSubtitles}
                      className="btn-pill btn-ghost text-xs py-2 px-3.5 flex items-center gap-1.5 text-[#0E7C86] border-[#0E7C86]/30 hover:border-[#0E7C86]"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#0E7C86]" />
                      <span>{isGeneratingSubtitles ? 'Yaratilmoqda...' : lang === 'uz' ? 'AI Bilan Qaytadan Yaratish' : 'Пересоздать через AI'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Empty state when no segments created yet */
                <div className="p-8 text-center bg-white border border-dashed border-[rgba(22,21,17,0.2)] rounded-2xl space-y-4">
                  <div className="w-12 h-12 rounded-2xl bg-[rgba(14,124,134,0.08)] border border-[#0E7C86]/20 flex items-center justify-center text-[#0E7C86] mx-auto">
                    <Clock className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[#161511]">
                      {lang === 'uz' ? 'Taymkodlar hali shakllantirilmadi' : 'Таймкоды еще не созданы'}
                    </h4>
                    <p className="text-xs text-[#5D594E] max-w-md mx-auto mt-1 leading-relaxed">
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
                      className="btn-pill btn-teal text-xs py-2.5 px-5 flex items-center gap-2"
                    >
                      <Sparkles className={`w-3.5 h-3.5 ${isGeneratingSubtitles ? 'animate-spin' : ''}`} />
                      <span>{isGeneratingSubtitles ? 'Yaratilmoqda...' : lang === 'uz' ? '⚡ 1-Klikda AI Taymkod va Subtitr Yaratish' : '⚡ Создать Таймкоды и Субтитры (AI)'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleAddSegment}
                      className="btn-pill btn-ghost text-xs py-2.5 px-4 flex items-center gap-1.5"
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
                  className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-xl p-3.5 text-xs sm:text-sm text-[#161511] font-mono leading-relaxed focus:outline-none focus:border-[#0E7C86] resize-y shadow-2xs"
                  placeholder="[00:00 - 00:05] [Dinamik]: Sahnangiz matni..."
                />
                {conditionAnalysis.hasConditions && (
                  <button
                    type="button"
                    onClick={handleStripConditions}
                    className="btn-pill btn-ghost text-xs py-1 px-3 flex items-center gap-1.5 text-[#C98A12] border-[#C98A12]/30"
                  >
                    <Eraser className="w-3.5 h-3.5 text-[#C98A12]" />
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
                  className="w-full bg-white border border-[#0E7C86]/30 rounded-xl p-3.5 text-xs sm:text-sm text-[#161511] font-sans leading-relaxed focus:outline-none focus:border-[#0E7C86] resize-y shadow-2xs"
                  placeholder="Faqat o'qiladigan toza matn..."
                />
              </div>
            )}

            {/* Target Duration & Style Preset Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-[rgba(22,21,17,0.08)]">
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-[#5D594E] mb-1.5 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#0E7C86]" />
                  {lang === 'uz' ? 'Xronometraj:' : 'Хронометраж:'}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {['15s', '30s', '60s', '2m', '5m'].map((dur) => (
                    <button
                      key={dur}
                      onClick={() => setTargetDuration(dur)}
                      className={`flex-1 min-w-[45px] py-1.5 px-2 text-xs font-medium rounded-full border transition-all cursor-pointer text-center ${
                        targetDuration === dur
                          ? 'bg-[#161511] text-[#F4F1EA] border-[#161511] font-bold shadow-2xs'
                          : 'bg-white/80 border-[rgba(22,21,17,0.14)] text-[#5D594E] hover:border-[#161511]'
                      }`}
                    >
                      {dur}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-[#5D594E] mb-1.5 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-[#0E7C86]" />
                  {lang === 'uz' ? 'Dublyaj ohangi:' : 'Настроение:'}
                </label>
                <select
                  value={stylePreset}
                  onChange={(e) => setStylePreset(e.target.value as any)}
                  className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-1.5 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86]"
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
              <div className="text-xs text-[#5D594E] flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#0E7C86] shrink-0" />
                <span>
                  {lang === 'uz'
                    ? 'Skobkalar va shartlar ovozda mutlaqo o\'qilmaydi.'
                    : 'Условия и ремарки не озвучиваются голосом.'}
                </span>
              </div>

              <div className="flex items-center gap-2.5 flex-wrap">
                {!isSynthesizing && dubbingWordCount > 0 && (
                  <PreCalculationBadge
                    estimatedSeconds={estimatedDubbingSeconds}
                    audioDurationSeconds={audioDuration || Math.round(dubbingWordCount / 2.2)}
                    creditsCost={1}
                    lang={lang}
                  />
                )}

                <button
                  onClick={handleSynthesize}
                  disabled={isSynthesizing || (!script.trim() && timelineSegments.length === 0)}
                  className="btn-pill btn-solid text-xs sm:text-sm py-2.5 px-6 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Volume2 className={`w-4 h-4 ${isSynthesizing ? 'animate-pulse text-[#5CC8CF]' : 'text-[#5CC8CF]'}`} />
                  {isSynthesizing ? (
                    <>
                      <span>
                        {lang === 'uz'
                          ? `Dublyaj: ${dubbingCountdown.remainingDigits} (~${dubbingCountdown.formattedRemaining})`
                          : `Дубляж: ${dubbingCountdown.remainingDigits} (~${dubbingCountdown.formattedRemaining})`}
                      </span>
                      <span className="font-mono text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full">{dubbingCountdown.progressPercent}%</span>
                    </>
                  ) : (
                    lang === 'uz' ? '🎙️ O\'zbekcha Ovozda Dublyaj Qilish (TTS)' : '🎙️ Озвучить на Узбекском'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Synchronized Audio Player, Video Sync & Subtitles (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Audio Result & Sync Player */}
          <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-[rgba(255,255,255,0.52)] backdrop-blur-sm p-5 space-y-4 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62]">
                <span>03 — Sinxron dublyaj natijasi</span>
              </div>

              {uploadedMedia?.isVideo && resultAudio && (
                <button
                  type="button"
                  onClick={() => setMuteOriginalVideo(!muteOriginalVideo)}
                  className={`btn-pill text-[11px] py-1 px-2.5 flex items-center gap-1 cursor-pointer transition-colors ${
                    muteOriginalVideo
                      ? 'bg-[#161511] text-[#F4F1EA]'
                      : 'border border-[rgba(22,21,17,0.14)] text-[#5D594E]'
                  }`}
                  title="Asl video ovozini o'chirish/yoqish"
                >
                  {muteOriginalVideo ? <VolumeX className="w-3 h-3 text-[#5CC8CF]" /> : <Volume1 className="w-3 h-3" />}
                  <span>{muteOriginalVideo ? "Asl ovoz o'chiq" : 'Asl ovoz yoniq'}</span>
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

                {/* Bounded Dark Studio Screen Player Box */}
                <div className="p-4 sm:p-5 rounded-2xl bg-[#141414] border border-[#2B2B27] text-[#EDEAE2] flex items-center gap-4 shadow-[0_30px_50px_-20px_rgba(20,20,20,0.45)]">
                  <button
                    onClick={togglePlay}
                    className="w-12 h-12 rounded-full bg-[#0E7C86] hover:bg-[#0A5A62] text-white flex items-center justify-center transition-transform hover:scale-105 shadow-md shadow-[#0E7C86]/30 cursor-pointer shrink-0"
                  >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5 fill-current" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-xs text-[#7D7A70]">
                      <span>
                        <span className="font-mono uppercase text-[10px] tracking-wider">{lang === 'uz' ? 'Vaqt:' : 'Время:'}</span>{' '}
                        <span className="text-[#5CC8CF] font-mono font-bold">
                          {Math.floor(playbackTime / 60).toString().padStart(2, '0')}:
                          {Math.floor(playbackTime % 60).toString().padStart(2, '0')}
                        </span>{' '}
                        / <span className="text-[#EDEAE2] font-mono">{audioDuration}s</span>
                      </span>
                      {uploadedMedia?.isVideo && (
                        <span className="text-[#5CC8CF] font-mono text-[10.5px] uppercase tracking-wider">• Video sinxron</span>
                      )}
                    </div>

                    {/* Visualizer Wave */}
                    <div className="flex items-center gap-1 mt-2 h-7">
                      {[40, 70, 30, 90, 60, 100, 80, 50, 95, 45, 85, 65, 30, 75, 55, 90, 40].map((h, i) => (
                        <div
                          key={i}
                          className={`w-1 rounded-full transition-all ${
                            isPlaying ? 'bg-[#5CC8CF] animate-pulse' : 'bg-[#2B2B27]'
                          }`}
                          style={{ height: `${h}%` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Speed & Audio Ducking Controls */}
                <div className="p-3.5 bg-white border border-[rgba(22,21,17,0.14)] rounded-2xl space-y-3 text-xs shadow-xs">
                  {/* Playback Speed */}
                  <div className="flex items-center justify-between">
                    <span className="text-[#5D594E] font-medium flex items-center gap-1.5 font-mono uppercase text-[10.5px]">
                      <Clock className="w-3.5 h-3.5 text-[#0E7C86]" />
                      {lang === 'uz' ? 'Dublyaj tezligi:' : 'Скорость речи:'}
                    </span>
                    <div className="flex items-center gap-1 bg-[#F4F1EA] p-0.5 rounded-full border border-[rgba(22,21,17,0.1)]">
                      {[0.8, 1.0, 1.1, 1.25].map((spd) => (
                        <button
                          key={spd}
                          type="button"
                          onClick={() => handleSpeedChange(spd)}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-mono cursor-pointer transition-colors ${
                            playbackSpeed === spd
                              ? 'bg-[#161511] text-[#F4F1EA] font-bold'
                              : 'text-[#5D594E] hover:text-[#161511]'
                          }`}
                        >
                          {spd}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Original Video Background Volume (Ducking) */}
                  {uploadedMedia?.isVideo && (
                    <div className="space-y-1.5 pt-2 border-t border-[rgba(22,21,17,0.08)]">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[#5D594E] flex items-center gap-1.5 font-mono uppercase text-[10.5px]">
                          <Volume2 className="w-3.5 h-3.5 text-[#0E7C86]" />
                          {lang === 'uz' ? 'Asl video foni (Ducking):' : 'Фон видео (Ducking):'}
                        </span>
                        <span className="font-mono text-[#0A5A62] font-bold">
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
                        className="w-full accent-[#0E7C86] cursor-pointer h-1.5 bg-[#ECE7DB] rounded-lg"
                      />
                    </div>
                  )}

                  {/* Subtitle Theme for Video Overlay */}
                  <div className="pt-2 border-t border-[rgba(22,21,17,0.08)] space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#5D594E] flex items-center gap-1.5 font-mono uppercase text-[10.5px]">
                        <Sparkles className="w-3.5 h-3.5 text-[#C98A12]" />
                        {lang === 'uz' ? 'Videodagi subtitr uslubi:' : 'Стиль субтитров:'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowSubtitleOverlay(!showSubtitleOverlay)}
                        className={`text-[10px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full cursor-pointer ${
                          showSubtitleOverlay ? 'bg-[#0E7C86] text-white' : 'bg-[#ECE7DB] text-[#5D594E]'
                        }`}
                      >
                        {showSubtitleOverlay ? (lang === 'uz' ? 'Yoniq' : 'Вкл') : (lang === 'uz' ? "O'chiq" : 'Выкл')}
                      </button>
                    </div>

                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { id: 'reels_yellow', label: '🟨 Reels', desc: 'Sariq' },
                        { id: 'classic_white', label: '⬜ Oq', desc: 'Klassik' },
                        { id: 'neon_amber', label: '🟦 Neon', desc: 'Moviy' },
                        { id: 'cinema', label: '🎬 Kino', desc: 'Dramatik' },
                      ].map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => setSubtitleStyle(st.id as any)}
                          className={`py-1 px-1.5 rounded-lg text-center text-[10px] font-medium border transition-colors cursor-pointer ${
                            subtitleStyle === st.id
                              ? 'bg-[#161511] border-[#161511] text-[#F4F1EA] font-bold'
                              : 'bg-white border-[rgba(22,21,17,0.1)] text-[#5D594E] hover:border-[#161511]'
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
                      className="btn-pill btn-ghost w-full py-2.5 flex items-center justify-center gap-2 text-xs font-semibold"
                    >
                      {isSaved ? <Check className="w-4 h-4 text-[#0E7C86]" /> : <Save className="w-4 h-4 text-[#0E7C86]" />}
                      <span>{isSaved ? 'CMS Kutubxonasiga Saqlandi!' : 'CMS Kutubxonasiga Saqlash'}</span>
                    </button>
                  )}

                  <button
                    onClick={downloadAudio}
                    className="btn-pill btn-solid w-full py-2.5 flex items-center justify-center gap-2 text-xs font-bold"
                  >
                    <Download className="w-4 h-4 text-[#5CC8CF]" />
                    {lang === 'uz' ? 'WAV Audioni Yuklab Olish' : 'Скачать WAV аудио'}
                  </button>
                </div>
              </div>
            ) : isSynthesizing ? (
              <GenerationCountdownHUD
                countdown={dubbingCountdown}
                isActive={isSynthesizing}
                lang={lang}
                title={lang === 'uz' ? "Video Dublyaj & Ovozlashtirish" : "Синтез Дубляжа Видео"}
                subtitle={lang === 'uz' ? dubbingCountdown.phaseNameUz : dubbingCountdown.phaseNameRu}
              />
            ) : (
              <div className="p-8 rounded-2xl bg-white border border-dashed border-[rgba(22,21,17,0.2)] text-center space-y-2">
                <Volume2 className="w-8 h-8 text-[#5D594E]/50 mx-auto" />
                <p className="text-xs text-[#161511] font-medium">
                  {lang === 'uz' ? 'Dublyaj audio hali yaratilmadi' : 'Дубляж еще не сгенерирован'}
                </p>
                <p className="text-[11px] text-[#5D594E]">
                  {lang === 'uz'
                    ? "Chap paneldagi \"O'zbekcha Ovozda Dublyaj Qilish\" tugmasini bosing."
                    : 'Нажмите "Озвучить на Узбекском" на панели слева.'}
                </p>
              </div>
            )}
          </div>

          {/* Subtitles Box (SRT / VTT) */}
          <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-[rgba(255,255,255,0.52)] backdrop-blur-sm p-5 space-y-4 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62]">
                <span>04 — Sinxron subtitrlar</span>
              </div>

              {/* Subtitle Format Tabs */}
              <div className="flex items-center bg-[#F4F1EA] p-0.5 rounded-full border border-[rgba(22,21,17,0.1)] text-xs">
                <button
                  onClick={() => setActiveSubTab('srt')}
                  className={`px-2.5 py-0.5 rounded-full font-mono text-[11px] cursor-pointer ${
                    activeSubTab === 'srt' ? 'bg-[#161511] text-[#F4F1EA] font-bold' : 'text-[#5D594E]'
                  }`}
                >
                  .SRT
                </button>
                <button
                  onClick={() => setActiveSubTab('vtt')}
                  className={`px-2.5 py-0.5 rounded-full font-mono text-[11px] cursor-pointer ${
                    activeSubTab === 'vtt' ? 'bg-[#161511] text-[#F4F1EA] font-bold' : 'text-[#5D594E]'
                  }`}
                >
                  .VTT
                </button>
              </div>
            </div>

            {srtSubtitles ? (
              <div className="space-y-3">
                <pre className="p-3.5 bg-[#141414] rounded-2xl border border-[#2B2B27] text-[11px] text-[#EDEAE2] font-mono max-h-56 overflow-y-auto leading-relaxed shadow-xs">
                  {activeSubTab === 'srt' ? srtSubtitles : vttSubtitles}
                </pre>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={copySubtitles}
                    className="btn-pill btn-ghost py-2 text-xs font-medium flex items-center justify-center gap-1.5"
                  >
                    {copiedSubtitle ? <Check className="w-3.5 h-3.5 text-[#0E7C86]" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedSubtitle ? 'Nusxalandi!' : 'Nusxa olish'}
                  </button>
                  <button
                    onClick={downloadSrt}
                    className="btn-pill btn-solid py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5 text-[#5CC8CF]" />
                    .{activeSubTab.toUpperCase()} Yuklab Olish
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-white border border-dashed border-[rgba(22,21,17,0.2)] text-center text-xs text-[#5D594E]">
                {lang === 'uz'
                  ? "Subtitrlar audio sintez qilingandan so'ng avtomatik paydo bo'ladi."
                  : 'Субтитры появятся автоматически после озвучивания.'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pipeline Audit Logs Modal */}
      {showAuditLogsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#161511]/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[#F4F1EA] border border-[rgba(22,21,17,0.2)] rounded-[22px] w-full max-w-4xl max-h-[85vh] flex flex-col shadow-[0_50px_90px_-40px_rgba(22,21,17,0.55)] overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-[rgba(22,21,17,0.12)] flex items-center justify-between bg-white/70 backdrop-blur-md">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[rgba(14,124,134,0.1)] border border-[#0E7C86]/20 flex items-center justify-center text-[#0E7C86]">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#161511]">
                    {lang === 'uz' ? 'OvozStudio Pipeline Audit Jurnali' : 'Журнал Аудита Конвейера Дубляжа'}
                  </h3>
                  <p className="text-[11px] text-[#5D594E]">
                    {lang === 'uz'
                      ? 'Serverdagi oxirgi media yuklash va sinxron dublyaj urinishlari tarixi'
                      : 'История последних попыток скачивания и обработки медиа'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchAuditLogs}
                  disabled={isLoadingAuditLogs}
                  className="p-2 rounded-full border border-[rgba(22,21,17,0.14)] bg-white hover:bg-[#ECE7DB] text-[#161511] transition-colors cursor-pointer"
                  title="Yangilash"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingAuditLogs ? 'animate-spin' : ''} text-[#0E7C86]`} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowAuditLogsModal(false)}
                  className="btn-pill btn-ghost text-xs py-1.5 px-3"
                >
                  {lang === 'uz' ? 'Yopish' : 'Закрыть'}
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-3 font-mono text-xs">
              {auditLogsList.length === 0 ? (
                <div className="p-8 text-center text-[#5D594E] font-sans">
                  {isLoadingAuditLogs
                    ? (lang === 'uz' ? 'Jurnal yuklanmoqda...' : 'Загрузка журнала...')
                    : (lang === 'uz' ? 'Hozircha urinishlar jurnali mavjud emas.' : 'Записи в журнале отсутствуют.')}
                </div>
              ) : (
                <div className="space-y-3 font-sans">
                  {auditLogsList.map((entry) => (
                    <div
                      key={entry.id}
                      className={`p-4 rounded-xl border space-y-2 transition-all ${
                        entry.success
                          ? 'bg-white border-[rgba(14,124,134,0.3)] shadow-2xs'
                          : 'bg-white border-[rgba(196,85,45,0.3)] shadow-2xs'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(22,21,17,0.08)] pb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider font-semibold ${
                              entry.success
                                ? 'bg-[rgba(14,124,134,0.1)] text-[#0E7C86] border border-[#0E7C86]/30'
                                : 'bg-[rgba(196,85,45,0.1)] text-[#C4552D] border border-[#C4552D]/30'
                            }`}
                          >
                            {entry.success ? 'Muvaffaqiyatli' : 'Cheklov / Xato'}
                          </span>
                          <span className="font-bold text-[#161511] text-xs">{entry.platform}</span>
                          <span className="text-[#5D594E] text-[10px] font-mono">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </span>
                        </div>

                        <span className="text-[11px] font-mono text-[#5D594E]">
                          Bosqich: <strong className="text-[#0E7C86]">{entry.stage}</strong>
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-[#161511]">
                        <div>
                          <span className="text-[#5D594E] text-[10px] block font-mono">Downloader:</span>
                          <span className="font-mono text-[10px]">{entry.downloaderVersion}</span>
                        </div>
                        <div>
                          <span className="text-[#5D594E] text-[10px] block font-mono">Video Hajmi:</span>
                          <span className="font-mono text-[10px]">{entry.videoFileSize ? `${(entry.videoFileSize / (1024 * 1024)).toFixed(2)} MB` : '0 bayt'}</span>
                        </div>
                        <div>
                          <span className="text-[#5D594E] text-[10px] block font-mono">Davomiylik (V/A):</span>
                          <span className="font-mono text-[10px]">{entry.videoDuration ? `${entry.videoDuration}s` : '0s'} / {entry.audioDuration ? `${entry.audioDuration}s` : '0s'}</span>
                        </div>
                        <div>
                          <span className="text-[#5D594E] text-[10px] block font-mono">Sinxronlik:</span>
                          <span className={`font-mono text-[10px] ${entry.durationsMatch ? 'text-[#0E7C86] font-bold' : 'text-[#5D594E]'}`}>
                            {entry.durationsMatch ? 'Mos (100%)' : 'N/A'}
                          </span>
                        </div>
                      </div>

                      {entry.error && (
                        <div className="p-2.5 rounded-lg bg-[rgba(196,85,45,0.06)] border border-[#C4552D]/20 text-[11px] text-[#C4552D]">
                          <strong>Sabab:</strong> {entry.error}
                        </div>
                      )}

                      {entry.firstOriginalWords && (
                        <div className="p-2.5 rounded-lg bg-[#ECE7DB] border border-[rgba(22,21,17,0.1)] text-[11px] text-[#161511]">
                          <span className="text-[#5D594E] font-mono text-[10px]">Asl nutq:</span> "{entry.firstOriginalWords}..."
                          {entry.uzbekTranslationSample && (
                            <div className="text-[#0E7C86] mt-1 font-medium">
                              <span className="text-[#5D594E] font-mono text-[10px]">Tarjima:</span> "{entry.uzbekTranslationSample}..."
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
