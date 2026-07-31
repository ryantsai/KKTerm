export interface TerminalFontAtlasRefreshTarget {
  waitForConfiguredFont: () => Promise<void>;
  releaseFontAtlas: () => boolean;
  restoreFontAtlas: (wasWebglEnabled: boolean) => void;
  redraw: () => void;
}

export async function refreshTerminalFontAtlases(targets: Iterable<TerminalFontAtlasRefreshTarget>) {
  const readyTargets = new Set<TerminalFontAtlasRefreshTarget>();
  while (true) {
    const pendingTargets = [...targets].filter((target) => !readyTargets.has(target));
    if (pendingTargets.length === 0) {
      break;
    }
    for (const target of pendingTargets) {
      readyTargets.add(target);
    }
    await Promise.allSettled(pendingTargets.map((target) => target.waitForConfiguredFont()));
  }

  // Re-snapshot after the final await so renderers disposed while fonts loaded
  // are excluded and every renderer that joined meanwhile releases its atlas.
  const refreshTargets = [...targets];
  const restoreStates = refreshTargets.map((target) => target.releaseFontAtlas());
  for (let index = 0; index < refreshTargets.length; index += 1) {
    refreshTargets[index].restoreFontAtlas(restoreStates[index]);
  }
  for (const target of refreshTargets) {
    target.redraw();
  }
}
