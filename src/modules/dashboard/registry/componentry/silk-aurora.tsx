/*
 * Adapted from Componentry by Harsh Jadhav under the MIT License.
 * See docs/licenses/componentry-mit.txt.
 */
import * as React from "react";
import { cn } from "./componentrySupport";
import {
  WebGLErrorBoundary,
  WebGLFallback,
} from "./componentrySupport";

const VERTEX_SHADER = `
attribute vec2 position;

void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_res;
uniform vec2 u_mouse;
uniform float u_time;
uniform float u_speed;
uniform float u_intensity;
uniform float u_grain;
uniform float u_vignette;
uniform float u_mouseInfluence;
uniform vec3 u_base;
uniform vec3 u_mid;
uniform vec3 u_sheen;
uniform vec3 u_accent;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);

  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.82, 0.57, -0.57, 0.82);

  for (int i = 0; i < 5; i++) {
    value += amp * noise(p);
    p = rot * p * 2.03;
    amp *= 0.5;
  }

  return value;
}

float ribbon(vec2 p, float offset, float width, float softness) {
  float y = p.y + sin(p.x * 1.8 + offset) * 0.18;
  y += sin(p.x * 4.2 - offset * 0.7) * 0.045;
  return smoothstep(width + softness, width, abs(y));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  vec2 mouse = (u_mouse - 0.5) * vec2(aspect, 1.0);
  float t = u_time * 0.12 * u_speed;
  float pointerFalloff = smoothstep(0.72, 0.0, length(p - mouse));
  p += (mouse - p) * pointerFalloff * 0.05 * u_mouseInfluence;

  vec2 silk = p;
  silk.x += fbm(p * 1.6 + vec2(t * 0.8, -t * 0.35)) * 0.16;
  silk.y += fbm(p * 2.2 + vec2(-t * 0.25, t * 0.7)) * 0.10;

  float veilA = ribbon(silk + vec2(-0.18, 0.08), t * 2.1, 0.055, 0.22);
  float veilB = ribbon(silk * vec2(0.86, 1.18) + vec2(0.2, -0.14), -t * 2.8 + 1.7, 0.038, 0.18);
  float veilC = ribbon(silk * vec2(1.18, 0.9) + vec2(-0.08, 0.24), t * 1.4 - 2.1, 0.03, 0.16);

  float atmosphere = fbm(p * 1.35 + vec2(t * 0.22, -t * 0.1));
  float pearlescent = pow(max(0.0, sin((p.x - p.y) * 7.5 + atmosphere * 4.0 - t * 2.5)), 5.0);
  float glint = pow(max(0.0, noise(gl_FragCoord.xy * 0.065 + t * 18.0) - 0.72), 5.0);

  vec3 col = u_base;
  col = mix(col, u_mid, smoothstep(-0.45, 0.75, p.y + atmosphere * 0.75));
  col += u_accent * veilA * 0.72 * u_intensity;
  col += u_sheen * veilB * 0.64 * u_intensity;
  col += mix(u_sheen, u_accent, 0.35) * veilC * 0.42 * u_intensity;
  col += u_sheen * pearlescent * 0.075 * u_intensity;
  col += vec3(1.0, 0.93, 0.82) * glint * 0.22 * u_intensity;
  col += u_sheen * pointerFalloff * 0.08 * u_mouseInfluence;

  float vignette = smoothstep(1.25, 0.22, length(p));
  col *= mix(1.0 - u_vignette * 0.42, 1.06, vignette);

  float grain = (hash(gl_FragCoord.xy + t * 90.0) - 0.5) * 0.08 * u_grain;
  col += grain;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const HEX_COLOR_REGEX = /^#?[0-9a-fA-F]{6}$/;

const DEFAULT_BASE = "#050507";
const DEFAULT_MID = "#14151d";
const DEFAULT_SHEEN = "#f4dfb8";
const DEFAULT_ACCENT = "#6ed6c9";

function sanitizeHexColor(value: string, fallback: string) {
  const trimmed = value.trim();
  if (!HEX_COLOR_REGEX.test(trimmed)) {
    return fallback;
  }

  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function hexToRgb01(hex: string, fallback: string): [number, number, number] {
  const normalized = sanitizeHexColor(hex, fallback).replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;

  return [r, g, b];
}

export interface SilkAuroraProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  description?: string;
  baseColor?: string;
  midColor?: string;
  sheenColor?: string;
  accentColor?: string;
  speed?: number;
  intensity?: number;
  grain?: number;
  vignette?: number;
  mouseInfluence?: number;
  interactive?: boolean;
  children?: React.ReactNode;
}

const HEADLINE_CLASS =
  "max-w-[820px] text-[13cqi] font-semibold leading-[0.86] tracking-normal text-white md:text-[8cqi] lg:text-[6.4cqi]";

export function SilkAurora({
  title,
  subtitle,
  description,
  baseColor = DEFAULT_BASE,
  midColor = DEFAULT_MID,
  sheenColor = DEFAULT_SHEEN,
  accentColor = DEFAULT_ACCENT,
  speed = 1,
  intensity = 1,
  grain = 0.85,
  vignette = 1,
  mouseInfluence = 1,
  interactive = true,
  className,
  children,
  style,
  ...props
}: SilkAuroraProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const mouseRef = React.useRef({ x: 0.5, y: 0.5 });
  const targetMouseRef = React.useRef({ x: 0.5, y: 0.5 });
  const [hasWebGLError, setHasWebGLError] = React.useState(false);

  const settings = React.useMemo(
    () => ({
      baseColor,
      midColor,
      sheenColor,
      accentColor,
      speed,
      intensity,
      grain,
      vignette,
      mouseInfluence,
      interactive,
    }),
    [
      baseColor,
      midColor,
      sheenColor,
      accentColor,
      speed,
      intensity,
      grain,
      vignette,
      mouseInfluence,
      interactive,
    ],
  );

  React.useEffect(() => {
    if (hasWebGLError) {
      return;
    }

    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) {
      return;
    }

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const handlePointerMove = (event: PointerEvent) => {
      if (!settings.interactive || event.buttons !== 0) {
        return;
      }

      const rect = container.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        return;
      }
      targetMouseRef.current = {
        x: (event.clientX - rect.left) / rect.width,
        y: 1 - (event.clientY - rect.top) / rect.height,
      };
    };

    try {
      const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
      if (!gl) {
        setHasWebGLError(true);
        return;
      }

      const compileShader = (type: number, source: string) => {
        const shader = gl.createShader(type);
        if (!shader) {
          return null;
        }

        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          gl.deleteShader(shader);
          return null;
        }

        return shader;
      };

      const vertexShader = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragmentShader = compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      if (!vertexShader || !fragmentShader) {
        setHasWebGLError(true);
        return;
      }

      const program = gl.createProgram();
      if (!program) {
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        setHasWebGLError(true);
        return;
      }

      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        setHasWebGLError(true);
        return;
      }

      gl.useProgram(program);

      const position = gl.getAttribLocation(program, "position");
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      const uRes = gl.getUniformLocation(program, "u_res");
      const uMouse = gl.getUniformLocation(program, "u_mouse");
      const uTime = gl.getUniformLocation(program, "u_time");
      const uSpeed = gl.getUniformLocation(program, "u_speed");
      const uIntensity = gl.getUniformLocation(program, "u_intensity");
      const uGrain = gl.getUniformLocation(program, "u_grain");
      const uVignette = gl.getUniformLocation(program, "u_vignette");
      const uMouseInfluence = gl.getUniformLocation(
        program,
        "u_mouseInfluence",
      );
      const uBase = gl.getUniformLocation(program, "u_base");
      const uMid = gl.getUniformLocation(program, "u_mid");
      const uSheen = gl.getUniformLocation(program, "u_sheen");
      const uAccent = gl.getUniformLocation(program, "u_accent");

      if (
        !uRes ||
        !uMouse ||
        !uTime ||
        !uSpeed ||
        !uIntensity ||
        !uGrain ||
        !uVignette ||
        !uMouseInfluence ||
        !uBase ||
        !uMid ||
        !uSheen ||
        !uAccent
      ) {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        setHasWebGLError(true);
        return;
      }

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const { width, height } = container.getBoundingClientRect();
        canvas.width = Math.max(1, Math.floor(width * dpr));
        canvas.height = Math.max(1, Math.floor(height * dpr));
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(uRes, canvas.width, canvas.height);
      };

      resize();
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);

      const base = hexToRgb01(settings.baseColor, DEFAULT_BASE);
      const mid = hexToRgb01(settings.midColor, DEFAULT_MID);
      const sheen = hexToRgb01(settings.sheenColor, DEFAULT_SHEEN);
      const accent = hexToRgb01(settings.accentColor, DEFAULT_ACCENT);

      gl.uniform3f(uBase, base[0], base[1], base[2]);
      gl.uniform3f(uMid, mid[0], mid[1], mid[2]);
      gl.uniform3f(uSheen, sheen[0], sheen[1], sheen[2]);
      gl.uniform3f(uAccent, accent[0], accent[1], accent[2]);

      let rafId = 0;
      const start = performance.now();
      document.addEventListener("pointermove", handlePointerMove, { passive: true });

      const render = (now: number) => {
        mouseRef.current.x +=
          (targetMouseRef.current.x - mouseRef.current.x) * 0.045;
        mouseRef.current.y +=
          (targetMouseRef.current.y - mouseRef.current.y) * 0.045;

        const elapsed = reducedMotion ? 8 : (now - start) / 1000;

        gl.uniform2f(uMouse, mouseRef.current.x, mouseRef.current.y);
        gl.uniform1f(uTime, elapsed);
        gl.uniform1f(uSpeed, reducedMotion ? 0 : settings.speed);
        gl.uniform1f(uIntensity, settings.intensity);
        gl.uniform1f(uGrain, settings.grain);
        gl.uniform1f(uVignette, settings.vignette);
        gl.uniform1f(
          uMouseInfluence,
          settings.interactive && !reducedMotion ? settings.mouseInfluence : 0,
        );
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        rafId = requestAnimationFrame(render);
      };

      rafId = requestAnimationFrame(render);

      return () => {
        document.removeEventListener("pointermove", handlePointerMove);
        cancelAnimationFrame(rafId);
        resizeObserver.disconnect();
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
      };
    } catch {
      setHasWebGLError(true);
      return;
    }
  }, [hasWebGLError, settings]);

  const fallbackContent = (
    <div
      className={cn(
        "relative flex min-h-screen w-full items-center overflow-hidden bg-[#050507] text-white",
        className,
      )}
      style={{ containerType: "size", ...style }}
      {...props}
    >
      <WebGLFallback className="absolute inset-0 h-full w-full" />
      {(title || subtitle || description || children) && (
        <div className="relative z-10 mx-auto w-full max-w-[1240px] px-6 py-20 md:px-10 md:py-28">
          <div className="max-w-[760px]">
            {subtitle && (
              <p className="mb-5 text-xs font-medium uppercase tracking-[0.24em] text-white/50">
                {subtitle}
              </p>
            )}
            {title && <h1 className={HEADLINE_CLASS}>{title}</h1>}
            {description && (
              <p className="mt-7 max-w-[620px] text-base leading-relaxed text-white/68 md:text-xl">
                {description}
              </p>
            )}
            {children && <div className="mt-10">{children}</div>}
          </div>
        </div>
      )}
    </div>
  );

  if (hasWebGLError) {
    return fallbackContent;
  }

  return (
    <WebGLErrorBoundary fallback={fallbackContent}>
      <div
        ref={containerRef}
        className={cn(
          "relative flex min-h-screen w-full items-center overflow-hidden bg-[#050507] text-white",
          className,
        )}
        style={{ containerType: "size", ...style }}
        {...props}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ width: "100%", height: "100%", display: "block" }}
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_34%,rgba(255,255,255,0.16),transparent_24%),radial-gradient(circle_at_18%_74%,rgba(110,214,201,0.13),transparent_30%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.46),rgba(0,0,0,0.14)_42%,rgba(0,0,0,0.42))]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent" />

        {(title || subtitle || description || children) && (
          <div className="relative z-10 mx-auto w-full max-w-[1240px] px-6 py-20 md:px-10 md:py-28">
            <div className="max-w-[760px]">
              {subtitle && (
                <p className="mb-5 text-xs font-medium uppercase tracking-[0.24em] text-white/50">
                  {subtitle}
                </p>
              )}
              {title && <h1 className={HEADLINE_CLASS}>{title}</h1>}
              {description && (
                <p className="mt-7 max-w-[620px] text-base leading-relaxed text-white/68 md:text-xl">
                  {description}
                </p>
              )}
              {children && <div className="mt-10">{children}</div>}
            </div>
          </div>
        )}
      </div>
    </WebGLErrorBoundary>
  );
}

export default SilkAurora;
