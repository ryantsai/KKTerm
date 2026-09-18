//! Network apply tests: pure script/result checks plus Windows-only, fully
//! stubbed PowerShell execution. No test elevates or touches host networking.
use super::*;

fn family(mode: IpMode) -> NetworkFamilySnapshot {
    NetworkFamilySnapshot { mode, addresses: Vec::new(), gateway: None }
}

fn request() -> ApplyNetworkProfileRequest {
    ApplyNetworkProfileRequest {
        adapter_id: "00000000-0000-0000-0000-000000000042".into(),
        service_id: None,
        ipv4: NetworkFamilySnapshot {
            mode: IpMode::Manual,
            addresses: vec![NetworkProfileAddress { address: "192.0.2.10".into(), prefix: 24 }],
            gateway: Some("192.0.2.1".into()),
        },
        ipv6: family(IpMode::Automatic),
        dns_servers: vec!["192.0.2.53".into()],
    }
}

#[test]
fn requires_both_success_exit_and_success_receipt() {
    assert!(windows_apply_result(true, Some(0), "OK", "").is_ok());
    for (success, code, report) in [(true, 0, ""), (false, 1, "OK"), (true, 0, "garbage")] {
        assert!(windows_apply_result(success, Some(code), report, "").is_err());
    }
}

#[test]
fn separates_cancel_launch_failure_and_original_native_error() {
    assert!(windows_apply_result(false, Some(1223), "", "").unwrap_err().contains("UAC"));
    assert!(windows_apply_result(false, Some(1), "", "Access denied").unwrap_err().contains("Access denied"));
    let error = windows_apply_result(false, Some(1), "ERROR\nIPv4 address creation: 拒絕存取 [AccessDenied]", "").unwrap_err();
    assert!(error.contains("IPv4 address creation: 拒絕存取 [AccessDenied]"));
    assert!(error.contains("partially changed"));
}

#[test]
fn finishes_binding_changes_before_addresses_and_scopes_cleanup() {
    let script = windows_apply_script(&request(), "C:\\Users\\O'Brien\\結果.txt");
    assert!(script.contains("O''Brien\\結果.txt"));
    assert!(script.contains("WildcardPattern]::Escape($a.Name)"));
    assert!(script.find("IPv6 protocol binding").unwrap() < script.find("adapter refresh").unwrap());
    assert!(script.contains("if ($b.Enabled -ne $true)"));
    for store in ["PersistentStore", "ActiveStore"] {
        assert!(script.contains(&format!("Get-NetRoute -PolicyStore {store} -ErrorAction Stop")));
        assert!(script.contains(&format!("Get-NetIPAddress -PolicyStore {store} -ErrorAction Stop")));
    }
    assert!(script.contains("$_.InterfaceIndex -eq $a.ifIndex -and $_.AddressFamily -eq 'IPv6'"));
    assert!(!script.contains("Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue"));
    assert!(!script.contains("Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue"));
}

#[test]
fn automatic_enables_dhcp_after_cleanup_and_disabled_skips_dns() {
    let statements = windows_family_statements("IPv4", &family(IpMode::Automatic)).join("\n");
    assert!(statements.contains("'set','address'"));
    assert!(statements.contains("'source=dhcp','store=persistent'"));
    let ipv6 = windows_family_statements("IPv6", &family(IpMode::Automatic)).join("\n");
    assert!(ipv6.rfind("Remove-NetIPAddress").unwrap() < ipv6.find("routerdiscovery=enabled").unwrap());
    let mut value = request();
    value.ipv4 = family(IpMode::Disabled);
    value.ipv6 = family(IpMode::Disabled);
    let script = windows_apply_script(&value, "result.txt");
    assert_eq!(script.matches("Disable-NetAdapterBinding").count(), 2);
    assert!(!script.contains("Set-DnsClientServerAddress"));
    assert!(!script.contains("Set-NetIPInterface"));
    assert!(!script.contains("Invoke-KKNetsh @("));
    assert!(windows_dns_statements(&value).is_empty());
}

