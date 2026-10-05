import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultRdpSettings } from "../src/app-defaults";
import { ensureI18nReady, switchLanguage } from "../src/i18n/config";
import type { Connection, RdpConnectionOptions as RdpOptions } from "../src/types";

// The real RDP components import the shared local-resource selector's CSS.
// Server rendering checks component output, not browser styling or geometry.
const stylesheetHook = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return { format: "module", source: "", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { RdpSettings } = await import("../src/modules/settings/RdpSettings");
const { RdpConnectionOptions } = await import(
  "../src/modules/workspace/connections/connection-dialog/RdpConnectionFields"
);
stylesheetHook.deregister();

await ensureI18nReady();
beforeEach(async () => { await switchLanguage("en"); });

function renderConnection({
  inherited = false,
  globalEnabled = true,
  options,
}: {
  inherited?: boolean;
  globalEnabled?: boolean;
  options?: RdpOptions;
} = {}) {
  const initialConnection: Connection | undefined = options ? {
    id: "rdp-component-test", name: "RDP component test", host: "example.test",
    user: "operator", type: "rdp", status: "idle", rdpOptions: options,
  } : undefined;
  return renderToStaticMarkup(createElement(RdpConnectionOptions, {
    initialConnection,
    rdpInheritsSettingsDefaults: inherited,
    onInheritsSettingsDefaultsChange: () => undefined,
    rdpSettings: { ...defaultRdpSettings, openInFullscreen: globalEnabled },
  }));
}

function fullscreenSwitch(markup: string, label = "Open in fullscreen") {
  const element = [...markup.matchAll(/<div\b[^>]*\brole="switch"[^>]*>/g)]
    .map((match) => match[0]).find((tag) => tag.includes(`aria-label="${label}"`));
  assert.ok(element, `expected an accessible switch named ${label}`);
  return element;
}

function assertSwitchState(markup: string, checked: boolean, disabled: boolean, label?: string) {
  const element = fullscreenSwitch(markup, label);
  assert.ok(element.includes(`aria-checked="${checked}"`));
  assert.ok(element.includes(`aria-disabled="${disabled}"`));
  assert.ok(element.includes(`tabindex="${disabled ? -1 : 0}"`));
}

function assertSerializedState(markup: string, checked: boolean) {
  const field = [...markup.matchAll(/<input\b[^>]*>/g)]
    .map((match) => match[0]).find((tag) => tag.includes('name="rdpOpenInFullscreen"'));
  assert.ok(field, "expected the form's serialized startup preference");
  assert.ok(field.includes('type="hidden"'));
  assert.ok(field.includes(`value="${checked ? "on" : ""}"`));
}

function assertFiveScalingModes(markup: string) {
  const selects = [...markup.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/g)];
  const viewMode = selects.find((match) => match[1].includes('value="fit"'));
  assert.ok(viewMode, "expected the existing scaling selector");
  assert.deepEqual([...viewMode[1].matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]),
    ["fit", "stretch", "actualSize", "fitWidth", "fitHeight"]);
}

test("real global RDP switch renders English, default-off, keyboard-accessible and separate from scaling", () => {
  const markup = renderToStaticMarkup(createElement(RdpSettings));
  assertSwitchState(markup, false, false);
  assert.ok(!markup.includes("Open new RDP sessions in fullscreen. Exit fullscreen to return to the workspace."));
  assert.ok(markup.includes('data-tutorial-id="settings.rdpOpenInFullscreen"'));
  assertFiveScalingModes(markup);
  assert.ok(markup.indexOf('data-tutorial-id="settings.rdpRemoteResolution"')
    < markup.indexOf('data-tutorial-id="settings.rdpOpenInFullscreen"'));
});

test("both real switches render the Taiwan Traditional Chinese label without redundant helper text", async () => {
  await switchLanguage("zh-TW");
  for (const markup of [renderToStaticMarkup(createElement(RdpSettings)), renderConnection({ globalEnabled: false })]) {
    assertSwitchState(markup, false, false, "連線後以全螢幕開啟");
    assert.ok(!markup.includes("新的RDP連線成功後自動進入全螢幕；離開全螢幕後返回原本的工作區。"));
    assertFiveScalingModes(markup);
  }
});

test("inherited Connection renders the enabled global default disabled and serializes its displayed value", () => {
  const markup = renderConnection({ inherited: true, options: { inheritDefaults: false, openInFullscreen: false } });
  assertSwitchState(markup, true, true);
  assertSerializedState(markup, true);
  assertFiveScalingModes(markup);
  assert.match(markup, /<input[^>]*name="rdpInheritDefaults"[^>]*checked=""/);
  assert.ok(markup.indexOf('name="rdpRemoteResolution"') < markup.indexOf('aria-label="Open in fullscreen"'));
  assert.ok(markup.indexOf('aria-label="Open in fullscreen"') < markup.indexOf("connection-advanced-section"));
});

test("custom Connection can explicitly disable startup fullscreen while the global default is enabled", () => {
  const markup = renderConnection({ options: { inheritDefaults: false, openInFullscreen: false } });
  assertSwitchState(markup, false, false);
  assertSerializedState(markup, false);
  assertFiveScalingModes(markup);
});

test("legacy custom Connection without startup preference remains off even with global fullscreen enabled", () => {
  const markup = renderConnection({ options: { inheritDefaults: false } });
  assertSwitchState(markup, false, false);
  assertSerializedState(markup, false);
});

test("custom Connection can enable startup fullscreen while the global default is disabled", () => {
  const markup = renderConnection({ globalEnabled: false, options: { inheritDefaults: false, openInFullscreen: true } });
  assertSwitchState(markup, true, false);
  assertSerializedState(markup, true);
});

test("inherited Connection follows a disabled global default even if an old override was enabled", () => {
  const markup = renderConnection({ inherited: true, globalEnabled: false, options: { inheritDefaults: false, openInFullscreen: true } });
  assertSwitchState(markup, false, true);
  assertSerializedState(markup, false);
});

test("the real shared switch supports click, Enter and Space while inherited mode blocks changes", async () => {
  const { ToggleSwitch } = await import("../src/modules/settings/ToggleSwitch");
  let checked = false;
  let prevented = 0;
  const renderSwitch = (disabled = false) => ToggleSwitch({
    ariaLabel: "Open in fullscreen", checked, disabled,
    onChange: (next) => { checked = next; },
  });
  renderSwitch().props.onClick();
  assert.equal(checked, true);
  renderSwitch().props.onKeyDown({ key: "Enter", preventDefault: () => { prevented += 1; } });
  assert.equal(checked, false);
  renderSwitch().props.onKeyDown({ key: " ", preventDefault: () => { prevented += 1; } });
  assert.equal(checked, true);
  assert.equal(prevented, 2);
  renderSwitch(true).props.onClick();
  renderSwitch(true).props.onKeyDown({ key: "Enter", preventDefault: () => { prevented += 1; } });
  renderSwitch(true).props.onKeyDown({ key: " ", preventDefault: () => { prevented += 1; } });
  assert.equal(checked, true);
  assert.equal(prevented, 2);
});
