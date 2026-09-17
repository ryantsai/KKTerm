import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src-tauri/src/net/profiles.rs", "utf8");
const script = source.match(/let script = r#"(\$items=@\([\s\S]*?)"#;/)?.[1];
assert.ok(script, "the Windows snapshot script must be available for fixture execution");

test("Windows snapshot omits missing addresses and DNS without losing configured adapters", {
  skip: process.platform !== "win32",
}, () => {
  // Execute the production PowerShell projection against disconnected and configured
  // adapter fixtures. No OS configuration is read or changed by these commands.
  const fixtures = `
function Get-NetAdapter {
  1..2 | ForEach-Object {
    [pscustomobject]@{ ifIndex=$_; InterfaceGuid="adapter-$_"; Name="Adapter $_"; Virtual=$false; Status=$(if($_ -eq 2){'Up'}else{'Disconnected'}) }
  }
}
function Get-NetIPInterface { param($InterfaceIndex, $AddressFamily, $ErrorAction)
  if($InterfaceIndex -eq 2){ [pscustomobject]@{ Dhcp='Enabled'; RouterDiscovery='Enabled' } }
}
function Get-NetIPConfiguration { param($InterfaceIndex, $ErrorAction)
  if($InterfaceIndex -eq 2){ [pscustomobject]@{ IPv4Address=[pscustomobject]@{ IPAddress='192.0.2.5'; PrefixLength=24 }; IPv4DefaultGateway=[pscustomobject]@{ NextHop='192.0.2.1' } } }
}
function Get-NetAdapterBinding { param($Name, $ComponentID, $ErrorAction)
  [pscustomobject]@{ Enabled=$true }
}
function Get-NetIPAddress { param($InterfaceIndex, $AddressFamily, $ErrorAction)
  if($InterfaceIndex -eq 2){ [pscustomobject]@{ IPAddress='2001:db8::5'; PrefixLength=64; PrefixOrigin='RouterAdvertisement'; AddressState='Preferred' } }
}
function Get-DnsClientServerAddress { param($InterfaceIndex, $ErrorAction)
  if($InterfaceIndex -eq 2){ [pscustomobject]@{ ServerAddresses=@('192.0.2.53','2001:db8::53',$null,'') } }
}
`;
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(fixtures + script, "utf16le").toString("base64"),
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const [disconnected, connected] = JSON.parse(result.stdout);
  assert.deepEqual(disconnected.dnsServers, []);
  assert.deepEqual(disconnected.ipv4Addresses, []);
  assert.deepEqual(disconnected.ipv6Addresses, []);
  assert.equal(disconnected.ipv4Gateway, null);
  assert.equal(disconnected.connected, false);
  assert.deepEqual(connected.dnsServers, ["192.0.2.53", "2001:db8::53"]);
  assert.deepEqual(connected.ipv4Addresses, ["192.0.2.5/24"]);
  assert.deepEqual(connected.ipv6Addresses, ["2001:db8::5/64"]);
  assert.equal(connected.ipv4Gateway, "192.0.2.1");
  assert.equal(connected.connected, true);
});
