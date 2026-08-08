// Centered, app-owned dialog for one Install Helper tool. Replaces the
// inline expanding tile body — single click on a tile opens this. Modes:
//   * "info" — installed: location, provider, versions, pin, update/uninstall.
//             not installed: homepage, release notes, latest, prereqs, options.
//   * "stepper" — install in progress or just completed; renders the shared
//                 staged template (or a provider-declared replacement) with
//                 per-step logs. Pressing Install from "info" flips the
//                 dialog to "stepper".
//   * "launcher" — managed web-app controls, standard CLI Run setup, or a
//                  suite-specific searchable launcher kept separate from
//                  installation details.
//
// Honors AGENTS.md dialog rules: concise title, a single footer dismiss path,
// and host-platform footer buttons at bottom right.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Btn,
  DIcon,
  DialogShell,
  LegacyDialogActions,
} from "../../app/ui/dialog";
import {
  invokeCommand,
  isTauriRuntime,
  openExternalUrl,
  selectInstallerLaunchFolder,
} from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import {
  findInstalledDependents,
  isWslFeature,
  isKnownSelfElevatingWingetRecipe,
  recipeNeedsWsl,
  resolveInstallPlan,
} from "./dag";
import { iconUrlForRecipe, FALLBACK_ICON_URL } from "./icons";
import {
  cliLaunchSamplesForRecipe,
  cliLauncherUsesProjectFolders,
  codingAgentCommandReferenceUrlForRecipe,
  codingAgentLaunchOptionsForRecipe,
  launchKindForRecipe,
  readCodingAgentLaunchSettings,
  readRecentLaunchFolders,
  rememberLaunchFolder,
  suiteTerminalIsElevated,
  writeCodingAgentLaunchSettings,
} from "./launch";
import { InstallerConfirmDialog } from "./InstallerConfirmDialog";
import { installRecipeAndWait } from "./progress";
import { ToggleSwitch } from "../settings/ToggleSwitch";
import { useInstallerStore, type StepStatus } from "./state";
import { notifyConnectionTreeInvalidated } from "../workspace/connections/connectionSidebarState";
import { isInstallerUpdateAvailable } from "./versionCompare";
import {
  latestVersionWebUrlForRecipe,
  recipeSupportsManagedLatestVersion,
  recipeSupportsLatestVersion,
} from "./latestSupport";
import {
  isOfficialScriptInstall,
  type DetectedState,
  type InstallOptions,
  type ManagedWebUiStatus,
  type Provider,
  type QuickLaunchEntry,
  type Recipe,
  type RecipeOption,
} from "./types";
import type { CreateConnectionRequest } from "../../types";
import { useInstallerRunAction } from "./useInstallerRunAction";

export function InstallerToolDialog() {
  const open = useInstallerStore((s) => s.openDialog);
  const catalog = useInstallerStore((s) => s.catalog);
  const closeDialog = useInstallerStore((s) => s.closeDialog);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeDialog]);

  if (!open || !catalog) return null;
  const recipe = catalog.recipes.find((r) => r.id === open.toolId);
  if (!recipe) return null;

  return (
    <DialogShell>
      <div
        aria-label={recipe.name}
        aria-modal="true"
        className="kk-dlg installer-tool-dialog"
        role="dialog"
      >
        {open.mode === "stepper" ? (
          <StepperBody recipe={recipe} />
        ) : open.mode === "launcher" ? (
          <LauncherBody recipe={recipe} />
        ) : (
          <InfoBody recipe={recipe} />
        )}
      </div>
    </DialogShell>
  );
}

// =================================================================
// Info mode
// =================================================================

function InfoBody({ recipe }: { recipe: Recipe }) {
  const detected = useInstallerStore((s) => s.detected[recipe.id]);
  if (detected?.installed) {
    return <InstalledInfoBody recipe={recipe} />;
  }
  return <NotInstalledInfoBody recipe={recipe} />;
}

