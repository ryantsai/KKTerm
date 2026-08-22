import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";

import { useDashboardAnimationActive } from "../view/animationGating";

const PredictiveArcBackground = lazy(() => import("./threeui/PredictiveArcBackground").then(({ PredictiveArcBackground: Component }) => ({ default: Component })));
const LiquidFormBackground = lazy(() => import("./threeui/LiquidFormBackground").then(({ LiquidFormBackground: Component }) => ({ default: Component })));
const GlobeCollection = lazy(() => import("./threeui/globe/GlobeCollection").then(({ GlobeCollection: Component }) => ({ default: Component })));
const AtTheHorizon = lazy(() => import("./threeui/at-the-horizon/AtTheHorizon").then(({ AtTheHorizon: Component }) => ({ default: Component })));
const StreamConvergenceBackground = lazy(() => import("./threeui/stream-convergence/StreamConvergenceBackground").then(({ StreamConvergenceBackground: Component }) => ({ default: Component })));
const BellFieldBackground = lazy(() => import("./threeui/bell-field/BellFieldBackground").then(({ BellFieldBackground: Component }) => ({ default: Component })));
const FlowField = lazy(() => import("./threeui/neuform-isolated/NeuformBatchEffects").then(({ FlowField: Component }) => ({ default: Component })));
const CondensationBackground = lazy(() => import("./threeui/condensation/CondensationBackground").then(({ CondensationBackground: Component }) => ({ default: Component })));
const GenerativeTree = lazy(() => import("./threeui/elements/GenerativeTree").then(({ GenerativeTree: Component }) => ({ default: Component })));
const RibbonFieldBackground = lazy(() => import("./threeui/ribbon-field/RibbonFieldBackground").then(({ RibbonFieldBackground: Component }) => ({ default: Component })));
const ParticleOrbField = lazy(() => import("./threeui/neuform-isolated/NeuformIsolatedEffects").then(({ ParticleOrbField: Component }) => ({ default: Component })));
const CloudField = lazy(() => import("./threeui/neuform-isolated/NeuformIsolatedEffects").then(({ CloudField: Component }) => ({ default: Component })));
const VoidField = lazy(() => import("./threeui/neuform-isolated/NeuformIsolatedEffects").then(({ VoidField: Component }) => ({ default: Component })));
const RecursiveErosionBackground = lazy(() => import("./threeui/neuform-isolated/NeuformIsolatedEffects").then(({ RecursiveErosionBackground: Component }) => ({ default: Component })));
const QuanteraTradingBackground = lazy(() => import("./threeui/quantera-trading-background/QuanteraTradingBackground").then(({ QuanteraTradingBackground: Component }) => ({ default: Component })));
const HalftoneFlow = lazy(() => import("./threeui/neuform-isolated/NeuformCraftEffects").then(({ HalftoneFlow: Component }) => ({ default: Component })));
const ConstellationField = lazy(() => import("./threeui/neuform-isolated/NeuformBatchEffects").then(({ ConstellationField: Component }) => ({ default: Component })));
const ParticleDrift = lazy(() => import("./threeui/neuform-isolated/NeuformBatchEffects").then(({ ParticleDrift: Component }) => ({ default: Component })));
const ParticleNetwork = lazy(() => import("./threeui/neuform-isolated/NeuformBatchEffects").then(({ ParticleNetwork: Component }) => ({ default: Component })));
const AmberHalftone = lazy(() => import("./threeui/neuform-isolated/NeuformBatchEffects").then(({ AmberHalftone: Component }) => ({ default: Component })));
const MatrixField = lazy(() => import("./threeui/neuform-isolated/NeuformBatchEffects").then(({ MatrixField: Component }) => ({ default: Component })));
const GatewayFlow = lazy(() => import("./threeui/neuform-isolated/NeuformBatchEffects").then(({ GatewayFlow: Component }) => ({ default: Component })));
const ConnectivityGraph = lazy(() => import("./threeui/neuform-isolated/NeuformBatchEffects").then(({ ConnectivityGraph: Component }) => ({ default: Component })));
const InterfaceLines = lazy(() => import("./threeui/neuform-isolated/NeuformBatchEffects").then(({ InterfaceLines: Component }) => ({ default: Component })));
const DefenseLines = lazy(() => import("./threeui/neuform-isolated/NeuformBatchEffects").then(({ DefenseLines: Component }) => ({ default: Component })));
const TopoField = lazy(() => import("./threeui/neuform-isolated/NeuformBatchEffects").then(({ TopoField: Component }) => ({ default: Component })));
const SylvaLivingWorldScene = lazy(() => import("./threeui/sylva-living-world/SylvaLivingWorldScene").then(({ SylvaLivingWorldScene: Component }) => ({ default: Component })));
const TempleNightScene = lazy(() => import("./threeui/temple-night/TempleNightScene").then(({ TempleNightScene: Component }) => ({ default: Component })));

