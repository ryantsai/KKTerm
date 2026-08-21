import { useEffect, useRef, type ComponentType } from "react";
import { CircuitBg, CrystalsBg, HalftoneBg, InkBg, OrbitalsBg } from "./abstractDynamicBackgrounds";
import { dynamicBackgroundDevicePixelRatio } from "./dynamicBackgroundCanvas";
import { BalloonsBg, DunesBg, JellyfishBg, LighthouseBg, SavannaBg } from "./extraDynamicBackgrounds";
import { FujiBg } from "./fujiBackground";
import { MistySeaBg } from "./mistySeaBackground";
import {
  MaelstromBg,
  OpenOceanBlueBg,
  SunGlitterBg,
  TropicalGreenBg,
  WaveFieldBg,
  WhitecapsBg,
} from "./maelstromBackground";
import { WatersBg } from "./watersBackground";
import { WindowRainBg } from "./windowRainBackground";
import { SubmergedSnellOceanBg } from "./submergedSnellOceanBackground";
import { SpectralCascadeOceanBg } from "./spectralCascadeOceanBackground";
import { BlackHoleBg } from "./blackHoleBackground";
import {
  AnimatedGradientBg,
  ClosingPlasmaBg,
  DitherPrismHeroBg,
  HeroGeometricBg,
  LiquidChromeBg,
  PrismGradientBg,
  SilkAuroraBg,
  WebGLLiquidBg,
} from "./componentryBackgrounds";
import {
  DashboardAnimationGate,
  useDashboardAnimationActive,
  useElementOnScreen,
} from "../view/animationGating";

interface CanvasAnimLifecycle {
  onResize?: (width: number, height: number, ctx: CanvasRenderingContext2D) => void;
}

type CanvasDraw<State extends CanvasAnimLifecycle> = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  state: State,
) => void;

