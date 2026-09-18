import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-boundary checks run on every platform. Rust tests exercise the actual
// builders/results; Windows-only Rust fixtures also execute the generated PS.
const source = readFileSync(new URL("../src-tauri/src/net/profiles.rs", import.meta.url), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const apply = section("fn windows_apply(request:", "fn windows_apply_broker(");
const script = section("fn windows_apply_script(", "fn windows_family_statements(");
const family = section("fn windows_family_statements(", "fn ps_quote(");

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
  assert.ok(family.indexOf("Remove-NetIPAddress") < family.indexOf("-Dhcp Enabled"));
});

test("UAC, readiness and command size have explicit guarded paths", () => {
  assert.match(source, /NativeErrorCode -eq 1223/);
  assert.match(source, /success && report\.trim\(\) == "OK"/);
  assert.match(family, /\$attempt -lt 50/);
  assert.match(family, /Start-Sleep -Milliseconds 200/);
  assert.match(apply, /broker\.encode_utf16\(\)\.count\(\) > 30_000/);
  assert.match(script, /request\.ipv4\.mode != IpMode::Disabled \|\| request\.ipv6\.mode != IpMode::Disabled/);
});
