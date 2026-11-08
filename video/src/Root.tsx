import { Composition, Still } from "remotion";
import { CoverV1, type CoverProps } from "./CoverV1";
import { FlashV1, type FlashSpec } from "./FlashV1";

const PLACEHOLDER: FlashSpec = {
  frame: { width: 1080, height: 1920, fps: 30 },
  durationSeconds: 1,
  title: "",
  sources: [],
  scenes: [],
  captions: [],
};

const COVER_PLACEHOLDER: CoverProps = {
  headline: "Copertina di prova",
  qualifier: "",
  subline: "",
  dateLabel: "1 GEN 2026",
  sources: [],
  visual: "generico",
  seed: 1,
};

export function Root() {
  return (
    <>
      <Composition
        id="flash-v1"
        component={FlashV1}
        width={PLACEHOLDER.frame.width}
        height={PLACEHOLDER.frame.height}
        fps={PLACEHOLDER.frame.fps}
        durationInFrames={30}
        defaultProps={{ spec: PLACEHOLDER, audioFile: "" }}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.ceil(props.spec.durationSeconds * props.spec.frame.fps),
        })}
      />
      <Still id="cover-v1" component={CoverV1} width={1080} height={1920} defaultProps={COVER_PLACEHOLDER} />
    </>
  );
}
