import { useEffect, useRef, useState } from "react";

import horizonSource from "./at-the-horizon-we-meet.html?raw";

export type AtTheHorizonProps = {
  className?: string;
};

export function AtTheHorizon({ className = "" }: AtTheHorizonProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const intersectsRef = useRef(true);
  const [mounted, setMounted] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const sync = () => setMounted(intersectsRef.current && document.visibilityState !== "hidden");
    const observer = new IntersectionObserver(([entry]) => {
      intersectsRef.current = entry.isIntersecting;
      sync();
    }, { rootMargin: "80px" });

    observer.observe(host);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  useEffect(() => {
    setReady(false);
  }, [mounted]);

  return (
    <div
      ref={hostRef}
      className={`at-the-horizon${className ? ` ${className}` : ""}`}
      data-state={!mounted ? "paused" : ready ? "ready" : "loading"}
    >
      {mounted ? (
        <iframe
          className={`at-the-horizon__frame${ready ? " is-ready" : ""}`}
          title="At the Horizon, We Meet"
          srcDoc={horizonSource}
          sandbox="allow-scripts"
          loading="eager"
          onLoad={() => setReady(true)}
        />
      ) : null}
    </div>
  );
}
