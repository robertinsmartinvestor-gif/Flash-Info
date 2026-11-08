import { loadFont } from "@remotion/fonts";
import inter500 from "@fontsource/inter/files/inter-latin-500-normal.woff2";
import inter800 from "@fontsource/inter/files/inter-latin-800-normal.woff2";
import inter800Italic from "@fontsource/inter/files/inter-latin-800-italic.woff2";
import inter900 from "@fontsource/inter/files/inter-latin-900-normal.woff2";
import { useLayoutEffect, useRef, useState } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender } from "remotion";
import { Illustration, type Visual } from "./Illustrations";

/** The part of CoverSpec (src/media/cover-spec.ts) this template reads: validated plain text only. */
export type CoverProps = {
  headline: string;
  qualifier: string;
  subline: string;
  dateLabel: string;
  sources: string[];
  visual: Visual;
  seed: number;
};

const FONT = "Inter";
const RED = "#e54b4b";
const WIDTH = 1080;
/** Same side margins as SAFE_AREA in src/media/render-spec.ts: the right one stays clear of YouTube's buttons. */
const SIDE = { left: 60, right: 140 };
/** Nothing below this line: the lowest 20% of the frame belongs to YouTube's interface. */
const TEXT_BOTTOM = 1920 * 0.8;
const HEADLINE_TOP = 250;
const HEADLINE_MAX_HEIGHT = 640;
const MIN_HEADLINE_SIZE = 70;

const fonts = Promise.all([
  loadFont({ family: FONT, url: inter500, weight: "500" }),
  loadFont({ family: FONT, url: inter800, weight: "800" }),
  loadFont({ family: FONT, url: inter800Italic, weight: "800", style: "italic" }),
  loadFont({ family: FONT, url: inter900, weight: "900" }),
]);

/** Deterministic variation from the seed: a fraction in [0, 1). */
const pick = (seed: number, salt: number) => ((Math.imul(seed ^ salt, 2654435761) >>> 0) % 10_000) / 10_000;

function overflows(element: HTMLElement | null): boolean {
  return !!element && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
}

function Clock({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="44" fill="none" stroke="#fff" strokeWidth="7" />
      <line x1="50" y1="50" x2="50" y2="22" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
      <line x1="50" y1="50" x2="72" y2="40" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
      <circle cx="50" cy="50" r="8" fill={RED} />
    </svg>
  );
}

/**
 * The headline shrinks until every word fits the width and all lines fit the
 * box. If even the smallest size overflows, the render fails: a cover never
 * ships with clipped text.
 */
export function CoverV1(props: CoverProps) {
  const [handle] = useState(() => delayRender("cover layout"));
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState(170);
  const headline = useRef<HTMLDivElement>(null);
  const lower = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    fonts.then(() => setReady(true), (error) => cancelRender(error));
  }, []);

  useLayoutEffect(() => {
    if (!ready) return;
    if (overflows(headline.current)) {
      if (size - 6 < MIN_HEADLINE_SIZE) cancelRender(new Error("cover_text_overflow"));
      else setSize(size - 6);
      return;
    }
    if (overflows(lower.current)) {
      cancelRender(new Error("cover_text_overflow"));
      return;
    }
    continueRender(handle);
  }, [ready, size, handle]);

  const angle = 115 + pick(props.seed, 1) * 40;
  const band = 30 + pick(props.seed, 2) * 30;
  const tilt = -6 + pick(props.seed, 3) * 12;
  const shift = pick(props.seed, 4) * 80;
  const textWidth = WIDTH - SIDE.left - SIDE.right;

  return (
    <AbsoluteFill style={{ fontFamily: FONT, background: "#0b0a0c", overflow: "hidden", visibility: ready ? "visible" : "hidden" }}>
      <AbsoluteFill style={{ background: `linear-gradient(${angle}deg, #0b0a0c 0%, #2a0d12 ${band}%, #120a0d ${band + 25}%, #0b0a0c 100%)` }} />
      <div
        style={{
          position: "absolute", left: -200, right: -200, top: 980 + shift, height: 70,
          background: `linear-gradient(90deg, transparent, ${RED}88, transparent)`, transform: `rotate(${tilt - 12}deg)`, filter: "blur(18px)",
        }}
      />
      <div style={{ position: "absolute", right: -40 + shift / 2, top: 640 - shift / 2, width: 680, height: 860, transform: `rotate(${tilt}deg)`, opacity: 0.95 }}>
        <Illustration visual={props.visual} />
      </div>
      {/* Keeps the text readable over the drawing. */}
      <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(11,10,12,0.92) 0%, rgba(11,10,12,0.55) 55%, rgba(11,10,12,0) 85%)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(11,10,12,0.85) 0%, rgba(11,10,12,0) 18%, rgba(11,10,12,0) 60%, rgba(11,10,12,0.9) 74%, rgba(11,10,12,0.96) 100%)" }} />

      <div style={{ position: "absolute", top: 70, left: SIDE.left, right: 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Clock size={86} />
          <div style={{ fontSize: 70, fontWeight: 800, letterSpacing: -2, color: "#fff" }}>
            Ogni<span style={{ color: RED }}>Ora</span>
          </div>
        </div>
        <div style={{ background: RED, color: "#fff", fontSize: 34, fontWeight: 800, fontStyle: "italic", padding: "12px 34px", transform: "skewX(-14deg)" }}>
          <div style={{ transform: "skewX(14deg)" }}>FLASH • {props.dateLabel}</div>
        </div>
      </div>
      <div style={{ position: "absolute", top: 200, left: SIDE.left, right: 60, height: 6, background: "rgba(255,255,255,0.18)" }}>
        <div style={{ width: 230, height: "100%", background: RED }} />
      </div>

      <div
        ref={headline}
        style={{
          position: "absolute", top: HEADLINE_TOP, left: SIDE.left, width: textWidth, maxHeight: HEADLINE_MAX_HEIGHT, overflow: "hidden",
          color: "#fff", fontSize: size, fontWeight: 900, lineHeight: 1.0, letterSpacing: -2, textTransform: "uppercase",
          wordBreak: "keep-all", overflowWrap: "normal", hyphens: "none", textShadow: "0 6px 30px rgba(0,0,0,0.6)",
        }}
      >
        {props.headline}
        {props.qualifier && (
          <div style={{ marginTop: 34, lineHeight: 1 }}>
            <span style={{ display: "inline-block", background: RED, color: "#fff", fontSize: 76, fontWeight: 800, fontStyle: "italic", letterSpacing: -1, padding: "18px 40px", borderRadius: 999, boxShadow: "0 10px 40px rgba(229,75,75,0.45)" }}>
              {props.qualifier}
            </span>
          </div>
        )}
      </div>

      <div
        ref={lower}
        style={{ position: "absolute", left: SIDE.left, width: textWidth, bottom: 1920 - TEXT_BOTTOM, maxHeight: 300, overflow: "hidden", color: "#fff" }}
      >
        {props.subline && (
          <div style={{ display: "flex", gap: 22, alignItems: "stretch", fontSize: 50, fontWeight: 500, lineHeight: 1.18, textShadow: "0 3px 16px rgba(0,0,0,0.7)" }}>
            <div style={{ width: 9, flex: "none", background: RED, borderRadius: 4 }} />
            <div>{props.subline}</div>
          </div>
        )}
        {props.sources.length > 0 && (
          <div style={{ marginTop: 26, paddingTop: 22, borderTop: "2px solid rgba(255,255,255,0.35)", fontSize: 32, fontWeight: 500, color: "#d9d9de" }}>
            Fonti: {props.sources.join(" • ")}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}
