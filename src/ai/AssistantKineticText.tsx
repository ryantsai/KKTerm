/*
 * Adapted from Componentry's Kinetic Text Reveal and Text Repel by Harsh Jadhav
 * under the MIT License.
 * See docs/licenses/componentry-mit.txt.
 */
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useEffect, useMemo, useRef, type MouseEvent } from "react";

type AssistantKineticTextTone = "waiting" | "tool" | "skill";

export function AssistantKineticText({
  active = false,
  className,
  repel = false,
  text,
  tone = "waiting",
}: {
  active?: boolean;
  className?: string;
  repel?: boolean;
  text: string;
  tone?: AssistantKineticTextTone;
}) {
  const shouldReduceMotion = useReducedMotion();
  const segments = useMemo(() => splitAssistantStatusText(text), [text]);
  const mouseX = useMotionValue(-9999);
  const mouseY = useMotionValue(-9999);
  const shouldRepel = repel && !shouldReduceMotion;

  const handleMouseMove = (event: MouseEvent<HTMLSpanElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    mouseX.set(event.clientX - rect.left);
    mouseY.set(event.clientY - rect.top);
  };

  const handleMouseLeave = () => {
    mouseX.set(-9999);
    mouseY.set(-9999);
  };

  return (
    <span
      aria-label={text}
      className={`assistant-kinetic-text${className ? ` ${className}` : ""}`}
      data-active={active}
      data-text-repel={shouldRepel ? true : undefined}
      data-tone={tone}
      onMouseLeave={shouldRepel ? handleMouseLeave : undefined}
      onMouseMove={shouldRepel ? handleMouseMove : undefined}
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
              {shouldRepel ? (
                <AssistantRepelSegment mouseX={mouseX} mouseY={mouseY} text={segment.value} />
              ) : (
                segment.value
              )}
            </motion.span>
          </span>
        ),
      )}
    </span>
  );
}

function AssistantRepelSegment({
  mouseX,
  mouseY,
  text,
}: {
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
  text: string;
}) {
  return splitAssistantStatusGraphemes(text).map((letter, index) => (
    <AssistantRepelLetter
      key={`${letter}-${index}`}
      letter={letter}
      mouseX={mouseX}
      mouseY={mouseY}
    />
  ));
}

function AssistantRepelLetter({
  letter,
  mouseX,
  mouseY,
}: {
  letter: string;
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
}) {
  const letterRef = useRef<HTMLSpanElement>(null);
  const originXRef = useRef(0);
  const originYRef = useRef(0);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 180, damping: 16, mass: 0.4 });
  const springY = useSpring(y, { stiffness: 180, damping: 16, mass: 0.4 });
  const rotate = useTransform(springX, (value) => value * 0.2);

  useEffect(() => {
    const captureOrigin = () => {
      const letterElement = letterRef.current;
      const container = letterElement?.closest<HTMLElement>("[data-text-repel]");
      if (!letterElement || !container) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const letterRect = letterElement.getBoundingClientRect();
      originXRef.current = letterRect.left - containerRect.left + letterRect.width / 2;
      originYRef.current = letterRect.top - containerRect.top + letterRect.height / 2;
    };

    const animationFrame = window.requestAnimationFrame(captureOrigin);
    window.addEventListener("resize", captureOrigin);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", captureOrigin);
    };
  }, []);

  useEffect(() => {
    const updatePosition = () => {
      const dx = originXRef.current - mouseX.get();
      const dy = originYRef.current - mouseY.get();
      const distance = Math.hypot(dx, dy);
      const radius = 72;

      if (distance > 0 && distance < radius) {
        const force = (1 - distance / radius) ** 2 * 12;
        const angle = Math.atan2(dy, dx);
        x.set(Math.cos(angle) * force);
        y.set(Math.sin(angle) * force);
        return;
      }

      x.set(0);
      y.set(0);
    };

    const unsubscribeX = mouseX.on("change", updatePosition);
    const unsubscribeY = mouseY.on("change", updatePosition);
    return () => {
      unsubscribeX();
      unsubscribeY();
    };
  }, [mouseX, mouseY, x, y]);

  return (
    <motion.span
      aria-hidden="true"
      className="assistant-repel-letter"
      ref={letterRef}
      style={{ rotate, x: springX, y: springY }}
    >
      {letter}
    </motion.span>
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
