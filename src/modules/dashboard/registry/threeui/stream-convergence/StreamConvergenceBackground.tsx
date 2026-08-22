import { useEffect, useRef } from "react";
import { STREAM_CONVERGENCE_FRAGMENT_SHADER, STREAM_CONVERGENCE_VERTEX_SHADER } from "./streamConvergenceShaders";

export type StreamConvergenceBackgroundProps = { speed?: number; fidelity?: number; scale?: number; brightness?: number; opacity?: number; hue?: number; saturation?: number; className?: string };
export const STREAM_CONVERGENCE_DEFAULTS = { speed: 1, fidelity: 0.5, scale: 1, brightness: 1, opacity: 1, hue: 0, saturation: 1 } as const;
function compile(gl: WebGLRenderingContext, type: number, source: string) { const shader = gl.createShader(type); if (!shader) throw new Error("Unable to create Stream Convergence shader"); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Stream Convergence shader compilation failed"); return shader; }

export function StreamConvergenceBackground({ className = "", ...props }: StreamConvergenceBackgroundProps) {
  const hostRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null); const optionsRef = useRef({ ...STREAM_CONVERGENCE_DEFAULTS, ...props }); optionsRef.current = { ...STREAM_CONVERGENCE_DEFAULTS, ...props };
  useEffect(() => {
    const host = hostRef.current, canvas = canvasRef.current; if (!host || !canvas) return undefined; const gl = canvas.getContext("webgl", { alpha: true, antialias: false }); if (!gl) return undefined;
    const vertex = compile(gl, gl.VERTEX_SHADER, STREAM_CONVERGENCE_VERTEX_SHADER), fragment = compile(gl, gl.FRAGMENT_SHADER, `precision highp float;\n${STREAM_CONVERGENCE_FRAGMENT_SHADER}`), program = gl.createProgram(); if (!program) return undefined;
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Stream Convergence program link failed"); gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW); const position = gl.getAttribLocation(program, "position"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uTime = gl.getUniformLocation(program, "u_time"), uResolution = gl.getUniformLocation(program, "u_resolution"), uFidelity = gl.getUniformLocation(program, "u_interactive_fidelity"); let frame = 0, visible = true;
    const resize = () => { const bounds = host.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.max(1, Math.round(bounds.width * dpr)); canvas.height = Math.max(1, Math.round(bounds.height * dpr)); gl.viewport(0, 0, canvas.width, canvas.height); gl.uniform2f(uResolution, canvas.width, canvas.height); };
    const render = (now: number) => { const options = optionsRef.current; gl.uniform1f(uTime, now * 0.0003 * options.speed); gl.uniform1f(uFidelity, options.fidelity); gl.drawArrays(gl.TRIANGLES, 0, 6); frame = visible && !document.hidden ? requestAnimationFrame(render) : 0; };
    const resizeObserver = new ResizeObserver(resize), intersection = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; if (visible && !frame) frame = requestAnimationFrame(render); if (!visible && frame) cancelAnimationFrame(frame), frame = 0; }); resizeObserver.observe(host); intersection.observe(host); resize(); frame = requestAnimationFrame(render);
    return () => { if (frame) cancelAnimationFrame(frame); resizeObserver.disconnect(); intersection.disconnect(); gl.deleteBuffer(buffer); gl.deleteShader(vertex); gl.deleteShader(fragment); gl.deleteProgram(program); };
  }, []);
  const options = optionsRef.current; return <div ref={hostRef} className={`threeui-background stream-convergence${className ? ` ${className}` : ""}`}><canvas ref={canvasRef} style={{ opacity: options.opacity, filter: `hue-rotate(${options.hue}deg) saturate(${options.saturation}) brightness(${options.brightness})`, transform: `scale(${options.scale})` }} /></div>;
}
