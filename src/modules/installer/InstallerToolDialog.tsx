// Centered, app-owned dialog for one Installer Helper tool. Replaces the
// inline expanding tile body — single click on a tile opens this. Modes:
//   * "info" — installed: location, provider, versions, pin, update/uninstall.
//             not installed: homepage, release notes, latest, prereqs, options.
//   * "stepper" — install in progress or just completed; renders the n8n-style
//                 step list with per-step logs. Pressing Install from "info"
//                 mode flips the dialog to "stepper".
//
// Honors AGENTS.md dialog rules: top-right close, concise title (no
// subtitle), Windows-order footer buttons (primary immediately before Cancel
// at bottom right).

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  invokeCommand,
  isTauriRuntime,
  openExternalUrl,
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
import { InstallerConfirmDialog } from "./InstallerConfirmDialog";
import { installRecipeAndWait } from "./progress";
import { ToggleSwitch } from "../settings/ToggleSwitch";
import { useInstallerStore, type StepStatus } from "./state";
import { notifyConnectionTreeInvalidated } from "../workspace/connections/connectionSidebarState";
import { isInstallerUpdateAvailable } from "./versionCompare";
import {
  latestVersionWebUrlForRecipe,
  recipeSupportsLatestVersion,
} from "./latestSupport";
import type {
  InstallOptions,
  ManagedWebUiStatus,
  Provider,
  Recipe,
  RecipeOption,
} from "./types";
import type { CreateConnectionRequest } from "../../types";

