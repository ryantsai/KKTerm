import { readdir, readFile } from "node:fs/promises";

const files = {
  agents: "AGENTS.md",
  architecture: "docs/ARCHITECTURE.md",
  aiTool: "src-tauri/src/ai.rs",
  navigationModel: "src/app/tutorialNavigationModel.ts",
};

const [agents, architecture, aiTool, navigationModel] = await Promise.all(
  Object.values(files).map((file) => readFile(file, "utf8")),
);

const uiFiles = await sourceFiles("src");
const manualFiles = await sourceFiles("docs/manual", /\.(md)$/);

const uiSources = await Promise.all(uiFiles.map((file) => readFile(file, "utf8")));
const manualSources = await Promise.all(manualFiles.map((file) => readFile(file, "utf8")));
const manual = manualSources.join("\n");

const anchorIds = new Set(
  uiSources.flatMap((source) =>
    [
      ...source.matchAll(/data-tutorial-id=["']([^"']+)["']/g),
      ...source.matchAll(/dataTutorialId=["']([^"']+)["']/g),
      ...source.matchAll(/tutorialId:\s*["']([^"']+)["']/g),
      ...Array.from(source.matchAll(/data-tutorial-id=\{([^}]+)\}/g)).flatMap((match) =>
        [...match[1].matchAll(/["']([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.-]+)["']/g)],
      ),
    ].map((match) => match[1]),
  ),
);

const mappedIds = new Set(
  [
    ...navigationModel.matchAll(/["']([a-zA-Z0-9.-]+)["']:\s*\{\s*page:/g),
    ...navigationModel.matchAll(/["']([a-zA-Z0-9.-]+)["']:\s*["'][a-z-]+["']/g),
    ...navigationModel.matchAll(/["']([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.-]+)["']/g),
  ].map((match) => match[1]),
);

const knownTargetsBlock = aiTool.match(
  /const TUTORIAL_TOOL_KNOWN_TARGETS: &str = concat!\(([\s\S]*?)\n\);/,
)?.[1];
if (!knownTargetsBlock) {
  throw new Error("tutorial_highlight known-target metadata could not be found.");
}
const aiKnownIds = new Set(
  [...knownTargetsBlock.matchAll(/\b([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.-]+)\b/g)].map(
    (match) => match[1],
  ),
);

for (const targetId of anchorIds) {
  if (!mappedIds.has(targetId)) {
    throw new Error(`${targetId} has a data-tutorial-id anchor but no tutorial navigation mapping.`);
  }
  if (!aiTool.includes(targetId)) {
    throw new Error(`${targetId} is mapped in the UI but missing from tutorial_highlight tool metadata.`);
  }
  if (!aiKnownIds.has(targetId)) {
    throw new Error(`${targetId} is missing from the tutorial_highlight known-target registry.`);
  }
  if (!manual.includes(targetId)) {
    throw new Error(`${targetId} is mapped in the UI but missing from docs/manual AI grep hints.`);
  }
}

for (const targetId of mappedIds) {
  if (!anchorIds.has(targetId)) {
    throw new Error(`${targetId} has tutorial navigation but no data-tutorial-id anchor.`);
  }
}

for (const targetId of aiKnownIds) {
  if (!anchorIds.has(targetId)) {
    throw new Error(`${targetId} is advertised by tutorial_highlight but has no UI anchor.`);
  }
}

const tutorialToolBlock = aiTool.match(
  /"tutorial_highlight",[\s\S]*?if settings\.network\(\)/,
)?.[0];
if (!tutorialToolBlock) {
  throw new Error("tutorial_highlight tool schema could not be found.");
}
for (const page of ["workspace", "dashboard", "itops", "installer", "screenshots", "systemCleaner", "settings"]) {
  if (!tutorialToolBlock.includes(`"${page}"`)) {
    throw new Error(`tutorial_highlight tool schema does not allow the ${page} page.`);
  }
}
for (const sectionId of [
  "general-settings",
  "appearance-settings",
  "dashboard-settings",
  "workspace-settings",
  "file-explorer-settings",
  "dont-sleep-settings",
  "installer-settings",
  "credentials-settings",
  "assistant-settings",
  "ssh-settings",
  "terminal-settings",
  "url-settings",
  "rdp-settings",
  "vnc-settings",
  "screenshots-settings",
  "itops-settings",
  "shortcuts-settings",
  "about-settings",
]) {
  if (!tutorialToolBlock.includes(`"${sectionId}"`)) {
    throw new Error(`tutorial_highlight tool schema does not allow ${sectionId}.`);
  }
}

const requiredDocs = [
  [files.agents, agents],
  [files.architecture, architecture],
];

for (const [file, source] of requiredDocs) {
  for (const phrase of ["data-tutorial-id", "tutorialNavigationModel.ts", "tutorial_highlight"]) {
    if (!source.includes(phrase)) {
      throw new Error(`${file} must document ${phrase} for tutorial navigation changes.`);
    }
  }
}

async function sourceFiles(directory, pattern = /\.(tsx|ts)$/) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        return sourceFiles(path, pattern);
      }
      if (pattern.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        return [path];
      }
      return [];
    }),
  );
  return files.flat();
}
