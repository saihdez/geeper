export type Format = "9:16" | "16:9" | "1:1";
export type Platform = "tiktok" | "youtube" | "instagram" | "facebook" | "snapchat" | "pinterest";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A named element drawn on screen (title, logo, caption block) to check against the safe zone. */
export interface NamedBox extends Box {
  name: string;
}

export interface Cue {
  start: number;
  end: number;
  /** Text as displayed; `\n` separates lines. */
  text: string;
}

export interface Asset {
  name: string;
  license: string;
}

export interface Rule {
  id: string;
  name: string;
  ok: boolean;
  /** Warnings never fail the report. */
  warning?: boolean;
  measured: unknown;
  target: string;
  detail?: string;
}

export interface Report {
  passed: boolean;
  file: string;
  measuredAt: string;
  rules: Rule[];
}

export interface Targets {
  /** Integrated loudness (LUFS). */
  lufs: number;
  lufsTolerance: number;
  /** Maximum true peak (dBTP). */
  maxTruePeak: number;
  maxCharsPerLine: number;
  maxLines: number;
  /** Maximum reading speed (characters per second). */
  maxCps: number;
  /** Longest freeze allowed before the outro (seconds). */
  maxFreeze: number;
  /** Share of duplicated frames allowed before the outro (0–1). */
  maxDuplicates: number;
  /** Frames the file may be off by. */
  frameTolerance: number;
  /** Seconds the audio track may differ from the video track. */
  avSyncTolerance: number;
}

export interface Expectations {
  /** Sets the canvas size and the base safe zone. */
  format?: Format;
  /** Overrides the canvas size from `format`. */
  width?: number;
  height?: number;
  /** Expected frame rate (default 30). */
  fps?: number;
  /** Expected duration (s). Duration and frame-count rules are skipped without it. */
  duration?: number;
  /** In 9:16, the safe zone is narrowed to what each platform's UI leaves visible. */
  platforms?: readonly Platform[];
  subtitles?: readonly Cue[];
  /** When the creator's voice can't be slowed down: reading speed only warns. */
  subtitleSpeedWarnOnly?: boolean;
  boxes?: readonly NamedBox[];
  assets?: readonly Asset[];
  /** Commercial use: unknown or non-commercial licenses fail instead of warn. */
  commercial?: boolean;
  /** Freeze and duplicate checks stop here (an end card is static on purpose). Default: whole file. */
  outroStart?: number;
  /** Duplicate share the source already has (low-fps clips, stills); added to `maxDuplicates`. */
  expectedDuplicates?: number;
  /** Rec.709 limited range, yuv420p (default true). */
  requireRec709?: boolean;
  targets?: Partial<Targets>;
}

export interface Measurements {
  loudness?: { integrated: number; truePeak: number; lra: number };
  video?: {
    width: number;
    height: number;
    /** As reported by ffprobe, e.g. "30/1" or "30000/1001". */
    frameRate: string;
    duration: number;
    colorSpace?: string;
    colorTransfer?: string;
    colorPrimaries?: string;
    colorRange?: string;
    pixFmt?: string;
  };
  audioDuration?: number;
  frameCount?: number;
  freezes?: { start: number; duration: number }[];
  /** Share of frames `mpdecimate` drops as duplicates (0–1). */
  duplicateRatio?: number;
}