#[test]
fn maximum_profile_fits_encoded_windows_command_line() {
    let mut value = request();
    value.ipv4.addresses = (1..=8).map(|n| NetworkProfileAddress { address: format!("192.0.2.{n}"), prefix: 24 }).collect();
    value.ipv6.mode = IpMode::Manual;
    value.ipv6.addresses = (1..=8).map(|n| NetworkProfileAddress { address: format!("2001:db8:ffff:ffff:ffff:ffff:ffff:{n}"), prefix: 64 }).collect();
    value.ipv6.gateway = Some("fe80::1".into());
    value.dns_servers = (1..=8).map(|n| format!("2001:db8:ffff:ffff:ffff:ffff:ffff:{n}")).collect();
    value.adapter_id = "a".repeat(256);
    let script = windows_apply_script(&value, &format!("C:\\{}\\result.txt", "x".repeat(240)));
    let bytes = script.encode_utf16().count() * 2;
    // Base64 length is enough here; the broker treats it as one opaque argument.
    let encoded_length = bytes.div_ceil(3) * 4;
    assert!(windows_apply_broker(&"A".repeat(encoded_length)).encode_utf16().count() <= 30_000);
}

#[test]
fn profiles_do_not_require_an_active_interface_or_connectivity() {
    let script = windows_apply_script(&request(), "result.txt");
    for forbidden in ["Get-NetIPInterface", "Set-NetIPInterface", "New-NetIPAddress", "Start-Sleep", "Test-Connection", "Set-DnsClientServerAddress"] {
        assert!(!script.contains(forbidden), "unexpected active-only dependency: {forbidden}");
    }
    assert!(script.contains("$code = $LASTEXITCODE"));
    assert!(script.contains("if ($code -ne 0)"));
}

#[test]
fn static_profiles_replace_ipv4_add_secondary_addresses_and_one_ipv6_gateway() {
    let mut value = request();
    value.ipv4.gateway = None;
    value.ipv4.addresses.push(NetworkProfileAddress { address: "192.0.2.11".into(), prefix: 25 });
    value.ipv6 = NetworkFamilySnapshot {
        mode: IpMode::Manual,
        addresses: vec![
            NetworkProfileAddress { address: "2001:db8::10".into(), prefix: 64 },
            NetworkProfileAddress { address: "2001:db8::11".into(), prefix: 80 },
        ],
        gateway: Some("fe80::1".into()),
    };
    let ipv4 = windows_family_statements("IPv4", &value.ipv4).join("\n");
    assert_eq!(ipv4.matches("'set','address'").count(), 1);
    assert_eq!(ipv4.matches("'add','address'").count(), 1);
    assert!(ipv4.contains("'gateway=none'"));
    assert!(ipv4.contains("'address=192.0.2.11/25'"));
    let ipv6 = windows_family_statements("IPv6", &value.ipv6).join("\n");
    assert_eq!(ipv6.matches("'add','address'").count(), 2);
    assert_eq!(ipv6.matches("'add','route'").count(), 1);
    assert!(ipv6.contains("'address=2001:db8::11/80'"));
    assert!(ipv6.contains("'nexthop=fe80::1'"));
    assert!(ipv6.find("routerdiscovery=disabled").unwrap() < ipv6.find("Remove-NetIPAddress").unwrap());
}

#[test]
fn dns_is_offline_safe_ordered_deduplicated_and_skips_disabled_families() {
    let mut value = request();
    value.dns_servers = ["192.0.2.53", "2001:db8::53", "192.0.2.54", "192.0.2.53", "2001:0db8::53", "2001:db8::54"].map(str::to_string).to_vec();
    let dns = windows_dns_statements(&value).join("\n");
    assert_eq!(dns.matches("'set','dnsservers'").count(), 2);
    assert_eq!(dns.matches("'add','dnsservers'").count(), 2);
    assert_eq!(dns.matches("'validate=no'").count(), 4);
    assert!(dns.contains("'address=192.0.2.54','index=2'"));
    assert!(dns.contains("'address=2001:db8::54','index=2'"));
    value.ipv6.mode = IpMode::Disabled;
    assert!(!windows_dns_statements(&value).join("\n").contains("ipv6"));
    value.ipv6.mode = IpMode::Automatic;
    value.dns_servers = vec!["192.0.2.53".into()];
    assert!(windows_dns_statements(&value).join("\n").contains("'source=static','address=none','validate=no'"));
    value.dns_servers.clear();
    let automatic = windows_dns_statements(&value).join("\n");
    assert_eq!(automatic.matches("'source=dhcp'").count(), 2);
    assert!(!automatic.contains("'address="));
}

#[cfg(target_os = "windows")]
const NETSH_CALL: &str = "& (Join-Path ([Environment]::SystemDirectory) 'netsh.exe') @Arguments 2>&1";

