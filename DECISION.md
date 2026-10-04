# OvozStudio AI: ElevenLabs-Inspired Premium Redesign & Architecture Decision

## 1. Executive Analysis & Problem Audit (AI-Slop vs. World-Class SaaS)

### The Problem
The current application suffered from common "AI-generated slop" patterns:
1. **Generic Flat-Black Clutter**: Stark, uninspiring `#000000` void with harsh neon borders, cards-within-cards syndrome, and static pill badges covering metadata.
2. **Outdated Top Navbar Paradigm**: While modern AI creation tools (ElevenLabs, Claude, ChatGPT, Gemini, Suno) utilize an intuitive, collapsible left sidebar, the site had inconsistent horizontal bars and duplicate switchers.
3. **Broken & Pseudo-Technical Mock Text to Purge**:
   - **Google Lyria 3 Pro / Fake Music Generators**: Text or buttons claiming broken model integrations that do not produce real music. Must be completely expunged.
   - **Fake AI Studio Replicated Voice Banner**: Banners pretending a user's voice like `"SHOKHRUKH"` or `"voice_17raj9ewke3g"` was auto-connected from Google AI Studio. This gives a fake impression.
   - **Pseudo-Technical Versioning & Telemetry**: Labels shouting `"Gemini 3.8 Flash TTS Live Quantum 24kHz"`, `"ONLINE // LATENCY"`, etc. on multiple cards.
   - **Intrusive Guest Lock Banners**: Large amber/yellow warning blocks blocking the screen. Premium apps use quiet, elegant inline hints or prompt modals when "Synthesize" is triggered.
   - **Redundant Studio Mode Switchers**: Both the sidebar and the main page had duplicate tabs ("Solo", "Interview", "Voiceover"). Clicking in the sidebar should seamlessly switch the workspace view without page-level duplicate buttons.
   - **Bloated Sound Director Cues**: Mock text and confusing timeline blocks that distracted from real, crisp audio synthesis.
4. **NotebookLM Integration**:
   - As requested ("И ноутбук LM тоже надо убрать. Это можно, ладно, можно оставить"), we simplify this: remove prominent promo banners and preserve it as a clean, elegant "Manbalar / Smart Import" drawer and modal for uploading documents, PDFs, or articles without cluttering the primary creation flow.

---

## 2. Benchmark Architecture: Inspired by ElevenLabs

ElevenLabs is the undisputed gold standard for AI voice and speech synthesis platforms. We adopt its proven architecture:

### A. Left Collapsible Sidebar Navigation
- **Dimensions**:
  - Expanded: `260px` width.
  - Collapsed: `72px` icon-only rail with tooltips.
  - Mobile: Floating sliding drawer with smooth spring animation.
- **Brand Identity**:
  - Custom SVG Sonic Waveform geometric monogram.
  - Typographic wordmark: `OvozStudio` with clean, understated `AI` badge.
- **Grouped Workspaces**:
  - **Ijodiy Studiya (Studio)**:
    - 🎙️ *Matndan Ovoz (Text to Speech / Solo)* — The primary studio canvas.
    - 👥 *2 Ovozli Intervyu (Dialogue)* — Multi-speaker conversation.
    - 🎬 *Video Dublyaj (Dubbing & Subtitles)* — Time-synced video voiceover.
    - 📞 *AI Agent (Conversational)* — Interactive real-time audio agent.
  - **Aktivlar & Ovozlar (Voices & Library)**:
    - 🧬 *Ovozlar Laboratoriyasi (Voice Lab)* — Authentic voice profiles & cloning.
    - 📁 *Media Kutubxona (History & CMS)* — Generated MP3/WAV library.
    - 👑 *Eksklyuziv VIP Hub* — Curated masterclasses & cover art.
  - **Asboblar (Tools & Resources)**:
    - 📄 *Manbalar & Hujjat (Smart Document / NotebookLM Import)*.
    - 📖 *Qo'llanma (User Guide)*.
