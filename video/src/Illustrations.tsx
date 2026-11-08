// Original vector illustrations for the cover, drawn here and owned by the
// project: no photos, no third-party images, no legible text or digits.
import type { ReactNode } from "react";

export const VISUALS = [
  "carburante", "economia", "politica", "esteri", "giustizia", "salute", "meteo", "trasporti", "lavoro", "tecnologia", "ambiente", "generico",
] as const;
export type Visual = (typeof VISUALS)[number];

const RED = "#e54b4b";

/** Shared gradients: brushed steel, dark rubber, a red glow. */
function Defs() {
  return (
    <defs>
      <linearGradient id="steel" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#3a3a40" />
        <stop offset="0.35" stopColor="#8d8d96" />
        <stop offset="0.55" stopColor="#c9c9d1" />
        <stop offset="0.75" stopColor="#6e6e78" />
        <stop offset="1" stopColor="#2a2a30" />
      </linearGradient>
      <linearGradient id="dark" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#2b2b31" />
        <stop offset="1" stopColor="#0d0d10" />
      </linearGradient>
      <linearGradient id="rubber" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#0b0b0d" />
        <stop offset="0.5" stopColor="#34343b" />
        <stop offset="1" stopColor="#0b0b0d" />
      </linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor={RED} stopOpacity="0.55" />
        <stop offset="1" stopColor={RED} stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

const stroke = { stroke: "#e8e8ee", strokeWidth: 14, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

function FuelPump() {
  return (
    <g>
      <rect x="250" y="40" width="330" height="760" rx="36" fill="url(#steel)" />
      <rect x="290" y="90" width="250" height="160" rx="18" fill="#101014" stroke="#55555e" strokeWidth="6" />
      <rect x="310" y="112" width="210" height="18" rx="9" fill={RED} opacity="0.9" />
      <rect x="310" y="150" width="150" height="14" rx="7" fill="#3c3c44" />
      <rect x="310" y="180" width="180" height="14" rx="7" fill="#3c3c44" />
      <rect x="440" y="300" width="100" height="220" rx="20" fill="url(#dark)" stroke="#5a5a63" strokeWidth="6" />
      {/* Hose from the pump to the nozzle held in front of it. */}
      <path d="M 490 520 C 500 700, 330 760, 250 640 C 200 560, 230 470, 250 420" stroke="url(#rubber)" strokeWidth="44" fill="none" strokeLinecap="round" />
      <g transform="rotate(-18 200 420)">
        <rect x="200" y="350" width="110" height="230" rx="34" fill="url(#dark)" stroke="#5a5a63" strokeWidth="6" />
        <path d="M 200 520 C 140 520, 130 600, 200 600" stroke="#6b6b75" strokeWidth="14" fill="none" strokeLinecap="round" />
        <circle cx="255" cy="400" r="34" fill="#0b0b0d" stroke="#c9c9d1" strokeWidth="8" />
        <circle cx="255" cy="400" r="12" fill={RED} />
        <rect x="225" y="575" width="60" height="40" rx="10" fill="url(#steel)" />
        <path d="M 255 610 L 255 690 Q 255 730 215 760" stroke="url(#steel)" strokeWidth="34" fill="none" strokeLinecap="round" />
      </g>
    </g>
  );
}

function Economy() {
  return (
    <g>
      {[0, 1, 2, 3].map((index) => (
        <rect key={index} x={120 + index * 110} y={560 - index * 110} width="80" height={200 + index * 110} rx="12" fill={index === 3 ? RED : "url(#steel)"} />
      ))}
      <path d="M 100 520 L 230 420 L 330 460 L 520 230" {...stroke} />
      <path d="M 460 230 L 520 230 L 520 290" {...stroke} />
      <circle cx="430" cy="640" r="120" fill="url(#dark)" stroke="#c9c9d1" strokeWidth="10" />
      <path d="M 480 590 A 70 70 0 1 0 480 690 M 360 625 L 450 625 M 360 655 L 450 655" {...stroke} strokeWidth={12} />
    </g>
  );
}

function Politics() {
  return (
    <g>
      <path d="M 140 330 A 160 130 0 0 1 460 330 Z" fill="url(#steel)" />
      <rect x="290" y="150" width="20" height="60" fill="#c9c9d1" />
      <path d="M 310 155 L 380 175 L 310 195 Z" fill={RED} />
      <rect x="90" y="330" width="420" height="40" rx="8" fill="#c9c9d1" />
      {[0, 1, 2, 3, 4].map((index) => (
        <rect key={index} x={120 + index * 80} y="380" width="40" height="300" rx="10" fill="url(#steel)" />
      ))}
      <rect x="70" y="690" width="460" height="40" rx="8" fill="#c9c9d1" />
      <rect x="40" y="740" width="520" height="40" rx="8" fill="#8d8d96" />
    </g>
  );
}

function Globe() {
  return (
    <g>
      <circle cx="320" cy="420" r="250" fill="url(#dark)" stroke="#c9c9d1" strokeWidth="12" />
      <ellipse cx="320" cy="420" rx="110" ry="250" {...stroke} strokeWidth={8} />
      <path d="M 70 420 L 570 420 M 110 290 L 530 290 M 110 550 L 530 550 M 320 170 L 320 670" {...stroke} strokeWidth={8} />
      <circle cx="420" cy="330" r="22" fill={RED} />
      <path d="M 420 330 C 470 250, 560 230, 600 260" stroke={RED} strokeWidth="8" fill="none" strokeDasharray="18 14" />
    </g>
  );
}

function Scales() {
  return (
    <g>
      <rect x="290" y="140" width="24" height="560" rx="10" fill="url(#steel)" />
      <rect x="180" y="700" width="244" height="50" rx="14" fill="#c9c9d1" />
      <rect x="100" y="210" width="400" height="20" rx="10" fill="url(#steel)" transform="rotate(-6 300 220)" />
      <circle cx="302" cy="200" r="30" fill={RED} />
      <path d="M 120 240 L 60 450 M 120 240 L 180 450" {...stroke} strokeWidth={6} />
      <path d="M 480 200 L 420 410 M 480 200 L 540 410" {...stroke} strokeWidth={6} />
      <path d="M 40 450 A 80 40 0 0 0 200 450 Z" fill="url(#steel)" />
      <path d="M 400 410 A 80 40 0 0 0 560 410 Z" fill="url(#steel)" />
    </g>
  );
}

function Health() {
  return (
    <g>
      <circle cx="320" cy="380" r="230" fill="url(#dark)" stroke="#c9c9d1" strokeWidth="10" />
      <path d="M 270 230 H 370 V 330 H 470 V 430 H 370 V 530 H 270 V 430 H 170 V 330 H 270 Z" fill={RED} />
      <path d="M 40 720 H 200 L 240 640 L 300 800 L 350 680 L 380 720 H 600" {...stroke} />
    </g>
  );
}

function Weather() {
  return (
    <g>
      <path d="M 150 460 A 100 100 0 0 1 200 280 A 140 140 0 0 1 450 260 A 110 110 0 0 1 470 460 Z" fill="url(#steel)" />
      {[0, 1, 2, 3, 4].map((index) => (
        <path key={index} d={`M ${190 + index * 65} 520 l -30 90`} stroke={index % 2 ? "#c9c9d1" : RED} strokeWidth="16" strokeLinecap="round" />
      ))}
      {[0, 1, 2, 3].map((index) => (
        <path key={index} d={`M ${220 + index * 65} 650 l -30 90`} stroke="#c9c9d1" strokeWidth="16" strokeLinecap="round" />
      ))}
    </g>
  );
}

function Train() {
  return (
    <g>
      <path d="M 160 200 Q 320 120 480 200 L 520 640 Q 320 690 120 640 Z" fill="url(#steel)" />
      <path d="M 200 240 Q 320 190 440 240 L 455 400 Q 320 420 185 400 Z" fill="#101014" />
      <circle cx="200" cy="540" r="30" fill="#f1f1f4" />
      <circle cx="440" cy="540" r="30" fill="#f1f1f4" />
      <rect x="250" y="600" width="140" height="20" rx="10" fill={RED} />
      <path d="M 180 680 L 80 800 M 460 680 L 560 800 M 140 740 H 500" {...stroke} strokeWidth={10} />
    </g>
  );
}

function Work() {
  return (
    <g>
      <path d="M 120 460 A 200 200 0 0 1 520 460 Z" fill={RED} />
      <rect x="290" y="250" width="60" height="210" rx="20" fill="#b83a3a" />
      <rect x="80" y="450" width="480" height="50" rx="24" fill="#c9c9d1" />
      <g transform="translate(320 650)">
        {Array.from({ length: 8 }, (_, index) => (
          <rect key={index} x="-22" y="-120" width="44" height="50" rx="8" fill="url(#steel)" transform={`rotate(${index * 45})`} />
        ))}
        <circle r="95" fill="url(#steel)" />
        <circle r="38" fill="#101014" />
      </g>
    </g>
  );
}

function Chip() {
  return (
    <g>
      {Array.from({ length: 6 }, (_, index) => (
        <g key={index}>
          <rect x={170 + index * 55} y="120" width="18" height="90" rx="6" fill="#c9c9d1" />
          <rect x={170 + index * 55} y="590" width="18" height="90" rx="6" fill="#c9c9d1" />
          <rect x="70" y={220 + index * 55} width="90" height="18" rx="6" fill="#c9c9d1" />
          <rect x="480" y={220 + index * 55} width="90" height="18" rx="6" fill="#c9c9d1" />
        </g>
      ))}
      <rect x="150" y="200" width="340" height="400" rx="30" fill="url(#dark)" stroke="#c9c9d1" strokeWidth="10" />
      <rect x="230" y="290" width="180" height="220" rx="16" fill={RED} />
      <path d="M 250 360 H 390 M 250 400 H 390 M 250 440 H 390" stroke="#101014" strokeWidth="10" />
    </g>
  );
}

function Leaf() {
  return (
    <g>
      <path d="M 120 680 C 100 360, 300 150, 560 120 C 560 420, 400 660, 120 680 Z" fill="url(#steel)" />
      <path d="M 120 680 C 260 520, 380 360, 540 140" {...stroke} stroke="#101014" strokeWidth={12} />
      <path d="M 250 520 L 220 400 M 330 430 L 320 300 M 330 430 L 450 410 M 250 520 L 380 540" {...stroke} stroke="#101014" strokeWidth={8} />
      <circle cx="480" cy="640" r="70" fill={RED} />
    </g>
  );
}

function Broadcast() {
  return (
    <g>
      <rect x="250" y="200" width="140" height="300" rx="70" fill="url(#steel)" />
      <path d="M 200 400 A 120 120 0 0 0 440 400 M 320 520 V 640 M 240 660 H 400" {...stroke} />
      {[1, 2, 3].map((ring) => (
        <path key={ring} d={`M ${190 - ring * 50} ${200 - ring * 20} A ${200 + ring * 40} ${200 + ring * 40} 0 0 0 ${190 - ring * 50} ${560 + ring * 20}`} stroke={ring === 1 ? RED : "#8d8d96"} strokeWidth="12" fill="none" strokeLinecap="round" />
      ))}
    </g>
  );
}

const DRAWINGS: Record<Visual, () => ReactNode> = {
  carburante: FuelPump,
  economia: Economy,
  politica: Politics,
  esteri: Globe,
  giustizia: Scales,
  salute: Health,
  meteo: Weather,
  trasporti: Train,
  lavoro: Work,
  tecnologia: Chip,
  ambiente: Leaf,
  generico: Broadcast,
};

export function Illustration({ visual }: { visual: Visual }) {
  const Drawing = DRAWINGS[visual];
  return (
    <svg viewBox="0 0 640 820" width="100%" height="100%">
      <Defs />
      <ellipse cx="320" cy="430" rx="320" ry="380" fill="url(#glow)" />
      <Drawing />
    </svg>
  );
}