#[cfg(target_os = "windows")]
const FIXTURES: &str = r#"
[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::GetCultureInfo('zh-TW')
$script:bindings=0
function Get-NetAdapter { [CmdletBinding()]param()
  if ($script:fail -eq 'missing' -or ($script:fail -eq 'removed' -and $script:bindings -gt 0)) { return }
  $index=42; if ($script:bindings -gt 0) { $index=84 }
  [pscustomobject]@{InterfaceGuid=[guid]'00000000-0000-0000-0000-000000000042';Name='乙太網路 [Lab]';ifIndex=$index;Status=$script:status}
}
function Get-NetAdapterBinding { [CmdletBinding()]param($Name,$ComponentID)
  [pscustomobject]@{Enabled=$false;ComponentID=$ComponentID}
}
function Enable-NetAdapterBinding { [CmdletBinding(SupportsShouldProcess)]param($InputObject) $script:bindings++ }
function Disable-NetAdapterBinding { [CmdletBinding(SupportsShouldProcess)]param($InputObject) }
function Get-NetIPInterface { [CmdletBinding()]param($InterfaceIndex,$AddressFamily) throw 'No active IP interface' }
function Start-Sleep { param($Milliseconds) throw 'Must not wait for physical connectivity' }
function Set-NetIPInterface { [CmdletBinding()]param($InterfaceIndex,$AddressFamily,$Dhcp,$RouterDiscovery) throw 'Active-only setter' }
function New-NetIPAddress { [CmdletBinding()]param($InterfaceIndex,$AddressFamily,$IPAddress,$PrefixLength,$DefaultGateway) throw 'Active-only address creation' }
function Set-DnsClientServerAddress { [CmdletBinding()]param($InterfaceIndex,$ServerAddresses,[switch]$ResetServerAddresses) throw 'Active-only DNS setter' }
function Get-NetRoute { [CmdletBinding()]param($PolicyStore)
  if ($script:fail -eq 'discovery') { throw 'Route query denied' }
  $indices=@(99); if ($PolicyStore -eq 'PersistentStore' -or $script:status -eq 'Up') { $indices+=84 }
  foreach($i in $indices) { [pscustomobject]@{InterfaceIndex=$i;AddressFamily='IPv6';DestinationPrefix='::/0';Protocol='NetMgmt'} }
  [pscustomobject]@{InterfaceIndex=84;AddressFamily='IPv4';DestinationPrefix='0.0.0.0/0';Protocol='NetMgmt'}
}
function Get-NetIPAddress { [CmdletBinding()]param($PolicyStore)
  $indices=@(99); if ($PolicyStore -eq 'PersistentStore' -or $script:status -eq 'Up') { $indices+=84 }
  foreach($i in $indices) { [pscustomobject]@{InterfaceIndex=$i;AddressFamily='IPv6';PrefixOrigin='Manual'} }
  [pscustomobject]@{InterfaceIndex=84;AddressFamily='IPv6';PrefixOrigin='WellKnown'}
}
function Remove-NetRoute { [CmdletBinding(SupportsShouldProcess)]param([Parameter(ValueFromPipeline)]$InputObject)
  process { if ($InputObject.InterfaceIndex -ne 84 -or $InputObject.AddressFamily -ne 'IPv6') { throw 'Wrong adapter route' } }
}
function Remove-NetIPAddress { [CmdletBinding(SupportsShouldProcess)]param([Parameter(ValueFromPipeline)]$InputObject)
  process {
    if ($InputObject.InterfaceIndex -ne 84 -or $InputObject.PrefixOrigin -eq 'WellKnown') { throw 'Wrong adapter address' }
    if ($script:fail -eq 'cleanup') { throw '清除失敗' }
  }
}
function Invoke-TestNetsh {
  param([string[]]$Arguments)
  $global:LASTEXITCODE=0
  if ($Arguments -notcontains 'name=84' -and $Arguments -notcontains 'interface=84') { throw 'Stale or wrong adapter index' }
  if ($Arguments -contains 'dnsservers') {
    if ($Arguments -notcontains 'validate=no') { throw 'DNS must not probe an offline network' }
    if ($script:fail -eq 'dns') { $global:LASTEXITCODE=5; 'DNS 設定失敗'; return }
  } else {
    if ($Arguments -notcontains 'store=persistent') { throw 'Configuration must be persistent' }
    if ($Arguments -contains 'address' -and $script:fail -eq 'address') { $global:LASTEXITCODE=87; '位址設定失敗'; return }
  }
  if ($script:fail -eq 'silent') { $global:LASTEXITCODE=1168; return }
  'Ok.'
}
"#;

#[cfg(target_os = "windows")]
fn run_stubbed_apply(value: &ApplyNetworkProfileRequest, status: &str, failure: &str) -> (bool, String) {
    use std::io::Read;
    let mut report = windows_apply_report_file().unwrap();
    let generated = windows_apply_script(value, report.path().to_str().unwrap());
    // Fail closed if the production invocation changes: NEVER launch real
    // netsh during a fixture test, even on a developer's Windows workstation.
    assert_eq!(generated.matches(NETSH_CALL).count(), 1);
    let stubbed = generated.replace(NETSH_CALL, "Invoke-TestNetsh -Arguments $Arguments");
    assert!(!stubbed.contains("netsh.exe"));
    let script = format!("{FIXTURES}\n$script:fail='{failure}'; $script:status='{status}'\n{stubbed}");
    let output = windows_snapshot_command(&script).output().unwrap();
    let mut receipt = String::new();
    report.as_file_mut().read_to_string(&mut receipt).unwrap();
    assert!(!receipt.is_empty(), "{}", String::from_utf8_lossy(&output.stderr));
    assert_eq!(windows_apply_result(output.status.success(), output.status.code(), &receipt, "").is_ok(), output.status.success());
    (output.status.success(), receipt)
}

#[cfg(target_os = "windows")]
#[test]
fn windows_executes_offline_apply_and_preserves_native_failure_steps() {
    for (failure, expected) in [
        ("", "OK"),
        ("cleanup", "IPv6 PersistentStore addresses: 清除失敗"),
        ("discovery", "IPv6 PersistentStore default routes: Route query denied"),
        ("address", "IPv4 static address 1: netsh exited with 87: 位址設定失敗"),
        ("dns", "ipv4 DNS server configuration: netsh exited with 5: DNS 設定失敗"),
        ("silent", "netsh exited with 1168"),
        ("missing", "adapter lookup: Network adapter not found"),
        ("removed", "adapter refresh: Network adapter is no longer available"),
    ] {
        let (success, receipt) = run_stubbed_apply(&request(), "Disconnected", failure);
        assert_eq!(success, failure.is_empty(), "{receipt}");
        assert!(receipt.contains(expected), "expected {expected}, received {receipt}");
    }
}

#[cfg(target_os = "windows")]
#[test]
fn windows_offline_manual_automatic_and_disabled_families_do_not_need_link() {
    for ipv4_mode in [IpMode::Manual, IpMode::Automatic, IpMode::Disabled] {
        for ipv6_mode in [IpMode::Manual, IpMode::Automatic, IpMode::Disabled] {
            let mut value = request();
            value.ipv4.mode = ipv4_mode;
            value.ipv4.addresses.push(NetworkProfileAddress { address: "192.0.2.11".into(), prefix: 24 });
            value.ipv6.mode = ipv6_mode;
            value.ipv6.addresses = vec![NetworkProfileAddress { address: "2001:db8::10".into(), prefix: 64 }];
            value.ipv6.gateway = Some("fe80::1".into());
            value.dns_servers = vec!["192.0.2.53".into(), "192.0.2.54".into(), "2001:db8::53".into()];
            if ipv4_mode == IpMode::Automatic && ipv6_mode == IpMode::Automatic {
                value.dns_servers.clear();
            }
            let (success, receipt) = run_stubbed_apply(&value, "Disconnected", "");
            assert!(success, "{ipv4_mode:?}/{ipv6_mode:?}: {receipt}");
            assert_eq!(receipt, "OK");
        }
    }
    let (success, receipt) = run_stubbed_apply(&request(), "Up", "");
    assert!(success, "{receipt}");
}

#[cfg(target_os = "windows")]
#[test]
fn windows_broker_reports_stubbed_uac_cancel_without_elevating() {
    let script = format!("function Start-Process {{ [CmdletBinding()]param($FilePath,$ArgumentList,$Verb,$WindowStyle,[switch]$Wait,[switch]$PassThru); throw [System.ComponentModel.Win32Exception]::new(1223) }}\n{}", windows_apply_broker("AA=="));
    let output = windows_snapshot_command(&script).output().unwrap();
    assert_eq!(output.status.code(), Some(1223), "{}", String::from_utf8_lossy(&output.stderr));
}
