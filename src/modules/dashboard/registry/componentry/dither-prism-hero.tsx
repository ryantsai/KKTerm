/*
 * Adapted from Componentry by Harsh Jadhav under the MIT License.
 * See docs/licenses/componentry-mit.txt.
 */
import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { motion } from "motion/react";

import { cn } from "./componentrySupport";
import { WebGLErrorBoundary, WebGLFallback } from "./componentrySupport";

// ═══════════════════════════════════════════════════════════════════════════════
// VERTEX SHADER
// ═══════════════════════════════════════════════════════════════════════════════
const vertexShader = `
varying vec2 vUv;
varying vec3 vPosition;

void main() {
  vUv = uv;
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// ═══════════════════════════════════════════════════════════════════════════════
// FRAGMENT SHADER - The magic happens here!
// ═══════════════════════════════════════════════════════════════════════════════
const fragmentShader = `
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uMouseIntensity;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uDitherIntensity;
uniform float uPrismIntensity;
varying vec2 vUv;
varying vec3 vPosition;

// ─────────────────────────────────────────────────────────────────────────────
// Hash functions for procedural noise
// ─────────────────────────────────────────────────────────────────────────────
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

// ─────────────────────────────────────────────────────────────────────────────
// Simplex 2D Noise
// ─────────────────────────────────────────────────────────────────────────────
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
           -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0))
  + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m;
  m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// ─────────────────────────────────────────────────────────────────────────────
