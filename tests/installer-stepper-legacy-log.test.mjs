import fs from "node:fs";
import path from "node:path";

const dialogPath = path.join(
  process.cwd(),
  "src",
  "modules",
  "installer",
  "InstallerToolDialog.tsx",
);
const source = fs.readFileSync(dialogPath, "utf8").replace(/\r\n/g, "\n");

if (
  source.includes("installer-stepper--legacy") ||
  source.includes("installer-stepper__legacy-step")
) {
  throw new Error(
    "Every installer operation must use the shared staged progress presentation.",
  );
}

const queuedInstallStart = source.indexOf("for (const queuedRecipe of recipes) {");
if (queuedInstallStart === -1) {
  throw new Error("Could not locate the queued install loop.");
}
const queuedInstallBlock = source.slice(
  queuedInstallStart,
  source.indexOf("const prereqs = catalog", queuedInstallStart),
);
if (
  !queuedInstallBlock.includes(
    "openStepperDialog(queuedRecipe.id);\n      beginInFlight(queuedRecipe.id",
  )
) {
  throw new Error(
    "Queued installs must move the dialog to the currently running package before starting it.",
  );
}
if (!queuedInstallBlock.includes('if (terminalEvent.kind !== "completed")')) {
  throw new Error(
    "Queued installs must stop on failed or cancelled terminal events.",
  );
}

const updateAllPath = path.join(
  process.cwd(),
  "src",
  "modules",
  "installer",
  "InstallerPage.tsx",
);
const updateAllSource = fs
  .readFileSync(updateAllPath, "utf8")
  .replace(/\r\n/g, "\n");
const updateAllStart = updateAllSource.indexOf("async function confirmUpdateAll()");
if (updateAllStart === -1) {
  throw new Error("Could not locate confirmUpdateAll.");
}
const updateAllBlock = updateAllSource.slice(
  updateAllStart,
  updateAllSource.indexOf("return (", updateAllStart),
);
if (
  !updateAllBlock.includes(
    "openStepperDialog(recipe.id);\n      beginInFlight(recipe.id",
  )
) {
  throw new Error(
    "Update all must open the stepper for each package before starting it.",
  );
}
if (!updateAllBlock.includes('if (terminalEvent.kind === "cancelled")')) {
  throw new Error(
    "Update all must stop the queue on a user-initiated cancel.",
  );
}
if (!updateAllBlock.includes('if (terminalEvent.kind !== "completed")')) {
  throw new Error(
    "Update all must ask to continue or abort on failed terminal events.",
  );
}
if (!updateAllBlock.includes("askContinueOrAbort")) {
  throw new Error(
    "Update all must offer Continue/Abort after a failed package with remaining updates.",
  );
}