export function InstallerToolDialog() {
  const { t } = useTranslation();
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
    <div className="dialog-backdrop connection-dialog-backdrop" role="presentation">
      <div
        aria-label={recipe.name}
        aria-modal="true"
        className="connection-dialog installer-tool-dialog"
        role="dialog"
      >
        <button
          type="button"
          className="installer-tool-dialog__close"
          aria-label={t("common.close")}
          onClick={closeDialog}
        >
          ×
        </button>
        {open.mode === "stepper" ? (
          <StepperBody recipe={recipe} />
        ) : (
          <InfoBody recipe={recipe} />
        )}
      </div>
    </div>
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
  const allDetected = useInstallerStore((s) => s.detected);
  const catalog = useInstallerStore((s) => s.catalog);
  const closeDialog = useInstallerStore((s) => s.closeDialog);
  const openStepperDialog = useInstallerStore((s) => s.openStepperDialog);
  const beginInFlight = useInstallerStore((s) => s.beginInFlight);
  const showStatusBarNotice = useWorkspaceStore(
    (state) => state.showStatusBarNotice,
  );

  const [uninstallConfirm, setUninstallConfirm] = useState<null | {
    dependents: string[];
  }>(null);

  const description =
    recipe.descriptionLocales?.[i18n.language] ?? recipe.descriptionEn;
  const version = detected?.installedVersion ?? null;
  const latest = toolState?.latestVersionSeen ?? null;
  const supportsLatestVersion = recipeSupportsLatestVersion(recipe);
  const latestWebUrl = latestVersionWebUrlForRecipe(recipe);
  const hasUpdate =
    supportsLatestVersion && isInstallerUpdateAvailable(latest, version);
  const webUi = webUiAffordanceForRecipe(recipe);
  const service = serviceAffordanceForRecipe(recipe);
  const terminalLaunch = terminalLaunchAffordanceForRecipe(recipe);
  const workspaceSpec = workspaceConnectionSpecForRecipe(recipe);
  const [webUiStatus, setWebUiStatus] = useState<ManagedWebUiStatus | null>(
    null,
  );
  const statusRefreshInFlight = useRef(false);

  useEffect(() => {
    if (!webUi || !isTauriRuntime()) {
      setWebUiStatus(null);
      return;
    }
    let cancelled = false;
    async function refresh() {
      if (statusRefreshInFlight.current) return;
      statusRefreshInFlight.current = true;
      try {
        const status = await invokeCommand("installer_get_web_ui_status", {
          toolId: recipe.id,
        });
        if (!cancelled) setWebUiStatus(status);
      } catch {
        if (!cancelled) setWebUiStatus(null);
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
  }, [recipe.id, !!webUi]);

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

  function startUpdate() {
    if (!catalog) return;
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

  async function handleRunWebUi() {
    if (!webUi || !isTauriRuntime()) return;
    try {
      await invokeCommand("installer_run_web_ui", { toolId: recipe.id });
      await refreshManagedWebUiStatus(recipe.id, setWebUiStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
    }
  }

  async function handleStopWebUi() {
    if (!webUi || !isTauriRuntime()) return;
    try {
      await invokeCommand("installer_stop_web_ui", { toolId: recipe.id });
      await refreshManagedWebUiStatus(recipe.id, setWebUiStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
    }
  }

  function handleOpenWebUi() {
    if (!webUi) return;
    if (!isTauriRuntime()) {
      window.open(webUi.url, "_blank", "noopener,noreferrer");
      return;
    }
    void openExternalUrl(webUi.url).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
    });
  }

  async function handleInstallService() {
    if (!service || !isTauriRuntime()) return;
    try {
      await invokeCommand("installer_install_service", { toolId: recipe.id });
      showStatusBarNotice(t("installer.status.serviceInstalled"));
      await refreshManagedWebUiStatus(recipe.id, setWebUiStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
    }
  }

  async function handleRemoveService() {
    if (!service || !isTauriRuntime()) return;
    try {
      await invokeCommand("installer_remove_service", { toolId: recipe.id });
      showStatusBarNotice(t("installer.status.serviceRemoved"));
      await refreshManagedWebUiStatus(recipe.id, setWebUiStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
    }
  }

  async function handleOpenTerminalLauncher() {
    if (!isTauriRuntime()) return;
    try {
      await invokeCommand("installer_open_terminal_launcher", { toolId: recipe.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatusBarNotice(message, { tone: "error" });
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
      <header className="installer-tool-dialog__header">
        <ToolIcon recipe={recipe} />
        <div>
          <h2>
            {recipe.name}
            {version ? (
              <span className="installer-tool-dialog__version"> {version}</span>
            ) : null}
          </h2>
        </div>
      </header>
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
            <button
              type="button"
              className="installer-button primary"
              onClick={startUpdate}
            >
              {t("installer.actions.update")}
            </button>
          </div>
        ) : null}
        <dl className="installer-tool-dialog__grid">
          {detected?.installLocation ? (
            <Row label={t("installer.dialog.installLocation")}>
              <code>{detected.installLocation}</code>
            </Row>
          ) : null}
          <Row label={t("installer.dialog.provider")}>
            {providerSummary(recipe.provider)}
          </Row>
          {version ? (
            <Row label={t("installer.dialog.installedVersion")}>
              {version}
            </Row>
          ) : null}
          {supportsLatestVersion && (latestError || latest) ? (
            <Row label={t("installer.dialog.latestVersion")}>
              <span
                className={latestError ? "installer-tool-dialog__value-error" : undefined}
              >
                {latestError ?? latest}
              </span>
            </Row>
          ) : latestWebUrl ? (
            <Row label={t("installer.dialog.latestVersion")}>
              <ExternalLink href={latestWebUrl}>{t("installer.status.web")}</ExternalLink>
            </Row>
          ) : null}
          {supportsLatestVersion && toolState?.lastCheckAt ? (
            <Row label={t("installer.dialog.lastChecked")}>
              {formatTimestamp(toolState.lastCheckAt)}
            </Row>
          ) : null}
          {webUi ? (
            <Row label={t("installer.dialog.webUi")}>
              <ExternalLink href={webUi.url} />
            </Row>
          ) : null}
          {service ? (
            <Row label={t("installer.dialog.windowsService")}>
              <code>{service.name}</code>
            </Row>
          ) : null}
          {webUi ? (
            <Row label={t("installer.dialog.runtimeStatus")}>
              {webUiStatus?.running
                ? t("installer.status.running")
                : t("installer.status.stopped")}
            </Row>
          ) : null}
          {service && webUiStatus?.serviceInstalled ? (
            <Row label={t("installer.dialog.serviceStartup")}>
              {webUiStatus.startup ?? t("installer.status.unknown")}
            </Row>
          ) : null}
          {terminalLaunch ? (
            <Row label={t("installer.dialog.runHints")}>
              <span style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                {terminalLaunch.hints.map((hint, i) => (
                  <code key={i}>{hint}</code>
                ))}
              </span>
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
      <div className="dialog-actions installer-tool-dialog__actions">
        <button
          type="button"
          className="secondary-button danger"
          onClick={attemptUninstall}
        >
          {t("installer.actions.uninstall")}
        </button>
        {terminalLaunch ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => void handleOpenTerminalLauncher()}
          >
            {t("installer.actions.run")}
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
        {webUi ? (
          <>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                webUiStatus?.running
                  ? void handleStopWebUi()
                  : void handleRunWebUi()
              }
            >
              {webUiStatus?.running
                ? t("installer.actions.stop")
                : t("installer.actions.run")}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={handleOpenWebUi}
            >
              {t("installer.actions.openWebUi")}
            </button>
          </>
        ) : null}
        {service ? (
          <>
            {!webUiStatus?.serviceInstalled ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void handleInstallService()}
              >
                {t("installer.actions.registerService")}
              </button>
            ) : (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void handleRemoveService()}
              >
                {t("installer.actions.removeService")}
              </button>
            )}
          </>
        ) : null}
        {hasUpdate ? (
          <button
            type="button"
            className="secondary-button"
            onClick={startUpdate}
          >
            {t("installer.actions.update")}
          </button>
        ) : null}
        <button type="button" className="toolbar-button" onClick={closeDialog}>
          {t("common.close")}
        </button>
      </div>
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
            uninstallConfirm.dependents.length > 0
              ? t("installer.confirm.uninstallDependentsFooter")
              : undefined
          }
          confirmLabel={t("installer.confirm.uninstallConfirm")}
          tone="danger"
          onConfirm={() => void doUninstall()}
          onCancel={() => setUninstallConfirm(null)}
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
  const checking = useInstallerStore((s) => s.checking);
  const catalog = useInstallerStore((s) => s.catalog);
  const closeDialog = useInstallerStore((s) => s.closeDialog);
  const openStepperDialog = useInstallerStore((s) => s.openStepperDialog);
  const beginInFlight = useInstallerStore((s) => s.beginInFlight);
  const wslJustEnabled = useInstallerStore((s) => s.wslJustEnabled);

  const [options, setOptions] = useState<InstallOptions>({});
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

  function applyOption<K extends keyof InstallOptions>(
    key: K,
    value: InstallOptions[K],
  ) {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCheckNow() {
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
    openStepperDialog(recipe.id);
    for (const queuedRecipe of recipes) {
      beginInFlight(queuedRecipe.id, "install");
      try {
        const terminalEvent = await installRecipeAndWait(
          queuedRecipe.id,
          queuedRecipe.id === recipe.id ? options : {},
        );
            if (terminalEvent.kind !== "completed") {
              break;
            }
            await maybeStartManagedWebUiAfterInstall(
              queuedRecipe,
              terminalEvent.kind,
            );
            if (isWslFeature(queuedRecipe) && queuedRecipe.id !== recipe.id) {
              break;
            }
      } catch {
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
      <header className="installer-tool-dialog__header">
        <ToolIcon recipe={recipe} />
        <div>
          <h2>{recipe.name}</h2>
        </div>
      </header>
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
          {supportsLatestVersion ? (
            <Row label={t("installer.dialog.latestVersion")}>
              {latestError ? (
                <span className="installer-tool-dialog__value-error">
                  {latestError}
                </span>
              ) : toolState?.latestVersionSeen ?? (
                <button
                  type="button"
                  className="installer-tool-dialog__inline-action"
                  onClick={() => void handleCheckNow()}
                  disabled={checking}
                >
                  {checking
                    ? t("installer.dialog.checkingDots")
                    : t("installer.dialog.checkNow")}
                </button>
              )}
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
      <div className="dialog-actions installer-tool-dialog__actions">
        <button
          type="button"
          className="secondary-button"
          onClick={attemptInstall}
          disabled={wslBlocked}
        >
          {t("installer.actions.install")}
        </button>
        <button type="button" className="toolbar-button" onClick={closeDialog}>
          {t("common.cancel")}
        </button>
      </div>
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
      <header className="installer-tool-dialog__header">
        <ToolIcon recipe={recipe} />
        <div>
          <h2>{t(titleKey, { name: recipe.name })}</h2>
        </div>
      </header>
      <div className="installer-tool-dialog__body">
        {lastStatus?.kind === "failed" ? (
          <p
            className="installer-tool-dialog__hint installer-tool-dialog__hint--error"
            role="status"
          >
            {lastStatus.message}
          </p>
        ) : null}
        {lastStatus?.kind === "cancelled" ? (
          <p className="installer-tool-dialog__hint" role="status">
            {t("installer.status.cancelled")}
          </p>
        ) : null}
        <StepperList stepper={stepper} inFlight={inFlight} />
      </div>
      <div className="dialog-actions installer-tool-dialog__actions">
        {running ? (
          <button
            type="button"
            className="secondary-button danger"
            onClick={() => void handleCancel()}
          >
            {t("installer.actions.cancel")}
          </button>
        ) : null}
        <button type="button" className="toolbar-button" onClick={closeDialog}>
          {t("common.close")}
        </button>
      </div>
    </>
  );
}

function StepperList({
  stepper,
  inFlight,
}: {
  stepper:
    | ReturnType<typeof useInstallerStore.getState>["stepperState"][string]
    | undefined;
  inFlight: ReturnType<typeof useInstallerStore.getState>["inFlight"][string];
}) {
  const { t } = useTranslation();
  const [manualExpanded, setManualExpanded] = useState<Record<string, boolean>>(
    {},
  );

  // No declared plan yet (legacy provider or stepper opened before plan
  // event lands). Fall back to today's single-current-step view from
  // inFlight so the user always sees activity.
  const hasPlan = !!stepper && stepper.plan.length > 0;

  if (!hasPlan) {
    return (
      <div className="installer-stepper installer-stepper--legacy">
        {inFlight?.currentStep ? (
          <div className="installer-stepper__legacy-step">
            {inFlight.currentStep}
          </div>
        ) : null}
        {inFlight?.ratio != null ? (
          <progress
            className="installer-stepper__bar"
            value={inFlight.ratio}
            max={1}
          />
        ) : null}
        {inFlight?.log && inFlight.log.length > 0 ? (
          <pre className="installer-stepper__log" aria-live="polite">
            {inFlight.log.slice(-30).join("\n")}
          </pre>
        ) : null}
      </div>
    );
  }

  const active = stepper!.activeStepId;
  function isExpanded(stepId: string): boolean {
    if (stepId in manualExpanded) return manualExpanded[stepId]!;
    return stepId === active;
  }

  return (
    <ol className="installer-stepper">
      {stepper!.plan.map((step) => {
        const status = (stepper!.status[step.id] ?? "pending") as StepStatus;
        const expanded = isExpanded(step.id);
        const log = stepper!.logs[step.id] ?? [];
        const duration = stepper!.durations[step.id];
        const error = stepper!.errors[step.id];
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
                {t(step.labelKey, { defaultValue: step.id })}
              </span>
              <span className="installer-stepper__meta">
                {status === "done" && duration != null
                  ? formatDuration(duration)
                  : status === "running" && ratio != null
                    ? `${Math.round(ratio * 100)}%`
                    : status === "failed"
                      ? t("installer.stepper.failedBadge")
                      : ""}
              </span>
            </button>
            {expanded ? (
              <div className="installer-stepper__row-body">
                {status === "running" && ratio != null ? (
                  <progress
                    className="installer-stepper__bar"
                    value={ratio}
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
    recipe.downloadProvider?.kind === "downloadInstaller";
  const usingDownloadProvider =
    canChooseDownload && options.provider === "download";
  const showSelfElevatingScopeHint =
    !usingDownloadProvider && isKnownSelfElevatingWingetRecipe(recipe);
  if (supported.size === 0) return null;
  return (
    <div
      className="installer-tool-dialog__options"
      data-tutorial-id="installer.toolOptions"
    >
      {canChooseDownload ? (
        <label>
          <span>{t("installer.options.provider")}</span>
          <select
            value={options.provider ?? "default"}
            onChange={(event) =>
              onChange("provider", event.target.value as "default" | "download")
            }
          >
            <option value="default">{providerSummary(recipe.provider)}</option>
            <option value="download">
              {providerSummary(recipe.downloadProvider!)}
            </option>
          </select>
        </label>
      ) : null}
      {supported.has("scope") && !usingDownloadProvider ? (
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
      {supported.has("location") && !usingDownloadProvider ? (
        <label>
          <span>{t("installer.options.location")}</span>
          <input
            type="text"
            value={options.location ?? ""}
            onChange={(event) => onChange("location", event.target.value)}
          />
        </label>
      ) : null}
      {supported.has("addToPath") && !usingDownloadProvider ? (
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

function selectedProviderForRecipe(
  recipe: Recipe,
  options: InstallOptions,
): Provider {
  if (
    options.provider === "download" &&
    recipe.downloadProvider?.kind === "downloadInstaller"
  ) {
    return recipe.downloadProvider;
  }
  return recipe.provider;
}

function providerSummary(provider: Provider): string {
  switch (provider.kind) {
    case "winget":
      return `winget · ${provider.id}`;
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

function terminalLaunchAffordanceForRecipe(
  recipe: Recipe,
): { hints: string[] } | null {
  switch (recipe.id) {
    case "hermes-agent":
      return {
        hints: [
          "hermes setup  —  configure providers and accounts",
          "hermes postinstall  —  optional dependencies",
          "hermes doctor  —  health check",
          "hermes  —  start chatting",
        ],
      };
    case "openclaw":
      return {
        hints: [
          "openclaw onboard --install-daemon  —  setup and managed startup",
          "openclaw doctor  —  check configuration",
          "openclaw gateway status  —  verify gateway",
        ],
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