// FBM (Fractal Brownian Motion) for layered noise
// ─────────────────────────────────────────────────────────────────────────────
float fbm(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    value += amplitude * snoise(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Advanced 8x8 Bayer Matrix for ordered dithering
// ─────────────────────────────────────────────────────────────────────────────
float bayer8x8(vec2 uv) {
  ivec2 p = ivec2(mod(uv, 8.0));
  int matrix[64];
  matrix[0] = 0;  matrix[1] = 32; matrix[2] = 8;  matrix[3] = 40; matrix[4] = 2;  matrix[5] = 34; matrix[6] = 10; matrix[7] = 42;
  matrix[8] = 48; matrix[9] = 16; matrix[10] = 56; matrix[11] = 24; matrix[12] = 50; matrix[13] = 18; matrix[14] = 58; matrix[15] = 26;
  matrix[16] = 12; matrix[17] = 44; matrix[18] = 4; matrix[19] = 36; matrix[20] = 14; matrix[21] = 46; matrix[22] = 6; matrix[23] = 38;
  matrix[24] = 60; matrix[25] = 28; matrix[26] = 52; matrix[27] = 20; matrix[28] = 62; matrix[29] = 30; matrix[30] = 54; matrix[31] = 22;
  matrix[32] = 3;  matrix[33] = 35; matrix[34] = 11; matrix[35] = 43; matrix[36] = 1;  matrix[37] = 33; matrix[38] = 9;  matrix[39] = 41;
  matrix[40] = 51; matrix[41] = 19; matrix[42] = 59; matrix[43] = 27; matrix[44] = 49; matrix[45] = 17; matrix[46] = 57; matrix[47] = 25;
  matrix[48] = 15; matrix[49] = 47; matrix[50] = 7; matrix[51] = 39; matrix[52] = 13; matrix[53] = 45; matrix[54] = 5; matrix[55] = 37;
  matrix[56] = 63; matrix[57] = 31; matrix[58] = 55; matrix[59] = 23; matrix[60] = 61; matrix[61] = 29; matrix[62] = 53; matrix[63] = 21;
  return float(matrix[p.y * 8 + p.x]) / 64.0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Blue Noise approximation for organic dithering
// ─────────────────────────────────────────────────────────────────────────────
float blueNoise(vec2 uv, float time) {
  float n1 = hash(uv + vec2(time * 0.1, 0.0));
  float n2 = hash(uv * 2.1 + vec2(0.0, time * 0.13));
  float n3 = hash(uv * 4.3 + vec2(time * 0.07, time * 0.11));
  return fract(n1 + n2 * 0.5 + n3 * 0.25);
}

// ─────────────────────────────────────────────────────────────────────────────
// Prismatic color refraction - creates rainbow light scattering
// ─────────────────────────────────────────────────────────────────────────────
vec3 prism(vec2 uv, float time, float intensity) {
  float angle = atan(uv.y - 0.5, uv.x - 0.5);
  float dist = length(uv - 0.5);
  
  // Create rotating prismatic effect
  float prismAngle = angle + time * 0.3 + dist * 3.0;
  
  // RGB separation based on angle
  float r = 0.5 + 0.5 * sin(prismAngle);
  float g = 0.5 + 0.5 * sin(prismAngle + 2.094); // 120 degrees
  float b = 0.5 + 0.5 * sin(prismAngle + 4.188); // 240 degrees
  
  return vec3(r, g, b) * intensity;
}

// ─────────────────────────────────────────────────────────────────────────────
// Holographic iridescence effect
// ─────────────────────────────────────────────────────────────────────────────
vec3 iridescence(vec2 uv, float time) {
  float t = time * 0.5;
  vec2 p = uv * 3.0;
  
  float n1 = snoise(p + vec2(t, 0.0));
  float n2 = snoise(p * 1.3 + vec2(0.0, t * 0.7));
  float n3 = snoise(p * 0.7 + vec2(t * 0.5, t * 0.3));
  
  vec3 col1 = vec3(0.5 + 0.5 * sin(n1 * 3.14159 + t));
  vec3 col2 = vec3(0.5 + 0.5 * sin(n2 * 3.14159 + t * 1.3 + 2.0));
  vec3 col3 = vec3(0.5 + 0.5 * sin(n3 * 3.14159 + t * 0.7 + 4.0));
  
  return (col1 + col2 + col3) / 3.0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometrically morphing shapes - creates flowing crystal/diamond patterns
// ─────────────────────────────────────────────────────────────────────────────
float diamond(vec2 p) {
  return abs(p.x) + abs(p.y);
}

float morphShape(vec2 uv, float time) {
  float morph = sin(time * 0.4) * 0.5 + 0.5;
  
  vec2 p = uv * 4.0 - 2.0;
  p = p + vec2(sin(time * 0.3), cos(time * 0.4)) * 0.5;
  
  // Morphing between circle and diamond
  float circle = length(p) - 1.0;
  float diam = diamond(p) - 1.4;
  
  float shape = mix(circle, diam, morph);
  
  // Create multiple copies
  vec2 q = mod(uv * 8.0, 2.0) - 1.0;
  float multiShape = mix(length(q), diamond(q), morph) - 0.3;
  
  return min(shape, multiShape);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mouse interaction - creates DRAMATIC ripple effect from cursor
// ─────────────────────────────────────────────────────────────────────────────
float mouseRipple(vec2 uv, vec2 mouse, float time, float intensity) {
  float dist = length(uv - mouse);
  // Multiple concentric ripples
  float ripple1 = sin(dist * 40.0 - time * 5.0) * exp(-dist * 3.0);
  float ripple2 = sin(dist * 25.0 - time * 3.5 + 1.0) * exp(-dist * 4.0);
  float ripple3 = sin(dist * 60.0 - time * 7.0) * exp(-dist * 5.0);
  return (ripple1 + ripple2 * 0.5 + ripple3 * 0.3) * intensity;
}

// Mouse glow - creates bright aura around cursor
vec3 mouseGlow(vec2 uv, vec2 mouse, float time, float intensity, vec3 glowColor) {
  float dist = length(uv - mouse);
  
  // Inner bright core
  float core = exp(-dist * 15.0) * 1.5;
  
  // Outer soft glow
  float outer = exp(-dist * 5.0) * 0.8;
  
  // Pulsing effect
  float pulse = 0.8 + 0.2 * sin(time * 3.0);
  
  // Rainbow chromatic aberration around cursor
  float chromatic = sin(dist * 30.0 + time * 2.0) * exp(-dist * 8.0);
  vec3 rainbow = vec3(
    sin(time * 2.0) * 0.5 + 0.5,
    sin(time * 2.0 + 2.094) * 0.5 + 0.5,
    sin(time * 2.0 + 4.188) * 0.5 + 0.5
  );
  
  vec3 glow = glowColor * (core + outer) * pulse * intensity;
  glow += rainbow * chromatic * intensity * 0.5;
  
  return glow;
}

// Lens distortion around cursor
vec2 mouseLensDistort(vec2 uv, vec2 mouse, float intensity) {
  vec2 delta = uv - mouse;
  float dist = length(delta);
  float distortion = exp(-dist * 6.0) * intensity * 0.15;
  return uv + normalize(delta + 0.001) * distortion;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SHADER
// ─────────────────────────────────────────────────────────────────────────────
void main() {
  vec2 uv = vUv;
  vec2 pixelCoord = gl_FragCoord.xy;
  float time = uTime;
  
  // ═══════════════════════════════════════════════════════════════════
  // Layer 0: Apply mouse lens distortion to UV coordinates FIRST
  // ═══════════════════════════════════════════════════════════════════
  vec2 distortedUv = mouseLensDistort(uv, uMouse, uMouseIntensity);
  
  // ═══════════════════════════════════════════════════════════════════
  // Layer 1: Base flowing gradient with noise (using distorted UVs)
  // ═══════════════════════════════════════════════════════════════════
  float noise1 = fbm(distortedUv * 2.0 + vec2(time * 0.05, time * 0.03), 4);
  float noise2 = fbm(distortedUv * 3.0 + vec2(-time * 0.04, time * 0.06), 3);
  
  float diagonal = (distortedUv.x + distortedUv.y) * 0.5;
  float flow = diagonal + noise1 * 0.3 + noise2 * 0.2;
  flow += sin(time * 0.2) * 0.1;
  
  // ═══════════════════════════════════════════════════════════════════
  // Layer 2: Color mixing with tri-color gradient
  // ═══════════════════════════════════════════════════════════════════
  vec3 col;
  float t1 = smoothstep(0.0, 0.5, flow);
  float t2 = smoothstep(0.5, 1.0, flow);
  
  col = mix(uColor1, uColor2, t1);
  col = mix(col, uColor3, t2);
  
  // ═══════════════════════════════════════════════════════════════════
  // Layer 3: Prismatic light refraction
  // ═══════════════════════════════════════════════════════════════════
  vec3 prismColor = prism(distortedUv, time, uPrismIntensity);
  
  // Apply prism only at edges/transitions
  float edgeMask = abs(fract(flow * 5.0) - 0.5) * 2.0;
  edgeMask = smoothstep(0.3, 0.7, edgeMask);
  col += prismColor * edgeMask * 0.4;
  
  // ═══════════════════════════════════════════════════════════════════
  // Layer 4: Iridescent holographic overlay
  // ═══════════════════════════════════════════════════════════════════
  vec3 iris = iridescence(distortedUv, time);
  float irisMask = snoise(distortedUv * 5.0 + time * 0.1);
  irisMask = smoothstep(-0.2, 0.8, irisMask) * 0.15;
  col = mix(col, iris, irisMask);
  
  // ═══════════════════════════════════════════════════════════════════
  // Layer 5: Geometric crystal patterns
  // ═══════════════════════════════════════════════════════════════════
  float shape = morphShape(distortedUv, time);
  float shapeMask = 1.0 - smoothstep(-0.1, 0.1, shape);
  col = mix(col, col * 1.15 + vec3(0.08), shapeMask * 0.3);
  
  // ═══════════════════════════════════════════════════════════════════
  // Layer 6: VISIBLE Mouse interaction - ripples + glow + color shift
  // ═══════════════════════════════════════════════════════════════════
  float ripple = mouseRipple(uv, uMouse, time, uMouseIntensity);
  
  // Add dramatic ripple color changes
  col += ripple * prismColor * 1.2;
  col += ripple * vec3(0.3, 0.2, 0.4);
  
  // Add bright glowing cursor aura
  vec3 glow = mouseGlow(uv, uMouse, time, uMouseIntensity, vec3(1.0, 0.8, 1.0));
  col += glow;
  
  // Color shift near cursor - make area around mouse more vibrant
  float mouseDist = length(uv - uMouse);
  float proximityBoost = exp(-mouseDist * 4.0) * uMouseIntensity;
  col = mix(col, col * 1.5 + prismColor * 0.3, proximityBoost);
  
  // ═══════════════════════════════════════════════════════════════════
  // Layer 7: ADVANCED DITHERING - The signature look!
  // ═══════════════════════════════════════════════════════════════════
  
  // 8x8 Bayer ordered dithering
  float bayer = bayer8x8(pixelCoord);
  
  // Animated blue noise
  float blue = blueNoise(pixelCoord * 0.1, time);
  
  // Combine dithering patterns
  float ditherPattern = mix(bayer, blue, 0.3 + 0.2 * sin(time * 0.5));
  
  // Apply dithering to create the signature grainy/retro look
  vec3 ditherOffset = (vec3(ditherPattern) - 0.5) * uDitherIntensity;
  col += ditherOffset;
  
  // Quantize colors for retro dithered appearance
  float levels = 16.0;
  vec3 quantized = floor(col * levels + ditherPattern) / levels;
  col = mix(col, quantized, uDitherIntensity * 0.5);
  
  // ═══════════════════════════════════════════════════════════════════
  // Layer 8: Scanline effect for extra depth
  // ═══════════════════════════════════════════════════════════════════
  float scanline = sin(pixelCoord.y * 2.0 + time * 2.0) * 0.02;
  col += scanline * uDitherIntensity;
  
  // ═══════════════════════════════════════════════════════════════════
  // Layer 9: Vignette for cinematic depth
  // ═══════════════════════════════════════════════════════════════════
  float vignette = 1.0 - length((uv - 0.5) * 1.2);
  vignette = smoothstep(0.0, 0.7, vignette);
  col *= 0.85 + vignette * 0.15;
  
  // ═══════════════════════════════════════════════════════════════════
  // Final output
  // ═══════════════════════════════════════════════════════════════════
  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ═══════════════════════════════════════════════════════════════════════════════
// The WebGL Plane Component
// ═══════════════════════════════════════════════════════════════════════════════
const DitherPrismPlane = ({
    color1,
    color2,
    color3,
    speed = 1,
    ditherIntensity = 0.15,
    prismIntensity = 0.5,
}: {
    color1: string;
    color2: string;
    color3: string;
    speed?: number;
    ditherIntensity?: number;
    prismIntensity?: number;
}) => {
    const meshRef = useRef<THREE.Mesh>(null);
    const { size } = useThree();

    const uniforms = useMemo(
        () => ({
            uTime: { value: 0 },
            uResolution: { value: new THREE.Vector2(1000, 1000) },
            uMouse: { value: new THREE.Vector2(0.5, 0.5) },
            uMouseIntensity: { value: 0.8 },
            uColor1: { value: new THREE.Color(color1) },
            uColor2: { value: new THREE.Color(color2) },
            uColor3: { value: new THREE.Color(color3) },
            uDitherIntensity: { value: ditherIntensity },
            uPrismIntensity: { value: prismIntensity },
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [] // Depend on nothing to keep reference stable
    );

    useFrame((state) => {
        const { clock } = state;

        uniforms.uTime.value = clock.getElapsedTime() * speed;
        uniforms.uResolution.value.set(size.width, size.height);
        uniforms.uMouse.value.set(0.5, 0.5);
        uniforms.uMouseIntensity.value = 0.8;
        uniforms.uColor1.value.set(color1);
        uniforms.uColor2.value.set(color2);
        uniforms.uColor3.value.set(color3);
        uniforms.uDitherIntensity.value = ditherIntensity;
        uniforms.uPrismIntensity.value = prismIntensity;
    });

    return (
        <mesh ref={meshRef} scale={[2, 2, 1]}>
            <planeGeometry args={[2, 2]} />
            <shaderMaterial
                vertexShader={vertexShader}
                fragmentShader={fragmentShader}
                uniforms={uniforms}
                transparent={true}
                depthWrite={false}
                depthTest={false}
            />
        </mesh>
    );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Floating Particles Layer - Adds depth and interactivity
// ═══════════════════════════════════════════════════════════════════════════════
const FloatingParticles = ({
    count = 50,
    color = "#ffffff",
}: {
    count?: number;
    color?: string;
}) => {
    const pointsRef = useRef<THREE.Points>(null);

    const particles = useMemo(() => {
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 4;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 4;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 2;
            sizes[i] = Math.random() * 3 + 1;
            phases[i] = Math.random() * Math.PI * 2;
        }

        return { positions, sizes, phases };
    }, [count]);

    useFrame(({ clock }) => {
        if (!pointsRef.current?.geometry?.attributes?.position) return;
        const time = clock.getElapsedTime();
        const positionAttr = pointsRef.current.geometry.attributes.position;
        const positions = positionAttr.array as Float32Array;

        for (let i = 0; i < count; i++) {
            const phase = particles.phases[i] ?? 0;
            const yIdx = i * 3 + 1;
            const xIdx = i * 3;
            positions[yIdx] = (positions[yIdx] ?? 0) + Math.sin(time + phase) * 0.001;
            positions[xIdx] = (positions[xIdx] ?? 0) + Math.cos(time * 0.5 + phase) * 0.0005;

            // Wrap particles
            if ((positions[yIdx] ?? 0) > 2) positions[yIdx] = -2;
            if ((positions[yIdx] ?? 0) < -2) positions[yIdx] = 2;
        }

        positionAttr.needsUpdate = true;
    });

    return (
        <points ref={pointsRef}>
            <bufferGeometry>
                <bufferAttribute
                    attach="attributes-position"
                    args={[particles.positions, 3]}
                    count={count}
                />
                <bufferAttribute
                    attach="attributes-size"
                    args={[particles.sizes, 1]}
                    count={count}
                />
            </bufferGeometry>
            <pointsMaterial
                color={color}
                size={0.02}
                transparent
                opacity={0.6}
                sizeAttenuation
                blending={THREE.AdditiveBlending}
            />
        </points>
    );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component Props
// ═══════════════════════════════════════════════════════════════════════════════
interface DitherPrismHeroProps extends React.HTMLAttributes<HTMLDivElement> {
    /** First line of headline */
    title1?: string;
    /** Second line of headline */
    title2?: string;
    /** Primary color (deep/dark) */
    color1?: string;
    /** Secondary color (mid) */
    color2?: string;
    /** Tertiary color (light/accent) */
    color3?: string;
    /** Animation speed multiplier */
    speed?: number;
    /** Dithering intensity (0-1) */
    ditherIntensity?: number;
    /** Prismatic refraction intensity (0-1) */
    prismIntensity?: number;
    /** Number of floating particles */
    particleCount?: number;
    /** Show floating particles */
    showParticles?: boolean;
    /** Particle color */
    particleColor?: string;
    /** Children to render on top */
    children?: React.ReactNode;
}

const HERO_HEADLINE_CLASS =
    "pb-[0.08em] text-[12cqi] md:text-[8cqi] lg:text-[6cqi] leading-[0.96] tracking-tighter font-bold text-transparent bg-clip-text bg-gradient-to-b from-zinc-900 via-zinc-500 to-zinc-800";

// ═══════════════════════════════════════════════════════════════════════════════
// Main Export Component
// ═══════════════════════════════════════════════════════════════════════════════
export default function DitherPrismHero({
    title1,
    title2,
    color1 = "#0f0f23",
    color2 = "#6366f1",
    color3 = "#ec4899",
    speed = 1,
    ditherIntensity = 0.15,
    prismIntensity = 0.5,
    particleCount = 50,
    showParticles = true,
    particleColor = "#ffffff",
    className,
    children,
    style,
    ...props
}: DitherPrismHeroProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    return (
        <div
            className={cn(
                "relative w-full min-h-screen flex flex-col items-center overflow-hidden text-gray-900",
                className
            )}
            style={{ containerType: "size", ...style }}
            {...props}
        >
            {/* WebGL Background */}
            {mounted && (
                <div className="absolute top-0 left-0 w-full h-full z-0">
                    <WebGLErrorBoundary fallback={<WebGLFallback className="absolute inset-0 h-full w-full" />}>
                        <Canvas
                            camera={{ position: [0, 0, 1] }}
                            dpr={[1, 1.5]}
                            gl={{
                                antialias: false,
                                alpha: true,
                                powerPreference: "high-performance",
                            }}
                        >
                            <DitherPrismPlane
                                color1={color1}
                                color2={color2}
                                color3={color3}
                                speed={speed}
                                ditherIntensity={ditherIntensity}
                                prismIntensity={prismIntensity}
                            />
                            {showParticles && (
                                <FloatingParticles count={particleCount} color={particleColor} />
                            )}
                        </Canvas>
                    </WebGLErrorBoundary>
                </div>
            )}

            {/* Content Overlay */}
            {(title1 || title2 || children) && (
                <div className="relative z-10 w-full flex-1 flex flex-col items-center justify-center pt-8 pb-8 md:pt-20 md:pb-20">
                    <div className="w-full max-w-[1200px] px-6 flex flex-col items-center">
                        {/* Headline */}
                        {(title1 || title2) && (
                            <div className="flex flex-col items-center text-center gap-2 md:gap-4 mb-8 md:mb-12">
                                {title1 && (
                                    <div className="overflow-hidden">
                                        <motion.h1
                                            initial={{ y: "100%", opacity: 0 }}
                                            animate={{ y: "0%", opacity: 1 }}
                                            transition={{
                                                duration: 1,
                                                ease: [0.16, 1, 0.3, 1],
                                                delay: 0.2,
                                            }}
                                            className={HERO_HEADLINE_CLASS}
                                        >
                                            <span>
                                                {title1}
                                            </span>
                                        </motion.h1>
                                    </div>
                                )}
                                {title2 && (
                                    <div className="overflow-hidden">
                                        <motion.h1
                                            initial={{ y: "100%", opacity: 0 }}
                                            animate={{ y: "0%", opacity: 1 }}
                                            transition={{
                                                duration: 1,
                                                ease: [0.16, 1, 0.3, 1],
                                                delay: 0.35,
                                            }}
                                            className={HERO_HEADLINE_CLASS}
                                        >
                                            {title2}
                                        </motion.h1>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Custom Children */}
                        {children && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.8, delay: 0.7, ease: "easeOut" }}
                            >
                                {children}
                            </motion.div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// Named export for easier imports
export { DitherPrismHero };