type ThreeUiComponent = ComponentType | LazyExoticComponent<ComponentType>;

function createThreeUiBackground(Component: ThreeUiComponent, fallbackBackground: string) {
  function ThreeUiBackground() {
    const active = useDashboardAnimationActive();
    if (!active) {
      return <div className="threeui-background threeui-background-fallback" style={{ background: fallbackBackground }} />;
    }
    return (
      <Suspense fallback={<div className="threeui-background threeui-background-fallback" style={{ background: fallbackBackground }} />}>
        <Component />
      </Suspense>
    );
  }

  return ThreeUiBackground;
}

export const PredictiveArcBg = createThreeUiBackground(PredictiveArcBackground, "#080a14");
export const LiquidFormBg = createThreeUiBackground(LiquidFormBackground, "#05070b");
export const EnergyOrbBg = createThreeUiBackground(GlobeCollection, "#050810");
export const NoiseFlowBg = createThreeUiBackground(AtTheHorizon, "#0b1118");
export const StreamConvergenceBg = createThreeUiBackground(StreamConvergenceBackground, "#05060b");
export const BellFieldBg = createThreeUiBackground(BellFieldBackground, "#08070b");
export const FlowFieldBg = createThreeUiBackground(FlowField, "#050810");
export const CondensationBg = createThreeUiBackground(CondensationBackground, "transparent");
export const GenerativeTreeBg = createThreeUiBackground(GenerativeTree, "#0a0a0a");
export const RibbonFieldBg = createThreeUiBackground(RibbonFieldBackground, "#050810");
export const ParticleOrbBg = createThreeUiBackground(ParticleOrbField, "#050810");
export const CloudFieldBg = createThreeUiBackground(CloudField, "#0c1117");
export const VoidFieldBg = createThreeUiBackground(VoidField, "#050508");
export const RecursiveErosionBg = createThreeUiBackground(RecursiveErosionBackground, "#080706");
export const QuanteraTradingBg = createThreeUiBackground(QuanteraTradingBackground, "#000000");
export const HalftoneFlowBg = createThreeUiBackground(HalftoneFlow, "#080808");
export const ConstellationFieldBg = createThreeUiBackground(ConstellationField, "#050810");
export const ParticleDriftBg = createThreeUiBackground(ParticleDrift, "#050810");
export const ParticleNetworkBg = createThreeUiBackground(ParticleNetwork, "#050810");
export const AmberHalftoneBg = createThreeUiBackground(AmberHalftone, "#0b0805");
export const MatrixFieldBg = createThreeUiBackground(MatrixField, "#050a08");
export const GatewayFlowBg = createThreeUiBackground(GatewayFlow, "#050810");
export const ConnectivityGraphBg = createThreeUiBackground(ConnectivityGraph, "#050810");
export const InterfaceLinesBg = createThreeUiBackground(InterfaceLines, "#050810");
export const DefenseLinesBg = createThreeUiBackground(DefenseLines, "#050810");
export const TopoFieldBg = createThreeUiBackground(TopoField, "#050810");
export const SylvaLivingWorldBg = createThreeUiBackground(SylvaLivingWorldScene, "#4a4d44");
export const TempleNightBg = createThreeUiBackground(TempleNightScene, "#05070a");
