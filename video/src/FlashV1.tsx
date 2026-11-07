import { loadFont } from "@remotion/fonts";
import inter500 from "@fontsource/inter/files/inter-latin-500-normal.woff2";
import inter800 from "@fontsource/inter/files/inter-latin-800-normal.woff2";
import { AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

export interface TimedText {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

/** The part of RenderSpec this template reads: validated plain text, rendered only as React text. */
export interface FlashSpec {
  frame: { width: number; height: number; fps: number };
  durationSeconds: number;
  title: string;
  sources: string[];
  scenes: TimedText[];
  captions: TimedText[];
}

/** Same values as SAFE_AREA in src/media/render-spec.ts. */
const SAFE = { top: 220, bottom: 420, left: 60, right: 140 };
const RED = "#e54b4b";
const FONT = "Inter";

void loadFont({ family: FONT, url: inter500, weight: "500" });
void loadFont({ family: FONT, url: inter800, weight: "800" });

function Background({ seconds }: { seconds: number }) {
  // Slow drift only: no news imagery, so there are no rights to clear.
  const x = 30 + 40 * Math.sin(seconds / 9);
  const y = 40 + 15 * Math.cos(seconds / 7);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at ${x}% ${y}%, #2a1418 0%, #0f0e14 55%, #0a0a0c 100%)` }} />
  );
}

function SceneProgress({ scenes, seconds }: { scenes: TimedText[]; seconds: number }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 28 }}>
      {scenes.map((scene) => {
        const done = interpolate(seconds, [scene.startSeconds, scene.endSeconds], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div key={scene.startSeconds} style={{ flex: 1, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.18)", overflow: "hidden" }}>
            <div style={{ width: `${done}%`, height: "100%", background: RED }} />
          </div>
        );
      })}
    </div>
  );
}

function Caption({ cue }: { cue: TimedText }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - Math.round(cue.startSeconds * fps), fps, durationInFrames: 8, config: { damping: 200 } });
  return (
    <div style={{ opacity: enter, transform: `translateY(${(1 - enter) * 24}px)`, color: "#fff", fontWeight: 800, fontSize: 84, lineHeight: 1.16, letterSpacing: -1.5 }}>
      {cue.text}
    </div>
  );
}

export function FlashV1({ spec, audioFile }: { spec: FlashSpec; audioFile: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const cue = spec.captions.find((item) => seconds >= item.startSeconds && seconds < item.endSeconds) ?? spec.captions.at(-1);

  return (
    <AbsoluteFill style={{ fontFamily: FONT, fontWeight: 500, background: "#0a0a0c" }}>
      <Background seconds={seconds} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 12, background: RED }} />
      {audioFile && <Audio src={staticFile(audioFile)} />}

      <div style={{ position: "absolute", top: SAFE.top, left: SAFE.left, right: SAFE.right }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ fontSize: 52, fontWeight: 800, letterSpacing: -1, color: "#fff" }}>
            Ogni<span style={{ color: RED }}>Ora</span>
          </div>
          <div style={{ background: RED, color: "#fff", fontSize: 28, fontWeight: 800, letterSpacing: 2, padding: "6px 16px", borderRadius: 8 }}>FLASH</div>
        </div>
        <SceneProgress scenes={spec.scenes} seconds={seconds} />
        <div
          style={{
            marginTop: 32,
            color: "#c9c9d1",
            fontSize: 42,
            lineHeight: 1.25,
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 3,
            overflow: "hidden",
          }}
        >
          {spec.title}
        </div>
      </div>

      <div style={{ position: "absolute", top: 800, left: SAFE.left, right: SAFE.right, height: 460, display: "flex", alignItems: "center" }}>
        {cue && <Caption key={cue.startSeconds} cue={cue} />}
      </div>

      <div style={{ position: "absolute", bottom: SAFE.bottom, left: SAFE.left, right: SAFE.right, color: "#a3a3ad", fontSize: 30, lineHeight: 1.35 }}>
        {spec.sources.length > 0 && <div>Fonti: {spec.sources.join(", ")}</div>}
        <div>Voce generata con IA</div>
      </div>
    </AbsoluteFill>
  );
}
