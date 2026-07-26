import type { CSSProperties, ReactNode } from "react";
import { useDashboardAnimationActive } from "../view/animationGating";
import { AnimatedGradient } from "./componentry/animated-gradient";
import ClosingPlasma from "./componentry/closing-plasma";
import DitherPrismHero from "./componentry/dither-prism-hero";
import HeroGeometric from "./componentry/hero-geometric";
import { LiquidChrome } from "./componentry/liquid-chrome";
import PrismGradient from "./componentry/prism-gradient";
import SilkAurora from "./componentry/silk-aurora";
import WebGLLiquid from "./componentry/webgl-liquid";

const FULL_SIZE_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  minHeight: "100%",
};

function ActiveComponentryBackground({ children }: { children: ReactNode }) {
  const active = useDashboardAnimationActive();
  return (
    <div className="componentry-background-host">
      {active ? children : null}
    </div>
  );
}

export function HeroGeometricBg() {
  return (
    <ActiveComponentryBackground>
      <HeroGeometric
        className="componentry-background-root"
        style={FULL_SIZE_STYLE}
      />
    </ActiveComponentryBackground>
  );
}

export function DitherPrismHeroBg() {
  return (
    <ActiveComponentryBackground>
      <DitherPrismHero
        className="componentry-background-root"
        style={FULL_SIZE_STYLE}
        particleCount={36}
      />
    </ActiveComponentryBackground>
  );
}

export function WebGLLiquidBg() {
  return (
    <ActiveComponentryBackground>
      <WebGLLiquid
        title=""
        subtitle=""
        description=""
        reveal={false}
        className="componentry-background-root"
        style={FULL_SIZE_STYLE}
      />
    </ActiveComponentryBackground>
  );
}

export function SilkAuroraBg() {
  return (
    <ActiveComponentryBackground>
      <SilkAurora
        className="componentry-background-root"
        style={FULL_SIZE_STYLE}
        interactive
      />
    </ActiveComponentryBackground>
  );
}

export function ClosingPlasmaBg() {
  return (
    <ActiveComponentryBackground>
      <ClosingPlasma
        className="componentry-background-root"
        style={FULL_SIZE_STYLE}
        interactive
      />
    </ActiveComponentryBackground>
  );
}

export function AnimatedGradientBg() {
  return (
    <ActiveComponentryBackground>
      <AnimatedGradient className="componentry-background-root" />
    </ActiveComponentryBackground>
  );
}

export function PrismGradientBg() {
  return (
    <ActiveComponentryBackground>
      <PrismGradient
        className="componentry-background-root"
        noise={{ opacity: 0.12, scale: 0.7 }}
      />
    </ActiveComponentryBackground>
  );
}

export function LiquidChromeBg() {
  return (
    <ActiveComponentryBackground>
      <LiquidChrome
        className="componentry-background-root"
        interactive
      />
    </ActiveComponentryBackground>
  );
}