function useCanvasAnim<State extends CanvasAnimLifecycle>(draw: CanvasDraw<State>) {
  const active = useDashboardAnimationActive();
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const ref = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  const runtimeRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  useEffect(() => {
    const canvasElement = ref.current;
    const parentElement = canvasElement?.parentElement;
    if (!canvasElement || !parentElement) return;
    const context = canvasElement.getContext("2d");
    if (!context) return;
    const canvas = canvasElement;
    const parent = parentElement;
    const ctx = context;

    let raf = 0;
    let width = 0;
    let height = 0;
    let elapsed = 0;
    let lastNow = 0;
    const dpr = dynamicBackgroundDevicePixelRatio(window.devicePixelRatio);
    const state = {} as State;

    function resize() {
      const rect = parent.getBoundingClientRect();
      width = Math.max(2, Math.floor(rect.width));
      height = Math.max(2, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      state.onResize?.(width, height, ctx);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);
    drawRef.current(ctx, 0, 0, 0, state);
    resize();

    function frame(now: number) {
      const dt = lastNow ? (now - lastNow) / 1000 : 0;
      lastNow = now;
      // Cap per-frame advance after a long pause so animations don't jump.
      elapsed += Math.min(dt, 0.05);
      drawRef.current(ctx, width, height, elapsed, state);
      raf = activeRef.current ? requestAnimationFrame(frame) : 0;
    }

    function start() {
      if (raf || !activeRef.current) return;
      lastNow = 0;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      lastNow = 0;
    }

    runtimeRef.current = { start, stop };
    if (activeRef.current) start();

    return () => {
      stop();
      resizeObserver.disconnect();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    activeRef.current = active;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (active) runtime.start();
    else runtime.stop();
  }, [active]);

  return ref;
}

function AuroraBg() {
  return (
    <div className="dw-bg-aurora">
      <div className="dw-aurora-blob dw-aurora-1" />
      <div className="dw-aurora-blob dw-aurora-2" />
      <div className="dw-aurora-blob dw-aurora-3" />
      <div className="dw-aurora-grain" />
    </div>
  );
}

interface EmberParticle {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  life: number;
  speed: number;
  hue: number;
}

interface EmbersState extends CanvasAnimLifecycle {
  parts?: EmberParticle[];
  last?: number;
}

function EmbersBg() {
  const draw: CanvasDraw<EmbersState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      const count = Math.max(60, Math.min(160, Math.floor((nextWidth * nextHeight) / 9000)));
      state.parts = Array.from({ length: count }, () => ({
        x: Math.random() * nextWidth,
        y: Math.random() * nextHeight,
        r: 0.6 + Math.random() * 1.8,
        vy: 6 + Math.random() * 18,
        vx: (Math.random() - 0.5) * 4,
        life: Math.random(),
        speed: 0.15 + Math.random() * 0.5,
        hue: 12 + Math.random() * 28,
      }));
      state.last = time;
    };
    if (!state.parts) return;
    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;

    const pulse = 0.5 + 0.5 * Math.sin(time * 0.4);
    const gradient = ctx.createRadialGradient(width * 0.5, height * 1.05, 0, width * 0.5, height * 1.05, Math.max(width, height) * 0.9);
    gradient.addColorStop(0, `rgba(255,${110 + pulse * 30},40,0.32)`);
    gradient.addColorStop(0.5, "rgba(160,40,10,0.18)");
    gradient.addColorStop(1, "rgba(20,8,5,0.05)");
    ctx.fillStyle = "rgba(18,10,6,1)";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = "lighter";
    for (const particle of state.parts) {
      particle.y -= particle.vy * dt;
      particle.x += particle.vx * dt + Math.sin((time + particle.life * 10) * particle.speed) * 0.4;
      particle.life += dt * 0.15;
      if (particle.y < -10) {
        particle.y = height + 10;
        particle.x = Math.random() * width;
        particle.life = 0;
      }
      const alpha = 0.4 + 0.4 * Math.sin(particle.life * 6);
      const spark = ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, particle.r * 8);
      spark.addColorStop(0, `hsla(${particle.hue}, 95%, 65%, ${0.85 * alpha})`);
      spark.addColorStop(1, `hsla(${particle.hue}, 95%, 50%, 0)`);
      ctx.fillStyle = spark;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.r * 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface Star {
  x: number;
  y: number;
  d: number;
  sz: number;
  hue: number;
  ph: number;
  tw: number;
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
}

interface StarfieldState extends CanvasAnimLifecycle {
  stars?: Star[];
  shooters?: ShootingStar[];
  last?: number;
  nextShoot?: number;
}

function StarfieldBg() {
  const draw: CanvasDraw<StarfieldState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      const layers = [
        { count: Math.floor((nextWidth * nextHeight) / 8000), depth: 1.2, size: 0.6, hue: 220, tw: 1.6 },
        { count: Math.floor((nextWidth * nextHeight) / 14000), depth: 3.5, size: 1.1, hue: 205, tw: 2.4 },
        { count: Math.floor((nextWidth * nextHeight) / 26000), depth: 7, size: 1.7, hue: 35, tw: 3.0 },
      ];
      state.stars = layers.flatMap((layer) => Array.from({ length: layer.count }, () => ({
        x: Math.random() * nextWidth,
        y: Math.random() * nextHeight,
        d: layer.depth,
        sz: layer.size * (0.5 + Math.random() * 0.9),
        hue: layer.hue + (Math.random() - 0.5) * 20,
        ph: Math.random() * 6.28,
        tw: layer.tw * (0.7 + Math.random() * 0.6),
      })));
      state.shooters = [];
      state.last = time;
      state.nextShoot = time + 4 + Math.random() * 6;
    };
    if (!state.stars || !state.shooters || state.nextShoot === undefined) return;
    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#070a1c");
    gradient.addColorStop(0.55, "#0c1230");
    gradient.addColorStop(1, "#05081a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const nebulaX = width * (0.4 + 0.15 * Math.sin(time * 0.05));
    const nebulaY = height * (0.6 + 0.1 * Math.cos(time * 0.04));
    const nebula = ctx.createRadialGradient(nebulaX, nebulaY, 0, nebulaX, nebulaY, Math.max(width, height) * 0.6);
    nebula.addColorStop(0, "rgba(80,40,140,0.32)");
    nebula.addColorStop(0.5, "rgba(40,60,160,0.10)");
    nebula.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, width, height);

    for (const star of state.stars) {
      star.x -= star.d * dt;
      if (star.x < -3) {
        star.x = width + 3;
        star.y = Math.random() * height;
      }
      const k = Math.sin(time * star.tw + star.ph);
      const twinkle = 0.35 + 0.65 * k * k;
      ctx.fillStyle = `hsla(${star.hue}, 85%, 92%, ${twinkle})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.sz, 0, Math.PI * 2);
      ctx.fill();
      if (star.sz > 1.1) {
        const halo = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.sz * 4);
        halo.addColorStop(0, `hsla(${star.hue}, 85%, 92%, ${twinkle * 0.35})`);
        halo.addColorStop(1, `hsla(${star.hue}, 85%, 92%, 0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.sz * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (time > state.nextShoot) {
      state.shooters.push({
        x: Math.random() * width * 0.6,
        y: Math.random() * height * 0.4,
        vx: 320 + Math.random() * 220,
        vy: 90 + Math.random() * 60,
        life: 0,
        ttl: 0.9 + Math.random() * 0.5,
      });
      state.nextShoot = time + 5 + Math.random() * 8;
    }
    state.shooters = state.shooters.filter((shooter) => shooter.life < shooter.ttl);
    for (const shooter of state.shooters) {
      shooter.life += dt;
      shooter.x += shooter.vx * dt;
      shooter.y += shooter.vy * dt;
      const alpha = Math.sin((shooter.life / shooter.ttl) * Math.PI);
      const tailX = shooter.x - shooter.vx * 0.06;
      const tailY = shooter.y - shooter.vy * 0.06;
      const tail = ctx.createLinearGradient(tailX, tailY, shooter.x, shooter.y);
      tail.addColorStop(0, "rgba(255,255,255,0)");
      tail.addColorStop(1, `rgba(220,235,255,${0.9 * alpha})`);
      ctx.strokeStyle = tail;
      ctx.lineWidth = 1.8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(shooter.x, shooter.y);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(shooter.x, shooter.y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface RainDrop {
  x: number;
  y: number;
  len: number;
  speed: number;
  a: number;
}

interface Ripple {
  x: number;
  y: number;
  r: number;
  life: number;
  ttl: number;
}

interface RaindropsState extends CanvasAnimLifecycle {
  drops?: RainDrop[];
  ripples?: Ripple[];
  last?: number;
}

function RaindropsBg() {
  const wind = -0.18;
  const draw: CanvasDraw<RaindropsState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      const count = Math.max(120, Math.min(280, Math.floor((nextWidth * nextHeight) / 4800)));
      state.drops = Array.from({ length: count }, () => ({
        x: Math.random() * nextWidth * 1.2,
        y: Math.random() * nextHeight,
        len: 9 + Math.random() * 16,
        speed: 420 + Math.random() * 260,
        a: 0.25 + Math.random() * 0.55,
      }));
      state.ripples = [];
      state.last = time;
    };
    if (!state.drops || !state.ripples) return;
    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#0e1a2a");
    gradient.addColorStop(0.6, "#162638");
    gradient.addColorStop(1, "#0a1422");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const cloud = ctx.createRadialGradient(width * 0.6, -height * 0.2, 0, width * 0.6, -height * 0.2, Math.max(width, height));
    cloud.addColorStop(0, "rgba(150,180,220,0.08)");
    cloud.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = cloud;
    ctx.fillRect(0, 0, width, height);

    ctx.lineCap = "round";
    for (const drop of state.drops) {
      drop.y += drop.speed * dt;
      drop.x += drop.speed * wind * dt;
      if (drop.y > height) {
        if (Math.random() < 0.45) {
          state.ripples.push({ x: drop.x, y: height - 2 + Math.random() * 2, r: 0, life: 0, ttl: 0.7 + Math.random() * 0.4 });
        }
        drop.y = -drop.len;
        drop.x = Math.random() * width * 1.2;
      }
      const line = ctx.createLinearGradient(drop.x, drop.y, drop.x + drop.len * wind, drop.y + drop.len);
      line.addColorStop(0, "rgba(180,210,240,0)");
      line.addColorStop(1, `rgba(200,225,255,${drop.a})`);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x + drop.len * wind, drop.y + drop.len);
      ctx.stroke();
    }

    state.ripples = state.ripples.filter((ripple) => ripple.life < ripple.ttl);
    for (const ripple of state.ripples) {
      ripple.life += dt;
      const k = ripple.life / ripple.ttl;
      ripple.r = k * 14;
      ctx.strokeStyle = `rgba(200,225,255,${(1 - k) * 0.55})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(ripple.x, ripple.y, ripple.r, ripple.r * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface RainyWindowMist {
  x: number;
  y: number;
  r: number;
  ph: number;
  decay?: number;
}

interface RainyWindowStud {
  x: number;
  y: number;
  r: number;
}

interface RainyWindowSlide {
  x: number;
  y: number;
  r: number;
  v: number;
  wob: number;
  wait: number;
  moving: boolean;
}

interface RainyWindowState extends CanvasAnimLifecycle {
  sharp?: HTMLCanvasElement;
  fog?: HTMLCanvasElement;
  reveal?: HTMLCanvasElement;
  revealCtx?: CanvasRenderingContext2D;
  mist?: RainyWindowMist[];
  stationaryDrops?: HTMLCanvasElement;
  mistGlowSprite?: HTMLCanvasElement;
  mistHighlightSprite?: HTMLCanvasElement;
  slides?: RainyWindowSlide[];
  last?: number;
  canvasWidth?: number;
  canvasHeight?: number;
}

function drawRainyWindowLensDrop(
  ctx: CanvasRenderingContext2D,
  sharp: HTMLCanvasElement,
  x: number,
  y: number,
  r: number,
  magnification: number,
) {
  const shadow = ctx.createRadialGradient(x + r * 0.25, y + r * 0.4, 0, x + r * 0.25, y + r * 0.4, r * 1.5);
  shadow.addColorStop(0, "rgba(0,0,0,0.32)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(x + r * 0.25, y + r * 0.4, r * 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  const sampleRadius = r / magnification;
  ctx.drawImage(
    sharp,
    x - sampleRadius,
    y - sampleRadius + r * 0.22,
    sampleRadius * 2,
    sampleRadius * 2,
    x - r,
    y - r,
    r * 2,
    r * 2,
  );
  ctx.fillStyle = "rgba(190,210,235,0.10)";
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  const bottomLight = ctx.createLinearGradient(0, y, 0, y + r);
  bottomLight.addColorStop(0, "rgba(210,225,245,0)");
  bottomLight.addColorStop(1, "rgba(210,225,245,0.22)");
  ctx.fillStyle = bottomLight;
  ctx.fillRect(x - r, y, r * 2, r);
  ctx.restore();

  ctx.lineWidth = Math.max(0.6, r * 0.1);
  ctx.strokeStyle = "rgba(8,14,22,0.45)";
  ctx.beginPath();
  ctx.arc(x, y, r - ctx.lineWidth * 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(x - r * 0.34, y - r * 0.38, Math.max(0.7, r * 0.16), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.arc(x + r * 0.2, y + r * 0.18, Math.max(0.5, r * 0.1), 0, Math.PI * 2);
  ctx.fill();
}

function createRainyWindowMistSprite(dpr: number, highlight: boolean): HTMLCanvasElement {
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(size * dpr);
  canvas.height = Math.ceil(size * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (highlight) {
    ctx.fillStyle = "rgb(255,255,255)";
    ctx.beginPath();
    ctx.arc(8, 8, 8, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const glow = ctx.createRadialGradient(5.6, 5.6, 0, 8, 8, 8);
    glow.addColorStop(0, "rgb(220,232,248)");
    glow.addColorStop(1, "rgba(150,175,205,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}

function RainyWindowBg() {
  function createSlide(width: number, height: number, seed: boolean): RainyWindowSlide {
    const r = 5 + Math.random() * 11;
    return {
      x: Math.random() * width,
      y: seed ? Math.random() * height : -10 - Math.random() * 40,
      r,
      v: 0,
      wob: Math.random() * Math.PI * 2,
      wait: Math.random() * 0.8,
      moving: false,
    };
  }

  const draw: CanvasDraw<RainyWindowState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      const sharp = document.createElement("canvas");
      sharp.width = nextWidth;
      sharp.height = nextHeight;
      const sharpCtx = sharp.getContext("2d");
      if (!sharpCtx) return;

      const cityGradient = sharpCtx.createLinearGradient(0, 0, 0, nextHeight);
      cityGradient.addColorStop(0, "#0a1320");
      cityGradient.addColorStop(0.5, "#0c1a2a");
      cityGradient.addColorStop(1, "#0f2436");
      sharpCtx.fillStyle = cityGradient;
      sharpCtx.fillRect(0, 0, nextWidth, nextHeight);

      const lightHues = [38, 38, 32, 196, 200, 320];
      const lightCount = Math.floor((nextWidth * nextHeight) / 11000);
      sharpCtx.globalCompositeOperation = "lighter";
      for (let i = 0; i < lightCount; i += 1) {
        const lx = Math.random() * nextWidth;
        const ly = nextHeight * (0.22 + Math.pow(Math.random(), 0.7) * 0.78);
        const r = 6 + Math.random() * 46;
        const hue = lightHues[Math.floor(Math.random() * lightHues.length)];
        const alpha = 0.18 + Math.random() * 0.4;
        const glow = sharpCtx.createRadialGradient(lx, ly, 0, lx, ly, r);
        glow.addColorStop(0, `hsla(${hue},85%,70%,${alpha})`);
        glow.addColorStop(0.4, `hsla(${hue},85%,60%,${alpha * 0.45})`);
        glow.addColorStop(1, `hsla(${hue},85%,55%,0)`);
        sharpCtx.fillStyle = glow;
        sharpCtx.beginPath();
        sharpCtx.arc(lx, ly, r, 0, Math.PI * 2);
        sharpCtx.fill();
      }
      for (let i = 0; i < 6; i += 1) {
        const ly = nextHeight * (0.7 + Math.random() * 0.28);
        const lx = Math.random() * nextWidth;
        const len = 60 + Math.random() * 180;
        const hue = Math.random() < 0.5 ? 35 : 200;
        const streak = sharpCtx.createLinearGradient(lx, ly, lx + len, ly);
        streak.addColorStop(0, `hsla(${hue},90%,65%,0)`);
        streak.addColorStop(0.5, `hsla(${hue},90%,68%,0.5)`);
        streak.addColorStop(1, `hsla(${hue},90%,65%,0)`);
        sharpCtx.fillStyle = streak;
        sharpCtx.fillRect(lx, ly - 1.5, len, 3);
      }
      sharpCtx.globalCompositeOperation = "source-over";

      const fog = document.createElement("canvas");
      fog.width = nextWidth;
      fog.height = nextHeight;
      const fogCtx = fog.getContext("2d");
      if (!fogCtx) return;
      fogCtx.filter = "blur(14px) brightness(0.62)";
      fogCtx.drawImage(sharp, 0, 0);
      fogCtx.filter = "none";
      fogCtx.fillStyle = "rgba(150,170,195,0.16)";
      fogCtx.fillRect(0, 0, nextWidth, nextHeight);

      const reveal = document.createElement("canvas");
      reveal.width = nextWidth;
      reveal.height = nextHeight;
      const revealCtx = reveal.getContext("2d");
      if (!revealCtx) return;

      const mistCount = Math.max(120, Math.min(360, Math.floor((nextWidth * nextHeight) / 5200)));
      const studCount = Math.max(26, Math.min(80, Math.floor((nextWidth * nextHeight) / 26000)));
      const slideCount = Math.max(10, Math.min(30, Math.floor(nextWidth / 90)));
      const studs: RainyWindowStud[] = Array.from({ length: studCount }, () => ({
        x: Math.random() * nextWidth,
        y: Math.random() * nextHeight,
        r: 3 + Math.random() * 6,
      }));
      const dpr = dynamicBackgroundDevicePixelRatio(window.devicePixelRatio);
      const stationaryDrops = document.createElement("canvas");
      stationaryDrops.width = Math.ceil(nextWidth * dpr);
      stationaryDrops.height = Math.ceil(nextHeight * dpr);
      const stationaryDropsCtx = stationaryDrops.getContext("2d");
      if (!stationaryDropsCtx) return;
      stationaryDropsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const stud of studs) {
        drawRainyWindowLensDrop(stationaryDropsCtx, sharp, stud.x, stud.y, stud.r, 1.45);
      }
      state.sharp = sharp;
      state.fog = fog;
      state.reveal = reveal;
      state.revealCtx = revealCtx;
      state.mist = Array.from({ length: mistCount }, () => ({
        x: Math.random() * nextWidth,
        y: Math.random() * nextHeight,
        r: 0.8 + Math.random() * 2.6,
        ph: Math.random() * Math.PI * 2,
      }));
      state.stationaryDrops = stationaryDrops;
      state.mistGlowSprite = createRainyWindowMistSprite(dpr, false);
      state.mistHighlightSprite = createRainyWindowMistSprite(dpr, true);
      state.slides = Array.from({ length: slideCount }, () => createSlide(nextWidth, nextHeight, true));
      state.canvasWidth = nextWidth;
      state.canvasHeight = nextHeight;
      state.last = time;
    };

    if (
      !state.fog
      || !state.sharp
      || !state.reveal
      || !state.revealCtx
      || !state.mist
      || !state.stationaryDrops
      || !state.mistGlowSprite
      || !state.mistHighlightSprite
      || !state.slides
      || !state.canvasWidth
      || !state.canvasHeight
    ) {
      return;
    }

    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;
    const canvasWidth = state.canvasWidth;
    const canvasHeight = state.canvasHeight;
    const revealCtx = state.revealCtx;

    ctx.fillStyle = "#0a1320";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(state.fog, 0, 0, canvasWidth, canvasHeight);

    revealCtx.globalCompositeOperation = "destination-out";
    revealCtx.fillStyle = `rgba(0,0,0,${Math.min(1, 0.35 * dt)})`;
    revealCtx.fillRect(0, 0, canvasWidth, canvasHeight);
    revealCtx.globalCompositeOperation = "source-over";

    for (const drop of state.slides) {
      if (!drop.moving) {
        drop.wait -= dt;
        if (drop.wait <= 0 || drop.r > 9) drop.moving = true;
      } else {
        drop.v += (40 + drop.r * 16) * dt;
        drop.v = Math.min(drop.v, 60 + drop.r * 26);
        const nextY = drop.y + drop.v * dt;
        const nextX = drop.x + Math.sin(time * 1.3 + drop.wob) * 6 * dt;

        revealCtx.save();
        revealCtx.beginPath();
        revealCtx.moveTo(drop.x, drop.y);
        revealCtx.lineTo(nextX, nextY);
        revealCtx.lineWidth = drop.r * 1.5;
        revealCtx.lineCap = "round";
        revealCtx.strokeStyle = "#000";
        revealCtx.stroke();
        revealCtx.globalCompositeOperation = "source-in";
        revealCtx.drawImage(state.sharp, 0, 0, canvasWidth, canvasHeight);
        revealCtx.restore();

        if (Math.random() < dt * 22) {
          state.mist.push({
            x: drop.x + (Math.random() - 0.5) * drop.r * 1.4,
            y: drop.y - Math.random() * drop.r,
            r: 0.8 + Math.random() * 1.8,
            ph: Math.random() * Math.PI * 2,
            decay: 1,
          });
          if (state.mist.length > 600) state.mist.shift();
        }

        drop.x = nextX;
        drop.y = nextY;
        if (Math.random() < dt * 1.1 && drop.r < 9) {
          drop.moving = false;
          drop.v = 0;
          drop.wait = 0.2 + Math.random() * 0.7;
        }
        if (drop.y - drop.r > canvasHeight) Object.assign(drop, createSlide(canvasWidth, canvasHeight, false));
      }
    }

    ctx.drawImage(state.reveal, 0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(state.stationaryDrops, 0, 0, canvasWidth, canvasHeight);

    for (let i = state.mist.length - 1; i >= 0; i -= 1) {
      const mist = state.mist[i];
      if (mist.decay !== undefined) {
        mist.decay -= dt * 0.25;
        if (mist.decay <= 0) {
          state.mist.splice(i, 1);
          continue;
        }
      }
      const decay = mist.decay ?? 1;
      const alpha = (0.22 + 0.12 * Math.sin(time * 0.6 + mist.ph)) * decay;
      ctx.globalAlpha = alpha + 0.18;
      ctx.drawImage(state.mistGlowSprite, mist.x - mist.r, mist.y - mist.r, mist.r * 2, mist.r * 2);
      ctx.globalAlpha = 0.5 * decay;
      const highlightRadius = Math.max(0.4, mist.r * 0.28);
      ctx.drawImage(
        state.mistHighlightSprite,
        mist.x - mist.r * 0.35 - highlightRadius,
        mist.y - mist.r * 0.35 - highlightRadius,
        highlightRadius * 2,
        highlightRadius * 2,
      );
    }
    ctx.globalAlpha = 1;

    for (const drop of state.slides) {
      drawRainyWindowLensDrop(ctx, state.sharp, drop.x, drop.y, drop.r, 1.6);
    }
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" style={{ background: "#0a1320" }} />;
}

interface FrostedWindowFlake {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  swaySp: number;
  ph: number;
  a: number;
}

interface FrostedWindowSpark {
  x: number;
  y: number;
  r: number;
  sp: number;
  ph: number;
  bt: number;
}

interface FrostedWindowBead {
  x: number;
  y: number;
  r: number;
  bt: number;
  rot: number;
  twk: number;
  tph: number;
  spokes: { a: number; len: number }[];
}

interface FrostedWindowState extends CanvasAnimLifecycle {
  sharp?: HTMLCanvasElement;
  fog?: HTMLCanvasElement;
  frostLayers?: HTMLCanvasElement[];
  corner?: HTMLCanvasElement;
  flakes?: FrostedWindowFlake[];
  sparks?: FrostedWindowSpark[];
  beads?: FrostedWindowBead[];
  frostLayerCount?: number;
  last?: number;
  canvasWidth?: number;
  canvasHeight?: number;
}

function FrostedWindowBg() {
  function smoothstep(a: number, b: number, x: number) {
    const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  }

  function makeBead(width: number, height: number): FrostedWindowBead {
    const r = 3 + Math.random() * 6;
    const edge = Math.random() < 0.6;
    const x = edge
      ? (Math.random() < 0.5 ? Math.random() * width * 0.26 : width - Math.random() * width * 0.26)
      : Math.random() * width;
    const y = edge
      ? (Math.random() < 0.45 ? Math.random() * height * 0.24 : height - Math.random() * height * 0.4)
      : Math.random() * height;
    const spokes = 6 + Math.floor(Math.random() * 6);
    const bt = Math.min(1, Math.min(x, width - x, y, height - y) / (Math.min(width, height) * 0.5)) * 0.8
      + Math.random() * 0.12;
    return {
      x,
      y,
      r,
      bt,
      rot: Math.random() * Math.PI * 2,
      twk: 0.4 + Math.random() * 1.6,
      tph: Math.random() * Math.PI * 2,
      spokes: Array.from({ length: spokes }, (_, index) => ({
        a: (index / spokes) * Math.PI * 2 + Math.random() * 0.3,
        len: r * (1.3 + Math.random() * 1.1),
      })),
    };
  }

  const draw: CanvasDraw<FrostedWindowState> = (ctx, _width, _height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      const sharp = document.createElement("canvas");
      sharp.width = nextWidth;
      sharp.height = nextHeight;
      const sharpCtx = sharp.getContext("2d");
      if (!sharpCtx) return;

      const sky = sharpCtx.createLinearGradient(0, 0, 0, nextHeight);
      sky.addColorStop(0, "#0a1426");
      sky.addColorStop(0.48, "#13243d");
      sky.addColorStop(0.74, "#1f3a58");
      sky.addColorStop(1, "#2b4a6b");
      sharpCtx.fillStyle = sky;
      sharpCtx.fillRect(0, 0, nextWidth, nextHeight);

      const moonX = nextWidth * 0.74;
      const moonY = nextHeight * 0.24;
      const moonR = Math.min(nextWidth, nextHeight) * 0.05;
      const halo = sharpCtx.createRadialGradient(moonX, moonY, 0, moonX, moonY, moonR * 7);
      halo.addColorStop(0, "rgba(220,235,255,0.55)");
      halo.addColorStop(0.18, "rgba(200,222,250,0.22)");
      halo.addColorStop(1, "rgba(200,222,250,0)");
      sharpCtx.fillStyle = halo;
      sharpCtx.beginPath();
      sharpCtx.arc(moonX, moonY, moonR * 7, 0, Math.PI * 2);
      sharpCtx.fill();
      sharpCtx.fillStyle = "rgba(238,248,255,0.94)";
      sharpCtx.beginPath();
      sharpCtx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
      sharpCtx.fill();

      sharpCtx.fillStyle = "#dbe7ff";
      const starCount = Math.floor((nextWidth * nextHeight) / 26000);
      for (let i = 0; i < starCount; i += 1) {
        sharpCtx.globalAlpha = 0.3 + Math.random() * 0.5;
        sharpCtx.beginPath();
        sharpCtx.arc(Math.random() * nextWidth, Math.random() * nextHeight * 0.5, 0.2 + Math.random() * 0.9, 0, Math.PI * 2);
        sharpCtx.fill();
      }
      sharpCtx.globalAlpha = 1;

      const horizon = nextHeight * 0.7;
      sharpCtx.fillStyle = "#0c1a26";
      let treeX = -10;
      while (treeX < nextWidth + 20) {
        const treeW = 14 + Math.random() * 26;
        const treeH = 26 + Math.random() * 70;
        const baseY = horizon + Math.random() * 10;
        sharpCtx.beginPath();
        sharpCtx.moveTo(treeX, baseY);
        sharpCtx.lineTo(treeX + treeW / 2, baseY - treeH);
        sharpCtx.lineTo(treeX + treeW, baseY);
        sharpCtx.closePath();
        sharpCtx.fill();
        treeX += treeW * 0.62;
      }

      sharpCtx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 7; i += 1) {
        const lightX = nextWidth * (0.08 + Math.random() * 0.84);
        const lightY = horizon - 4 + Math.random() * 16;
        const radius = 5 + Math.random() * 22;
        const glow = sharpCtx.createRadialGradient(lightX, lightY, 0, lightX, lightY, radius);
        glow.addColorStop(0, "rgba(255,208,128,0.48)");
        glow.addColorStop(0.4, "rgba(255,184,82,0.18)");
        glow.addColorStop(1, "rgba(255,184,82,0)");
        sharpCtx.fillStyle = glow;
        sharpCtx.beginPath();
        sharpCtx.arc(lightX, lightY, radius, 0, Math.PI * 2);
        sharpCtx.fill();
      }
      sharpCtx.globalCompositeOperation = "source-over";

      const ground = sharpCtx.createLinearGradient(0, horizon, 0, nextHeight);
      ground.addColorStop(0, "#3a587a");
      ground.addColorStop(0.25, "#5e7c9c");
      ground.addColorStop(1, "#aebfd4");
      sharpCtx.fillStyle = ground;
      sharpCtx.beginPath();
      sharpCtx.moveTo(0, nextHeight);
      sharpCtx.lineTo(0, horizon + 14);
      for (let gx = 0; gx <= nextWidth; gx += nextWidth / 6) {
        sharpCtx.quadraticCurveTo(gx + nextWidth / 12, horizon + 8 + Math.sin(gx) * 8, gx + nextWidth / 6, horizon + 14);
      }
      sharpCtx.lineTo(nextWidth, nextHeight);
      sharpCtx.closePath();
      sharpCtx.fill();

      const fog = document.createElement("canvas");
      fog.width = nextWidth;
      fog.height = nextHeight;
      const fogCtx = fog.getContext("2d");
      if (!fogCtx) return;
      fogCtx.filter = "blur(3px) brightness(0.86)";
      fogCtx.drawImage(sharp, 0, 0);
      fogCtx.filter = "none";
      fogCtx.fillStyle = "rgba(196,214,238,0.12)";
      fogCtx.fillRect(0, 0, nextWidth, nextHeight);

      const frostLayerCount = 9;
      const layerCanvases = Array.from({ length: frostLayerCount }, () => {
        const canvas = document.createElement("canvas");
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        return canvas;
      });
      const layerContexts = layerCanvases.map((canvas) => canvas.getContext("2d"));
      if (layerContexts.some((layerCtx) => !layerCtx)) return;
      const typedLayerContexts = layerContexts as CanvasRenderingContext2D[];
      for (const layerCtx of typedLayerContexts) {
        layerCtx.lineCap = "round";
        layerCtx.strokeStyle = "rgba(226,240,255,0.5)";
        layerCtx.globalCompositeOperation = "lighter";
      }
      const layerFor = (progress: number) => typedLayerContexts[Math.max(0, Math.min(frostLayerCount - 1, Math.floor(progress * frostLayerCount)))];
      const fern = (x: number, y: number, angle: number, length: number, depth: number, birth: number) => {
        if (depth <= 0 || length < 3) return;
        const x2 = x + Math.cos(angle) * length;
        const y2 = y + Math.sin(angle) * length;
        const fernCtx = layerFor(birth);
        fernCtx.lineWidth = Math.max(0.35, depth * 0.34);
        fernCtx.beginPath();
        fernCtx.moveTo(x, y);
        fernCtx.lineTo(x2, y2);
        fernCtx.stroke();
        const branches = 2 + depth;
        for (let i = 1; i < branches; i += 1) {
          const f = i / branches;
          const branchX = x + Math.cos(angle) * length * f;
          const branchY = y + Math.sin(angle) * length * f;
          const spread = 0.55 + Math.random() * 0.35;
          const childBirth = Math.min(0.999, birth + 0.04 + f * 0.05);
          fern(branchX, branchY, angle - spread, length * 0.5 * (1 - f * 0.45), depth - 1, childBirth);
          fern(branchX, branchY, angle + spread, length * 0.5 * (1 - f * 0.45), depth - 1, childBirth);
        }
      };

      const seeds = Math.max(40, Math.min(120, Math.floor((2 * (nextWidth + nextHeight)) / 36)));
      for (let i = 0; i < seeds; i += 1) {
        let x = 0;
        let y = 0;
        let baseAngle = 0;
        const edge = Math.random();
        const r = Math.random();
        const u = r < 0.5 ? Math.pow(r * 2, 1.8) / 2 : 1 - Math.pow((1 - r) * 2, 1.8) / 2;
        if (edge < 0.25) {
          x = u * nextWidth;
          baseAngle = Math.PI / 2;
        } else if (edge < 0.5) {
          x = u * nextWidth;
          y = nextHeight;
          baseAngle = -Math.PI / 2;
        } else if (edge < 0.75) {
          y = u * nextHeight;
        } else {
          x = nextWidth;
          y = u * nextHeight;
          baseAngle = Math.PI;
        }
        fern(x, y, baseAngle + (Math.random() - 0.5) * 1.1, 26 + Math.random() * 74, 4, Math.random() * 0.7);
      }

      const softenedLayers = layerCanvases.map((layerCanvas) => {
        const canvas = document.createElement("canvas");
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        const layerCtx = canvas.getContext("2d");
        if (layerCtx) {
          layerCtx.filter = "blur(0.6px)";
          layerCtx.drawImage(layerCanvas, 0, 0);
        }
        return canvas;
      });

      const corner = document.createElement("canvas");
      corner.width = nextWidth;
      corner.height = nextHeight;
      const cornerCtx = corner.getContext("2d");
      if (!cornerCtx) return;
      for (const [px, py] of [[0, 0], [nextWidth, 0], [0, nextHeight], [nextWidth, nextHeight]]) {
        const glow = cornerCtx.createRadialGradient(px, py, 0, px, py, Math.min(nextWidth, nextHeight) * 0.55);
        glow.addColorStop(0, "rgba(222,236,255,0.5)");
        glow.addColorStop(0.5, "rgba(210,228,250,0.16)");
        glow.addColorStop(1, "rgba(210,228,250,0)");
        cornerCtx.fillStyle = glow;
        cornerCtx.fillRect(0, 0, nextWidth, nextHeight);
      }
      const band = cornerCtx.createLinearGradient(0, 0, 0, nextHeight);
      band.addColorStop(0, "rgba(225,238,255,0.30)");
      band.addColorStop(0.12, "rgba(225,238,255,0)");
      band.addColorStop(0.88, "rgba(225,238,255,0)");
      band.addColorStop(1, "rgba(232,243,255,0.42)");
      cornerCtx.fillStyle = band;
      cornerCtx.fillRect(0, 0, nextWidth, nextHeight);

      state.sharp = sharp;
      state.fog = fog;
      state.frostLayers = softenedLayers;
      state.corner = corner;
      state.frostLayerCount = frostLayerCount;
      state.flakes = Array.from({ length: Math.max(90, Math.min(220, Math.floor((nextWidth * nextHeight) / 7000))) }, () => ({
        x: Math.random() * nextWidth,
        y: Math.random() * nextHeight,
        r: 0.8 + Math.random() * 2.6,
        vy: 12 + Math.random() * 34,
        sway: 6 + Math.random() * 20,
        swaySp: 0.4 + Math.random() * 0.8,
        ph: Math.random() * Math.PI * 2,
        a: 0.35 + Math.random() * 0.5,
      }));
      state.sparks = Array.from({ length: Math.max(50, Math.min(160, Math.floor((nextWidth * nextHeight) / 9000))) }, () => {
        const edgeBias = Math.random() < 0.7;
        const x = edgeBias
          ? (Math.random() < 0.5 ? Math.random() * nextWidth * 0.22 : nextWidth - Math.random() * nextWidth * 0.22)
          : Math.random() * nextWidth;
        const y = edgeBias
          ? (Math.random() < 0.5 ? Math.random() * nextHeight * 0.22 : nextHeight - Math.random() * nextHeight * 0.22)
          : Math.random() * nextHeight;
        const bt = Math.min(1, Math.min(x, nextWidth - x, y, nextHeight - y) / (Math.min(nextWidth, nextHeight) * 0.5)) * 0.85;
        return { x, y, r: 0.6 + Math.random() * 1.6, sp: 1.5 + Math.random() * 3.5, ph: Math.random() * Math.PI * 2, bt };
      });
      state.beads = Array.from({ length: Math.max(10, Math.min(34, Math.floor((nextWidth * nextHeight) / 42000))) }, () => makeBead(nextWidth, nextHeight));
      state.canvasWidth = nextWidth;
      state.canvasHeight = nextHeight;
      state.last = time;
    };

    if (
      !state.fog
      || !state.sharp
      || !state.frostLayers
      || !state.corner
      || !state.flakes
      || !state.sparks
      || !state.beads
      || !state.frostLayerCount
      || !state.canvasWidth
      || !state.canvasHeight
    ) {
      return;
    }

    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;
    const canvasWidth = state.canvasWidth;
    const canvasHeight = state.canvasHeight;
    const phase = (time % 30) / 30;
    const coverage = phase < 0.56 ? smoothstep(0, 0.46, phase) : 1 - smoothstep(0.56, 1, phase);

    const drawIceBead = (x: number, y: number, r: number, magnification: number) => {
      if (!state.sharp) return;
      const shadow = ctx.createRadialGradient(x + r * 0.25, y + r * 0.4, 0, x + r * 0.25, y + r * 0.4, r * 1.5);
      shadow.addColorStop(0, "rgba(0,0,0,0.26)");
      shadow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.arc(x + r * 0.25, y + r * 0.4, r * 1.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      const sampleRadius = r / magnification;
      ctx.drawImage(state.sharp, x - sampleRadius, y - sampleRadius + r * 0.22, sampleRadius * 2, sampleRadius * 2, x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = "rgba(206,224,248,0.12)";
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.restore();

      ctx.lineWidth = Math.max(0.6, r * 0.1);
      ctx.strokeStyle = "rgba(120,150,185,0.45)";
      ctx.beginPath();
      ctx.arc(x, y, r - ctx.lineWidth * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(x - r * 0.34, y - r * 0.38, Math.max(0.7, r * 0.16), 0, Math.PI * 2);
      ctx.fill();
    };

    ctx.drawImage(state.fog, 0, 0, canvasWidth, canvasHeight);
    for (const flake of state.flakes) {
      flake.y += flake.vy * dt;
      flake.x += Math.sin(time * flake.swaySp + flake.ph) * flake.sway * dt;
      if (flake.y > canvasHeight + 4) {
        flake.y = -4;
        flake.x = Math.random() * canvasWidth;
      }
      if (flake.x < -4) flake.x = canvasWidth + 4;
      else if (flake.x > canvasWidth + 4) flake.x = -4;
      const glow = ctx.createRadialGradient(flake.x, flake.y, 0, flake.x, flake.y, flake.r * 1.6);
      glow.addColorStop(0, `rgba(238,246,255,${flake.a})`);
      glow.addColorStop(1, "rgba(238,246,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(flake.x, flake.y, flake.r * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    const front = coverage * state.frostLayerCount;
    const shimmer = 0.82 + 0.08 * Math.sin(time * 0.4);
    for (let index = 0; index < state.frostLayers.length; index += 1) {
      const alpha = Math.max(0, Math.min(1, front - index));
      if (alpha <= 0.002) continue;
      ctx.save();
      ctx.globalAlpha = alpha * shimmer;
      ctx.drawImage(state.frostLayers[index], 0, 0, canvasWidth, canvasHeight);
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = coverage;
    ctx.drawImage(state.corner, 0, 0, canvasWidth, canvasHeight);
    ctx.restore();

    for (const spark of state.sparks) {
      const grow = Math.max(0, Math.min(1, (coverage - spark.bt) / 0.1));
      if (grow <= 0) continue;
      const flicker = Math.pow(Math.max(0, Math.sin(time * spark.sp + spark.ph)), 6);
      if (flicker < 0.04) continue;
      const alpha = flicker * 0.9 * grow;
      const glow = ctx.createRadialGradient(spark.x, spark.y, 0, spark.x, spark.y, spark.r * 4);
      glow.addColorStop(0, `rgba(255,255,255,${alpha})`);
      glow.addColorStop(1, "rgba(220,238,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.r * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(spark.x - spark.r * 2.4, spark.y);
      ctx.lineTo(spark.x + spark.r * 2.4, spark.y);
      ctx.moveTo(spark.x, spark.y - spark.r * 2.4);
      ctx.lineTo(spark.x, spark.y + spark.r * 2.4);
      ctx.stroke();
    }

    for (const bead of state.beads) {
      const grow = Math.max(0, Math.min(1, (coverage - bead.bt) / 0.12));
      if (grow <= 0) continue;
      ctx.save();
      ctx.globalAlpha = grow;
      const twinkle = 0.7 + 0.3 * Math.sin(time * bead.twk + bead.tph);
      ctx.save();
      ctx.translate(bead.x, bead.y);
      ctx.rotate(bead.rot);
      ctx.scale(0.55 + 0.45 * grow, 0.55 + 0.45 * grow);
      ctx.strokeStyle = `rgba(228,242,255,${0.45 * twinkle})`;
      ctx.lineCap = "round";
      for (const spoke of bead.spokes) {
        ctx.lineWidth = Math.max(0.5, bead.r * 0.12);
        ctx.beginPath();
        ctx.moveTo(Math.cos(spoke.a) * bead.r * 0.9, Math.sin(spoke.a) * bead.r * 0.9);
        ctx.lineTo(Math.cos(spoke.a) * spoke.len, Math.sin(spoke.a) * spoke.len);
        ctx.stroke();
      }
      ctx.restore();
      drawIceBead(bead.x, bead.y, bead.r, 1.5);
      ctx.restore();
    }
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" style={{ background: "#0a1426" }} />;
}

interface MatrixState extends CanvasAnimLifecycle {
  fs?: number;
  cols?: number;
  drops?: number[];
  speeds?: number[];
  last?: number;
}

function MatrixBg() {
  const chars = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789@#$%&".split("");
  const draw: CanvasDraw<MatrixState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth) => {
      state.fs = 14;
      state.cols = Math.ceil(nextWidth / state.fs);
      state.drops = Array.from({ length: state.cols }, () => Math.random() * -height);
      state.speeds = Array.from({ length: state.cols }, () => 110 + Math.random() * 180);
      state.last = time;
    };
    if (!state.drops || !state.speeds || !state.fs || !state.cols) return;
    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;

    ctx.fillStyle = `rgba(5, 10, 8, ${Math.min(0.25, 6 * dt)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.font = `${state.fs}px ui-monospace, "JetBrains Mono", monospace`;
    for (let i = 0; i < state.cols; i += 1) {
      const char = chars[(Math.floor(time * 4 + i)) % chars.length];
      const x = i * state.fs;
      const y = state.drops[i];
      ctx.fillStyle = "rgba(190,255,210,0.95)";
      ctx.fillText(char, x, y);
      ctx.fillStyle = "rgba(60,210,90,0.75)";
      ctx.fillText(chars[(i * 7 + Math.floor(time * 2)) % chars.length], x, y - state.fs);
      state.drops[i] += state.speeds[i] * dt;
      if (y > height && Math.random() > 0.975) state.drops[i] = Math.random() * -40;
    }
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas dw-dynamic-bg-canvas-matrix" />;
}

interface LavaBlob {
  ph: number;
  rx: number;
  ry: number;
  ax: number;
  ay: number;
  speed: number;
  hue: number;
  r: number;
}

interface LavaState extends CanvasAnimLifecycle {
  blobs?: LavaBlob[];
}

function LavaBg() {
  const draw: CanvasDraw<LavaState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      state.blobs = Array.from({ length: 6 }, (_, index) => ({
        ph: index * 1.4 + Math.random() * 3,
        rx: 0.15 + Math.random() * 0.25,
        ry: 0.18 + Math.random() * 0.3,
        ax: nextWidth * (0.25 + Math.random() * 0.5),
        ay: nextHeight * (0.25 + Math.random() * 0.5),
        speed: 0.15 + Math.random() * 0.25,
        hue: 8 + index * 8,
        r: Math.min(nextWidth, nextHeight) * (0.18 + Math.random() * 0.18),
      }));
    };
    if (!state.blobs) return;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#2a0a06");
    gradient.addColorStop(1, "#180605");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = "lighter";
    for (const blob of state.blobs) {
      const x = blob.ax + Math.sin(time * blob.speed + blob.ph) * width * blob.rx;
      const y = blob.ay + Math.cos(time * blob.speed * 0.8 + blob.ph) * height * blob.ry;
      const blobGradient = ctx.createRadialGradient(x, y, 0, x, y, blob.r);
      blobGradient.addColorStop(0, `hsla(${blob.hue + 5}, 95%, 60%, 0.70)`);
      blobGradient.addColorStop(0.5, `hsla(${blob.hue}, 85%, 50%, 0.30)`);
      blobGradient.addColorStop(1, `hsla(${blob.hue - 5}, 80%, 35%, 0)`);
      ctx.fillStyle = blobGradient;
      ctx.beginPath();
      ctx.arc(x, y, blob.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

function SynthwaveBg() {
  return (
    <div className="dw-bg-synthwave">
      <div className="dw-sw-sky" />
      <div className="dw-sw-sun" />
      <div className="dw-sw-mountains" />
      <div className="dw-sw-grid" />
      <div className="dw-sw-scan" />
    </div>
  );
}

interface ConfettiBit {
  x: number;
  y: number;
  sz: number;
  rot: number;
  vrot: number;
  vy: number;
  vx: number;
  wob: number;
  wobSp: number;
  color: string;
}

interface ConfettiState extends CanvasAnimLifecycle {
  bits?: ConfettiBit[];
  last?: number;
}

function ConfettiBg() {
  const palette = ["#ff5b8a", "#ffd166", "#06d6a0", "#118ab2", "#a78bfa", "#ff8c42", "#ef476f", "#7be0ad"];
  function spawn(width: number, height: number, seed: boolean): ConfettiBit {
    return {
      x: Math.random() * width,
      y: seed ? Math.random() * height : -10,
      sz: 5 + Math.random() * 9,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 4,
      vy: 25 + Math.random() * 60,
      vx: (Math.random() - 0.5) * 30,
      wob: Math.random() * 6.28,
      wobSp: 1 + Math.random() * 2,
      color: palette[Math.floor(Math.random() * palette.length)],
    };
  }

  const draw: CanvasDraw<ConfettiState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      const count = Math.max(60, Math.min(180, Math.floor((nextWidth * nextHeight) / 8500)));
      state.bits = Array.from({ length: count }, () => spawn(nextWidth, nextHeight, true));
      state.last = time;
    };
    if (!state.bits) return;
    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#fdf2f8");
    gradient.addColorStop(1, "#eef2ff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    for (const bit of state.bits) {
      bit.y += bit.vy * dt;
      bit.x += bit.vx * dt + Math.sin(time * bit.wobSp + bit.wob) * 0.7;
      bit.rot += bit.vrot * dt;
      if (bit.y > height + 20) Object.assign(bit, spawn(width, height, false));
      ctx.save();
      ctx.translate(bit.x, bit.y);
      ctx.rotate(bit.rot);
      ctx.fillStyle = bit.color;
      ctx.fillRect(-bit.sz / 2, -bit.sz * 0.35, bit.sz, bit.sz * 0.7);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(-bit.sz / 2, -bit.sz * 0.35, bit.sz, bit.sz * 0.18);
      ctx.restore();
    }
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface NebulaCloud {
  hue: number;
  ax: number;
  ay: number;
  r: number;
  ph: number;
  speed: number;
}

interface NebulaState extends CanvasAnimLifecycle {
  clouds?: NebulaCloud[];
  starCanvas?: HTMLCanvasElement;
}

function NebulaBg() {
  const draw: CanvasDraw<NebulaState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      state.clouds = Array.from({ length: 5 }, (_, index) => ({
        hue: [285, 320, 200, 260, 180][index],
        ax: nextWidth * (0.15 + (index / 4) * 0.7),
        ay: nextHeight * (0.3 + Math.random() * 0.4),
        r: Math.min(nextWidth, nextHeight) * (0.35 + Math.random() * 0.25),
        ph: index * 1.3,
        speed: 0.04 + Math.random() * 0.05,
      }));
      state.starCanvas = document.createElement("canvas");
      state.starCanvas.width = nextWidth;
      state.starCanvas.height = nextHeight;
      const starCtx = state.starCanvas.getContext("2d");
      if (!starCtx) return;
      const starCount = Math.floor((nextWidth * nextHeight) / 14000);
      for (let i = 0; i < starCount; i += 1) {
        const x = Math.random() * nextWidth;
        const y = Math.random() * nextHeight;
        const radius = Math.random() * 0.9 + 0.2;
        starCtx.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.5})`;
        starCtx.beginPath();
        starCtx.arc(x, y, radius, 0, Math.PI * 2);
        starCtx.fill();
      }
    };
    if (!state.clouds) return;

    ctx.fillStyle = "#070617";
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = "lighter";
    for (const cloud of state.clouds) {
      const x = cloud.ax + Math.sin(time * cloud.speed + cloud.ph) * width * 0.1;
      const y = cloud.ay + Math.cos(time * cloud.speed * 0.7 + cloud.ph) * height * 0.06;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, cloud.r);
      gradient.addColorStop(0, `hsla(${cloud.hue}, 80%, 60%, 0.32)`);
      gradient.addColorStop(0.4, `hsla(${cloud.hue + 20}, 70%, 50%, 0.16)`);
      gradient.addColorStop(1, `hsla(${cloud.hue}, 70%, 30%, 0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, cloud.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    if (state.starCanvas) ctx.drawImage(state.starCanvas, 0, 0, width, height);
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface Cloud {
  x: number;
  y: number;
  r: number;
  speed: number;
  puffs: number;
  a: number;
}

interface CloudsState extends CanvasAnimLifecycle {
  clouds?: Cloud[];
  last?: number;
}

function CloudsBg() {
  const draw: CanvasDraw<CloudsState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      const count = Math.max(8, Math.min(18, Math.floor(nextWidth / 130)));
      state.clouds = Array.from({ length: count }, () => ({
        x: Math.random() * nextWidth * 1.2 - nextWidth * 0.1,
        y: nextHeight * (0.05 + Math.random() * 0.65),
        r: 40 + Math.random() * 90,
        speed: 4 + Math.random() * 10,
        puffs: 3 + Math.floor(Math.random() * 3),
        a: 0.55 + Math.random() * 0.35,
      }));
      state.last = time;
    };
    if (!state.clouds) return;
    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#4ea8e8");
    gradient.addColorStop(0.55, "#a3d3f0");
    gradient.addColorStop(1, "#dcecf6");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const sunX = width * 0.78;
    const sunY = height * 0.22;
    const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(width, height) * 0.55);
    sunGlow.addColorStop(0, "rgba(255,240,200,0.55)");
    sunGlow.addColorStop(0.3, "rgba(255,235,180,0.18)");
    sunGlow.addColorStop(1, "rgba(255,235,180,0)");
    ctx.fillStyle = sunGlow;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255,245,210,0.9)";
    ctx.beginPath();
    ctx.arc(sunX, sunY, 28, 0, Math.PI * 2);
    ctx.fill();

    for (const cloud of state.clouds) {
      cloud.x += cloud.speed * dt;
      if (cloud.x - cloud.r * 2 > width) {
        cloud.x = -cloud.r * 2;
        cloud.y = height * (0.05 + Math.random() * 0.65);
      }
      for (let i = 0; i < cloud.puffs; i += 1) {
        const puffX = cloud.x + Math.cos(i * 1.4) * cloud.r * 0.55;
        const puffY = cloud.y + Math.sin(i * 1.9) * cloud.r * 0.18;
        const puffRadius = cloud.r * (0.55 + (i % 3) * 0.15);
        const puff = ctx.createRadialGradient(puffX, puffY - puffRadius * 0.2, 0, puffX, puffY, puffRadius);
        puff.addColorStop(0, `rgba(255,255,255,${cloud.a})`);
        puff.addColorStop(0.6, `rgba(245,250,255,${cloud.a * 0.45})`);
        puff.addColorStop(1, "rgba(220,235,250,0)");
        ctx.fillStyle = puff;
        ctx.beginPath();
        ctx.arc(puffX, puffY, puffRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface OceanState extends CanvasAnimLifecycle {
  last?: number;
}

function OceanBg() {
  const draw: CanvasDraw<OceanState> = (ctx, width, height, time, state) => {
    state.onResize = () => {
      state.last = time;
    };
    if (state.last === undefined) state.last = time;

    const horizon = height * 0.38;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#f6e9c8");
    sky.addColorStop(0.6, "#f0c79a");
    sky.addColorStop(1, "#dba488");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizon);

    const sea = ctx.createLinearGradient(0, horizon, 0, height);
    sea.addColorStop(0, "#3d6b80");
    sea.addColorStop(0.5, "#1f4a63");
    sea.addColorStop(1, "#0b2a3c");
    ctx.fillStyle = sea;
    ctx.fillRect(0, horizon, width, height - horizon);

    const reflection = ctx.createRadialGradient(width * 0.5, horizon, 0, width * 0.5, horizon, width * 0.5);
    reflection.addColorStop(0, "rgba(255,210,140,0.55)");
    reflection.addColorStop(1, "rgba(255,210,140,0)");
    ctx.fillStyle = reflection;
    ctx.fillRect(0, 0, width, height);

    const bands = 8;
    for (let i = 0; i < bands; i += 1) {
      const k = i / (bands - 1);
      const yBase = horizon + (height - horizon) * (0.08 + k * 0.95);
      const amp = 4 + k * 18;
      const waveLength = 80 + k * 180;
      const speed = 0.4 + k * 1.2;
      const lightness = 30 + k * 28;
      const foamAlpha = 0.15 + k * 0.45;
      const step = 6;

      ctx.beginPath();
      ctx.moveTo(0, yBase);
      for (let x = 0; x <= width; x += step) {
        const y = yBase
          + Math.sin((x / waveLength) + time * speed + i) * amp
          + Math.sin((x / (waveLength * 0.5)) - time * speed * 0.7 + i * 2.1) * amp * 0.35;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fillStyle = `hsl(200, 35%, ${lightness}%)`;
      ctx.fill();

      ctx.beginPath();
      for (let x = 0; x <= width; x += step) {
        const y = yBase
          + Math.sin((x / waveLength) + time * speed + i) * amp
          + Math.sin((x / (waveLength * 0.5)) - time * speed * 0.7 + i * 2.1) * amp * 0.35;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(220,235,245,${foamAlpha})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface SnowFlake {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  swaySp: number;
  ph: number;
  a: number;
}

interface SnowState extends CanvasAnimLifecycle {
  flakes?: SnowFlake[];
  last?: number;
}

function SnowBg() {
  const draw: CanvasDraw<SnowState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      const count = Math.max(120, Math.min(260, Math.floor((nextWidth * nextHeight) / 5500)));
      state.flakes = Array.from({ length: count }, () => ({
        x: Math.random() * nextWidth,
        y: Math.random() * nextHeight,
        r: 0.8 + Math.random() * 2.2,
        vy: 18 + Math.random() * 50,
        sway: 8 + Math.random() * 22,
        swaySp: 0.4 + Math.random() * 0.8,
        ph: Math.random() * 6.28,
        a: 0.5 + Math.random() * 0.5,
      }));
      state.last = time;
    };
    if (!state.flakes) return;
    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#2a3340");
    gradient.addColorStop(0.5, "#3e4a5c");
    gradient.addColorStop(1, "#6b7a8e");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const drift = ctx.createLinearGradient(0, height * 0.85, 0, height);
    drift.addColorStop(0, "rgba(240,245,252,0)");
    drift.addColorStop(1, "rgba(240,245,252,0.5)");
    ctx.fillStyle = drift;
    ctx.fillRect(0, height * 0.85, width, height * 0.15);

    for (const flake of state.flakes) {
      flake.y += flake.vy * dt;
      flake.x += Math.sin(time * flake.swaySp + flake.ph) * flake.sway * dt;
      if (flake.y > height + 4) {
        flake.y = -4;
        flake.x = Math.random() * width;
      }
      ctx.fillStyle = `rgba(245,250,255,${flake.a})`;
      ctx.beginPath();
      ctx.arc(flake.x, flake.y, flake.r, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface CyberpunkWindow {
  x: number;
  y: number;
  hue: number;
  flick: number;
  flickSp: number;
}

interface CyberpunkBuilding {
  x: number;
  y: number;
  w: number;
  h: number;
  windows: CyberpunkWindow[];
  color: string;
}

interface CyberpunkStreak {
  y: number;
  x: number;
  speed: number;
  len: number;
  hue: number;
  a: number;
}

interface CyberpunkRain {
  x: number;
  y: number;
  len: number;
  sp: number;
}

interface CyberpunkState extends CanvasAnimLifecycle {
  back?: CyberpunkBuilding[];
  mid?: CyberpunkBuilding[];
  fore?: CyberpunkBuilding[];
  streaks?: CyberpunkStreak[];
  rain?: CyberpunkRain[];
  last?: number;
}

function CyberpunkBg() {
  const draw: CanvasDraw<CyberpunkState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      function buildSkyline(baseY: number, hRange: [number, number], color: string) {
        const buildings: CyberpunkBuilding[] = [];
        let x = 0;
        while (x < nextWidth + 60) {
          const buildingWidth = 22 + Math.random() * 60;
          const buildingHeight = hRange[0] + Math.random() * (hRange[1] - hRange[0]);
          const windows: CyberpunkWindow[] = [];
          const rows = Math.floor(buildingHeight / 14);
          const cols = Math.max(1, Math.floor(buildingWidth / 11));
          for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
              if (Math.random() < 0.55) {
                windows.push({
                  x: col * 11 + 3,
                  y: row * 14 + 6,
                  hue: Math.random() < 0.5 ? 320 : (Math.random() < 0.5 ? 195 : 50),
                  flick: Math.random() * 6.28,
                  flickSp: 0.2 + Math.random() * 1.8,
                });
              }
            }
          }
          buildings.push({ x, y: baseY - buildingHeight, w: buildingWidth, h: buildingHeight, windows, color });
          x += buildingWidth - 1;
        }
        return buildings;
      }

      state.back = buildSkyline(nextHeight * 0.78, [60, 130], "#15101e");
      state.mid = buildSkyline(nextHeight * 0.88, [80, 180], "#0d0918");
      state.fore = buildSkyline(nextHeight, [100, 220], "#06030f");
      state.streaks = Array.from({ length: 14 }, () => ({
        y: nextHeight * (0.62 + Math.random() * 0.28),
        x: Math.random() * nextWidth,
        speed: (Math.random() < 0.5 ? -1 : 1) * (160 + Math.random() * 280),
        len: 60 + Math.random() * 120,
        hue: Math.random() < 0.5 ? 320 : 200,
        a: 0.5 + Math.random() * 0.5,
      }));
      const rainCount = Math.max(80, Math.min(180, Math.floor((nextWidth * nextHeight) / 7200)));
      state.rain = Array.from({ length: rainCount }, () => ({
        x: Math.random() * nextWidth * 1.2,
        y: Math.random() * nextHeight,
        len: 8 + Math.random() * 12,
        sp: 380 + Math.random() * 200,
      }));
      state.last = time;
    };
    if (!state.back || !state.mid || !state.fore || !state.streaks || !state.rain) return;
    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#08020e");
    gradient.addColorStop(0.45, "#1a0820");
    gradient.addColorStop(0.75, "#3a0a3a");
    gradient.addColorStop(1, "#5e1444");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const haze = ctx.createLinearGradient(0, height * 0.5, 0, height);
    haze.addColorStop(0, "rgba(255,80,180,0)");
    haze.addColorStop(1, "rgba(255,80,180,0.22)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, height * 0.5, width, height * 0.5);

    function drawLayer(layer: CyberpunkBuilding[], glow: number) {
      for (const building of layer) {
        ctx.fillStyle = building.color;
        ctx.fillRect(building.x, building.y, building.w, building.h);
        for (const win of building.windows) {
          const flick = 0.4 + 0.6 * Math.abs(Math.sin(time * win.flickSp + win.flick));
          ctx.fillStyle = `hsla(${win.hue},90%,65%,${flick * glow})`;
          ctx.fillRect(building.x + win.x, building.y + win.y, 4, 5);
        }
      }
    }
    drawLayer(state.back, 0.55);
    drawLayer(state.mid, 0.8);

    ctx.lineCap = "round";
    for (const streak of state.streaks) {
      streak.x += streak.speed * dt;
      if (streak.speed > 0 && streak.x - streak.len > width) streak.x = -streak.len;
      if (streak.speed < 0 && streak.x + streak.len < 0) streak.x = width + streak.len;
      const x2 = streak.x - Math.sign(streak.speed) * streak.len;
      const streakGradient = ctx.createLinearGradient(x2, streak.y, streak.x, streak.y);
      streakGradient.addColorStop(0, `hsla(${streak.hue},95%,60%,0)`);
      streakGradient.addColorStop(1, `hsla(${streak.hue},95%,70%,${streak.a})`);
      ctx.strokeStyle = streakGradient;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x2, streak.y);
      ctx.lineTo(streak.x, streak.y);
      ctx.stroke();
    }

    drawLayer(state.fore, 1.0);

    ctx.strokeStyle = "rgba(180,210,240,0.30)";
    ctx.lineWidth = 0.9;
    for (const drop of state.rain) {
      drop.y += drop.sp * dt;
      drop.x -= drop.sp * 0.18 * dt;
      if (drop.y > height) {
        drop.y = -drop.len;
        drop.x = Math.random() * width * 1.2;
      }
      ctx.beginPath();
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x - drop.len * 0.18, drop.y + drop.len);
      ctx.stroke();
    }
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface SakuraPetal {
  x: number;
  y: number;
  sz: number;
  rot: number;
  vrot: number;
  vy: number;
  sway: number;
  swaySp: number;
  ph: number;
  hue: number;
  a: number;
}

interface SakuraState extends CanvasAnimLifecycle {
  petals?: SakuraPetal[];
  last?: number;
}

function SakuraBg() {
  const draw: CanvasDraw<SakuraState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      const count = Math.max(40, Math.min(110, Math.floor((nextWidth * nextHeight) / 13000)));
      state.petals = Array.from({ length: count }, () => ({
        x: Math.random() * nextWidth,
        y: Math.random() * nextHeight,
        sz: 6 + Math.random() * 10,
        rot: Math.random() * 6.28,
        vrot: (Math.random() - 0.5) * 1.6,
        vy: 14 + Math.random() * 26,
        sway: 14 + Math.random() * 22,
        swaySp: 0.4 + Math.random() * 0.8,
        ph: Math.random() * 6.28,
        hue: 340 + (Math.random() - 0.5) * 18,
        a: 0.7 + Math.random() * 0.3,
      }));
      state.last = time;
    };
    if (!state.petals) return;
    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#fce4ec");
    gradient.addColorStop(0.55, "#fff1f4");
    gradient.addColorStop(1, "#fde2cf");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const sun = ctx.createRadialGradient(width * 0.2, height * 0.15, 0, width * 0.2, height * 0.15, Math.max(width, height) * 0.4);
    sun.addColorStop(0, "rgba(255,240,220,0.55)");
    sun.addColorStop(1, "rgba(255,240,220,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, width, height);

    for (const petal of state.petals) {
      petal.y += petal.vy * dt;
      petal.x += Math.sin(time * petal.swaySp + petal.ph) * petal.sway * dt;
      petal.rot += petal.vrot * dt;
      if (petal.y > height + 10) {
        petal.y = -10;
        petal.x = Math.random() * width;
      }
      ctx.save();
      ctx.translate(petal.x, petal.y);
      ctx.rotate(petal.rot);
      const petalGradient = ctx.createLinearGradient(0, -petal.sz, 0, petal.sz);
      petalGradient.addColorStop(0, `hsla(${petal.hue},85%,90%,${petal.a})`);
      petalGradient.addColorStop(0.6, `hsla(${petal.hue},75%,75%,${petal.a})`);
      petalGradient.addColorStop(1, `hsla(${petal.hue - 10},70%,60%,${petal.a * 0.7})`);
      ctx.fillStyle = petalGradient;
      ctx.beginPath();
      ctx.ellipse(0, 0, petal.sz * 0.45, petal.sz, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface Firefly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  ph: number;
  sp: number;
  hue: number;
}

interface FirefliesState extends CanvasAnimLifecycle {
  bugs?: Firefly[];
  last?: number;
}

function FirefliesBg() {
  const draw: CanvasDraw<FirefliesState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      const count = Math.max(35, Math.min(85, Math.floor((nextWidth * nextHeight) / 16000)));
      state.bugs = Array.from({ length: count }, () => ({
        x: Math.random() * nextWidth,
        y: Math.random() * nextHeight,
        vx: (Math.random() - 0.5) * 14,
        vy: (Math.random() - 0.5) * 10,
        r: 1.2 + Math.random() * 1.6,
        ph: Math.random() * 6.28,
        sp: 0.6 + Math.random() * 1.6,
        hue: 55 + Math.random() * 20,
      }));
      state.last = time;
    };
    if (!state.bugs) return;
    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#0b1a14");
    gradient.addColorStop(0.5, "#13261c");
    gradient.addColorStop(1, "#08130e");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const floorGlow = ctx.createRadialGradient(width * 0.5, height * 1.1, 0, width * 0.5, height * 1.1, Math.max(width, height) * 0.8);
    floorGlow.addColorStop(0, "rgba(140,110,40,0.20)");
    floorGlow.addColorStop(1, "rgba(140,110,40,0)");
    ctx.fillStyle = floorGlow;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = "lighter";
    for (const bug of state.bugs) {
      bug.x += bug.vx * dt + Math.sin(time * bug.sp + bug.ph) * 6 * dt;
      bug.y += bug.vy * dt + Math.cos(time * bug.sp * 0.7 + bug.ph) * 5 * dt;
      if (bug.x < -10) bug.x = width + 10;
      else if (bug.x > width + 10) bug.x = -10;
      if (bug.y < -10) bug.y = height + 10;
      else if (bug.y > height + 10) bug.y = -10;
      const pulse = 0.3 + 0.7 * Math.abs(Math.sin(time * bug.sp * 1.3 + bug.ph));
      const halo = ctx.createRadialGradient(bug.x, bug.y, 0, bug.x, bug.y, bug.r * 10);
      halo.addColorStop(0, `hsla(${bug.hue},95%,70%,${0.55 * pulse})`);
      halo.addColorStop(0.4, `hsla(${bug.hue},95%,60%,${0.18 * pulse})`);
      halo.addColorStop(1, `hsla(${bug.hue},95%,50%,0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(bug.x, bug.y, bug.r * 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(${bug.hue},100%,90%,${pulse})`;
      ctx.beginPath();
      ctx.arc(bug.x, bug.y, bug.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface ThunderstormCloud {
  x: number;
  y: number;
  r: number;
  sp: number;
}

interface ThunderstormDrop {
  x: number;
  y: number;
  len: number;
  sp: number;
}

interface LightningBolt {
  pts: { x: number; y: number }[];
  ttl: number;
  life: number;
}

interface ThunderstormState extends CanvasAnimLifecycle {
  rain?: ThunderstormDrop[];
  clouds?: ThunderstormCloud[];
  flash?: number;
  nextFlash?: number;
  flashBolt?: LightningBolt | null;
  last?: number;
}

function ThunderstormBg() {
  const draw: CanvasDraw<ThunderstormState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      const rainCount = Math.max(140, Math.min(280, Math.floor((nextWidth * nextHeight) / 5200)));
      state.rain = Array.from({ length: rainCount }, () => ({
        x: Math.random() * nextWidth * 1.2,
        y: Math.random() * nextHeight,
        len: 10 + Math.random() * 14,
        sp: 540 + Math.random() * 300,
      }));
      state.clouds = Array.from({ length: 6 }, (_, index) => ({
        x: nextWidth * (index / 6) + Math.random() * 80,
        y: nextHeight * (0.1 + Math.random() * 0.3),
        r: 120 + Math.random() * 140,
        sp: 4 + Math.random() * 7,
      }));
      state.flash = 0;
      state.nextFlash = time + 2 + Math.random() * 5;
      state.flashBolt = null;
      state.last = time;
    };
    if (!state.clouds || !state.rain || state.nextFlash === undefined) return;
    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#0d1018");
    gradient.addColorStop(0.55, "#1a2230");
    gradient.addColorStop(1, "#0a1018");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    for (const cloud of state.clouds) {
      cloud.x += cloud.sp * dt;
      if (cloud.x - cloud.r > width) cloud.x = -cloud.r;
      const cloudGradient = ctx.createRadialGradient(cloud.x, cloud.y, 0, cloud.x, cloud.y, cloud.r);
      cloudGradient.addColorStop(0, "rgba(70,80,95,0.85)");
      cloudGradient.addColorStop(0.6, "rgba(40,48,60,0.45)");
      cloudGradient.addColorStop(1, "rgba(20,26,38,0)");
      ctx.fillStyle = cloudGradient;
      ctx.beginPath();
      ctx.arc(cloud.x, cloud.y, cloud.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (time > state.nextFlash) {
      state.flash = 1;
      const startX = Math.random() * width;
      const pts = [{ x: startX, y: 0 }];
      let currentX = startX;
      let currentY = 0;
      while (currentY < height * 0.85) {
        currentY += 10 + Math.random() * 30;
        currentX += (Math.random() - 0.5) * 60;
        pts.push({ x: currentX, y: currentY });
      }
      state.flashBolt = { pts, ttl: 0.18 + Math.random() * 0.12, life: 0 };
      state.nextFlash = time + 2.5 + Math.random() * 6;
    }

    if ((state.flash ?? 0) > 0) {
      state.flash = Math.max(0, (state.flash ?? 0) - dt * 4.5);
      ctx.fillStyle = `rgba(220,230,255,${state.flash * 0.5})`;
      ctx.fillRect(0, 0, width, height);
    }

    if (state.flashBolt) {
      state.flashBolt.life += dt;
      if (state.flashBolt.life > state.flashBolt.ttl) {
        state.flashBolt = null;
      } else {
        const k = 1 - state.flashBolt.life / state.flashBolt.ttl;
        ctx.strokeStyle = `rgba(230,235,255,${k})`;
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        ctx.shadowColor = "rgba(180,210,255,0.9)";
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.moveTo(state.flashBolt.pts[0].x, state.flashBolt.pts[0].y);
        for (let i = 1; i < state.flashBolt.pts.length; i += 1) {
          ctx.lineTo(state.flashBolt.pts[i].x, state.flashBolt.pts[i].y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    ctx.strokeStyle = "rgba(180,200,225,0.55)";
    ctx.lineWidth = 1.2;
    for (const drop of state.rain) {
      drop.y += drop.sp * dt;
      drop.x -= drop.sp * 0.22 * dt;
      if (drop.y > height) {
        drop.y = -drop.len;
        drop.x = Math.random() * width * 1.2;
      }
      ctx.beginPath();
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x - drop.len * 0.22, drop.y + drop.len);
      ctx.stroke();
    }
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface TopoField {
  ph: number;
  sp: number;
  ax: number;
  ay: number;
  sigma: number;
}

interface TopoState extends CanvasAnimLifecycle {
  fields?: TopoField[];
  lo?: HTMLCanvasElement;
  loCtx?: CanvasRenderingContext2D | null;
  scale?: number;
}

function TopoBg() {
  const draw: CanvasDraw<TopoState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      state.fields = Array.from({ length: 5 }, (_, index) => ({
        ph: index * 1.3,
        sp: 0.12 + Math.random() * 0.16,
        ax: nextWidth * (0.2 + Math.random() * 0.6),
        ay: nextHeight * (0.2 + Math.random() * 0.6),
        sigma: Math.min(nextWidth, nextHeight) * (0.18 + Math.random() * 0.12),
      }));
      state.lo = document.createElement("canvas");
      state.scale = 4;
      state.lo.width = Math.max(1, Math.floor(nextWidth / state.scale));
      state.lo.height = Math.max(1, Math.floor(nextHeight / state.scale));
      state.loCtx = state.lo.getContext("2d");
    };
    if (!state.fields || !state.lo || !state.loCtx || !state.scale) return;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#0a1322");
    gradient.addColorStop(1, "#0d1a2e");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const loWidth = state.lo.width;
    const loHeight = state.lo.height;
    const image = state.loCtx.createImageData(loWidth, loHeight);
    const data = image.data;
    const centers = state.fields.map((field) => ({
      x: (field.ax + Math.sin(time * field.sp + field.ph) * width * 0.2) / state.scale!,
      y: (field.ay + Math.cos(time * field.sp * 0.7 + field.ph) * height * 0.2) / state.scale!,
      sigma2: (field.sigma / state.scale!) ** 2,
    }));
    const levels = 14;
    const band = 0.04;
    for (let py = 0; py < loHeight; py += 1) {
      for (let px = 0; px < loWidth; px += 1) {
        let value = 0;
        for (const center of centers) {
          const dx = px - center.x;
          const dy = py - center.y;
          value += Math.exp(-(dx * dx + dy * dy) / (2 * center.sigma2));
        }
        const scaled = value * levels;
        const fraction = scaled - Math.floor(scaled);
        const distance = Math.min(fraction, 1 - fraction);
        const index = (py * loWidth + px) * 4;
        if (distance < band) {
          const k = 1 - distance / band;
          const level = Math.min(1, value / 1.6);
          data[index] = Math.floor(60 + level * 130);
          data[index + 1] = Math.floor(180 + level * 60);
          data[index + 2] = Math.floor(220 - level * 60);
          data[index + 3] = Math.floor(200 * k * (0.4 + level * 0.6));
        } else {
          data[index + 3] = 0;
        }
      }
    }
    state.loCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(state.lo, 0, 0, width, height);
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface Bubble {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  swaySp: number;
  ph: number;
  a: number;
}

interface BubblesState extends CanvasAnimLifecycle {
  bubs?: Bubble[];
  last?: number;
}

function BubblesBg() {
  const draw: CanvasDraw<BubblesState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      const count = Math.max(40, Math.min(110, Math.floor((nextWidth * nextHeight) / 12000)));
      state.bubs = Array.from({ length: count }, () => ({
        x: Math.random() * nextWidth,
        y: Math.random() * nextHeight,
        r: 3 + Math.random() * 14,
        vy: 18 + Math.random() * 38,
        sway: 6 + Math.random() * 14,
        swaySp: 0.4 + Math.random() * 0.8,
        ph: Math.random() * 6.28,
        a: 0.35 + Math.random() * 0.4,
      }));
      state.last = time;
    };
    if (!state.bubs) return;
    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#1a6b8c");
    gradient.addColorStop(0.45, "#0e4263");
    gradient.addColorStop(1, "#051c30");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < 6; i += 1) {
      const yBase = height * 0.05 + Math.sin(time * 0.6 + i * 1.3) * 12;
      const caustic = ctx.createLinearGradient(0, yBase, 0, yBase + height * 0.4);
      caustic.addColorStop(0, `rgba(180,225,255,${0.10 + 0.05 * Math.sin(time + i)})`);
      caustic.addColorStop(1, "rgba(180,225,255,0)");
      ctx.fillStyle = caustic;
      const wavelength = width / 4 + i * 30;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 8) {
        const y = yBase + Math.sin((x / wavelength) + time * 0.8 + i) * 10;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(width, yBase + height * 0.4);
      ctx.lineTo(0, yBase + height * 0.4);
      ctx.closePath();
      ctx.fill();
    }

    for (const bubble of state.bubs) {
      bubble.y -= bubble.vy * dt;
      bubble.x += Math.sin(time * bubble.swaySp + bubble.ph) * bubble.sway * dt;
      if (bubble.y < -bubble.r * 2) {
        bubble.y = height + bubble.r;
        bubble.x = Math.random() * width;
      }
      const body = ctx.createRadialGradient(bubble.x - bubble.r * 0.3, bubble.y - bubble.r * 0.3, bubble.r * 0.1, bubble.x, bubble.y, bubble.r);
      body.addColorStop(0, `rgba(220,240,255,${bubble.a * 0.9})`);
      body.addColorStop(0.6, `rgba(180,220,245,${bubble.a * 0.35})`);
      body.addColorStop(1, "rgba(140,200,235,0)");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(bubble.x, bubble.y, bubble.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(220,240,255,${bubble.a * 0.6})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(bubble.x, bubble.y, bubble.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${bubble.a * 0.9})`;
      ctx.beginPath();
      ctx.arc(bubble.x - bubble.r * 0.4, bubble.y - bubble.r * 0.4, bubble.r * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface AquariumFishPalette {
  body: string;
  belly: string;
  fin: string;
  stripe: string | null;
}

type AquariumCreatureKind = "fish" | "stingray" | "octopus" | "squid";

interface AquariumFish {
  kind: AquariumCreatureKind;
  x: number;
  baseY: number;
  size: number;
  vx: number;
  dir: -1 | 1;
  pal: AquariumFishPalette;
  bobAmp: number;
  bobSp: number;
  bobPh: number;
  tailSp: number;
  tailPh: number;
  turnAt: number;
  baseSpeed: number;
}

interface AquariumPlant {
  x: number;
  height: number;
  color: string;
  swaySp: number;
  swayPh: number;
  blades: {
    off: number;
    hs: number;
    wob: number;
    wid: number;
  }[];
}

interface AquariumBubble {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  swaySp: number;
  ph: number;
}

interface AquariumParticle {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  swaySp: number;
  ph: number;
  a: number;
}

interface AquariumPebble {
  x: number;
  y: number;
  rx: number;
  ry: number;
  c: string;
}

interface AquariumState extends CanvasAnimLifecycle {
  fish?: AquariumFish[];
  plants?: AquariumPlant[];
  bubbles?: AquariumBubble[];
  particles?: AquariumParticle[];
  pebbles?: AquariumPebble[];
  floorY?: number;
  minY?: number;
  maxY?: number;
  last?: number;
}

function AquariumBg() {
  const palettes: AquariumFishPalette[] = [
    { body: "#ff8a3d", belly: "#ffd9b0", fin: "#ff6a14", stripe: "#fff4e6" },
    { body: "#ffce3a", belly: "#fff0a8", fin: "#f3a200", stripe: null },
    { body: "#3fb6f0", belly: "#bfe9ff", fin: "#1f8fd6", stripe: "#eaf8ff" },
    { body: "#f25d8e", belly: "#ffd2e2", fin: "#d6356d", stripe: null },
    { body: "#9b6ff0", belly: "#ddccff", fin: "#7846d8", stripe: null },
    { body: "#7fc35a", belly: "#dcf2c4", fin: "#5da33d", stripe: null },
    { body: "#ef5b5b", belly: "#ffd0cf", fin: "#cf3636", stripe: "#fff0ef" },
    { body: "#e9eef2", belly: "#ffffff", fin: "#b9c6d0", stripe: "#5b6b78" },
  ];

  const draw: CanvasDraw<AquariumState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      const floorY = nextHeight * 0.86;
      const minY = nextHeight * 0.16;
      const maxY = floorY - 20;
      const range = maxY - minY;
      const fishCount = Math.max(5, Math.min(11, Math.floor((nextWidth * nextHeight) / 95000)));
      state.fish = Array.from({ length: fishCount }, (_, index) => {
        const dir: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
        const baseSpeed = 26 + Math.random() * 40;
        return {
          kind: "fish",
          x: Math.random() * nextWidth,
          baseY: minY + Math.random() * range,
          size: 16 + Math.random() * 26,
          vx: baseSpeed * dir,
          dir,
          pal: palettes[index % palettes.length],
          bobAmp: 4 + Math.random() * 9,
          bobSp: 0.5 + Math.random() * 0.8,
          bobPh: Math.random() * Math.PI * 2,
          tailSp: 6 + Math.random() * 4,
          tailPh: Math.random() * Math.PI * 2,
          turnAt: time + 4 + Math.random() * 8,
          baseSpeed,
        };
      });
      if (range > 120) {
        const stingrayDir: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
        const stingraySpeed = 16 + Math.random() * 12;
        state.fish.push({
          kind: "stingray",
          x: Math.random() * nextWidth,
          baseY: minY + range * (0.5 + Math.random() * 0.3),
          size: 170 + Math.random() * 70,
          vx: stingraySpeed * stingrayDir,
          dir: stingrayDir,
          pal: { body: "#6f829a", belly: "#d8e2e8", fin: "#56697f", stripe: null },
          bobAmp: 5 + Math.random() * 6,
          bobSp: 0.4 + Math.random() * 0.4,
          bobPh: Math.random() * Math.PI * 2,
          tailSp: 1.5 + Math.random(),
          tailPh: Math.random() * Math.PI * 2,
          turnAt: time + 5 + Math.random() * 8,
          baseSpeed: stingraySpeed,
        });

        const octopusDir: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
        const octopusSpeed = 9 + Math.random() * 7;
        state.fish.push({
          kind: "octopus",
          x: Math.random() * nextWidth,
          baseY: maxY - 6,
          size: 78 + Math.random() * 30,
          vx: octopusSpeed * octopusDir,
          dir: octopusDir,
          pal: { body: Math.random() < 0.5 ? "#b9536a" : "#9a5fb0", belly: "#ffd2e2", fin: "#8c405d", stripe: null },
          bobAmp: 4 + Math.random() * 4,
          bobSp: 0.4 + Math.random() * 0.4,
          bobPh: Math.random() * Math.PI * 2,
          tailSp: 1.5 + Math.random(),
          tailPh: Math.random() * Math.PI * 2,
          turnAt: time + 5 + Math.random() * 8,
          baseSpeed: octopusSpeed,
        });

        const squidDir: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
        const squidSpeed = 30 + Math.random() * 20;
        state.fish.push({
          kind: "squid",
          x: Math.random() * nextWidth,
          baseY: minY + range * (0.2 + Math.random() * 0.35),
          size: 96 + Math.random() * 40,
          vx: squidSpeed * squidDir,
          dir: squidDir,
          pal: { body: Math.random() < 0.5 ? "#e08aa0" : "#cf7d92", belly: "#ffd9e2", fin: "#bd6378", stripe: null },
          bobAmp: 3 + Math.random() * 4,
          bobSp: 0.4 + Math.random() * 0.4,
          bobPh: Math.random() * Math.PI * 2,
          tailSp: 1.5 + Math.random(),
          tailPh: Math.random() * Math.PI * 2,
          turnAt: time + 5 + Math.random() * 8,
          baseSpeed: squidSpeed,
        });
      }

      const plantColors = ["#2f7d4f", "#3f9b5c", "#5aa84a", "#2c8b6e", "#46925a"];
      state.plants = Array.from({ length: Math.max(5, Math.min(14, Math.floor(nextWidth / 130))) }, () => {
        const blades = 2 + Math.floor(Math.random() * 3);
        return {
          x: Math.random() * nextWidth,
          height: nextHeight * (0.16 + Math.random() * 0.26),
          color: plantColors[Math.floor(Math.random() * plantColors.length)],
          swaySp: 0.5 + Math.random() * 0.6,
          swayPh: Math.random() * Math.PI * 2,
          blades: Array.from({ length: blades }, () => ({
            off: (Math.random() - 0.5) * 26,
            hs: 0.7 + Math.random() * 0.5,
            wob: 0.6 + Math.random() * 0.5,
            wid: 4 + Math.random() * 4,
          })),
        };
      });

      state.bubbles = Array.from({ length: Math.max(14, Math.floor((nextWidth * nextHeight) / 42000)) }, () => ({
        x: Math.random() * nextWidth,
        y: Math.random() * nextHeight,
        r: 1.5 + Math.random() * 4.5,
        vy: 22 + Math.random() * 40,
        sway: 5 + Math.random() * 12,
        swaySp: 0.6 + Math.random() * 1,
        ph: Math.random() * Math.PI * 2,
      }));
      state.particles = Array.from({ length: Math.max(26, Math.floor((nextWidth * nextHeight) / 14000)) }, () => ({
        x: Math.random() * nextWidth,
        y: Math.random() * nextHeight,
        r: 0.5 + Math.random() * 1.4,
        vy: 3 + Math.random() * 8,
        sway: 3 + Math.random() * 7,
        swaySp: 0.3 + Math.random() * 0.5,
        ph: Math.random() * Math.PI * 2,
        a: 0.1 + Math.random() * 0.25,
      }));

      const pebbleColors = ["#b9a78a", "#9c8a6e", "#cdbb9c", "#8d7c63", "#d8c6a4", "#7d6f59"];
      state.pebbles = Array.from({ length: Math.max(40, Math.floor(nextWidth / 6)) }, () => ({
        x: Math.random() * nextWidth,
        y: floorY + Math.random() * (nextHeight - floorY),
        rx: 3 + Math.random() * 7,
        ry: 2 + Math.random() * 4,
        c: pebbleColors[Math.floor(Math.random() * pebbleColors.length)],
      }));
      state.floorY = floorY;
      state.minY = minY;
      state.maxY = maxY;
      state.last = time;
    };

    if (
      !state.fish
      || !state.plants
      || !state.bubbles
      || !state.particles
      || !state.pebbles
      || !state.floorY
      || !state.minY
      || !state.maxY
    ) {
      return;
    }

    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;
    const floorY = state.floorY;
    const minY = state.minY;
    const maxY = state.maxY;

    const water = ctx.createLinearGradient(0, 0, 0, height);
    water.addColorStop(0, "#1d6f86");
    water.addColorStop(0.32, "#155e7c");
    water.addColorStop(0.62, "#0d3f5e");
    water.addColorStop(1, "#07263d");
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, width, height);

    const surface = ctx.createLinearGradient(0, 0, 0, height * 0.22);
    surface.addColorStop(0, "rgba(190,235,255,0.30)");
    surface.addColorStop(1, "rgba(190,235,255,0)");
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, width, height * 0.22);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let x = 0; x <= width; x += 10) {
      const y = 5 + Math.sin(x / 46 + time * 1.6) * 2.5 + Math.sin(x / 17 - time * 2.2) * 1.4;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, 0);
    ctx.closePath();
    ctx.fillStyle = "rgba(220,245,255,0.5)";
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 5; i += 1) {
      const centerX = (width / 6) * (i + 1) + Math.sin(time * 0.2 + i * 1.7) * 40;
      const topW = 22 + 14 * Math.sin(time * 0.5 + i);
      const bottomW = topW * 5;
      const lean = Math.sin(time * 0.15 + i) * height * 0.12;
      const alpha = 0.05 + 0.04 * (0.5 + 0.5 * Math.sin(time * 0.6 + i * 2));
      const ray = ctx.createLinearGradient(centerX, 0, centerX + lean, height * 0.9);
      ray.addColorStop(0, `rgba(195,238,255,${alpha})`);
      ray.addColorStop(1, "rgba(195,238,255,0)");
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(centerX - topW / 2, 0);
      ctx.lineTo(centerX + topW / 2, 0);
      ctx.lineTo(centerX + lean + bottomW / 2, height * 0.9);
      ctx.lineTo(centerX + lean - bottomW / 2, height * 0.9);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    const drawPlant = (plant: AquariumPlant) => {
      const baseSway = Math.sin(time * plant.swaySp + plant.swayPh);
      for (const blade of plant.blades) {
        const baseX = plant.x + blade.off;
        const topX = baseX + baseSway * 24 * blade.wob;
        const topY = floorY - plant.height * blade.hs;
        ctx.beginPath();
        ctx.moveTo(baseX - blade.wid, floorY);
        ctx.quadraticCurveTo(baseX + baseSway * 10 * blade.wob, (floorY + topY) / 2, topX, topY);
        ctx.quadraticCurveTo(baseX + baseSway * 12 * blade.wob + blade.wid * 1.5, (floorY + topY) / 2, baseX + blade.wid, floorY);
        ctx.closePath();
        const plantGradient = ctx.createLinearGradient(baseX, floorY, topX, topY);
        plantGradient.addColorStop(0, "rgba(20,60,40,0.95)");
        plantGradient.addColorStop(1, plant.color);
        ctx.fillStyle = plantGradient;
        ctx.fill();
      }
    };
    for (const plant of state.plants) drawPlant(plant);

    const drawStingray = (fish: AquariumFish, size: number) => {
      const flap = Math.sin(time * 1.5 + fish.tailPh);
      ctx.beginPath();
      ctx.moveTo(size * 1.05, 0);
      ctx.quadraticCurveTo(size * 0.1, -size * (0.78 + 0.22 * flap), -size * 0.55, -size * 0.12);
      ctx.quadraticCurveTo(-size * 0.35, 0, -size * 0.55, size * 0.12);
      ctx.quadraticCurveTo(size * 0.1, size * (0.78 + 0.22 * flap), size * 1.05, 0);
      ctx.closePath();
      const body = ctx.createLinearGradient(0, -size, 0, size);
      body.addColorStop(0, "#6f829a");
      body.addColorStop(0.5, "#56697f");
      body.addColorStop(1, "#3f5167");
      ctx.fillStyle = body;
      ctx.fill();

      ctx.fillStyle = "rgba(208,224,240,0.5)";
      for (const [spotX, spotY] of [[-0.05, -0.2], [0.28, 0.08], [-0.2, 0.22], [0.08, -0.05]]) {
        ctx.beginPath();
        ctx.ellipse(size * spotX, size * spotY + flap * size * 0.08, size * 0.07, size * 0.05, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = "#46586d";
      ctx.lineWidth = size * 0.06;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-size * 0.5, 0);
      ctx.quadraticCurveTo(-size * 1.3, flap * size * 0.22, -size * 2.1, flap * size * 0.45);
      ctx.stroke();

      ctx.fillStyle = "#1a232c";
      for (const [eyeX, eyeY] of [[0.52, -0.13], [0.52, 0.13]]) {
        ctx.beginPath();
        ctx.arc(size * eyeX, size * eyeY, size * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawOctopus = (fish: AquariumFish, size: number) => {
      const color = fish.pal.body;
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      for (let index = 0; index < 8; index += 1) {
        const offset = index / 7 - 0.5;
        const phase = index * 0.8 + time * 3;
        ctx.lineWidth = size * 0.13 * (1 - Math.abs(offset) * 0.3);
        ctx.beginPath();
        ctx.moveTo(offset * size * 0.7, size * 0.18);
        ctx.quadraticCurveTo(
          offset * size * 0.7 - size * 0.2 + Math.sin(phase) * size * 0.12,
          size * 0.62,
          offset * size * 0.7 - size * 0.42 + Math.sin(phase + 1) * size * 0.18,
          size * 0.96 + Math.sin(phase) * size * 0.08,
        );
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.ellipse(0, -size * 0.12, size * 0.6, size * 0.72, 0, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.beginPath();
      ctx.ellipse(-size * 0.16, -size * 0.4, size * 0.24, size * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      for (const [eyeX, eyeY] of [[-0.22, -0.08], [0.22, -0.08]]) {
        ctx.beginPath();
        ctx.ellipse(size * eyeX, size * eyeY, size * 0.15, size * 0.12, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#1a232c";
      for (const [eyeX, eyeY] of [[-0.19, -0.06], [0.25, -0.06]]) {
        ctx.beginPath();
        ctx.ellipse(size * eyeX, size * eyeY, size * 0.06, size * 0.085, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawSquid = (fish: AquariumFish, size: number) => {
      const color = fish.pal.body;
      const wave = Math.sin(time * 4 + fish.tailPh);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-size * 0.95, -size * 0.16);
      ctx.lineTo(-size * 1.5, -size * 0.5 + wave * size * 0.08);
      ctx.lineTo(-size * 1.12, -size * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-size * 0.95, size * 0.16);
      ctx.lineTo(-size * 1.5, size * 0.5 + wave * size * 0.08);
      ctx.lineTo(-size * 1.12, size * 0.02);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(size * 0.45, -size * 0.28);
      ctx.quadraticCurveTo(size * 0.78, 0, size * 0.45, size * 0.28);
      ctx.quadraticCurveTo(-size * 0.4, size * 0.22, -size * 1.35, size * 0.05);
      ctx.quadraticCurveTo(-size * 1.5, 0, -size * 1.35, -size * 0.05);
      ctx.quadraticCurveTo(-size * 0.4, -size * 0.22, size * 0.45, -size * 0.28);
      ctx.closePath();
      const body = ctx.createLinearGradient(0, -size * 0.3, 0, size * 0.3);
      body.addColorStop(0, color);
      body.addColorStop(1, "rgba(255,255,255,0.55)");
      ctx.fillStyle = body;
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      for (let index = 0; index < 6; index += 1) {
        const offset = index / 5 - 0.5;
        const phase = index * 0.9 + time * 5;
        ctx.lineWidth = size * 0.055;
        ctx.beginPath();
        ctx.moveTo(size * 0.5, size * offset * 0.4);
        ctx.quadraticCurveTo(
          size * 0.92,
          size * offset * 0.5 + Math.sin(phase) * size * 0.06,
          size * 1.15 + Math.sin(phase) * size * 0.05,
          size * offset * 0.62 + Math.sin(phase + 1) * size * 0.05,
        );
        ctx.stroke();
      }

      ctx.lineWidth = size * 0.045;
      for (const offset of [-0.18, 0.18]) {
        ctx.beginPath();
        ctx.moveTo(size * 0.5, size * offset);
        ctx.quadraticCurveTo(size * 1.2, size * offset + Math.sin(time * 5) * size * 0.06, size * 1.55, size * offset * 1.4 + Math.sin(time * 5 + 1) * size * 0.08);
        ctx.stroke();
      }
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(size * 0.28, -size * 0.05, size * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1a232c";
      ctx.beginPath();
      ctx.arc(size * 0.3, -size * 0.05, size * 0.06, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawFish = (fish: AquariumFish) => {
      if (time >= fish.turnAt) {
        fish.dir = fish.dir === 1 ? -1 : 1;
        fish.vx = fish.baseSpeed * fish.dir;
        fish.turnAt = time + 5 + Math.random() * 10;
      }
      fish.x += fish.vx * dt;
      if (fish.x < -fish.size * 3) {
        fish.dir = 1;
        fish.vx = fish.baseSpeed;
        fish.x = -fish.size * 2;
      } else if (fish.x > width + fish.size * 3) {
        fish.dir = -1;
        fish.vx = -fish.baseSpeed;
        fish.x = width + fish.size * 2;
      }
      const y = Math.max(minY, Math.min(maxY, fish.baseY + Math.sin(time * fish.bobSp + fish.bobPh) * fish.bobAmp));
      const bodyLength = fish.size * 1.8;
      const bodyHeight = fish.size * 0.78;
      const tailWag = Math.sin(time * fish.tailSp + fish.tailPh) * fish.size * 0.18;

      ctx.save();
      ctx.translate(fish.x, y);
      ctx.scale(fish.dir, 1);
      ctx.rotate(Math.sin(time * fish.bobSp + fish.bobPh) * 0.04);

      ctx.fillStyle = "rgba(0,20,30,0.16)";
      ctx.beginPath();
      ctx.ellipse(0, fish.size * 0.55, fish.size * 1.05, fish.size * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();

      if (fish.kind === "stingray") {
        drawStingray(fish, fish.size);
        ctx.restore();
        return;
      }
      if (fish.kind === "octopus") {
        drawOctopus(fish, fish.size);
        ctx.restore();
        return;
      }
      if (fish.kind === "squid") {
        drawSquid(fish, fish.size);
        ctx.restore();
        return;
      }

      ctx.fillStyle = fish.pal.fin;
      ctx.beginPath();
      ctx.moveTo(-bodyLength * 0.52, 0);
      ctx.lineTo(-bodyLength * 0.9, -bodyHeight * 0.45 + tailWag);
      ctx.lineTo(-bodyLength * 0.86, bodyHeight * 0.45 + tailWag);
      ctx.closePath();
      ctx.fill();

      const bodyGradient = ctx.createLinearGradient(-bodyLength * 0.4, -bodyHeight * 0.45, bodyLength * 0.52, bodyHeight * 0.45);
      bodyGradient.addColorStop(0, fish.pal.body);
      bodyGradient.addColorStop(0.72, fish.pal.body);
      bodyGradient.addColorStop(1, fish.pal.belly);
      ctx.fillStyle = bodyGradient;
      ctx.beginPath();
      ctx.ellipse(0, 0, bodyLength * 0.52, bodyHeight * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = fish.pal.fin;
      ctx.beginPath();
      ctx.moveTo(-bodyLength * 0.05, -bodyHeight * 0.45);
      ctx.quadraticCurveTo(bodyLength * 0.16, -bodyHeight * 0.88, bodyLength * 0.3, -bodyHeight * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-bodyLength * 0.05, bodyHeight * 0.45);
      ctx.quadraticCurveTo(bodyLength * 0.12, bodyHeight * 0.76, bodyLength * 0.28, bodyHeight * 0.24);
      ctx.closePath();
      ctx.fill();

      if (fish.pal.stripe) {
        ctx.strokeStyle = fish.pal.stripe;
        ctx.lineWidth = Math.max(2, fish.size * 0.16);
        for (const stripeX of [-bodyLength * 0.2, bodyLength * 0.12]) {
          ctx.beginPath();
          ctx.moveTo(stripeX, -bodyHeight * 0.42);
          ctx.quadraticCurveTo(stripeX + bodyLength * 0.05, 0, stripeX, bodyHeight * 0.42);
          ctx.stroke();
        }
      }

      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.beginPath();
      ctx.arc(bodyLength * 0.32, -bodyHeight * 0.12, Math.max(1.4, fish.size * 0.08), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(bodyLength * 0.34, -bodyHeight * 0.14, Math.max(0.5, fish.size * 0.025), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    for (const fish of state.fish) drawFish(fish);

    const sand = ctx.createLinearGradient(0, floorY, 0, height);
    sand.addColorStop(0, "#bfae89");
    sand.addColorStop(1, "#7b6c52");
    ctx.fillStyle = sand;
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, floorY + 12);
    for (let x = 0; x <= width; x += width / 7) {
      ctx.quadraticCurveTo(x + width / 14, floorY + 4 + Math.sin(x * 0.01) * 5, x + width / 7, floorY + 12);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();

    for (const pebble of state.pebbles) {
      ctx.fillStyle = pebble.c;
      ctx.beginPath();
      ctx.ellipse(pebble.x, pebble.y, pebble.rx, pebble.ry, Math.sin(pebble.x) * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const particle of state.particles) {
      particle.y += particle.vy * dt;
      particle.x += Math.sin(time * particle.swaySp + particle.ph) * particle.sway * dt;
      if (particle.y > height + 2) {
        particle.y = -2;
        particle.x = Math.random() * width;
      }
      ctx.fillStyle = `rgba(220,245,245,${particle.a})`;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const bubble of state.bubbles) {
      bubble.y -= bubble.vy * dt;
      bubble.x += Math.sin(time * bubble.swaySp + bubble.ph) * bubble.sway * dt;
      if (bubble.y < -bubble.r * 2) {
        bubble.y = height + bubble.r;
        bubble.x = Math.random() * width;
      }
      const body = ctx.createRadialGradient(bubble.x - bubble.r * 0.3, bubble.y - bubble.r * 0.3, bubble.r * 0.1, bubble.x, bubble.y, bubble.r);
      body.addColorStop(0, "rgba(220,245,255,0.78)");
      body.addColorStop(0.6, "rgba(180,225,245,0.24)");
      body.addColorStop(1, "rgba(140,200,235,0)");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(bubble.x, bubble.y, bubble.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(220,245,255,0.42)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(bubble.x, bubble.y, bubble.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const glass = ctx.createLinearGradient(0, 0, width, 0);
    glass.addColorStop(0, "rgba(255,255,255,0.16)");
    glass.addColorStop(0.08, "rgba(255,255,255,0)");
    glass.addColorStop(0.92, "rgba(255,255,255,0)");
    glass.addColorStop(1, "rgba(255,255,255,0.12)");
    ctx.fillStyle = glass;
    ctx.fillRect(0, 0, width, height);
    const vignette = ctx.createRadialGradient(width * 0.5, height * 0.45, Math.min(width, height) * 0.2, width * 0.5, height * 0.45, Math.max(width, height) * 0.72);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,10,20,0.36)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" style={{ background: "#0b3f5e" }} />;
}

interface Taipei101Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  hue: number;
  sat: number;
  l: number;
  sz: number;
  trail: number[];
}

interface Taipei101SkylineBuilding {
  x: number;
  w: number;
  h: number;
}

interface Taipei101Tower {
  cx: number;
  base: number;
  segH: number;
  baseW: number;
}

interface Taipei101State extends CanvasAnimLifecycle {
  parts?: Taipei101Particle[];
  bucket?: number;
  last?: number;
  tower?: Taipei101Tower;
  skyline?: Taipei101SkylineBuilding[];
}

function Taipei101Bg() {
  const draw: CanvasDraw<Taipei101State> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      state.parts ??= [];
      state.bucket ??= -1;
      state.last = time;
      const segH = Math.max(20, Math.min(nextHeight * 0.074, nextWidth * 0.18));
      const baseW = Math.max(18, segH * 0.42);
      state.tower = { cx: nextWidth * 0.52, base: nextHeight + 1, segH, baseW };
      if (!state.skyline) {
        state.skyline = [];
        let x = 0;
        while (x < nextWidth) {
          const buildingWidth = 14 + Math.random() * 40;
          const buildingHeight = 20 + Math.random() * 60;
          state.skyline.push({ x, w: buildingWidth, h: buildingHeight });
          x += buildingWidth + 1;
        }
      }
    };
    if (!state.parts || !state.tower || !state.skyline) return;
    const dt = Math.max(0, Math.min(0.05, time - (state.last ?? time)));
    state.last = time;
    const tower = state.tower;
    const palette = [
      [200, 90, 65],
      [280, 90, 68],
      [340, 95, 68],
      [30, 95, 65],
      [50, 95, 70],
      [120, 80, 60],
    ] as const;
    const halfW = () => tower.baseW * 1.5;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#03050d");
    gradient.addColorStop(0.55, "#070d22");
    gradient.addColorStop(1, "#0c1432");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    const cityGlow = ctx.createLinearGradient(0, height * 0.65, 0, height);
    cityGlow.addColorStop(0, "rgba(255,180,100,0)");
    cityGlow.addColorStop(1, "rgba(255,180,100,0.25)");
    ctx.fillStyle = cityGlow;
    ctx.fillRect(0, height * 0.65, width, height * 0.35);

    for (const building of state.skyline) {
      const y = height - building.h;
      ctx.fillStyle = "#06090f";
      ctx.fillRect(building.x, y, building.w, building.h);
      const seed = Math.floor(building.x * 13.37) % 997;
      for (let row = 0; row < building.h / 6; row += 1) {
        for (let col = 0; col < building.w / 5; col += 1) {
          const k = (seed + row * 7 + col * 3) % 11;
          if (k < 4) {
            const flick = 0.5 + 0.5 * Math.abs(Math.sin(time * (0.4 + k * 0.1) + k));
            ctx.fillStyle = `hsla(${40 + k * 8},90%,70%,${flick * 0.65})`;
            ctx.fillRect(building.x + col * 5 + 1, y + row * 6 + 2, 1.8, 2);
          }
        }
      }
    }

    const towerFill = "#03070e";
    const towerStroke = "rgba(140,190,235,0.62)";
    const lightStroke = "rgba(185,235,255,0.72)";
    const windowLight = (seed: number) => {
      const flick = 0.55 + 0.45 * Math.sin(time * (0.8 + (seed % 5) * 0.11) + seed * 1.73);
      return `rgba(210,245,255,${0.35 + flick * 0.42})`;
    };
    const drawPath = (points: Array<[number, number]>, fill = towerFill, stroke = towerStroke) => {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.15;
      ctx.stroke();
    };
    const drawWindowGrid = (
      centerX: number,
      top: number,
      rows: number,
      cols: number,
      cellW: number,
      cellH: number,
      gapX: number,
      gapY: number,
      seedBase: number,
    ) => {
      const totalW = cols * cellW + (cols - 1) * gapX;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const seed = seedBase + row * 13 + col * 7;
          const lit = (seed % 9) !== 0;
          ctx.strokeStyle = lit ? windowLight(seed) : "rgba(80,125,150,0.32)";
          ctx.lineWidth = 0.72;
          ctx.strokeRect(
            centerX - totalW / 2 + col * (cellW + gapX),
            top + row * (cellH + gapY),
            cellW,
            cellH,
          );
        }
      }
    };

    const baseHeight = tower.segH * 1.72;
    const baseTop = tower.base - baseHeight;
    const baseBottomHalf = tower.baseW * 1.72;
    const baseTopHalf = tower.baseW * 1.28;
    drawPath([
      [tower.cx - baseBottomHalf, tower.base],
      [tower.cx + baseBottomHalf, tower.base],
      [tower.cx + baseTopHalf, baseTop],
      [tower.cx - baseTopHalf, baseTop],
    ]);
    ctx.strokeStyle = lightStroke;
    ctx.lineWidth = 0.85;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(tower.cx + side * baseBottomHalf * 0.52, tower.base - 3);
      ctx.lineTo(tower.cx + side * baseTopHalf * 0.62, baseTop + 8);
      ctx.stroke();
    }
    drawWindowGrid(tower.cx, baseTop + tower.segH * 0.22, 9, 3, tower.baseW * 0.26, 2.6, 3.3, 4.2, 320);
    for (let row = 0; row < 12; row += 1) {
      const y = baseTop + 8 + row * ((baseHeight - 18) / 12);
      ctx.strokeStyle = windowLight(430 + row);
      ctx.lineWidth = 0.72;
      for (const side of [-1, 1]) {
        ctx.strokeRect(tower.cx + side * tower.baseW * 0.65 - (side === 1 ? 0 : tower.baseW * 0.36), y, tower.baseW * 0.36, 2.4);
      }
    }
    const medallionY = baseTop + tower.segH * 0.1;
    ctx.fillStyle = "#07111d";
    ctx.strokeStyle = `rgba(220,245,255,${0.75 + 0.2 * Math.sin(time * 1.8)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(tower.cx, medallionY, tower.baseW * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    for (let i = 0; i < 8; i += 1) {
      const moduleBottom = baseTop - i * tower.segH;
      const moduleTop = moduleBottom - tower.segH * 1.14;
      const ledgeY = moduleBottom - tower.segH * 0.012;
      const halfTop = halfW();
      const halfBottom = halfTop * 0.76;
      const innerHalf = halfBottom * 0.64;
      const segmentGlow = 0.35 + 0.25 * Math.sin(time * 1.4 + i * 0.7);
      drawPath([
        [tower.cx - halfBottom, moduleBottom],
        [tower.cx + halfBottom, moduleBottom],
        [tower.cx + halfTop, moduleTop],
        [tower.cx - halfTop, moduleTop],
      ]);
      ctx.fillStyle = "#050810";
      ctx.fillRect(tower.cx - halfTop * 1.08, ledgeY, halfTop * 2.16, tower.segH * 0.055);
      ctx.strokeStyle = `rgba(125,200,255,${0.35 + segmentGlow * 0.34})`;
      ctx.lineWidth = 1.05;
      ctx.strokeRect(tower.cx - halfTop * 1.08, ledgeY, halfTop * 2.16, tower.segH * 0.055);
      for (const side of [-1, 1]) {
        ctx.strokeStyle = `rgba(175,235,255,${0.38 + segmentGlow * 0.28})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tower.cx + side * halfBottom * 1.06, moduleBottom - 2);
        ctx.lineTo(tower.cx + side * halfTop * 1.12, moduleTop + 2);
        ctx.moveTo(tower.cx + side * halfBottom * 0.9, moduleBottom - 2);
        ctx.lineTo(tower.cx + side * halfTop * 0.94, moduleTop + 2);
        ctx.stroke();
      }
      ctx.strokeStyle = `rgba(115,205,255,${0.32 + segmentGlow * 0.28})`;
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(tower.cx, moduleBottom - 3);
      ctx.lineTo(tower.cx, moduleTop + 6);
      ctx.stroke();
      drawWindowGrid(
        tower.cx,
        moduleTop + tower.segH * 0.29,
        7,
        6,
        innerHalf * 0.34,
        tower.segH * 0.052,
        innerHalf * 0.11,
        tower.segH * 0.04,
        500 + i * 41,
      );
      ctx.strokeStyle = `rgba(185,235,255,${0.42 + segmentGlow * 0.2})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(tower.cx - tower.baseW * 0.14, moduleBottom - tower.segH * 0.1);
      ctx.lineTo(tower.cx, moduleBottom - tower.segH * 0.16);
      ctx.lineTo(tower.cx + tower.baseW * 0.14, moduleBottom - tower.segH * 0.1);
      ctx.stroke();
    }
    const topY = baseTop - 8 * tower.segH;
    const crownGlow = 0.72 + 0.28 * Math.sin(time * 2.2);
    const crownHalf = tower.baseW * 0.82;
    const crownHeight = tower.segH * 0.82;
    const crownY = topY - crownHeight * 0.88;
    const crownHalo = ctx.createRadialGradient(tower.cx, crownY, 0, tower.cx, crownY, tower.segH * 2.3);
    crownHalo.addColorStop(0, `rgba(95,170,255,${0.32 * crownGlow})`);
    crownHalo.addColorStop(0.42, `rgba(70,130,255,${0.16 * crownGlow})`);
    crownHalo.addColorStop(1, "rgba(70,130,255,0)");
    ctx.fillStyle = crownHalo;
    ctx.beginPath();
    ctx.arc(tower.cx, crownY, tower.segH * 2.3, 0, Math.PI * 2);
    ctx.fill();
    drawPath(
      [
        [tower.cx - crownHalf * 0.78, topY],
        [tower.cx + crownHalf * 0.78, topY],
        [tower.cx + crownHalf, crownY],
        [tower.cx - crownHalf, crownY],
      ],
      "#081326",
      `rgba(160,215,255,${0.5 + crownGlow * 0.25})`,
    );
    ctx.fillStyle = `rgba(120,205,255,${0.55 + crownGlow * 0.25})`;
    ctx.fillRect(tower.cx - crownHalf * 0.54, crownY + crownHeight * 0.18, crownHalf * 1.08, 2);
    drawWindowGrid(tower.cx, crownY + crownHeight * 0.28, 4, 4, crownHalf * 0.24, 2.5, 2.5, 3.8, 900);
    const spireTop = crownY - tower.segH * 0.88;
    ctx.fillStyle = "#dbeeff";
    ctx.beginPath();
    ctx.moveTo(tower.cx - 2.2, crownY);
    ctx.lineTo(tower.cx + 2.2, crownY);
    ctx.lineTo(tower.cx + 0.75, spireTop);
    ctx.lineTo(tower.cx - 0.75, spireTop);
    ctx.closePath();
    ctx.fill();
    const tipGlow = ctx.createRadialGradient(tower.cx, spireTop - 4, 0, tower.cx, spireTop - 4, tower.segH * 0.75);
    tipGlow.addColorStop(0, `rgba(255,220,120,${0.92 * crownGlow})`);
    tipGlow.addColorStop(0.45, `rgba(255,110,45,${0.38 * crownGlow})`);
    tipGlow.addColorStop(1, "rgba(255,110,45,0)");
    ctx.fillStyle = tipGlow;
    ctx.beginPath();
    ctx.arc(tower.cx, spireTop - 4, tower.segH * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,205,95,${0.86 + crownGlow * 0.14})`;
    ctx.beginPath();
    ctx.arc(tower.cx, spireTop - 4, 2.2, 0, Math.PI * 2);
    ctx.fill();

    const bucket = Math.floor(time / 0.45);
    if (bucket !== state.bucket) {
      state.bucket = bucket;
      const slot = bucket % 10;
      const [hue, sat, lit] = palette[Math.floor(bucket / 10) % palette.length];
      const addParticle = (particle: Omit<Taipei101Particle, "trail">) => {
        state.parts!.push({ ...particle, trail: [] });
      };
      const fireSegment = (segmentIndex: number, intensity: number) => {
        const cy = baseTop - (segmentIndex + 0.42) * tower.segH;
        const halfWidth = halfW();
        const count = Math.floor(18 * intensity);
        for (const side of [-1, 1]) {
          const originX = tower.cx + side * halfWidth;
          for (let i = 0; i < count; i += 1) {
            const baseAngle = side === 1 ? 0 : Math.PI;
            const angle = baseAngle + (Math.random() - 0.5) * Math.PI * 0.55;
            const velocity = (90 + Math.random() * 140) * intensity;
            addParticle({
              x: originX + side * Math.random() * 4,
              y: cy + (Math.random() - 0.5) * tower.segH * 0.6,
              vx: Math.cos(angle) * velocity,
              vy: Math.sin(angle) * velocity - 20,
              life: 0,
              ttl: 1.6 + Math.random() * 1.2,
              hue: hue + (Math.random() - 0.5) * 20,
              sat,
              l: lit + (Math.random() - 0.5) * 10,
              sz: 1 + Math.random() * 1.4,
            });
          }
        }
      };
      const fireSpire = () => {
        const cy = spireTop - 4;
        for (let i = 0; i < 32; i += 1) {
          const angle = (i / 32) * Math.PI * 2 + Math.random() * 0.15;
          const velocity = 110 + Math.random() * 100;
          addParticle({
            x: tower.cx,
            y: cy,
            vx: Math.cos(angle) * velocity,
            vy: Math.sin(angle) * velocity - 30,
            life: 0,
            ttl: 1.8 + Math.random() * 1,
            hue: hue + (Math.random() - 0.5) * 16,
            sat,
            l: lit,
            sz: 1.2 + Math.random() * 1.4,
          });
        }
      };
      const fireSkyBurst = (count: number) => {
        const side = Math.random() > 0.5 ? 1 : -1;
        const x = tower.cx + side * (tower.baseW * 3.8 + Math.random() * width * 0.26);
        const y = height * (0.15 + Math.random() * 0.38);
        for (let i = 0; i < count; i += 1) {
          const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.22;
          const velocity = 55 + Math.random() * 145;
          addParticle({
            x,
            y,
            vx: Math.cos(angle) * velocity,
            vy: Math.sin(angle) * velocity,
            life: 0,
            ttl: 1.3 + Math.random() * 1.1,
            hue: hue + (Math.random() - 0.5) * 34,
            sat,
            l: lit + (Math.random() - 0.5) * 12,
            sz: 0.9 + Math.random() * 1.2,
          });
        }
      };
      if (slot < 8) {
        fireSegment(slot, 1);
        fireSegment((slot + 3) % 8, 0.6);
        fireSegment((slot + 5) % 8, 0.6);
      } else {
        fireSpire();
        fireSegment(6, 0.8);
        fireSegment(7, 0.8);
      }
      if (slot === 1 || slot === 4 || slot === 8 || Math.random() < 0.24) {
        fireSkyBurst(32 + Math.floor(Math.random() * 22));
      }
    }

    ctx.globalCompositeOperation = "lighter";
    const nextParts: Taipei101Particle[] = [];
    for (const particle of state.parts) {
      if (particle.life >= particle.ttl) continue;
      particle.trail.push(particle.x, particle.y);
      if (particle.trail.length > 14) {
        particle.trail.shift();
        particle.trail.shift();
      }
      particle.life += dt;
      particle.vy += 110 * dt;
      particle.vx *= 1 - dt * 0.55;
      particle.vy *= 1 - dt * 0.12;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      const k = Math.max(0, 1 - particle.life / particle.ttl);
      const alpha = Math.min(1, k * 1.5);
      if (particle.trail.length >= 4) {
        ctx.strokeStyle = `hsla(${particle.hue},${particle.sat}%,${particle.l}%,${alpha * 0.55})`;
        ctx.lineWidth = particle.sz * 0.9;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(particle.trail[0], particle.trail[1]);
        for (let i = 2; i < particle.trail.length; i += 2) ctx.lineTo(particle.trail[i], particle.trail[i + 1]);
        ctx.stroke();
      }
      const head = ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, particle.sz * 5);
      head.addColorStop(0, `hsla(${particle.hue},${particle.sat}%,${Math.min(95, particle.l + 25)}%,${alpha})`);
      head.addColorStop(0.4, `hsla(${particle.hue},${particle.sat}%,${particle.l}%,${alpha * 0.55})`);
      head.addColorStop(1, `hsla(${particle.hue},${particle.sat}%,${Math.max(0, particle.l - 20)}%,0)`);
      ctx.fillStyle = head;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.sz * 5, 0, Math.PI * 2);
      ctx.fill();
      nextParts.push(particle);
    }
    state.parts = nextParts;
    ctx.globalCompositeOperation = "source-over";
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface Lantern {
  x: number;
  y: number;
  depth: number;
  vy: number;
  sway: number;
  swaySp: number;
  ph: number;
  flick: number;
  flickSp: number;
}

interface Point {
  x: number;
  y: number;
}

interface LanternsState extends CanvasAnimLifecycle {
  lanterns?: Lantern[];
  mountain?: Point[];
  last?: number;
}

function LanternsBg() {
  function spawn(width: number, height: number, seed: boolean, flick?: number, flickSp?: number): Lantern {
    const depth = 0.3 + Math.random() * 0.7;
    return {
      x: Math.random() * width,
      y: seed ? Math.random() * height : height + 20,
      depth,
      vy: 14 + depth * 30,
      sway: 6 + Math.random() * 14,
      swaySp: 0.3 + Math.random() * 0.6,
      ph: Math.random() * 6.28,
      flick: flick ?? Math.random() * 6.28,
      flickSp: flickSp ?? 0.6 + Math.random() * 1.6,
    };
  }

  const draw: CanvasDraw<LanternsState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      const count = Math.max(18, Math.min(50, Math.floor((nextWidth * nextHeight) / 28000)));
      state.lanterns = Array.from({ length: count }, () => spawn(nextWidth, nextHeight, true));
      state.mountain = [];
      let mountainX = 0;
      while (mountainX <= nextWidth + 20) {
        const y = nextHeight * 0.78 + (Math.random() - 0.5) * nextHeight * 0.06;
        state.mountain.push({ x: mountainX, y });
        mountainX += 18 + Math.random() * 30;
      }
      state.last = time;
    };
    if (!state.lanterns || !state.mountain) return;
    const dt = Math.min(0.05, time - (state.last ?? time));
    state.last = time;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#0a0a1c");
    gradient.addColorStop(0.45, "#1c1a3a");
    gradient.addColorStop(0.75, "#3a2a4a");
    gradient.addColorStop(1, "#5a3a4a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const moonX = width * 0.85;
    const moonY = height * 0.18;
    const moonGlow = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, Math.max(width, height) * 0.4);
    moonGlow.addColorStop(0, "rgba(255,235,200,0.30)");
    moonGlow.addColorStop(1, "rgba(255,235,200,0)");
    ctx.fillStyle = moonGlow;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255,240,210,0.85)";
    ctx.beginPath();
    ctx.arc(moonX, moonY, 18, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 40; i += 1) {
      const starX = (i * 137.5) % width;
      const starY = (i * 73.3) % (height * 0.55);
      const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(time * (0.5 + i * 0.07) + i));
      ctx.fillStyle = `rgba(255,250,230,${twinkle * 0.7})`;
      ctx.fillRect(starX, starY, 1.2, 1.2);
    }

    for (const lantern of state.lanterns) {
      lantern.y -= lantern.vy * dt;
      lantern.x += Math.sin(time * lantern.swaySp + lantern.ph) * lantern.sway * dt;
      if (lantern.y < -40) {
        Object.assign(lantern, spawn(width, height, false, lantern.flick, lantern.flickSp));
      }
      const size = 8 + lantern.depth * 22;
      const flick = 0.7 + 0.3 * Math.sin(time * lantern.flickSp + lantern.flick);
      const halo = ctx.createRadialGradient(lantern.x, lantern.y, 0, lantern.x, lantern.y, size * 3);
      halo.addColorStop(0, `rgba(255,180,90,${0.55 * flick * lantern.depth})`);
      halo.addColorStop(0.5, `rgba(255,140,60,${0.15 * flick * lantern.depth})`);
      halo.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(lantern.x, lantern.y, size * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(60,40,20,${0.5 * lantern.depth})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(lantern.x, lantern.y + size * 0.6);
      ctx.lineTo(lantern.x - 1, lantern.y + size * 1.1);
      ctx.stroke();
      const body = ctx.createLinearGradient(lantern.x, lantern.y - size * 0.6, lantern.x, lantern.y + size * 0.6);
      body.addColorStop(0, `hsla(20,90%,70%,${0.95 * flick})`);
      body.addColorStop(0.5, `hsla(30,95%,60%,${flick})`);
      body.addColorStop(1, `hsla(15,90%,45%,${0.95 * flick})`);
      ctx.fillStyle = body;
      const bodyWidth = size * 0.7;
      const bodyHeight = size;
      ctx.beginPath();
      ctx.moveTo(lantern.x - bodyWidth * 0.85, lantern.y - bodyHeight * 0.45);
      ctx.lineTo(lantern.x + bodyWidth * 0.85, lantern.y - bodyHeight * 0.45);
      ctx.lineTo(lantern.x + bodyWidth, lantern.y);
      ctx.lineTo(lantern.x + bodyWidth * 0.85, lantern.y + bodyHeight * 0.45);
      ctx.lineTo(lantern.x - bodyWidth * 0.85, lantern.y + bodyHeight * 0.45);
      ctx.lineTo(lantern.x - bodyWidth, lantern.y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(80,40,20,${0.7 * lantern.depth})`;
      ctx.fillRect(lantern.x - bodyWidth * 0.55, lantern.y - bodyHeight * 0.5, bodyWidth * 1.1, 1.5);
      ctx.fillRect(lantern.x - bodyWidth * 0.55, lantern.y + bodyHeight * 0.45 - 0.5, bodyWidth * 1.1, 1.5);
      ctx.fillStyle = `hsla(45,100%,85%,${0.7 * flick})`;
      ctx.beginPath();
      ctx.arc(lantern.x, lantern.y, size * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#0c0a1a";
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (const point of state.mountain) ctx.lineTo(point.x, point.y);
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface RiceStalk {
  x: number;
  ph: number;
  len: number;
  tilt: number;
}

interface RiceBand {
  y: number;
  k: number;
  stalks: RiceStalk[];
}

interface RicefieldState extends CanvasAnimLifecycle {
  bands?: RiceBand[];
  mountain?: Point[];
  last?: number;
}

function RicefieldBg() {
  const draw: CanvasDraw<RicefieldState> = (ctx, width, height, time, state) => {
    state.onResize = (nextWidth, nextHeight) => {
      state.bands = [];
      const horizon = nextHeight * 0.45;
      const bandCount = 14;
      for (let i = 0; i < bandCount; i += 1) {
        const k = i / (bandCount - 1);
        const y = horizon + (nextHeight - horizon) * (0.05 + k * 0.95);
        const density = Math.floor(nextWidth / (8 - k * 4));
        const stalks = Array.from({ length: density }, () => ({
          x: Math.random() * nextWidth,
          ph: Math.random() * 6.28,
          len: 6 + (1 - k) * 16,
          tilt: (Math.random() - 0.5) * 0.4,
        }));
        state.bands!.push({ y, k, stalks });
      }
      state.mountain = [];
      let mountainX = 0;
      while (mountainX <= nextWidth + 20) {
        state.mountain.push({ x: mountainX, y: nextHeight * (0.4 + (Math.random() - 0.5) * 0.04) });
        mountainX += 30 + Math.random() * 50;
      }
      state.last = time;
    };
    if (!state.bands || !state.mountain) return;
    state.last = time;

    const sky = ctx.createLinearGradient(0, 0, 0, height * 0.5);
    sky.addColorStop(0, "#e8f0d4");
    sky.addColorStop(0.5, "#f4e2b0");
    sky.addColorStop(1, "#f6cc88");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height * 0.5);

    const sunX = width * 0.7;
    const sunY = height * 0.22;
    const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(width, height) * 0.5);
    sunGlow.addColorStop(0, "rgba(255,235,180,0.55)");
    sunGlow.addColorStop(1, "rgba(255,235,180,0)");
    ctx.fillStyle = sunGlow;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255,245,210,0.95)";
    ctx.beginPath();
    ctx.arc(sunX, sunY, 24, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(120,140,110,0.55)";
    ctx.beginPath();
    ctx.moveTo(0, height * 0.5);
    for (const point of state.mountain) ctx.lineTo(point.x, point.y);
    ctx.lineTo(width, height * 0.5);
    ctx.closePath();
    ctx.fill();

    const field = ctx.createLinearGradient(0, height * 0.42, 0, height);
    field.addColorStop(0, "#caa64a");
    field.addColorStop(0.4, "#d8b54a");
    field.addColorStop(1, "#7a6020");
    ctx.fillStyle = field;
    ctx.fillRect(0, height * 0.42, width, height * 0.58);

    for (const band of state.bands) {
      const amp = 6 + band.k * 22;
      const wavelength = 80 + band.k * 60;
      const speed = 0.6 + band.k * 0.8;
      const hue = 38 + band.k * 6;
      const sat = 70 - band.k * 10;
      const lit = 65 - band.k * 30;
      for (const stalk of band.stalks) {
        const sway = Math.sin((stalk.x / wavelength) - time * speed + stalk.ph) * amp * 0.18 + stalk.tilt * 4;
        const topX = stalk.x + sway;
        const topY = band.y - stalk.len;
        ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${lit}%, ${0.55 + band.k * 0.4})`;
        ctx.lineWidth = 0.9 + band.k * 0.6;
        ctx.beginPath();
        ctx.moveTo(stalk.x, band.y);
        ctx.lineTo(topX, topY);
        ctx.stroke();
        ctx.fillStyle = `hsla(${hue + 8}, 90%, 75%, ${0.7 + band.k * 0.3})`;
        ctx.beginPath();
        ctx.arc(topX, topY, 0.9 + band.k * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const breezeY = height * 0.55 + Math.sin(time * 0.4) * height * 0.05;
    const breeze = ctx.createLinearGradient(0, breezeY - 30, 0, breezeY + 30);
    breeze.addColorStop(0, "rgba(255,230,150,0)");
    breeze.addColorStop(0.5, "rgba(255,235,170,0.18)");
    breeze.addColorStop(1, "rgba(255,230,150,0)");
    ctx.fillStyle = breeze;
    ctx.fillRect(0, breezeY - 30, width, 60);
  };
  const ref = useCanvasAnim(draw);
  return <canvas ref={ref} className="dw-dynamic-bg-canvas" />;
}

interface ParticleCursorPoint {
  x: number;
  y: number;
  ox: number;
  oy: number;
  dist: number;
  phase: number;
  scale: number;
  opacity: number;
  lightness: number;
}

function useParticleCursorAnim() {
  const active = useDashboardAnimationActive();
  const ref = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  const runtimeRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  useEffect(() => {
    const canvasElement = ref.current;
    const parentElement = canvasElement?.parentElement;
    if (!canvasElement || !parentElement) return;
    const context = canvasElement.getContext("2d");
    if (!context) return;

    const canvas = canvasElement;
    const parent = parentElement;
    const ctx = context;
    const rows = 13;
    const center = (rows - 1) / 2;
    const maxGridDist = Math.hypot(center, center);
    const dpr = dynamicBackgroundDevicePixelRatio(window.devicePixelRatio);

    let raf = 0;
    let width = 0;
    let height = 0;
    let targetX = 0;
    let targetY = 0;
    let cursorX = 0;
    let cursorY = 0;
    let elapsed = 0;
    let lastNow = 0;
    let idleUntil = 0;
    let pulseStart = -10;
    let points: ParticleCursorPoint[] = [];

    function resize() {
      const rect = parent.getBoundingClientRect();
      width = Math.max(2, Math.floor(rect.width));
      height = Math.max(2, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const spacing = Math.max(7, Math.min(16, Math.min(width, height) / 54));
      targetX = cursorX = width / 2;
      targetY = cursorY = height / 2;
      points = [];
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < rows; col += 1) {
          const gx = col - center;
          const gy = row - center;
          const dist = Math.hypot(gx, gy);
          const k = 1 - dist / maxGridDist;
          points.push({
            x: cursorX + gx * spacing,
            y: cursorY + gy * spacing,
            ox: gx * spacing,
            oy: gy * spacing,
            dist,
            phase: Math.random() * Math.PI * 2,
            scale: 2 + k * 3,
            opacity: 0.1 + k * 0.9,
            lightness: 20 + k * 60,
          });
        }
      }
      points.sort((a, b) => b.dist - a.dist);
      pulseStart = elapsed;
    }

    function nudgePulse() {
      if (elapsed - pulseStart > 0.75) {
        pulseStart = elapsed;
      }
    }

    function followPointer(event: PointerEvent) {
      if (event.buttons !== 0) return;
      const rect = parent.getBoundingClientRect();
      targetX = Math.max(0, Math.min(width, event.clientX - rect.left));
      targetY = Math.max(0, Math.min(height, event.clientY - rect.top));
      idleUntil = performance.now() + 1500;
      nudgePulse();
    }

    function draw(now: number) {
      const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.05) : 0;
      lastNow = now;
      elapsed += dt;

      if (performance.now() > idleUntil) {
        targetX = width * (0.5 + Math.sin(elapsed * 0.9) * 0.28 + Math.sin(elapsed * 0.17) * 0.12);
        targetY = height * (0.5 + Math.cos(elapsed * 0.72) * 0.24 + Math.sin(elapsed * 0.31) * 0.10);
        if (elapsed - pulseStart > 3.2) pulseStart = elapsed;
      }

      cursorX += (targetX - cursorX) * Math.min(1, dt * 4.8);
      cursorY += (targetY - cursorY) * Math.min(1, dt * 4.8);

      const bg = ctx.createRadialGradient(cursorX, cursorY, 0, cursorX, cursorY, Math.max(width, height) * 0.85);
      bg.addColorStop(0, "rgba(126, 24, 18, 0.62)");
      bg.addColorStop(0.38, "rgba(48, 12, 18, 0.86)");
      bg.addColorStop(1, "rgba(8, 8, 14, 1)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const vignette = ctx.createLinearGradient(0, 0, width, height);
      vignette.addColorStop(0, "rgba(255, 160, 120, 0.12)");
      vignette.addColorStop(0.5, "rgba(255, 80, 68, 0)");
      vignette.addColorStop(1, "rgba(0, 0, 0, 0.35)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = "lighter";
      const pulseAge = elapsed - pulseStart;
      for (const point of points) {
        const lag = 0.05 + point.dist * 0.018;
        const follow = 1 - Math.exp(-dt / lag);
        const wobble = Math.sin(elapsed * 1.8 + point.phase) * (1.4 + point.dist * 0.12);
        const wantedX = cursorX + point.ox + Math.cos(point.phase) * wobble;
        const wantedY = cursorY + point.oy + Math.sin(point.phase) * wobble;
        point.x += (wantedX - point.x) * follow;
        point.y += (wantedY - point.y) * follow;

        const wave = Math.max(0, 1 - Math.abs(pulseAge - point.dist * 0.055) / 0.16);
        const scale = point.scale + wave * 2.2;
        const alpha = Math.min(1, point.opacity + wave * 0.65);
        const radius = scale * 1.55;
        const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 4.6);
        glow.addColorStop(0, `hsla(4, 78%, ${Math.min(86, point.lightness + wave * 18)}%, ${alpha})`);
        glow.addColorStop(0.42, `hsla(4, 72%, ${point.lightness}%, ${alpha * 0.42})`);
        glow.addColorStop(1, "hsla(4, 70%, 20%, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius * 4.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `hsla(4, 74%, ${Math.min(88, point.lightness + wave * 20)}%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      raf = activeRef.current ? requestAnimationFrame(draw) : 0;
    }

    function start() {
      if (raf || !activeRef.current) return;
      lastNow = 0;
      raf = requestAnimationFrame(draw);
    }

    function stop() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      lastNow = 0;
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);
    resize();
    document.addEventListener("pointermove", followPointer, { passive: true });
    runtimeRef.current = { start, stop };
    if (activeRef.current) start();

    return () => {
      stop();
      resizeObserver.disconnect();
      document.removeEventListener("pointermove", followPointer);
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    activeRef.current = active;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (active) runtime.start();
    else runtime.stop();
  }, [active]);

  return ref;
}

function ParticleCursorBg() {
  const ref = useParticleCursorAnim();
  return <canvas ref={ref} className="dw-dynamic-bg-canvas dw-dynamic-bg-canvas-particle-cursor" />;
}

const DYNAMIC_BACKGROUND_COMPONENTS = {
  fuji: FujiBg,
  aurora: AuroraBg,
  halftone: HalftoneBg,
  clouds: CloudsBg,
  ocean: OceanBg,
  mistySea: MistySeaBg,
  maelstrom: MaelstromBg,
  sunGlitter: SunGlitterBg,
  whitecaps: WhitecapsBg,
  waveField: WaveFieldBg,
  openOceanBlue: OpenOceanBlueBg,
  tropicalGreen: TropicalGreenBg,
  waters: WatersBg,
  raindrops: RaindropsBg,
  rainywindow: RainyWindowBg,
  frostedWindow: FrostedWindowBg,
  snow: SnowBg,
  sakura: SakuraBg,
  fireflies: FirefliesBg,
  bubbles: BubblesBg,
  aquarium: AquariumBg,
  jellyfish: JellyfishBg,
  lighthouse: LighthouseBg,
  balloons: BalloonsBg,
  ricefield: RicefieldBg,
  lanterns: LanternsBg,
  starfield: StarfieldBg,
  nebula: NebulaBg,
  orbitals: OrbitalsBg,
  embers: EmbersBg,
  lava: LavaBg,
  ink: InkBg,
  dunes: DunesBg,
  savanna: SavannaBg,
  matrix: MatrixBg,
  topo: TopoBg,
  synthwave: SynthwaveBg,
  circuit: CircuitBg,
  crystals: CrystalsBg,
  cyberpunk: CyberpunkBg,
  taipei101: Taipei101Bg,
  thunderstorm: ThunderstormBg,
  confetti: ConfettiBg,
  particleCursor: ParticleCursorBg,
  heroGeometric: HeroGeometricBg,
  ditherPrismHero: DitherPrismHeroBg,
  webglLiquid: WebGLLiquidBg,
  silkAurora: SilkAuroraBg,
  closingPlasma: ClosingPlasmaBg,
  animatedGradient: AnimatedGradientBg,
  prismGradient: PrismGradientBg,
  liquidChrome: LiquidChromeBg,
  windowRain: WindowRainBg,
  submergedSnellOcean: SubmergedSnellOceanBg,
  spectralCascadeOcean: SpectralCascadeOceanBg,
  blackHole: BlackHoleBg,
} satisfies Record<string, ComponentType>;

export type DynamicBackgroundId = keyof typeof DYNAMIC_BACKGROUND_COMPONENTS;
type DynamicBackgroundMood = "calm" | "spacey" | "warm" | "geeky" | "erratic";

export const DYNAMIC_BACKGROUNDS: readonly {
  id: DynamicBackgroundId;
  labelKey: string;
  mood: DynamicBackgroundMood;
}[] = [
  { id: "fuji", labelKey: "dashboard.dynamicBackgrounds.fuji", mood: "calm" },
  { id: "aurora", labelKey: "dashboard.dynamicBackgrounds.aurora", mood: "calm" },
  { id: "halftone", labelKey: "dashboard.dynamicBackgrounds.halftone", mood: "calm" },
  { id: "clouds", labelKey: "dashboard.dynamicBackgrounds.clouds", mood: "calm" },
  { id: "ocean", labelKey: "dashboard.dynamicBackgrounds.ocean", mood: "calm" },
  { id: "mistySea", labelKey: "dashboard.dynamicBackgrounds.mistySea", mood: "calm" },
  { id: "maelstrom", labelKey: "dashboard.dynamicBackgrounds.maelstrom", mood: "erratic" },
  { id: "sunGlitter", labelKey: "dashboard.dynamicBackgrounds.sunGlitter", mood: "warm" },
  { id: "whitecaps", labelKey: "dashboard.dynamicBackgrounds.whitecaps", mood: "erratic" },
  { id: "waveField", labelKey: "dashboard.dynamicBackgrounds.waveField", mood: "calm" },
  { id: "openOceanBlue", labelKey: "dashboard.dynamicBackgrounds.openOceanBlue", mood: "calm" },
  { id: "tropicalGreen", labelKey: "dashboard.dynamicBackgrounds.tropicalGreen", mood: "calm" },
  { id: "waters", labelKey: "dashboard.dynamicBackgrounds.waters", mood: "calm" },
  { id: "raindrops", labelKey: "dashboard.dynamicBackgrounds.raindrops", mood: "calm" },
  { id: "rainywindow", labelKey: "dashboard.dynamicBackgrounds.rainyWindow", mood: "calm" },
  { id: "frostedWindow", labelKey: "dashboard.dynamicBackgrounds.frostedWindow", mood: "calm" },
  { id: "snow", labelKey: "dashboard.dynamicBackgrounds.snow", mood: "calm" },
  { id: "sakura", labelKey: "dashboard.dynamicBackgrounds.sakura", mood: "calm" },
  { id: "fireflies", labelKey: "dashboard.dynamicBackgrounds.fireflies", mood: "calm" },
  { id: "bubbles", labelKey: "dashboard.dynamicBackgrounds.bubbles", mood: "calm" },
  { id: "aquarium", labelKey: "dashboard.dynamicBackgrounds.aquarium", mood: "calm" },
  { id: "jellyfish", labelKey: "dashboard.dynamicBackgrounds.jellyfish", mood: "calm" },
  { id: "lighthouse", labelKey: "dashboard.dynamicBackgrounds.lighthouse", mood: "calm" },
  { id: "balloons", labelKey: "dashboard.dynamicBackgrounds.balloons", mood: "calm" },
  { id: "ricefield", labelKey: "dashboard.dynamicBackgrounds.ricefield", mood: "calm" },
  { id: "lanterns", labelKey: "dashboard.dynamicBackgrounds.lanterns", mood: "calm" },
  { id: "heroGeometric", labelKey: "dashboard.dynamicBackgrounds.heroGeometric", mood: "calm" },
  { id: "webglLiquid", labelKey: "dashboard.dynamicBackgrounds.webglLiquid", mood: "calm" },
  { id: "silkAurora", labelKey: "dashboard.dynamicBackgrounds.silkAurora", mood: "calm" },
  { id: "animatedGradient", labelKey: "dashboard.dynamicBackgrounds.animatedGradient", mood: "calm" },
  { id: "starfield", labelKey: "dashboard.dynamicBackgrounds.starfield", mood: "spacey" },
  { id: "nebula", labelKey: "dashboard.dynamicBackgrounds.nebula", mood: "spacey" },
  { id: "orbitals", labelKey: "dashboard.dynamicBackgrounds.orbitals", mood: "spacey" },
  { id: "ditherPrismHero", labelKey: "dashboard.dynamicBackgrounds.ditherPrismHero", mood: "spacey" },
  { id: "closingPlasma", labelKey: "dashboard.dynamicBackgrounds.closingPlasma", mood: "spacey" },
  { id: "prismGradient", labelKey: "dashboard.dynamicBackgrounds.prismGradient", mood: "spacey" },
  { id: "embers", labelKey: "dashboard.dynamicBackgrounds.embers", mood: "warm" },
  { id: "lava", labelKey: "dashboard.dynamicBackgrounds.lava", mood: "warm" },
  { id: "ink", labelKey: "dashboard.dynamicBackgrounds.ink", mood: "warm" },
  { id: "dunes", labelKey: "dashboard.dynamicBackgrounds.dunes", mood: "warm" },
  { id: "savanna", labelKey: "dashboard.dynamicBackgrounds.savanna", mood: "warm" },
  { id: "matrix", labelKey: "dashboard.dynamicBackgrounds.matrix", mood: "geeky" },
  { id: "topo", labelKey: "dashboard.dynamicBackgrounds.topo", mood: "geeky" },
  { id: "synthwave", labelKey: "dashboard.dynamicBackgrounds.synthwave", mood: "geeky" },
  { id: "circuit", labelKey: "dashboard.dynamicBackgrounds.circuit", mood: "geeky" },
  { id: "crystals", labelKey: "dashboard.dynamicBackgrounds.crystals", mood: "geeky" },
  { id: "cyberpunk", labelKey: "dashboard.dynamicBackgrounds.cyberpunk", mood: "erratic" },
  { id: "taipei101", labelKey: "dashboard.dynamicBackgrounds.taipei101", mood: "erratic" },
  { id: "thunderstorm", labelKey: "dashboard.dynamicBackgrounds.thunderstorm", mood: "erratic" },
  { id: "confetti", labelKey: "dashboard.dynamicBackgrounds.confetti", mood: "erratic" },
  { id: "particleCursor", labelKey: "dashboard.dynamicBackgrounds.particleCursor", mood: "erratic" },
  { id: "liquidChrome", labelKey: "dashboard.dynamicBackgrounds.liquidChrome", mood: "erratic" },
  { id: "windowRain", labelKey: "dashboard.dynamicBackgrounds.windowRain", mood: "calm" },
  { id: "submergedSnellOcean", labelKey: "dashboard.dynamicBackgrounds.submergedSnellOcean", mood: "calm" },
  { id: "spectralCascadeOcean", labelKey: "dashboard.dynamicBackgrounds.spectralCascadeOcean", mood: "erratic" },
  { id: "blackHole", labelKey: "dashboard.dynamicBackgrounds.blackHole", mood: "spacey" },
];

export function isDynamicBackgroundId(value: string): value is DynamicBackgroundId {
  return value in DYNAMIC_BACKGROUND_COMPONENTS;
}

export function getDashboardDynamicBackgroundHostClassName() {
  return "dw-canvas-bg dw-dynamic-bg-layer";
}

export function DashboardDynamicBackground({ id, active }: { id: string; active: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onScreen = useElementOnScreen(hostRef);
  if (!isDynamicBackgroundId(id)) return null;
  const Component = DYNAMIC_BACKGROUND_COMPONENTS[id];
  return (
    <div ref={hostRef} className={getDashboardDynamicBackgroundHostClassName()} aria-hidden="true">
      <DashboardAnimationGate active={active && onScreen}>
        <Component />
      </DashboardAnimationGate>
    </div>
  );
}
