import { Floppy } from "../../lib/reicon";

export function SaveAsIcon({ size = 15 }: { size?: number }) {
  const frameSize = size + 3;

  return (
    <span
      aria-hidden="true"
      style={{
        alignItems: "center",
        display: "inline-flex",
        height: frameSize,
        justifyContent: "center",
        position: "relative",
        width: frameSize,
      }}
    >
      <Floppy
        size={size - 1}
        style={{
          opacity: 0.72,
          position: "absolute",
          transform: "translate(3px, -3px)",
        }}
      />
      <Floppy
        size={size}
        style={{
          position: "absolute",
          transform: "translate(-2px, 2px)",
        }}
      />
    </span>
  );
}
