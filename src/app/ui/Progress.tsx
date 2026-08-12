import { motion, useReducedMotion } from "motion/react";

export function Progress({
  ariaLabel,
  className = "",
  value,
}: {
  ariaLabel: string;
  className?: string;
  value: number;
}) {
  const reducedMotion = useReducedMotion();
  const progress = Math.max(0, Math.min(100, value));

  return (
    <div
      aria-label={ariaLabel}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={progress}
      className={`kk-progress ${className}`.trim()}
      role="progressbar"
    >
      <motion.div
        animate={{ scaleX: progress / 100 }}
        className="kk-progress-indicator"
        initial={false}
        style={{ originX: 0 }}
        transition={
          reducedMotion
            ? { duration: 0 }
            : { type: "spring", stiffness: 220, damping: 30, mass: 0.45 }
        }
      />
    </div>
  );
}
