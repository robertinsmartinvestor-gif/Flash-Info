export interface CaptionCue {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

const MAX_WORDS_PER_CUE = 6;
const MAX_CHARS_PER_CUE = 36;

function splitCues(narration: string): string[] {
  const cues: string[] = [];
  let current: string[] = [];
  for (const word of narration.split(/\s+/).filter(Boolean)) {
    const next = [...current, word];
    if (current.length > 0 && (next.length > MAX_WORDS_PER_CUE || next.join(" ").length > MAX_CHARS_PER_CUE)) {
      cues.push(current.join(" "));
      current = [word];
    } else {
      current = next;
    }
    if (/[.!?:]$/.test(word)) {
      cues.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) cues.push(current.join(" "));
  return cues;
}

/**
 * Timed captions from the text and the real audio length. Without word timings
 * the time is shared by character count: close, not exact, so the review step
 * must look at sync until a provider with word boundaries is in use.
 */
export function buildCaptions(narration: string, durationSeconds: number): CaptionCue[] {
  if (durationSeconds <= 0) throw new Error("captions_invalid_duration");
  const texts = splitCues(narration);
  const total = texts.reduce((sum, text) => sum + text.length, 0);
  let cursor = 0;
  return texts.map((text) => {
    const startSeconds = cursor;
    cursor += (text.length / total) * durationSeconds;
    return { startSeconds, endSeconds: cursor, text };
  });
}

function stamp(seconds: number, separator: "," | "."): string {
  const millis = Math.round(seconds * 1000);
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor(millis / 60_000) % 60;
  const secs = Math.floor(millis / 1000) % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${separator}${pad(millis % 1000, 3)}`;
}

export function toSrt(cues: CaptionCue[]): string {
  return cues.map((cue, index) => `${index + 1}\n${stamp(cue.startSeconds, ",")} --> ${stamp(cue.endSeconds, ",")}\n${cue.text}\n`).join("\n");
}

export function toVtt(cues: CaptionCue[]): string {
  return `WEBVTT\n\n${cues.map((cue) => `${stamp(cue.startSeconds, ".")} --> ${stamp(cue.endSeconds, ".")}\n${cue.text}\n`).join("\n")}`;
}
