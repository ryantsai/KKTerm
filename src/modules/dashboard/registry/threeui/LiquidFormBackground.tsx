import { useEffect, useRef } from "react";
import { VELOX_FRAGMENT_SHADER, VELOX_VERTEX_SHADER } from "./liquidFormShaders";

export type LiquidFormBackgroundProps = {
  speed?: number;
  morph?: number;
  noiseScale?: number;
  mouseAmount?: number;
  metal?: number;
  camera?: number;
  tintHue?: number;
  tintAmount?: number;
  className?: string;
};

export const LIQUID_FORM_DEFAULTS = { speed: 1, morph: 1, noiseScale: 1, mouseAmount: 0.15, metal: 1, camera: 5.5, tintHue: 220, tintAmount: 0 } as const;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create Velox shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Velox shader compilation failed");
  return shader;
}

export function LiquidFormBackground({ className = "", ...props }: LiquidFormBackgroundProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const optionsRef = useRef({ ...LIQUID_FORM_DEFAULTS, ...props });
  optionsRef.current = { ...LIQUID_FORM_DEFAULTS, ...props };
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "high-performance" });
    if (!gl) return undefined;
    const vertex = compile(gl, gl.VERTEX_SHADER, VELOX_VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, VELOX_FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) return undefined;
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Velox program link failed");
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniforms = {
      resolution: gl.getUniformLocation(program, "u_res"), time: gl.getUniformLocation(program, "u_time"), mouse: gl.getUniformLocation(program, "u_mouse"),
      morph: gl.getUniformLocation(program, "u_morph"), noiseScale: gl.getUniformLocation(program, "u_noise_scale"), mouseAmount: gl.getUniformLocation(program, "u_mouse_amount"),
      metal: gl.getUniformLocation(program, "u_metal"), camera: gl.getUniformLocation(program, "u_camera"),
    };
    let targetX = 0, targetY = 0, mouseX = 0, mouseY = 0, frame = 0, visible = true;
    const startedAt = performance.now();
    const resize = () => {
      const bounds = host.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio)); canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const pointer = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      targetX = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1;
      targetY = -(((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2 - 1);
    };
    const render = (now: number) => {
      const options = optionsRef.current;
      mouseX += (targetX - mouseX) * 0.05; mouseY += (targetY - mouseY) * 0.05;
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height); gl.uniform1f(uniforms.time, (now - startedAt) * 0.001 * options.speed); gl.uniform2f(uniforms.mouse, mouseX, mouseY);
      gl.uniform1f(uniforms.morph, options.morph); gl.uniform1f(uniforms.noiseScale, options.noiseScale); gl.uniform1f(uniforms.mouseAmount, options.mouseAmount); gl.uniform1f(uniforms.metal, options.metal); gl.uniform1f(uniforms.camera, options.camera);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      frame = visible && !document.hidden ? requestAnimationFrame(render) : 0;
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; if (visible && !frame) frame = requestAnimationFrame(render); if (!visible && frame) cancelAnimationFrame(frame), frame = 0; });
    resizeObserver.observe(host); intersection.observe(host); canvas.addEventListener("pointermove", pointer, { passive: true }); resize(); frame = requestAnimationFrame(render);
    return () => { if (frame) cancelAnimationFrame(frame); resizeObserver.disconnect(); intersection.disconnect(); canvas.removeEventListener("pointermove", pointer); gl.deleteBuffer(buffer); gl.deleteShader(vertex); gl.deleteShader(fragment); gl.deleteProgram(program); };
  }, []);
  const options = optionsRef.current;
  const tintFilter = options.tintAmount > 0 ? ` sepia(${options.tintAmount}) saturate(${1 + options.tintAmount * 5}) hue-rotate(${options.tintHue - 35}deg)` : "";
  return <div ref={hostRef} className={`threeui-background liquid-form${className ? ` ${className}` : ""}`}><canvas ref={canvasRef} style={{ filter: tintFilter.trim() || undefined }} /></div>;
}