function InstalledInfoBody({ recipe }: { recipe: Recipe }) {
  const { t, i18n } = useTranslation();
  const detected = useInstallerStore((s) => s.detected[recipe.id]);
  const toolState = useInstallerStore((s) => s.toolState[recipe.id]);
  const latestError = useInstallerStore((s) => s.checkError[recipe.id]);
  const checking = useInstallerStore((s) =>
    s.checkingToolIds.has(recipe.id),
  );
  const allDetected = useInstallerStore((s) => s.detected);
  const catalog = useInstallerStore((s) => s.catalog);
  const closeDialog = useInstallerStore((s) => s.closeDialog);
  const openStepperDialog = useInstallerStore((s) => s.openStepperDialog);
  const beginInFlight = useInstallerStore((s) => s.beginInFlight);
  const openWslManager = useInstallerStore((s) => s.openWslManager);
  const showStatusBarNotice = useWorkspaceStore(
    (state) => state.showStatusBarNotice,
  );

  const [uninstallConfirm, setUninstallConfirm] = useState<null | {
    dependents: string[];
  }>(null);
  const [updateConfirm, setUpdateConfirm] = useState(false);

  const isWsl = isWslFeature(recipe);
  const installedProvider = detectedProviderForRecipe(recipe, detected);
  const usesChocolatey = recipeUsesChocolateyProvider(recipe, detected);

  const description =
    recipe.descriptionLocales?.[i18n.language] ?? recipe.descriptionEn;
  const version = detected?.installedVersion ?? null;
  const latest = toolState?.latestVersionSeen ?? null;
  const supportsLatestVersion = recipeSupportsManagedLatestVersion(
    recipe,
    detected,
  );
  const latestWebUrl = latestVersionWebUrlForRecipe(recipe);
  const officialScript = isOfficialScriptInstall(detected);
  const hasUpdate =
    supportsLatestVersion && isInstallerUpdateAvailable(latest, version);
  const workspaceSpec = workspaceConnectionSpecForRecipe(recipe);
  const installMode = installModeForInstalledRecipe(detected);
  const runAction = useInstallerRunAction(recipe);

  async function handleTogglePin() {
    if (!isTauriRuntime()) return;
    const next = !(toolState?.pinned ?? false);
    try {
      await invokeCommand("installer_set_pinned", {
        toolId: recipe.id,
        pinned: next,
      });
      const states = await invokeCommand("installer_get_state");
      useInstallerStore.getState().setToolStates(states);
    } catch {
      // ignore — non-fatal
    }
  }

  async function handleRefreshLatest() {
    if (!isTauriRuntime()) return;
    try {
      await invokeCommand("installer_check_latest_versions", {
        toolIds: [recipe.id],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
    }
  }

  function startUpdate() {
    if (!catalog) return;
    // Chocolatey upgrades run elevated (UAC) and machine-wide — confirm first
    // so the admin requirement is explicit before the prompt appears.
    if (usesChocolatey) {
      setUpdateConfirm(true);
      return;
    }
    runUpdate();
  }

  function runUpdate() {
    setUpdateConfirm(false);
    openStepperDialog(recipe.id);
    beginInFlight(recipe.id, "install");
    void installRecipeAndWait(recipe.id, {})
      .then((event) => maybeStartManagedWebUiAfterInstall(recipe, event.kind))
      .catch(() => {
        // failure surfaces via the failed terminal event into stepperState.
      });
  }

  function attemptUninstall() {
    if (!catalog) return;
    const dependents = findInstalledDependents(recipe.id, catalog, allDetected);
    setUninstallConfirm({ dependents: dependents.map((d) => d.name) });
  }

  async function doUninstall() {
    if (!isTauriRuntime()) return;
    setUninstallConfirm(null);
    beginInFlight(recipe.id, "uninstall");
    openStepperDialog(recipe.id);
    try {
      await invokeCommand("installer_uninstall_recipe", { toolId: recipe.id });
    } catch {
      // backend emits Failed
    }
  }

  async function handleAddToWorkspace() {
    if (!workspaceSpec || !isTauriRuntime()) return;
    try {
      await invokeCommand("create_connection", { request: workspaceSpec.request });
      notifyConnectionTreeInvalidated();
      showStatusBarNotice(
        t("installer.status.addedToWorkspace", { name: workspaceSpec.name }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
    }
  }

  return (
    <>
      <ToolDialogHeader
        recipe={recipe}
        title={recipe.name}
        version={version}
      />
      <div className="installer-tool-dialog__body">
        {description ? (
          <p className="installer-tool-dialog__desc">{description}</p>
        ) : null}
        {hasUpdate ? (
          <div className="installer-tool-dialog__update-banner">
            <span>
              {t("installer.dialog.updateAvailable", {
                from: version,
                to: latest,
              })}
            </span>
            <Btn sm kind="primary" className="update" icon="refresh" onClick={startUpdate}>
              {t("installer.actions.update")}
            </Btn>
          </div>
        ) : null}
        <dl className="installer-tool-dialog__grid">
          {detected?.installLocation ? (
            <Row label={t("installer.dialog.installLocation")}>
              <code>{detected.installLocation}</code>
            </Row>
          ) : null}
          <Row label={t("installer.dialog.provider")}>
            {officialScript
              ? t("installer.dialog.providerOfficialScript")
              : providerSummary(installedProvider)}
          </Row>
          {installMode && !officialScript ? (
            <Row label={t("installer.options.scope")}>
              {installModeLabel(installMode, t)}
            </Row>
          ) : null}
          {version ? (
            <Row label={t("installer.dialog.installedVersion")}>
              {version}
            </Row>
          ) : null}
          {supportsLatestVersion ? (
            <Row label={t("installer.dialog.latestVersion")}>
              <LatestVersionValue
                error={latestError}
                value={latest}
                checking={checking}
                onRefresh={() => void handleRefreshLatest()}
              />
            </Row>
          ) : !officialScript && latestWebUrl ? (
            <Row label={t("installer.dialog.latestVersion")}>
              <ExternalLink href={latestWebUrl}>{t("installer.status.web")}</ExternalLink>
            </Row>
          ) : null}
          {supportsLatestVersion && toolState?.lastCheckAt ? (
            <Row label={t("installer.dialog.lastChecked")}>
              {formatTimestamp(toolState.lastCheckAt)}
            </Row>
          ) : null}
        </dl>
        {supportsLatestVersion ? (
          <label className="installer-tool-dialog__pin">
            <span>{t("installer.options.pinVersion")}</span>
            <ToggleSwitch
              checked={toolState?.pinned ?? false}
              onChange={() => void handleTogglePin()}
            />
          </label>
        ) : null}
      </div>
      <LegacyDialogActions
        className="installer-tool-dialog__actions"
        extraLeft={<>
        {/* The receipt authorizes `uv self update`, but it still does not prove
            WinGet owns an uninstallable package. Keep only Uninstall hidden so
            the backend cannot remove a separate catalog-provider copy. */}
        {!officialScript ? (
          <Btn kind="danger" icon="trash" onClick={attemptUninstall}>
            {t("installer.actions.uninstall")}
          </Btn>
        ) : null}
        {isWsl ? (
          <button
            type="button"
            className="secondary-button"
            onClick={openWslManager}
          >
            {t("installer.wsl.manageDistros")}
          </button>
        ) : null}
        {workspaceSpec ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => void handleAddToWorkspace()}
          >
            {t("installer.actions.addToWorkspace")}
          </button>
        ) : null}
        {hasUpdate ? (
          <button
            type="button"
            className="secondary-button update"
            onClick={startUpdate}
          >
            {t("installer.actions.update")}
          </button>
        ) : null}
        </>}
        primary={
          runAction.launchKind === "gui" ||
          runAction.launchKind === "cli" ||
          runAction.launchKind === "suite" ||
          runAction.launchKind === "webUi" ? (
            <Btn
              icon={
                runAction.launchKind === "gui"
                  ? undefined
                  : runAction.launchKind === "webUi"
                    ? "globe"
                    : "terminal"
              }
              onClick={runAction.run}
            >
              {t("installer.actions.run")}
            </Btn>
          ) : null
        }
        cancel={<Btn onClick={closeDialog}>{t("common.close")}</Btn>}
      />
      {uninstallConfirm ? (
        <InstallerConfirmDialog
          title={t("installer.confirm.uninstallTitle", { name: recipe.name })}
          body={
            uninstallConfirm.dependents.length > 0
              ? t("installer.confirm.uninstallDependentsBody", {
                  name: recipe.name,
                })
              : t("installer.confirm.uninstallSimpleBody", { name: recipe.name })
          }
          items={
            uninstallConfirm.dependents.length > 0
              ? uninstallConfirm.dependents
              : undefined
          }
          footer={
            usesChocolatey
              ? t("installer.confirm.adminChocolateyFooter")
              : uninstallConfirm.dependents.length > 0
                ? t("installer.confirm.uninstallDependentsFooter")
                : undefined
          }
          confirmLabel={t("installer.confirm.uninstallConfirm")}
          tone="danger"
          onConfirm={() => void doUninstall()}
          onCancel={() => setUninstallConfirm(null)}
        />
      ) : null}
      {updateConfirm ? (
        <InstallerConfirmDialog
          title={t("installer.confirm.updateTitle", { name: recipe.name })}
          footer={t("installer.confirm.adminChocolateyFooter")}
          confirmLabel={t("installer.actions.update")}
          onConfirm={() => runUpdate()}
          onCancel={() => setUpdateConfirm(false)}
        />
      ) : null}
    </>
  );
}

function NotInstalledInfoBody({ recipe }: { recipe: Recipe }) {
  const { t, i18n } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore(
    (state) => state.showStatusBarNotice,
  );
  const detected = useInstallerStore((s) => s.detected);
  const toolState = useInstallerStore((s) => s.toolState[recipe.id]);
  const latestError = useInstallerStore((s) => s.checkError[recipe.id]);
  const checking = useInstallerStore((s) =>
    s.checkingToolIds.has(recipe.id),
  );
  const catalog = useInstallerStore((s) => s.catalog);
  const closeDialog = useInstallerStore((s) => s.closeDialog);
  const openInfoDialog = useInstallerStore((s) => s.openInfoDialog);
  const openStepperDialog = useInstallerStore((s) => s.openStepperDialog);
  const beginInFlight = useInstallerStore((s) => s.beginInFlight);
  const wslJustEnabled = useInstallerStore((s) => s.wslJustEnabled);
  const installerDefaultProvider = useWorkspaceStore(
    (state) => state.generalSettings.installerDefaultProvider,
  );

  const [options, setOptions] = useState<InstallOptions>(() =>
    defaultInstallOptionsForRecipe(recipe, installerDefaultProvider),
  );
  const [installConfirm, setInstallConfirm] = useState<null | {
    items: string[];
    recipes: Recipe[];
    uacEstimate: number;
  }>(null);

  const description =
    recipe.descriptionLocales?.[i18n.language] ?? recipe.descriptionEn;
  const wslBlocked =
    !!catalog && wslJustEnabled && recipeNeedsWsl(recipe, catalog);
  const supportsLatestVersion = recipeSupportsLatestVersion(recipe);
  const latestWebUrl = latestVersionWebUrlForRecipe(recipe);
  const homepage = recipe.homepage;
  const selectedProvider = selectedProviderForRecipe(recipe, options);
  const releaseUrl = recipe.releaseNotesUrl ?? deriveProviderUrl(selectedProvider);
  const installMode = installModeForOptions(recipe, options);

  useEffect(() => {
    setOptions(defaultInstallOptionsForRecipe(recipe, installerDefaultProvider));
  }, [recipe, installerDefaultProvider]);

  function applyOption<K extends keyof InstallOptions>(
    key: K,
    value: InstallOptions[K],
  ) {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }

  async function handleRefreshLatest() {
    if (!isTauriRuntime()) return;
    try {
      await invokeCommand("installer_check_latest_versions", {
        toolIds: [recipe.id],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
    }
  }

  function attemptInstall() {
    if (!catalog || wslBlocked) return;
    if (
      selectedProvider.kind === "chocolatey" &&
      recipe.id !== "chocolatey" &&
      !detected["chocolatey"]?.installed
    ) {
      openInfoDialog("chocolatey");
      return;
    }
    const plan = resolveInstallPlan(recipe.id, catalog, detected, options);
    const prereqActionable = plan.actionable.filter((s) => s.isPrerequisite);
    if (prereqActionable.length > 0 || plan.uacPromptEstimate > 0) {
      setInstallConfirm({
        items: prereqActionable.map((s) => s.recipe.name),
        recipes: plan.actionable.map((s) => s.recipe),
        uacEstimate: plan.uacPromptEstimate,
      });
      return;
    }
    void doInstall(plan.actionable.map((s) => s.recipe));
  }

  async function doInstall(recipes: Recipe[]) {
    if (!isTauriRuntime()) return;
    setInstallConfirm(null);
    for (const queuedRecipe of recipes) {
      openStepperDialog(queuedRecipe.id);
      beginInFlight(queuedRecipe.id, "install");
      try {
        const terminalEvent = await installRecipeAndWait(
          queuedRecipe.id,
          queuedRecipe.id === recipe.id ? options : {},
        );
        if (terminalEvent.kind !== "completed") {
          openStepperDialog(queuedRecipe.id);
          break;
        }
        await maybeStartManagedWebUiAfterInstall(
          queuedRecipe,
          terminalEvent.kind,
        );
        if (isWslFeature(queuedRecipe) && queuedRecipe.id !== recipe.id) {
          openStepperDialog(queuedRecipe.id);
          break;
        }
      } catch {
        openStepperDialog(queuedRecipe.id);
        break;
      }
    }
  }

  const prereqs = catalog
    ? resolveInstallPlan(recipe.id, catalog, detected, options)
        .steps.filter((step) => step.isPrerequisite)
        .map((step) => step.recipe)
    : [];

  return (
    <>
      <ToolDialogHeader recipe={recipe} title={recipe.name} />
      <div className="installer-tool-dialog__body">
        {description ? (
          <p className="installer-tool-dialog__desc">{description}</p>
        ) : null}
        {wslBlocked ? (
          <p
            className="installer-tool-dialog__hint installer-tool-dialog__hint--warn"
            role="status"
          >
            {t("installer.wslReboot")}
          </p>
        ) : null}
        <dl className="installer-tool-dialog__grid">
          {homepage ? (
            <Row label={t("installer.dialog.homepage")}>
              <ExternalLink href={homepage} />
            </Row>
          ) : null}
          {releaseUrl ? (
            <Row label={t("installer.dialog.releaseNotes")}>
              <ExternalLink href={releaseUrl} />
            </Row>
          ) : null}
          <Row label={t("installer.dialog.provider")}>
            {providerSummary(selectedProvider)}
          </Row>
          {selectedProvider.kind === "chocolatey" ? (
            <Row label={t("installer.options.scope")}>
              <span className="installer-tool-dialog__option-hint">
                {t("installer.dialog.adminRequiredChocolatey")}
              </span>
            </Row>
          ) : installMode ? (
            <Row label={t("installer.options.scope")}>
              {installModeLabel(installMode, t)}
            </Row>
          ) : null}
          {supportsLatestVersion ? (
            <Row label={t("installer.dialog.latestVersion")}>
              <LatestVersionValue
                error={latestError}
                value={toolState?.latestVersionSeen ?? null}
                checking={checking}
                onRefresh={() => void handleRefreshLatest()}
              />
            </Row>
          ) : latestWebUrl ? (
            <Row label={t("installer.dialog.latestVersion")}>
              <ExternalLink href={latestWebUrl}>{t("installer.status.web")}</ExternalLink>
            </Row>
          ) : null}
          {prereqs.length > 0 ? (
            <Row label={t("installer.dialog.prerequisites")}>
              <ul className="installer-tool-dialog__prereqs">
                {prereqs.map((p) => {
                  const ok = detected[p.id]?.installed ?? false;
                  return (
                    <li key={p.id} data-installed={ok ? "true" : "false"}>
                      <span>{p.name}</span>
                      <span>
                        {ok
                          ? t("installer.dialog.prereqInstalled")
                          : t("installer.dialog.prereqMissing")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Row>
          ) : null}
        </dl>
        <OptionsForm recipe={recipe} options={options} onChange={applyOption} />
      </div>
      <LegacyDialogActions
        className="installer-tool-dialog__actions"
        primary={
          <Btn
            kind="primary"
            icon="download"
            onClick={attemptInstall}
            disabled={wslBlocked}
          >
            {t("installer.actions.install")}
          </Btn>
        }
        cancel={<Btn onClick={closeDialog}>{t("common.cancel")}</Btn>}
      />
      {installConfirm ? (
        <InstallerConfirmDialog
          title={t("installer.confirm.installTitle", { name: recipe.name })}
          body={
            installConfirm.items.length > 0
              ? t("installer.confirm.installWithPrereqsBody")
              : undefined
          }
          items={
            installConfirm.items.length > 0 ? installConfirm.items : undefined
          }
          footer={
            installConfirm.uacEstimate > 0
              ? t("installer.confirm.uacFooter", {
                  count: installConfirm.uacEstimate,
                })
              : undefined
          }
          confirmLabel={t("installer.confirm.installConfirm")}
          onConfirm={() => void doInstall(installConfirm.recipes)}
          onCancel={() => setInstallConfirm(null)}
        />
      ) : null}
    </>
  );
}

// =================================================================
// Stepper mode
// =================================================================

function StepperBody({ recipe }: { recipe: Recipe }) {
  const { t } = useTranslation();
  const stepper = useInstallerStore((s) => s.stepperState[recipe.id]);
  const inFlight = useInstallerStore((s) => s.inFlight[recipe.id]);
  const lastStatus = useInstallerStore((s) => s.lastStatus[recipe.id]);
  const closeDialog = useInstallerStore((s) => s.closeDialog);

  async function handleCancel() {
    if (!isTauriRuntime()) return;
    try {
      await invokeCommand("installer_cancel", { toolId: recipe.id });
    } catch {
      // best effort
    }
  }

  const running = !!inFlight;
  const titleKey = running
    ? inFlight?.operation === "uninstall"
      ? "installer.dialog.uninstallingTitle"
      : "installer.dialog.installingTitle"
    : lastStatus?.kind === "completed"
      ? "installer.dialog.installedTitle"
      : lastStatus?.kind === "failed"
        ? "installer.dialog.failedTitle"
        : lastStatus?.kind === "cancelled"
          ? "installer.dialog.cancelledTitle"
          : "installer.dialog.installingTitle";

  return (
    <>
      <ToolDialogHeader
        recipe={recipe}
        title={t(titleKey, { name: recipe.name })}
        sub={inFlight?.currentStep ?? undefined}
        busy={running}
      />
      <div className="installer-tool-dialog__body">
        {lastStatus?.kind === "failed" ? (
          <div className="installer-tool-dialog__error-banner" role="status">
            <DIcon name="alert" size={18} />
            <p>{lastStatus.message}</p>
          </div>
        ) : null}
        {lastStatus?.kind === "cancelled" ? (
          <p className="installer-tool-dialog__hint" role="status">
            {t("installer.status.cancelled")}
          </p>
        ) : null}
        <StepperList
          recipeName={recipe.name}
          stepper={stepper}
          inFlight={inFlight}
        />
      </div>
      <LegacyDialogActions
        className="installer-tool-dialog__actions"
        extraLeft={running ? (
          <Btn kind="danger" onClick={() => void handleCancel()}>
            {t("installer.actions.cancel")}
          </Btn>
        ) : null}
        primary={<Btn kind="primary" onClick={closeDialog}>{t("common.close")}</Btn>}
      />
    </>
  );
}

function StepperList({
  recipeName,
  stepper,
  inFlight,
}: {
  recipeName: string;
  stepper:
    | ReturnType<typeof useInstallerStore.getState>["stepperState"][string]
    | undefined;
  inFlight: ReturnType<typeof useInstallerStore.getState>["inFlight"][string];
}) {
  const { t } = useTranslation();
  const [manualExpanded, setManualExpanded] = useState<Record<string, boolean>>(
    {},
  );

  // beginInFlight seeds the shared three-stage template synchronously. A
  // provider-declared plan may replace it before this component renders.
  if (!stepper || stepper.plan.length === 0) return null;

  const active = stepper.activeStepId;
  function isExpanded(stepId: string): boolean {
    if (stepId in manualExpanded) return manualExpanded[stepId]!;
    return stepId === active;
  }

  return (
    <ol className="installer-stepper">
      {stepper.plan.map((step) => {
        const status = (stepper.status[step.id] ?? "pending") as StepStatus;
        const expanded = isExpanded(step.id);
        const log = stepper.logs[step.id] ?? [];
        const duration = stepper.durations[step.id];
        const error = stepper.errors[step.id];
        const ratio =
          status === "running" && inFlight?.ratio != null ? inFlight.ratio : null;
        return (
          <li
            key={step.id}
            className="installer-stepper__row"
            data-status={status}
            data-active={status === "running" ? "true" : "false"}
          >
            <button
              type="button"
              className="installer-stepper__row-head"
              aria-expanded={expanded}
              onClick={() =>
                setManualExpanded((prev) => ({
                  ...prev,
                  [step.id]: !expanded,
                }))
              }
            >
              <span
                className={`installer-stepper__dot installer-stepper__dot--${status}`}
                aria-hidden="true"
              />
              <span className="installer-stepper__label">
                {t(step.labelKey, {
                  name: recipeName,
                  defaultValue: step.id,
                })}
              </span>
              <span className="installer-stepper__meta">
                {status === "done" && duration != null
                  ? formatDuration(duration)
                  : status === "running" && ratio != null
                    ? `${Math.round(ratio * 100)}%`
                    : status === "failed"
                      ? t("installer.stepper.failedBadge")
                      : status === "cancelled"
                        ? t("installer.status.cancelled")
                      : ""}
              </span>
            </button>
            {expanded ? (
              <div className="installer-stepper__row-body">
                {status === "running" ? (
                  <progress
                    className="installer-stepper__bar"
                    value={ratio ?? undefined}
                    max={1}
                  />
                ) : null}
                {error ? (
                  <p className="installer-tool-dialog__hint installer-tool-dialog__hint--error">
                    {error}
                  </p>
                ) : null}
                {log.length > 0 ? (
                  <pre className="installer-stepper__log" aria-live="polite">
                    {log.slice(-200).join("\n")}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// =================================================================
// Launcher mode — mini launcher for installed command-line tools
// =================================================================

const RECENT_LAUNCH_FOLDERS_VISIBLE = 5;

function LauncherBody({ recipe }: { recipe: Recipe }) {
  const launchKind = launchKindForRecipe(recipe.id);
  return launchKind === "webUi" ? (
    <ManagedWebUiLauncherBody recipe={recipe} />
  ) : launchKind === "suite" ? (
    <SuiteLauncherBody recipe={recipe} />
  ) : (
    <CliLauncherBody recipe={recipe} />
  );
}

function ManagedWebUiLauncherBody({ recipe }: { recipe: Recipe }) {
  const { t } = useTranslation();
  const detected = useInstallerStore((s) => s.detected[recipe.id]);
  const closeDialog = useInstallerStore((s) => s.closeDialog);
  const showStatusBarNotice = useWorkspaceStore(
    (state) => state.showStatusBarNotice,
  );
  const webUi = webUiAffordanceForRecipe(recipe);
  const hasWebUi = webUi !== null;
  const service = serviceAffordanceForRecipe(recipe);
  const [status, setStatus] = useState<ManagedWebUiStatus | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);
  const statusRefreshInFlight = useRef(false);

  useEffect(() => {
    if (!hasWebUi || !isTauriRuntime()) return;
    let cancelled = false;
    async function refresh() {
      if (statusRefreshInFlight.current) return;
      statusRefreshInFlight.current = true;
      try {
        const next = await invokeCommand("installer_get_web_ui_status", {
          toolId: recipe.id,
        });
        if (!cancelled) setStatus(next);
      } catch {
        if (!cancelled) setStatus(null);
      } finally {
        statusRefreshInFlight.current = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [recipe.id, hasWebUi]);

  async function handleRunAction(
    command: "installer_run_web_ui" | "installer_stop_web_ui",
  ) {
    if (!webUi || !isTauriRuntime() || actionInFlight) return;
    setActionInFlight(true);
    try {
      await invokeCommand(command, { toolId: recipe.id });
      await refreshManagedWebUiStatus(recipe.id, setStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(
        command === "installer_run_web_ui" && status?.nodeRequirement
          ? t("installer.status.nodeStartFailed", {
              name: recipe.name,
              current: status.nodeVersion ?? t("installer.status.unknown"),
              runtime:
                status.nodeRuntimeVersion ?? t("installer.status.unknown"),
              requirement: status.nodeRequirement,
              reason: message,
            })
          : message,
        { tone: "error" },
      );
    } finally {
      setActionInFlight(false);
    }
  }

  function handleOpenWebUi() {
    if (!webUi || !status?.running) return;
    const url = status.url ?? webUi.url;
    if (!isTauriRuntime()) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    void openExternalUrl(url).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
    });
  }

  async function handleServiceAction() {
    if (!service || !isTauriRuntime() || actionInFlight) return;
    setActionInFlight(true);
    const removing = status?.serviceInstalled ?? false;
    try {
      await invokeCommand(
        removing ? "installer_remove_service" : "installer_install_service",
        { toolId: recipe.id },
      );
      showStatusBarNotice(
        t(
          removing
            ? "installer.status.serviceRemoved"
            : "installer.status.serviceInstalled",
        ),
      );
      await refreshManagedWebUiStatus(recipe.id, setStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
    } finally {
      setActionInFlight(false);
    }
  }

  if (!webUi) return null;

  return (
    <>
      <ToolDialogHeader
        recipe={recipe}
        title={t("installer.launcher.title", { name: recipe.name })}
        version={detected?.installedVersion ?? null}
      />
      <div className="installer-tool-dialog__body">
        <dl className="installer-tool-dialog__grid">
          <Row label={t("installer.dialog.runtimeStatus")}>
            {status
              ? status.running
                ? t("installer.status.running")
                : t("installer.status.stopped")
              : t("installer.dialog.checkingDots")}
          </Row>
          <Row label={t("installer.dialog.webUi")}>
            <code>{status?.url ?? webUi.url}</code>
          </Row>
          {status?.nodeRequirement ? (
            <Row label={t("installer.dialog.nodeRuntime")}>
              {t("installer.dialog.nodeVersionSummary", {
                current: status.nodeVersion ?? t("installer.status.unknown"),
                runtime:
                  status.nodeRuntimeVersion ?? t("installer.status.unknown"),
                requirement: status.nodeRequirement,
              })}
            </Row>
          ) : null}
          {service ? (
            <Row label={t("installer.dialog.windowsService")}>
              <code>{service.name}</code>
              {" · "}
              {status?.serviceInstalled
                ? status.serviceState ?? t("installer.status.unknown")
                : t("installer.status.notInstalled")}
            </Row>
          ) : null}
          {service && status?.serviceInstalled ? (
            <Row label={t("installer.dialog.serviceStartup")}>
              {status.startup ?? t("installer.status.unknown")}
            </Row>
          ) : null}
        </dl>
      </div>
      <LegacyDialogActions
        className="installer-tool-dialog__actions"
        extraLeft={
          service ? (
            <Btn disabled={actionInFlight} onClick={() => void handleServiceAction()}>
              {status?.serviceInstalled
                ? t("installer.actions.removeService")
                : t("installer.actions.registerService")}
            </Btn>
          ) : null
        }
        primary={
          <>
            <Btn
              disabled={!status?.running || actionInFlight}
              onClick={handleOpenWebUi}
            >
              {t("installer.actions.openWebUi")}
            </Btn>
            <Btn
              kind="primary"
              icon="bolt"
              disabled={!status || actionInFlight}
              onClick={() =>
                void handleRunAction(
                  status?.running
                    ? "installer_stop_web_ui"
                    : "installer_run_web_ui",
                )
              }
            >
              {status?.running
                ? t("installer.actions.stop")
                : t("installer.actions.start")}
            </Btn>
          </>
        }
        cancel={<Btn onClick={closeDialog}>{t("common.close")}</Btn>}
      />
    </>
  );
}

function CliLauncherBody({ recipe }: { recipe: Recipe }) {
  const { t } = useTranslation();
  const closeDialog = useInstallerStore((s) => s.closeDialog);
  const showStatusBarNotice = useWorkspaceStore(
    (state) => state.showStatusBarNotice,
  );
  const samples = cliLaunchSamplesForRecipe(recipe.id) ?? [];
  const codingAgentOptions = codingAgentLaunchOptionsForRecipe(recipe.id);
  const commandReferenceUrl =
    codingAgentCommandReferenceUrlForRecipe(recipe.id);
  const usesProjectFolders = cliLauncherUsesProjectFolders(recipe.id);
  const [launchSettings, setLaunchSettings] = useState(() =>
    readCodingAgentLaunchSettings(recipe.id),
  );
  const [recentFolders, setRecentFolders] = useState<string[]>(() =>
    usesProjectFolders ? readRecentLaunchFolders(recipe.id) : [],
  );
  const [showAllFolders, setShowAllFolders] = useState(false);
  const visibleFolders = showAllFolders
    ? recentFolders
    : recentFolders.slice(0, RECENT_LAUNCH_FOLDERS_VISIBLE);
  const launchArguments = [launchSettings.preset, launchSettings.arguments.trim()]
    .filter(Boolean)
    .join(" ");

  function updateLaunchSettings(
    next: Partial<{ preset: string; arguments: string }>,
  ) {
    const settings = { ...launchSettings, ...next };
    setLaunchSettings(settings);
    writeCodingAgentLaunchSettings(recipe.id, settings);
  }

  async function openTerminal(folder?: string) {
    if (!isTauriRuntime()) return;
    try {
      await invokeCommand("installer_open_terminal_launcher", {
        toolId: recipe.id,
        ...(folder ? { path: folder } : {}),
        ...(launchArguments ? { arguments: launchArguments } : {}),
        execute: usesProjectFolders,
      });
      if (folder) {
        setRecentFolders(rememberLaunchFolder(recipe.id, folder));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
    }
  }

  async function handleChooseFolder() {
    const selected = await selectInstallerLaunchFolder({
      title: t("installer.launcher.chooseFolder"),
    });
    if (selected) await openTerminal(selected);
  }

  return (
    <>
      <ToolDialogHeader
        recipe={recipe}
        title={t("installer.launcher.title", { name: recipe.name })}
        sub={t("installer.launcher.body", { name: recipe.name })}
      />
      <div className="installer-tool-dialog__body">
        {codingAgentOptions ? (
          <div className="installer-launcher__options">
            {commandReferenceUrl ? (
              <span className="installer-launcher__reference">
                <ExternalLink href={commandReferenceUrl}>
                  {t("installer.launcher.commandReference")}
                </ExternalLink>
              </span>
            ) : null}
            <label className="installer-launcher__field">
              <span>{t("installer.launcher.commonOption")}</span>
              <select
                value={launchSettings.preset}
                onChange={(event) =>
                  updateLaunchSettings({ preset: event.target.value })
                }
              >
                <option value="">{t("installer.launcher.defaultOption")}</option>
                {codingAgentOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value}
                  </option>
                ))}
              </select>
            </label>
            <label className="installer-launcher__field">
              <span>{t("installer.launcher.arguments")}</span>
              <input
                type="text"
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={launchSettings.arguments}
                onChange={(event) =>
                  updateLaunchSettings({ arguments: event.target.value })
                }
              />
            </label>
          </div>
        ) : (
          <dl className="installer-tool-dialog__grid">
            <Row label={t("installer.launcher.samples")}>
              <span
                style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}
              >
                {samples.map((sample, i) => (
                  <code key={i}>{sample}</code>
                ))}
              </span>
            </Row>
          </dl>
        )}
        {usesProjectFolders && recentFolders.length > 0 ? (
          <div className="installer-launcher__recent">
            <span className="installer-launcher__recent-label">
              {t("installer.launcher.recentFolders")}
            </span>
            <ul className="installer-launcher__recent-list">
              {visibleFolders.map((folder) => (
                <li key={folder}>
                  <button
                    type="button"
                    className="installer-launcher__recent-item"
                    title={folder}
                    onClick={() => void openTerminal(folder)}
                  >
                    <code>{folder}</code>
                  </button>
                </li>
              ))}
            </ul>
            {!showAllFolders &&
            recentFolders.length > RECENT_LAUNCH_FOLDERS_VISIBLE ? (
              <button
                type="button"
                className="installer-tool-dialog__inline-action"
                onClick={() => setShowAllFolders(true)}
              >
                {t("installer.launcher.showMore")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <LegacyDialogActions
        className="installer-tool-dialog__actions"
        extraLeft={
          usesProjectFolders ? (
            <Btn icon="folder" onClick={() => void handleChooseFolder()}>
              {t("installer.launcher.chooseFolder")}
            </Btn>
          ) : null
        }
        primary={
          <Btn kind="primary" icon="terminal" onClick={() => void openTerminal()}>
            {usesProjectFolders
              ? t("installer.actions.run")
              : t("installer.launcher.openTerminal")}
          </Btn>
        }
        cancel={
          <Btn onClick={closeDialog}>{t("common.close")}</Btn>
        }
      />
    </>
  );
}

function SuiteLauncherBody({ recipe }: { recipe: Recipe }) {
  const { t, i18n } = useTranslation();
  const closeDialog = useInstallerStore((s) => s.closeDialog);
  const detected = useInstallerStore((s) => s.detected[recipe.id]);
  const showStatusBarNotice = useWorkspaceStore(
    (state) => state.showStatusBarNotice,
  );
  const [entries, setEntries] = useState<QuickLaunchEntry[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isTauriRuntime()) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    void invokeCommand("installer_list_quick_launch", { toolId: recipe.id })
      .then((nextEntries) => {
        if (!cancelled) setEntries(nextEntries);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [recipe.id]);

  async function handleLaunch(command: string) {
    if (!isTauriRuntime()) return;
    try {
      await invokeCommand("installer_launch_quick_command", {
        toolId: recipe.id,
        command,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
    }
  }

  async function handleOpenTerminal() {
    if (!isTauriRuntime()) return;
    try {
      await invokeCommand("installer_open_quick_launch_terminal", {
        toolId: recipe.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filteredEntries = normalizedQuery
    ? entries.filter((entry) =>
        `${entry.label} ${entry.command} ${entry.description}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : entries;
  const hasCli = entries.some((entry) => entry.cli);
  const description =
    recipe.descriptionLocales?.[i18n.language] ?? recipe.descriptionEn;

  return (
    <>
      <ToolDialogHeader
        recipe={recipe}
        title={t("installer.launcher.title", { name: recipe.name })}
        version={detected?.installedVersion ?? null}
        sub={description}
      />
      <div className="installer-tool-dialog__body installer-suite-launcher">
        <label className="installer-suite-launcher__search">
          <DIcon name="search" size={15} />
          <input
            type="search"
            placeholder={t("installer.quickLaunch.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <ul className="installer-suite-launcher__list">
          {filteredEntries.map((entry) => (
            <li key={entry.command} className="installer-suite-launcher__item">
              <div className="installer-suite-launcher__meta">
                <span className="installer-suite-launcher__name">
                  {entry.label}
                  <code>{entry.command}</code>
                </span>
                <span className="installer-suite-launcher__desc">
                  {entry.description}
                </span>
              </div>
              {entry.cli ? (
                <span className="installer-suite-launcher__badge">
                  {t("installer.quickLaunch.cli")}
                </span>
              ) : (
                <Btn sm onClick={() => void handleLaunch(entry.command)}>
                  {t("installer.quickLaunch.launch")}
                </Btn>
              )}
            </li>
          ))}
          {filteredEntries.length === 0 ? (
            <li className="installer-suite-launcher__empty">
              {t("installer.quickLaunch.noMatches")}
            </li>
          ) : null}
        </ul>
      </div>
      <LegacyDialogActions
        className="installer-tool-dialog__actions"
        primary={
          hasCli ? (
            <Btn kind="primary" icon="terminal" onClick={() => void handleOpenTerminal()}>
              {suiteTerminalIsElevated(recipe.id)
                ? t("installer.quickLaunch.openTerminal")
                : t("installer.launcher.openTerminal")}
            </Btn>
          ) : null
        }
        cancel={<Btn onClick={closeDialog}>{t("common.close")}</Btn>}
      />
    </>
  );
}

// =================================================================
// Small shared helpers
// =================================================================

function ToolIcon({ recipe }: { recipe: Recipe }) {
  return (
    <img
      className="installer-tool-dialog__icon"
      src={iconUrlForRecipe(recipe.id)}
      alt=""
      draggable={false}
      onError={(event) => {
        const img = event.currentTarget;
        if (img.src !== FALLBACK_ICON_URL) {
          img.src = FALLBACK_ICON_URL;
        }
      }}
    />
  );
}

function ToolDialogHeader({
  recipe,
  title,
  version,
  sub,
  busy = false,
}: {
  recipe: Recipe;
  title: React.ReactNode;
  version?: string | null;
  sub?: React.ReactNode;
  busy?: boolean;
}) {
  return (
    <header className="installer-tool-dialog__header">
      <span className="installer-tool-dialog__icon-wrap">
        <ToolIcon recipe={recipe} />
      </span>
      <div className="installer-tool-dialog__heading">
        <div className="installer-tool-dialog__title-line">
          {busy ? <span className="installer-tool-dialog__spinner" aria-hidden="true" /> : null}
          <h2>{title}</h2>
          {version ? (
            <span className="installer-tool-dialog__version">{version}</span>
          ) : null}
        </div>
        {sub ? <p className="installer-tool-dialog__header-sub">{sub}</p> : null}
      </div>
    </header>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function LatestVersionValue({
  checking,
  error,
  onRefresh,
  value,
}: {
  checking: boolean;
  error: string | null | undefined;
  onRefresh: () => void;
  value: string | null;
}) {
  const { t } = useTranslation();
  return (
    <span className="installer-tool-dialog__latest-value">
      {error ? (
        <span className="installer-tool-dialog__value-error">{error}</span>
      ) : (
        value
      )}
      <button
        type="button"
        className="installer-tool-dialog__inline-action"
        onClick={onRefresh}
        disabled={checking}
      >
        {checking ? t("installer.dialog.checkingDots") : t("installer.refresh")}
      </button>
    </span>
  );
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children?: React.ReactNode;
}) {
  // Open via opener plugin so external URLs go to the system browser, not
  // an in-app webview that we don't intend to host arbitrary sites in.
  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (!isTauriRuntime()) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    void openExternalUrl(href).catch(() => {
      window.open(href, "_blank", "noopener,noreferrer");
    });
  }
  return (
    <a href={href} onClick={handleClick} rel="noopener noreferrer">
      {children ?? href}
    </a>
  );
}

function OptionsForm({
  recipe,
  options,
  onChange,
}: {
  recipe: Recipe;
  options: InstallOptions;
  onChange: <K extends keyof InstallOptions>(
    key: K,
    value: InstallOptions[K],
  ) => void;
}) {
  const { t } = useTranslation();
  const supported = new Set<RecipeOption>(recipe.options ?? []);
  const canChooseDownload =
    supported.has("provider") &&
    (recipe.downloadProvider?.kind === "downloadInstaller" ||
      recipe.downloadProvider?.kind === "githubRelease");
  const canChooseChocolatey =
    recipe.id !== "chocolatey" &&
    supported.has("provider") &&
    recipe.chocolateyProvider?.kind === "chocolatey";
  const canChooseNpm =
    supported.has("provider") && recipe.npmProvider?.kind === "npm";
  const usingDownloadProvider =
    canChooseDownload && options.provider === "download";
  const selectedProvider = selectedProviderForRecipe(recipe, options);
  const selectedProviderKind = selectedProvider?.kind;
  const showSelfElevatingScopeHint =
    selectedProviderKind === "winget" && isKnownSelfElevatingWingetRecipe(recipe);
  if (supported.size === 0) return null;
  return (
    <div
      className="installer-tool-dialog__options"
      data-tutorial-id="installer.toolOptions"
    >
      {canChooseDownload || canChooseChocolatey || canChooseNpm ? (
        <label>
          <span>{t("installer.options.provider")}</span>
          <select
            value={options.provider ?? "default"}
            onChange={(event) =>
              onChange(
                "provider",
                event.target.value as
                  | "default"
                  | "download"
                  | "chocolatey"
                  | "npm",
              )
            }
          >
            <option value="default">{providerSummary(recipe.provider)}</option>
            {canChooseDownload ? (
              <option value="download">
                {providerSummary(recipe.downloadProvider!)}
              </option>
            ) : null}
            {canChooseChocolatey ? (
              <option value="chocolatey">
                {providerSummary(recipe.chocolateyProvider!)}
              </option>
            ) : null}
            {canChooseNpm ? (
              <option value="npm">{providerSummary(recipe.npmProvider!)}</option>
            ) : null}
          </select>
        </label>
      ) : null}
      {supported.has("scope") && selectedProviderKind === "winget" ? (
        <label>
          <span>{t("installer.options.scope")}</span>
          <select
            value={options.scope ?? "user"}
            onChange={(event) =>
              onChange("scope", event.target.value as "user" | "machine")
            }
          >
            <option value="user">{t("installer.options.scopeUser")}</option>
            <option value="machine">
              {t("installer.options.scopeMachine")}
            </option>
          </select>
          {showSelfElevatingScopeHint ? (
            <span className="installer-tool-dialog__option-hint">
              {t("installer.options.scopeSelfElevatingHint")}
            </span>
          ) : null}
        </label>
      ) : null}
      {supported.has("version") && !usingDownloadProvider ? (
        <label>
          <span>{t("installer.options.version")}</span>
          <input
            type="text"
            placeholder={t("installer.options.versionLatest")}
            value={options.version ?? ""}
            onChange={(event) => onChange("version", event.target.value)}
          />
        </label>
      ) : null}
      {supported.has("location") && selectedProviderKind === "githubRelease" ? (
        <label>
          <span>{t("installer.options.location")}</span>
          <input
            type="text"
            value={options.location ?? ""}
            onChange={(event) => onChange("location", event.target.value)}
          />
        </label>
      ) : null}
      {supported.has("addToPath") && selectedProviderKind === "githubRelease" ? (
        <label>
          <input
            type="checkbox"
            checked={options.addToPath ?? false}
            onChange={(event) => onChange("addToPath", event.target.checked)}
          />
          <span>{t("installer.options.addToPath")}</span>
        </label>
      ) : null}
    </div>
  );
}


function defaultInstallOptionsForRecipe(
  recipe: Recipe,
  preferredProvider: "winget" | "chocolatey",
): InstallOptions {
  if (
    preferredProvider === "chocolatey" &&
    recipe.id !== "chocolatey" &&
    recipe.options?.includes("provider") &&
    recipe.provider.kind === "winget" &&
    recipe.chocolateyProvider?.kind === "chocolatey"
  ) {
    return { provider: "chocolatey" };
  }
  if (preferredProvider === "chocolatey" && recipe.provider.kind === "bundle") {
    return { provider: "chocolatey" };
  }
  return {};
}

function selectedProviderForRecipe(
  recipe: Recipe,
  options: InstallOptions,
): Provider {
  if (
    options.provider === "download" &&
    (recipe.downloadProvider?.kind === "downloadInstaller" ||
      recipe.downloadProvider?.kind === "githubRelease")
  ) {
    return recipe.downloadProvider;
  }
  if (
    options.provider === "chocolatey" &&
    recipe.chocolateyProvider?.kind === "chocolatey"
  ) {
    return recipe.chocolateyProvider;
  }
  if (options.provider === "npm" && recipe.npmProvider?.kind === "npm") {
    return recipe.npmProvider;
  }
  return recipe.provider;
}

/// Provider that detected this installed recipe. Mirrors the backend detection
/// provider marker, with older cached states falling back to the catalog
/// primary provider.
function detectedProviderForRecipe(
  recipe: Recipe,
  detected: DetectedState | undefined,
): Provider {
  if (
    detected?.installProvider === "chocolatey" &&
    recipe.chocolateyProvider?.kind === "chocolatey"
  ) {
    return recipe.chocolateyProvider;
  }
  if (
    detected?.installProvider === "githubRelease" &&
    recipe.downloadProvider?.kind === "githubRelease"
  ) {
    return recipe.downloadProvider;
  }
  if (
    detected?.installProvider === "downloadInstaller" &&
    recipe.downloadProvider?.kind === "downloadInstaller"
  ) {
    return recipe.downloadProvider;
  }
  if (
    detected?.installProvider === "npm" &&
    recipe.npmProvider?.kind === "npm"
  ) {
    return recipe.npmProvider;
  }
  return recipe.provider;
}

/// Whether an install/update/uninstall of this recipe will run through the
/// Chocolatey provider — which the Rust side always runs elevated (one UAC
/// prompt) and machine-wide.
function recipeUsesChocolateyProvider(
  recipe: Recipe,
  detected: DetectedState | undefined,
  options?: InstallOptions,
): boolean {
  if (
    options?.provider === "chocolatey" &&
    recipe.chocolateyProvider?.kind === "chocolatey"
  ) {
    return true;
  }
  if (recipe.provider.kind === "chocolatey") return true;
  return detectedProviderForRecipe(recipe, detected).kind === "chocolatey";
}

function recipeSupportsScope(recipe: Recipe): boolean {
  return (recipe.options ?? []).includes("scope");
}

function installModeForOptions(
  recipe: Recipe,
  options: InstallOptions,
): "user" | "machine" | null {
  if (selectedProviderForRecipe(recipe, options).kind !== "winget") return null;
  if (recipeSupportsScope(recipe)) return options.scope ?? "user";
  return "machine";
}

function installModeForInstalledRecipe(
  detected: { installScope?: "user" | "machine" | null } | undefined,
): "user" | "machine" | null {
  if (detected?.installScope === "user" || detected?.installScope === "machine") {
    return detected.installScope;
  }
  return null;
}

function installModeLabel(
  scope: "user" | "machine",
  t: (key: string) => string,
): string {
  return scope === "machine"
    ? t("installer.options.scopeMachine")
    : t("installer.options.scopeUser");
}

function providerSummary(provider: Provider): string {
  switch (provider.kind) {
    case "winget":
      return `winget · ${provider.id}`;
    case "chocolatey":
      return `Chocolatey · ${provider.id}`;
    case "npm":
      return `npm · ${provider.pkg}`;
    case "uvPip":
      return `uv pip · ${provider.package}`;
    case "downloadInstaller":
      return `download · ${provider.fileName}`;
    case "githubRelease":
      return `GitHub release · ${provider.repo}`;
    case "windowsFeature":
      return `Windows feature · ${provider.feature}`;
    case "wslDistro":
      return `WSL distro · ${provider.distro}`;
    case "bundle":
      return `bundle · ${provider.steps.length} step(s)`;
  }
}

function deriveProviderUrl(provider: Provider): string | null {
  switch (provider.kind) {
    case "githubRelease":
      return `https://github.com/${provider.repo}/releases`;
    case "npm":
      return `https://www.npmjs.com/package/${encodeURIComponent(provider.pkg)}`;
    case "uvPip":
      return `https://pypi.org/project/${encodeURIComponent(provider.package)}/`;
    case "downloadInstaller":
      return provider.url;
    case "winget":
      return `https://winstall.app/apps/${encodeURIComponent(provider.id)}`;
    case "chocolatey":
      return `https://community.chocolatey.org/packages/${encodeURIComponent(provider.id)}`;
    default:
      return null;
  }
}

function webUiAffordanceForRecipe(recipe: Recipe): { url: string } | null {
  switch (recipe.id) {
    case "n8n":
      return { url: "http://localhost:5678" };
    case "ollama":
      return { url: "http://localhost:11434" };
    case "flowise":
      return { url: "http://localhost:3000" };
    case "open-webui":
      return { url: "http://localhost:8080" };
    case "langflow":
      return { url: "http://localhost:7860" };
    case "excalidraw":
      return { url: "http://localhost:3021" };
    case "bentopdf":
      return { url: "http://localhost:3022" };
    case "openflowkit":
      return { url: "http://localhost:3023" };
    default:
      return null;
  }
}

function workspaceConnectionSpecForRecipe(
  recipe: Recipe,
): { name: string; request: CreateConnectionRequest } | null {
  switch (recipe.id) {
    case "hermes-agent":
      return {
        name: "Hermes Agent",
        request: {
          name: "Hermes Agent",
          type: "local",
          localShell: "powershell.exe",
          localStartupScript: [
            '& "$env:LOCALAPPDATA\\KKTerm\\installer\\apps\\hermes-agent\\.venv\\Scripts\\Activate.ps1"',
            "Write-Host ''",
            "Write-Host '  hermes setup  —  configure providers and accounts' -ForegroundColor Cyan",
            "Write-Host '  hermes postinstall  —  optional dependencies' -ForegroundColor Cyan",
            "Write-Host '  hermes doctor  —  health check' -ForegroundColor Cyan",
            "Write-Host '  hermes  —  start chatting' -ForegroundColor Cyan",
            "Write-Host ''",
          ].join("\n"),
        },
      };
    case "openclaw":
      return {
        name: "OpenClaw",
        request: {
          name: "OpenClaw",
          type: "local",
          localShell: "powershell.exe",
          localStartupScript: [
            'function openclaw { npm exec --prefix (Join-Path $env:LOCALAPPDATA "KKTerm\\installer\\apps\\openclaw") -- openclaw @args }',
            "Write-Host ''",
            "Write-Host '  openclaw onboard --install-daemon  —  setup and managed startup' -ForegroundColor Cyan",
            "Write-Host '  openclaw doctor  —  check configuration' -ForegroundColor Cyan",
            "Write-Host '  openclaw gateway status  —  verify gateway' -ForegroundColor Cyan",
            "Write-Host ''",
          ].join("\n"),
        },
      };
    default:
      return null;
  }
}

function serviceAffordanceForRecipe(recipe: Recipe): { name: string } | null {
  switch (recipe.id) {
    case "n8n":
      return { name: "KKTerm-n8n" };
    case "ollama":
      return { name: "KKTerm-Ollama" };
    case "flowise":
      return { name: "KKTerm-Flowise" };
    case "open-webui":
      return { name: "KKTerm-OpenWebUI" };
    case "langflow":
      return { name: "KKTerm-Langflow" };
    case "excalidraw":
      return { name: "KKTerm-Excalidraw" };
    case "bentopdf":
      return { name: "KKTerm-BentoPDF" };
    case "openflowkit":
      return { name: "KKTerm-OpenFlowKit" };
    default:
      return null;
  }
}

async function maybeStartManagedWebUiAfterInstall(
  recipe: Recipe,
  resultKind: "completed" | "failed" | "cancelled",
) {
  if (resultKind !== "completed") return;
  if (!webUiAffordanceForRecipe(recipe) || !isTauriRuntime()) return;
  try {
    await invokeCommand("installer_run_web_ui", { toolId: recipe.id });
  } catch {
    // The install succeeded; status UI and manual Run can surface retry errors.
  }
}

async function refreshManagedWebUiStatus(
  toolId: string,
  setStatus: (status: ManagedWebUiStatus | null) => void,
) {
  if (!isTauriRuntime()) return;
  const status = await invokeCommand("installer_get_web_ui_status", { toolId });
  setStatus(status);
}

function formatTimestamp(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 100) / 10;
  return `${seconds}s`;
}
