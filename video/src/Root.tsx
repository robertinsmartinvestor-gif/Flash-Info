import { Composition } from "remotion";
import { FlashV1, type FlashSpec } from "./FlashV1";

const PLACEHOLDER: FlashSpec = {
  frame: { width: 1080, height: 1920, fps: 30 },
  durationSeconds: 1,
  title: "",
  sources: [],
  scenes: [],
  captions: [],
};

export function Root() {
  return (
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
  );
}
