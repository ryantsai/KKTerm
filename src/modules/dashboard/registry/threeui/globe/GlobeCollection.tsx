import { lazy, Suspense } from "react";
import type { EnergyOrbProps } from "../energy-orb/EnergyOrb";
export type GlobeVariant = "energy-orb";
export type GlobeCollectionProps = EnergyOrbProps & { variant?: "energy-orb" };
const EnergyOrbVariant = lazy(() => import("../energy-orb/EnergyOrb").then((module) => ({ default: module.EnergyOrb })));
export function GlobeCollection({ variant: _variant, ...props }: GlobeCollectionProps) {
  return <Suspense fallback={<div className="threeui-background energy-orb" style={{ background: "#05030e" }} />}><EnergyOrbVariant {...props} /></Suspense>;
}