- **Bottom Tray**:
  - Live Credit Balance Gauge (`Kreditlar: 5 / 50` or `👑 Cheksiz VIP`).
  - Tactile `To'ldirish` (Top Up / Pricing) button.
  - User Profile Drawer (Avatar, name, email).
  - Language Switcher (UZ / RU).

### B. Center Workspace: ElevenLabs-Grade Audio Studio
- **Top Context Bar**: Slim `52px` header with breadcrumb trail (`OvozStudio / Matndan Ovoz`) and quick action buttons.
- **Voice Selection Bar**:
  - Clean horizontal card with voice avatar, category tag, play audio sample button, and instant settings toggle (speed, tone, ambient soundscape).
  - No fake IDs or confusing text.
- **High-End Script Canvas**:
  - Rich distraction-free text editor with character counter (`0 / 5,000 belgi`).
  - Instant AI Script Assistant (topic to engaging script generator).
  - Clear, paste, and sample buttons.
- **Tactile Bottom Synthesis Bar**:
  - Big, premium "Sintez Qilish" (Synthesize) button with subtle gradient and active scale animation.
  - Real-time audio waveform / sound bars animation during processing.
- **Pinned Audio Player**:
  - ElevenLabs-style persistent playback bar: play/pause, waveform scrubber, time display (`01:24 / 03:40`), playback speed (0.8x, 1.0x, 1.25x, 1.5x), volume, and one-click lossless WAV/MP3 download.

---

## 3. Visual Design Constitution (Anti-AI-Slop)

1. **Palette (Luxury Dark Graphite & Warm Titanium)**:
   - Primary Canvas: `#0a0a0c` (deep obsidian).
   - Sidebar & Panels: `#121216` with hairline borders (`rgba(255,255,255,0.07)` / `#222228`).
   - Accent: Warm Titanium white (`#f4f4f6`) for primary actions, subtle Emerald (`#10b981`) for audio playback and positive status, Cyan (`#06b6d4`) for subtle focus rings.
   - Zero garish neon cyan glow or magenta gradients.
2. **Typography**:
   - Display Headings: **Syne** (`font-display font-bold tracking-tight`).
   - Body & Controls: **Plus Jakarta Sans** (`font-sans font-medium`).
   - Data & Counters: **JetBrains Mono** with `tabular-nums` alignment.
3. **Zero-Pill Discipline**:
   - Metadata (categories, dates, duration) rendered as unboxed text separated by quiet middle dots (`Tarix · 3 daqiqa · 24kHz`).
   - Pill shapes strictly reserved for functional interactive buttons or active segmented controls.
4. **Motion & Feedback**:
   - `motion` (Framer Motion v12) for smooth sidebar collapse, modal entrance, and tab transitions.
   - Micro-interactions settling within $\le 180\text{ms}$.

---

## 4. Implementation Plan & File Roadmap

| Step | Scope | Target Files |
| :--- | :--- | :--- |
| **1** | **Purge Mock & Non-Working Elements** | Remove fake "Google AI Studio Voice Replication" banners, "Google Lyria" remnants, and pseudo-AI sound director clutter from `App.tsx`, `AudioPreviewPlayer.tsx`, `VoiceSettingsPanel.tsx`, and `server.ts`. |
| **2** | **Collapsible Left Sidebar Enhancement** | Enhance `Sidebar.tsx` with smooth collapse/expand, active states, refined sonic waveform logo, bottom credit gauge, and direct routing. |
| **3** | **Main Studio Workspace Layout** | Restructure `App.tsx` into a true ElevenLabs layout: zero top navbar, full left sidebar, slim context header, unified creation canvas with no duplicate switchers. |
| **4** | **Script & Voice Selection Polish** | Polish `ScriptEditor.tsx` and `VoiceSettingsPanel.tsx` with high-density ElevenLabs styling, clean character counters, and audio sample auditioning. |
| **5** | **Audio Player Refinement** | Clean `AudioPreviewPlayer.tsx`: remove mock cue timeline, focus on real waveform canvas, scrub bar, speed buttons, and lossless export. |
| **6** | **Verification & Build** | Run `compile_applet` and verify zero errors, flawless TypeScript types, and smooth user experience. |
