import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-boundary checks run on every platform. Rust tests exercise the actual
// builders/results; Windows-only Rust fixtures also execute the generated PS.
const source = readFileSync(new URL("../src-tauri/src/net/profiles.rs", import.meta.url), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const apply = section("fn windows_apply(request:", "fn windows_apply_broker(");
const script = section("fn windows_apply_script(", "fn windows_family_statements(");
const family = section("fn windows_family_statements(", "fn windows_dns_statements(");
const dns = section("fn windows_dns_statements(", "fn ps_quote(");

test("Windows apply retains a bounded result channel and captures broker errors", () => {
  assert.match(apply, /windows_apply_report_file\(\)\?/);
  assert.match(apply, /\.output\(\)/);
  assert.match(apply, /take\(32_768\)/);
  assert.match(apply, /output\.stderr/);
  assert.match(apply, /windows_apply_result/);
  assert.doesNotMatch(apply, /cancelled or failed/);
});

test("report path is created atomically and held without delete sharing", () => {
  const report = section("fn windows_apply_report_file(", "fn windows_apply(request:");
  assert.match(report, /create_new\(true\)/);
  assert.match(report, /share_mode\(0x00000001 \| 0x00000002\)/);
  assert.match(script, /FileMode\]::Open/);
  assert.doesNotMatch(script, /FileMode\]::Create|ReadAllText|Invoke-Expression/);
});

test("binding changes precede address configuration and avoid wildcard targeting", () => {
  assert.match(script, /WildcardPattern\]::Escape\(\$a\.Name\)/);
  assert.match(script, /if \(\$b\.Enabled -ne/);
  assert.ok(script.indexOf("protocol binding") < script.indexOf('windows_family_statements("IPv4"'));
  assert.match(script, /-NetAdapterBinding -InputObject \$b -Confirm:\$false -ErrorAction Stop/);
});

test("cleanup scopes each policy store to the selected interface and preserves errors", () => {
  assert.match(family, /\["PersistentStore", "ActiveStore"\]/);
  assert.match(family, /\$_\.InterfaceIndex -eq \$a\.ifIndex -and \$_\.AddressFamily/);
  for (const command of ["Remove-NetIPAddress", "Remove-NetRoute"]) {
    assert.match(family, new RegExp(`${command} -Confirm:\\$false -ErrorAction Stop`));
    assert.doesNotMatch(family, new RegExp(`${command}[^"\\n]*SilentlyContinue`));
  }
  assert.match(family, /'source=dhcp','store=persistent'/);
  assert.match(family, /out\.push\(configure\)/);
});

test("offline application uses persistent setters, not active interface readiness", () => {
  assert.doesNotMatch(script + family + dns, /Get-NetIPInterface|Set-NetIPInterface|New-NetIPAddress|Start-Sleep|Test-Connection/);
  assert.match(script, /adapter refresh/);
  assert.match(family, /'store=persistent'/);
  assert.match(script, /SystemDirectory\) 'netsh\.exe'/);
  assert.match(script, /\$code = \$LASTEXITCODE/);
  assert.match(script, /if \(\$code -ne 0\)/);
});

test("DNS is configured by enabled family without reachability validation", () => {
  assert.match(script, /windows_dns_statements\(request\)/);
  assert.match(dns, /family\.mode == IpMode::Disabled/);
  assert.match(dns, /address\.is_ipv6\(\) == ipv6/);
  assert.match(dns, /seen\.insert\(address\)/);
  assert.match(dns, /validate=no/);
  assert.doesNotMatch(dns, /validate=yes|Set-DnsClientServerAddress/);
  assert.match(dns, /unwrap_or\("none"\)/);
});

test("UAC and success receipts remain guarded", () => {
  assert.match(source, /NativeErrorCode -eq 1223/);
  assert.match(source, /success && report\.trim\(\) == "OK"/);
  assert.match(apply, /broker\.encode_utf16\(\)\.count\(\) > 30_000/);
});

test("widget emits one success popup after native apply succeeds, not on failure", () => {
  const widget = readFileSync(new URL("../src/modules/dashboard/widgets/builtin/network-profiles/NetworkProfilesWidget.tsx", import.meta.url), "utf8");
  const action = widget.slice(widget.indexOf("async function applyProfile("), widget.indexOf("function confirmDelete("));
  assert.ok(action.length > 0);
  const success = action.slice(0, action.indexOf("} catch (error)"));
  const failure = action.slice(action.indexOf("} catch (error)"));
  assert.ok(success.indexOf('await invokeCommand("network_profiles_apply"') < success.indexOf('t("dashboard.networkProfilesApplied"'));
  assert.match(success, /showStatusBarNotice\(t\("dashboard\.networkProfilesApplied",[\s\S]*?tone: "success"/);
  assert.equal(action.match(/dashboard\.networkProfilesApplied/g)?.length, 1);
  assert.match(failure, /dashboard\.networkProfilesApplyError/);
  assert.doesNotMatch(failure, /tone: "success"/);
});
