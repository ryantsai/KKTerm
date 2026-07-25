/*
 * Adapted from Componentry's Kinetic Text Reveal by Harsh Jadhav under the MIT License.
 * See docs/licenses/componentry-mit.txt.
 */
import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";

type AssistantKineticTextTone = "waiting" | "tool" | "skill";

export function AssistantKineticText({
  active = false,
  className,
  text,
  tone = "waiting",
}: {
  active?: boolean;
  className?: string;
  text: string;
  tone?: AssistantKineticTextTone;
}) {
  const shouldReduceMotion = useReducedMotion();
  const segments = useMemo(() => splitAssistantStatusText(text), [text]);

  return (
    <span
      aria-label={text}
      className={`assistant-kinetic-text${className ? ` ${className}` : ""}`}
      data-active={active}
      data-tone={tone}
    >
      {segments.map((segment) =>
        segment.isWhitespace ? (
          <span
            aria-hidden="true"
            className="assistant-kinetic-space"
            key={`${text}-space-${segment.index}`}
          >
            {segment.value}
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="assistant-kinetic-mask"
            key={`${text}-word-${segment.index}`}
          >
            <motion.span
              animate={{
                filter: "blur(0px)",
                opacity: 1,
                y: 0,
              }}
              className="assistant-kinetic-segment"
              initial={
                shouldReduceMotion
                  ? false
                  : {
                      filter: "blur(4px)",
                      opacity: 0,
                      y: 5,
                    }
              }
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : {
                      delay: Math.min(segment.wordIndex * 0.025, 0.14),
                      duration: 0.42,
                      ease: [0.22, 1, 0.36, 1],
                    }
              }
            >
              {segment.value}
            </motion.span>
          </span>
        ),
      )}
    </span>
  );
}

export function AssistantWaitingDots() {
  return (
    <span className="assistant-waiting-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function splitAssistantStatusText(text: string) {
  let wordIndex = 0;
  const parts = /\s/.test(text) ? text.split(/(\s+)/) : splitAssistantStatusGraphemes(text);
  return parts
    .filter(Boolean)
    .map((value, index) => {
      const isWhitespace = /^\s+$/.test(value);
      return {
        index,
        isWhitespace,
        value,
        wordIndex: isWhitespace ? -1 : wordIndex++,
      };
    });
}

function splitAssistantStatusGraphemes(text: string) {
  return Array.from(text);
}
