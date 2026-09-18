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
    assert!(script.find("IPv6 protocol binding").unwrap() < script.find("IPv4 interface readiness").unwrap());
    assert!(script.contains("if ($b.Enabled -ne $true)"));
    for store in ["PersistentStore", "ActiveStore"] {
        assert!(script.contains(&format!("Get-NetRoute -PolicyStore {store} -ErrorAction Stop")));
        assert!(script.contains(&format!("Get-NetIPAddress -PolicyStore {store} -ErrorAction Stop")));
    }
    assert!(script.contains("$_.InterfaceIndex -eq $a.ifIndex -and $_.AddressFamily -eq 'IPv4'"));
    assert!(!script.contains("Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue"));
    assert!(!script.contains("Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue"));
}

#[test]
fn automatic_enables_dhcp_after_cleanup_and_disabled_skips_dns() {
    let statements = windows_family_statements("IPv4", &family(IpMode::Automatic)).join("\n");
    assert!(statements.rfind("Remove-NetIPAddress").unwrap() < statements.find("-Dhcp Enabled").unwrap());
    let mut value = request();
    value.ipv4 = family(IpMode::Disabled);
    value.ipv6 = family(IpMode::Disabled);
    let script = windows_apply_script(&value, "result.txt");
    assert_eq!(script.matches("Disable-NetAdapterBinding").count(), 2);
    assert!(!script.contains("Set-DnsClientServerAddress"));
    assert!(!script.contains("Set-NetIPInterface"));
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

#[cfg(target_os = "windows")]
const FIXTURES: &str = r#"
$script:changed=$false; $script:sleeps=0
function Get-NetAdapter { [CmdletBinding()]param()
  [pscustomobject]@{InterfaceGuid=[guid]'00000000-0000-0000-0000-000000000042';Name='乙太網路 [Lab]';ifIndex=42}
}
function Get-NetAdapterBinding { [CmdletBinding()]param($Name,$ComponentID)
  [pscustomobject]@{Enabled=$false;ComponentID=$ComponentID}
}
function Enable-NetAdapterBinding { [CmdletBinding(SupportsShouldProcess)]param($InputObject) }
function Disable-NetAdapterBinding { [CmdletBinding(SupportsShouldProcess)]param($InputObject) }
function Get-NetIPInterface { [CmdletBinding()]param($InterfaceIndex,$AddressFamily)
  if ($script:sleeps -lt 2) { return }; [pscustomobject]@{InterfaceIndex=42}
}
function Start-Sleep { param($Milliseconds) $script:sleeps++ }
function Set-NetIPInterface { [CmdletBinding()]param($InterfaceIndex,$AddressFamily,$Dhcp,$RouterDiscovery) }
function Get-NetRoute { [CmdletBinding()]param($PolicyStore)
  foreach($i in @(42,99)) { [pscustomobject]@{InterfaceIndex=$i;AddressFamily='IPv4';DestinationPrefix='0.0.0.0/0';Protocol='NetMgmt'} }
}
function Get-NetIPAddress { [CmdletBinding()]param($PolicyStore)
  foreach($i in @(42,99)) { [pscustomobject]@{InterfaceIndex=$i;AddressFamily='IPv4';PrefixOrigin='Manual'} }
}
function Remove-NetRoute { [CmdletBinding(SupportsShouldProcess)]param([Parameter(ValueFromPipeline)]$InputObject)
  process { if ($InputObject.InterfaceIndex -ne 42) { throw 'Wrong adapter route' } }
}
function Remove-NetIPAddress { [CmdletBinding(SupportsShouldProcess)]param([Parameter(ValueFromPipeline)]$InputObject)
  process {
    if ($InputObject.InterfaceIndex -ne 42) { throw 'Wrong adapter address' }
    if ($script:fail -eq 'cleanup') { throw '清除失敗' }
  }
}
function New-NetIPAddress { [CmdletBinding()]param($InterfaceIndex,$AddressFamily,$IPAddress,$PrefixLength,$DefaultGateway)
  if ($script:fail -eq 'address') { throw '位址設定失敗' }; $script:changed=$true
}
function Set-DnsClientServerAddress { [CmdletBinding()]param($InterfaceIndex,$ServerAddresses,[switch]$ResetServerAddresses)
  if (-not $script:changed) { throw 'Address creation was skipped' }
  if ($script:fail -eq 'dns') { throw 'DNS 設定失敗' }
}
"#;

#[cfg(target_os = "windows")]
#[test]
fn windows_executes_stubbed_apply_and_preserves_failure_steps() {
    use std::io::Read;
    for (failure, expected) in [("", "OK"), ("cleanup", "IPv4 PersistentStore addresses: 清除失敗"), ("address", "IPv4 static address 1: 位址設定失敗"), ("dns", "DNS server configuration: DNS 設定失敗")] {
        let mut report = windows_apply_report_file().unwrap();
        let script = format!("{FIXTURES}\n$script:fail='{failure}'\n{}", windows_apply_script(&request(), report.path().to_str().unwrap()));
        let output = windows_snapshot_command(&script).output().unwrap();
        let mut receipt = String::new();
        report.as_file_mut().read_to_string(&mut receipt).unwrap();
        assert_eq!(output.status.success(), failure.is_empty(), "{}", String::from_utf8_lossy(&output.stderr));
        assert!(receipt.contains(expected), "expected {expected}, received {receipt}");
        assert_eq!(windows_apply_result(output.status.success(), output.status.code(), &receipt, "").is_ok(), failure.is_empty());
    }
}

#[cfg(target_os = "windows")]
#[test]
fn windows_broker_reports_stubbed_uac_cancel_without_elevating() {
    let script = format!("function Start-Process {{ [CmdletBinding()]param($FilePath,$ArgumentList,$Verb,$WindowStyle,[switch]$Wait,[switch]$PassThru); throw [System.ComponentModel.Win32Exception]::new(1223) }}\n{}", windows_apply_broker("AA=="));
    let output = windows_snapshot_command(&script).output().unwrap();
    assert_eq!(output.status.code(), Some(1223), "{}", String::from_utf8_lossy(&output.stderr));
}
