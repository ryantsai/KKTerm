//! Cross-platform network profile snapshots and privileged application.
//!
//! The frontend persists named profiles. This module owns the machine boundary:
//! it discovers the active OS configuration, validates every requested address,
//! and invokes only fixed system tools with structured arguments.

use super::interfaces;
#[cfg(target_os = "windows")]
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr};
use std::process::Command;

// All widget instances share the same machine. Reject overlapping applies
// rather than interleaving address, route and DNS changes or queuing stale work.
static PROFILE_APPLY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IpMode {
    Automatic,
    Manual,
    Disabled,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfileAddress {
    pub address: String,
    pub prefix: u8,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkFamilySnapshot {
    pub mode: IpMode,
    pub addresses: Vec<NetworkProfileAddress>,
    pub gateway: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAdapterSnapshot {
    pub id: String,
    pub name: String,
    pub detail: Option<String>,
    pub service_id: Option<String>,
    pub connected: bool,
    pub ipv4: NetworkFamilySnapshot,
    pub ipv6: NetworkFamilySnapshot,
    pub dns_servers: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfilesSnapshot {
    pub platform: &'static str,
    pub capability: &'static str,
    pub adapters: Vec<NetworkAdapterSnapshot>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyNetworkProfileRequest {
    pub adapter_id: String,
    pub service_id: Option<String>,
    pub ipv4: NetworkFamilySnapshot,
    pub ipv6: NetworkFamilySnapshot,
    #[serde(default)]
    pub dns_servers: Vec<String>,
}

pub fn snapshot() -> Result<NetworkProfilesSnapshot, String> {
    #[cfg(target_os = "windows")]
    return windows_snapshot();
    #[cfg(target_os = "macos")]
    return macos_snapshot();
    #[cfg(target_os = "linux")]
    return linux_snapshot();
    #[allow(unreachable_code)]
    fallback_snapshot("unsupported")
}

pub fn apply(request: ApplyNetworkProfileRequest) -> Result<(), String> {
    validate_request(&request)?;
    let _apply_guard = PROFILE_APPLY_LOCK.try_lock().map_err(|error| match error {
        std::sync::TryLockError::WouldBlock => "another network profile is already being applied".to_string(),
        std::sync::TryLockError::Poisoned(_) => "network profile application lock is poisoned".to_string(),
    })?;
    #[cfg(target_os = "windows")]
    return windows_apply(&request);
    #[cfg(target_os = "macos")]
    return macos_apply(&request);
    #[cfg(target_os = "linux")]
    return linux_apply(&request);
    #[allow(unreachable_code)]
    Err("network profile application is unavailable on this platform".into())
}

fn validate_request(request: &ApplyNetworkProfileRequest) -> Result<(), String> {
    validate_identifier(&request.adapter_id, "adapter")?;
    if let Some(service_id) = request.service_id.as_deref() {
        validate_identifier(service_id, "network service")?;
    }
    validate_family(&request.ipv4, false)?;
    validate_family(&request.ipv6, true)?;
    if request.dns_servers.len() > 8 {
        return Err("a network profile may contain at most 8 DNS servers".into());
    }
    for dns in &request.dns_servers {
        dns.parse::<IpAddr>()
            .map_err(|_| format!("invalid DNS server address: {dns}"))?;
    }
    Ok(())
}

fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return Err(format!("invalid {label} identifier"));
    }
    Ok(())
}

fn validate_family(value: &NetworkFamilySnapshot, ipv6: bool) -> Result<(), String> {
    if value.addresses.len() > 8 {
        return Err("an address family may contain at most 8 addresses".into());
    }
    if value.mode == IpMode::Manual && value.addresses.is_empty() {
        return Err("manual addressing requires at least one address".into());
    }
    for entry in &value.addresses {
        let address = entry
            .address
            .parse::<IpAddr>()
            .map_err(|_| format!("invalid IP address: {}", entry.address))?;
        if address.is_ipv6() != ipv6 || entry.prefix > if ipv6 { 128 } else { 32 } {
            return Err(format!(
                "invalid address family or prefix: {}/{}",
                entry.address, entry.prefix
            ));
        }
    }
    if let Some(gateway) = value.gateway.as_deref() {
        let address = gateway
            .parse::<IpAddr>()
            .map_err(|_| format!("invalid gateway address: {gateway}"))?;
        if address.is_ipv6() != ipv6 {
            return Err(format!("gateway has the wrong address family: {gateway}"));
        }
    }
    Ok(())
}

fn fallback_snapshot(capability: &'static str) -> Result<NetworkProfilesSnapshot, String> {
    let adapters = interfaces::list_interfaces()
        .map_err(|error| format!("failed to list network adapters: {error:?}"))?
        .into_iter()
        .filter(|adapter| !adapter.is_loopback)
        .map(|adapter| {
            let mut ipv4 = Vec::new();
            let mut ipv6 = Vec::new();
            for address in adapter.addresses {
                let entry = NetworkProfileAddress {
                    address: address.ip,
                    prefix: address
                        .cidr
                        .unwrap_or(if address.family == "v6" { 128 } else { 32 }),
                };
                if address.family == "v6" {
                    ipv6.push(entry);
                } else {
                    ipv4.push(entry);
                }
            }
            NetworkAdapterSnapshot {
                id: adapter.name.clone(),
                name: adapter.name,
                detail: None,
                service_id: None,
                connected: adapter.is_up,
                ipv4: NetworkFamilySnapshot {
                    mode: IpMode::Automatic,
                    addresses: ipv4,
                    gateway: None,
                },
                ipv6: NetworkFamilySnapshot {
                    mode: IpMode::Automatic,
                    addresses: ipv6,
                    gateway: None,
                },
                dns_servers: Vec::new(),
            }
        })
        .collect();
    Ok(NetworkProfilesSnapshot {
        platform: std::env::consts::OS,
        capability,
        adapters,
    })
}

fn command_output(mut command: Command, label: &str) -> Result<String, String> {
    let output = command
        .output()
        .map_err(|error| format!("failed to start {label}: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!("{label} exited with {}", output.status)
        } else {
            detail
        });
    }
    String::from_utf8(output.stdout)
        .map_err(|error| format!("{label} returned invalid text: {error}"))
}

#[cfg(target_os = "macos")]
fn macos_snapshot() -> Result<NetworkProfilesSnapshot, String> {
    let mut list = Command::new("/usr/sbin/networksetup");
    list.arg("-listnetworkserviceorder");
    let output = command_output(list, "networksetup")?;
    let mut adapters = Vec::new();
    let lines: Vec<_> = output.lines().collect();
    for pair in lines.windows(2) {
        let Some(name) = pair[0]
            .trim()
            .strip_prefix('(')
            .and_then(|line| line.split_once(") ").map(|(_, name)| name.trim()))
        else {
            continue;
        };
        let hardware = pair[1].trim();
        let Some(device) = hardware
            .split("Device: ")
            .nth(1)
            .map(|value| value.trim_end_matches(')').trim())
        else {
            continue;
        };
        let disabled = name.starts_with('*');
        let service_name = name.trim_start_matches('*').trim();
        let mut info = Command::new("/usr/sbin/networksetup");
        info.args(["-getinfo", service_name]);
        let info = command_output(info, "networksetup")?;
        let mut ipv4_mode = IpMode::Automatic;
        let mut ipv6_mode = IpMode::Automatic;
        let mut ipv4_addresses = Vec::new();
        let mut ipv6_addresses = Vec::new();
        let mut ipv4_gateway = None;
        let mut ipv6_gateway = None;
        let mut ipv4_address = None;
        let mut subnet_mask = None;
        let mut ipv6_address = None;
        let mut ipv6_prefix = None;
        for line in info.lines().map(str::trim) {
            if line.eq_ignore_ascii_case("Manual Configuration") {
                ipv4_mode = IpMode::Manual;
            } else if line.eq_ignore_ascii_case("DHCP Configuration") {
                ipv4_mode = IpMode::Automatic;
            } else if line.eq_ignore_ascii_case("IPv4: Off") {
                ipv4_mode = IpMode::Disabled;
            } else if let Some(value) = line.strip_prefix("IP address: ") {
                if value != "none" {
                    ipv4_address = Some(value.to_string());
                }
            } else if let Some(value) = line.strip_prefix("Subnet mask: ") {
                subnet_mask = Some(value.to_string());
            } else if let Some(value) = line.strip_prefix("Router: ") {
                if value != "none" {
                    ipv4_gateway = Some(value.to_string());
                }
            } else if let Some(value) = line.strip_prefix("IPv6: ") {
                ipv6_mode = match value.to_ascii_lowercase().as_str() {
                    "off" => IpMode::Disabled,
                    "manual" => IpMode::Manual,
                    _ => IpMode::Automatic,
                };
            } else if let Some(value) = line.strip_prefix("IPv6 IP address: ") {
                if value != "none" {
                    ipv6_address = Some(value.to_string());
                }
            } else if let Some(value) = line.strip_prefix("IPv6 Router: ") {
                if value != "none" {
                    ipv6_gateway = Some(value.to_string());
                }
            } else if let Some(value) = line.strip_prefix("IPv6 Prefix Length: ") {
                ipv6_prefix = value.parse::<u8>().ok().filter(|prefix| *prefix <= 128);
            }
        }
        if let Some(address) = ipv4_address {
            ipv4_addresses.push(NetworkProfileAddress {
                address,
                prefix: subnet_mask
                    .as_deref()
                    .and_then(ipv4_mask_to_prefix)
                    .unwrap_or(32),
            });
        }
        if let Some(address) = ipv6_address {
            ipv6_addresses.push(NetworkProfileAddress {
                address,
                prefix: ipv6_prefix.unwrap_or(128),
            });
        }
        let mut dns = Command::new("/usr/sbin/networksetup");
        dns.args(["-getdnsservers", service_name]);
        let dns_servers = command_output(dns, "networksetup")?
            .lines()
            .map(str::trim)
            .filter(|line| line.parse::<IpAddr>().is_ok())
            .map(str::to_string)
            .collect();
        adapters.push(NetworkAdapterSnapshot {
            id: service_name.to_string(),
            name: service_name.to_string(),
            detail: Some(device.to_string()),
            service_id: Some(service_name.to_string()),
            connected: !disabled && (!ipv4_addresses.is_empty() || !ipv6_addresses.is_empty()),
            ipv4: NetworkFamilySnapshot {
                mode: ipv4_mode,
                addresses: ipv4_addresses,
                gateway: ipv4_gateway,
            },
            ipv6: NetworkFamilySnapshot {
                mode: ipv6_mode,
                addresses: ipv6_addresses,
                gateway: ipv6_gateway,
            },
            dns_servers,
        });
    }
    Ok(NetworkProfilesSnapshot {
        platform: "macos",
        capability: if cfg!(feature = "mac-app-store") {
            "readOnlyMacAppStore"
        } else {
            "supported"
        },
        adapters,
    })
}

#[cfg(target_os = "macos")]
fn macos_apply(request: &ApplyNetworkProfileRequest) -> Result<(), String> {
    #[cfg(feature = "mac-app-store")]
    {
        let _ = request;
        return Err("network profile application is unavailable in the Mac App Store build".into());
    }
    #[cfg(not(feature = "mac-app-store"))]
    {
        let service = request.service_id.as_deref().unwrap_or(&request.adapter_id);
        let mut commands = vec![shell_join(&[
            "/usr/sbin/networksetup".to_string(),
            "-setnetworkserviceenabled".to_string(),
            service.to_string(),
            "on".to_string(),
        ])];
        commands.push(macos_family_command(service, &request.ipv4, false)?);
        commands.push(macos_family_command(service, &request.ipv6, true)?);
        let mut dns = vec![
            "/usr/sbin/networksetup".to_string(),
            "-setdnsservers".to_string(),
            service.to_string(),
        ];
        if request.dns_servers.is_empty() {
            dns.push("empty".into());
        } else {
            dns.extend(request.dns_servers.iter().cloned());
        }
        commands.push(shell_join(&dns));
        let shell_script = commands.join(" && ");
        let apple_script = format!(
            "do shell script \"{}\" with administrator privileges",
            shell_script.replace('\\', "\\\\").replace('"', "\\\"")
        );
        let status = Command::new("/usr/bin/osascript")
            .args(["-e", &apple_script])
            .status()
            .map_err(|error| format!("failed to request administrator authorization: {error}"))?;
        status
            .success()
            .then_some(())
            .ok_or_else(|| "network profile application was cancelled or failed".into())
    }
}

#[cfg(all(target_os = "macos", not(feature = "mac-app-store")))]
fn macos_family_command(
    service: &str,
    family: &NetworkFamilySnapshot,
    ipv6: bool,
) -> Result<String, String> {
    let mut args = vec!["/usr/sbin/networksetup".to_string()];
    match (ipv6, family.mode) {
        (false, IpMode::Automatic) => args.extend(["-setdhcp".into(), service.into()]),
        (false, IpMode::Disabled) => args.extend(["-setv4off".into(), service.into()]),
        (false, IpMode::Manual) => {
            let address = &family.addresses[0];
            args.extend([
                "-setmanual".into(),
                service.into(),
                address.address.clone(),
                ipv4_prefix_to_mask(address.prefix),
                family.gateway.clone().unwrap_or_else(|| "0.0.0.0".into()),
            ]);
        }
        (true, IpMode::Automatic) => args.extend(["-setv6automatic".into(), service.into()]),
        (true, IpMode::Disabled) => args.extend(["-setv6off".into(), service.into()]),
        (true, IpMode::Manual) => {
            let address = &family.addresses[0];
            args.extend([
                "-setv6manual".into(),
                service.into(),
                address.address.clone(),
                address.prefix.to_string(),
                family.gateway.clone().unwrap_or_else(|| "::".into()),
            ]);
        }
    }
    Ok(shell_join(&args))
}

#[cfg(all(target_os = "macos", not(feature = "mac-app-store")))]
fn shell_join(args: &[String]) -> String {
    args.iter()
        .map(|value| format!("'{}'", value.replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
fn windows_snapshot_command(script: &str) -> Command {
    use std::os::windows::process::CommandExt;
    // Redirected Windows PowerShell output otherwise uses the console code
    // page, which cannot be decoded as UTF-8 for localized adapter names.
    let script = format!(
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); {script}"
    );
    let mut command = Command::new("powershell.exe");
    command.creation_flags(CREATE_NO_WINDOW).args([
        "-NoProfile", "-NonInteractive", "-Command", &script,
    ]);
    command
}

#[cfg(target_os = "windows")]
fn windows_snapshot_script() -> &'static str {
    r#"$items=@(
Get-NetAdapter | Where-Object { -not $_.Virtual } | ForEach-Object {
  $a=$_; $i4=Get-NetIPInterface -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue;
  $i6=Get-NetIPInterface -InterfaceIndex $a.ifIndex -AddressFamily IPv6 -ErrorAction SilentlyContinue;
  $c=Get-NetIPConfiguration -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue;
  $v4b=Get-NetAdapterBinding -Name $a.Name -ComponentID ms_tcpip -ErrorAction SilentlyContinue;
  $v6b=Get-NetAdapterBinding -Name $a.Name -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue;
  [pscustomobject]@{
    id=$a.InterfaceGuid.ToString(); name=$a.Name; detail=$a.InterfaceDescription; connected=($a.Status -eq 'Up');
    ipv4Mode=$(if($v4b -and -not $v4b.Enabled){'disabled'}elseif($i4.Dhcp -eq 'Enabled'){'automatic'}elseif($i4){'manual'}else{'disabled'});
    ipv6Mode=$(if($v6b -and -not $v6b.Enabled){'disabled'}elseif($i6.RouterDiscovery -eq 'Disabled'){'manual'}else{'automatic'});
    ipv4Addresses=@($c.IPv4Address | Where-Object { $_.IPAddress } | %{"$($_.IPAddress)/$($_.PrefixLength)"});
    ipv6Addresses=@(Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv6 -ErrorAction SilentlyContinue | Where-Object { $_.PrefixOrigin -ne 'WellKnown' -and $_.AddressState -ne 'Duplicate' } | %{"$($_.IPAddress)/$($_.PrefixLength)"});
    ipv4Gateway=$(@($c.IPv4DefaultGateway | Sort-Object RouteMetric)[0].NextHop);
    ipv6Gateway=$(@($c.IPv6DefaultGateway | Sort-Object RouteMetric)[0].NextHop);
    dnsServers=@((Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue).ServerAddresses | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  }
}); ConvertTo-Json -InputObject $items -Compress -Depth 5"#
}

#[cfg(target_os = "windows")]
fn windows_snapshot() -> Result<NetworkProfilesSnapshot, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RawAdapter {
        id: String,
        name: String,
        detail: Option<String>,
        connected: bool,
        ipv4_mode: IpMode,
        ipv6_mode: IpMode,
        #[serde(default)]
        ipv4_addresses: Vec<String>,
        #[serde(default)]
        ipv6_addresses: Vec<String>,
        ipv4_gateway: Option<String>,
        ipv6_gateway: Option<String>,
        #[serde(default)]
        dns_servers: Vec<String>,
    }
    let raw = command_output(windows_snapshot_command(windows_snapshot_script()), "PowerShell")?;
    let parsed: Vec<RawAdapter> = serde_json::from_str(&raw)
        .map_err(|error| format!("invalid PowerShell network data: {error}"))?;
    Ok(NetworkProfilesSnapshot {
        platform: "windows",
        capability: "supported",
        adapters: parsed
            .into_iter()
            .map(|adapter| NetworkAdapterSnapshot {
                id: adapter.id.clone(),
                name: adapter.name.clone(),
                detail: adapter.detail,
                service_id: Some(adapter.name),
                connected: adapter.connected,
                ipv4: NetworkFamilySnapshot {
                    mode: adapter.ipv4_mode,
                    addresses: adapter
                        .ipv4_addresses
                        .into_iter()
                        .map(|value| {
                            let (address, prefix) = split_cidr(&value, 32);
                            NetworkProfileAddress { address, prefix }
                        })
                        .collect(),
                    gateway: adapter.ipv4_gateway,
                },
                ipv6: NetworkFamilySnapshot {
                    mode: adapter.ipv6_mode,
                    addresses: adapter
                        .ipv6_addresses
                        .into_iter()
                        .map(|value| {
                            let (address, prefix) = split_cidr(&value, 128);
                            NetworkProfileAddress { address, prefix }
                        })
                        .collect(),
                    gateway: adapter.ipv6_gateway,
                },
                dns_servers: adapter.dns_servers,
            })
            .collect(),
    })
}

#[cfg(target_os = "windows")]
fn windows_apply(request: &ApplyNetworkProfileRequest) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let adapter_id = ps_quote(&request.adapter_id);
    let mut statements = Vec::new();
    statements.push(format!(
        "$a=Get-NetAdapter | Where-Object {{ $_.InterfaceGuid.ToString() -eq '{adapter_id}' }} | Select-Object -First 1; if ($null -eq $a) {{ throw 'Network adapter not found' }}"
    ));
    statements.extend(windows_family_statements("IPv4", "ms_tcpip", &request.ipv4));
    statements.extend(windows_family_statements(
        "IPv6",
        "ms_tcpip6",
        &request.ipv6,
    ));
    if request.dns_servers.is_empty() {
        statements.push("Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ResetServerAddresses -ErrorAction Stop".into());
    } else {
        let dns = request
            .dns_servers
            .iter()
            .map(|value| format!("'{}'", ps_quote(value)))
            .collect::<Vec<_>>()
            .join(",");
        statements.push(format!("Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ServerAddresses @({dns}) -ErrorAction Stop"));
    }
    let inner = statements.join("; ");
    let encoded = base64::engine::general_purpose::STANDARD.encode(
        inner
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    let broker = format!(
        "$ErrorActionPreference='Stop'; try {{ $p=Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','{encoded}') -Verb RunAs -Wait -PassThru; exit $p.ExitCode }} catch {{ exit 1 }}"
    );
    let mut command = Command::new("powershell.exe");
    command.creation_flags(CREATE_NO_WINDOW).args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        &broker,
    ]);
    let status = command
        .status()
        .map_err(|error| format!("failed to request administrator authorization: {error}"))?;
    status
        .success()
        .then_some(())
        .ok_or_else(|| "network profile application was cancelled or failed".into())
}

#[cfg(any(target_os = "windows", test))]
fn windows_family_statements(
    family_name: &str,
    binding: &str,
    family: &NetworkFamilySnapshot,
) -> Vec<String> {
    let mut out = vec![format!(
        "{}-NetAdapterBinding -Name $a.Name -ComponentID {binding} -ErrorAction Stop",
        if family.mode == IpMode::Disabled {
            "Disable"
        } else {
            "Enable"
        }
    )];
    if family.mode == IpMode::Disabled {
        return out;
    }
    let dhcp = if family.mode == IpMode::Automatic {
        "Enabled"
    } else {
        "Disabled"
    };
    out.push(format!("Set-NetIPInterface -InterfaceIndex $a.ifIndex -AddressFamily {family_name} -Dhcp {dhcp} -ErrorAction Stop"));
    if family_name == "IPv6" {
        out.push(format!(
            "Set-NetIPInterface -InterfaceIndex $a.ifIndex -AddressFamily IPv6 -RouterDiscovery {} -ErrorAction Stop",
            if family.mode == IpMode::Automatic {
                "Enabled"
            } else {
                "Disabled"
            }
        ));
    }
    if family.mode == IpMode::Automatic {
        out.push(format!("Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily {family_name} -ErrorAction SilentlyContinue | Where-Object PrefixOrigin -eq 'Manual' | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue"));
        out.push(format!("Get-NetRoute -InterfaceIndex $a.ifIndex -AddressFamily {family_name} -DestinationPrefix '{}' -ErrorAction SilentlyContinue | Where-Object Protocol -eq 'NetMgmt' | Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue", if family_name == "IPv4" { "0.0.0.0/0" } else { "::/0" }));
    } else if family.mode == IpMode::Manual {
        out.push(format!("Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily {family_name} -ErrorAction SilentlyContinue | Where-Object PrefixOrigin -ne 'WellKnown' | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue"));
        out.push(format!("Get-NetRoute -InterfaceIndex $a.ifIndex -AddressFamily {family_name} -DestinationPrefix '{}' -ErrorAction SilentlyContinue | Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue", if family_name == "IPv4" { "0.0.0.0/0" } else { "::/0" }));
        for (index, address) in family.addresses.iter().enumerate() {
            let gateway = if index == 0 {
                family
                    .gateway
                    .as_deref()
                    .map(|value| format!(" -DefaultGateway '{}'", ps_quote(value)))
                    .unwrap_or_default()
            } else {
                String::new()
            };
            out.push(format!("New-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily {family_name} -IPAddress '{}' -PrefixLength {}{gateway} -ErrorAction Stop", ps_quote(&address.address), address.prefix));
        }
    }
    out
}

#[cfg(any(target_os = "windows", test))]
fn ps_quote(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(target_os = "linux")]
fn linux_snapshot() -> Result<NetworkProfilesSnapshot, String> {
    let mut command = Command::new("nmcli");
    command.args(["-t", "-f", "GENERAL.DEVICE,GENERAL.CON-UUID,GENERAL.CONNECTION,GENERAL.STATE,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS,IP6.ADDRESS,IP6.GATEWAY,IP6.DNS", "device", "show"]);
    let output = match command_output(command, "NetworkManager") {
        Ok(output) => output,
        Err(_) => return fallback_snapshot("networkManagerUnavailable"),
    };
    let mut adapters = Vec::new();
    for block in output.split("\n\n") {
        let mut fields: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for line in block.lines() {
            if let Some((key, value)) = line.split_once(':') {
                fields
                    .entry(key.split('[').next().unwrap_or(key).to_string())
                    .or_default()
                    .push(nm_unescape(value));
            }
        }
        let Some(device) = first_field(&fields, "GENERAL.DEVICE") else {
            continue;
        };
        if device == "lo" {
            continue;
        }
        let connection_uuid = first_field(&fields, "GENERAL.CON-UUID")
            .filter(|value| !value.is_empty() && value != "--");
        let (ipv4_mode, ipv6_mode) = connection_uuid
            .as_deref()
            .and_then(linux_connection_methods)
            .unwrap_or((IpMode::Automatic, IpMode::Automatic));
        adapters.push(NetworkAdapterSnapshot {
            id: device.clone(),
            name: first_field(&fields, "GENERAL.CONNECTION")
                .filter(|value| value != "--")
                .unwrap_or_else(|| device.clone()),
            detail: Some(device.clone()),
            service_id: connection_uuid,
            connected: first_field(&fields, "GENERAL.STATE")
                .is_some_and(|value| value.starts_with("100")),
            ipv4: NetworkFamilySnapshot {
                mode: ipv4_mode,
                addresses: address_fields(&fields, "IP4.ADDRESS", 32),
                gateway: first_field(&fields, "IP4.GATEWAY").filter(|value| !value.is_empty()),
            },
            ipv6: NetworkFamilySnapshot {
                mode: ipv6_mode,
                addresses: address_fields(&fields, "IP6.ADDRESS", 128),
                gateway: first_field(&fields, "IP6.GATEWAY").filter(|value| !value.is_empty()),
            },
            dns_servers: fields
                .get("IP4.DNS")
                .into_iter()
                .flatten()
                .chain(fields.get("IP6.DNS").into_iter().flatten())
                .filter(|value| value.parse::<IpAddr>().is_ok())
                .cloned()
                .collect(),
        });
    }
    Ok(NetworkProfilesSnapshot {
        platform: "linux",
        capability: "supported",
        adapters,
    })
}

#[cfg(target_os = "linux")]
fn linux_connection_methods(uuid: &str) -> Option<(IpMode, IpMode)> {
    let mut command = Command::new("nmcli");
    command.args([
        "-g",
        "ipv4.method,ipv6.method",
        "connection",
        "show",
        "uuid",
        uuid,
    ]);
    let output = command_output(command, "NetworkManager").ok()?;
    let mut lines = output.lines();
    Some((linux_mode(lines.next()?), linux_mode(lines.next()?)))
}

#[cfg(target_os = "linux")]
fn linux_mode(value: &str) -> IpMode {
    match value.trim() {
        "manual" => IpMode::Manual,
        "disabled" | "ignore" => IpMode::Disabled,
        _ => IpMode::Automatic,
    }
}

#[cfg(target_os = "linux")]
fn linux_apply(request: &ApplyNetworkProfileRequest) -> Result<(), String> {
    let uuid = request
        .service_id
        .as_deref()
        .ok_or("the selected adapter has no active NetworkManager connection")?;
    let mut args = vec![
        "nmcli".to_string(),
        "connection".into(),
        "modify".into(),
        "uuid".into(),
        uuid.into(),
    ];
    append_nm_family(&mut args, "ipv4", &request.ipv4);
    append_nm_family(&mut args, "ipv6", &request.ipv6);
    let ipv4_dns = request
        .dns_servers
        .iter()
        .filter(|value| {
            value
                .parse::<IpAddr>()
                .is_ok_and(|address| address.is_ipv4())
        })
        .cloned()
        .collect::<Vec<_>>()
        .join(",");
    let ipv6_dns = request
        .dns_servers
        .iter()
        .filter(|value| {
            value
                .parse::<IpAddr>()
                .is_ok_and(|address| address.is_ipv6())
        })
        .cloned()
        .collect::<Vec<_>>()
        .join(",");
    let ignore_auto_dns = if request.dns_servers.is_empty() {
        "no"
    } else {
        "yes"
    };
    args.extend([
        "ipv4.dns".into(),
        ipv4_dns,
        "ipv6.dns".into(),
        ipv6_dns,
        "ipv4.ignore-auto-dns".into(),
        ignore_auto_dns.into(),
        "ipv6.ignore-auto-dns".into(),
        ignore_auto_dns.into(),
    ]);
    let status = Command::new("pkexec")
        .args(&args)
        .status()
        .map_err(|error| format!("failed to request administrator authorization: {error}"))?;
    if !status.success() {
        return Err("NetworkManager rejected the profile change".into());
    }
    let status = Command::new("pkexec")
        .args(["nmcli", "connection", "up", "uuid", uuid])
        .status()
        .map_err(|error| format!("failed to activate the NetworkManager connection: {error}"))?;
    status
        .success()
        .then_some(())
        .ok_or_else(|| "NetworkManager could not activate the updated connection".into())
}

#[cfg(any(target_os = "linux", test))]
fn append_nm_family(args: &mut Vec<String>, prefix: &str, family: &NetworkFamilySnapshot) {
    let method = match family.mode {
        IpMode::Automatic => "auto",
        IpMode::Manual => "manual",
        IpMode::Disabled => "disabled",
    };
    args.extend([format!("{prefix}.method"), method.into()]);
    args.extend([
        format!("{prefix}.addresses"),
        if family.mode == IpMode::Manual {
            family
                .addresses
                .iter()
                .map(|value| format!("{}/{}", value.address, value.prefix))
                .collect::<Vec<_>>()
                .join(",")
        } else {
            String::new()
        },
    ]);
    args.extend([
        format!("{prefix}.gateway"),
        if family.mode == IpMode::Manual {
            family.gateway.clone().unwrap_or_default()
        } else {
            String::new()
        },
    ]);
}

#[cfg(target_os = "linux")]
fn nm_unescape(value: &str) -> String {
    value.replace("\\:", ":").replace("\\\\", "\\")
}

#[cfg(target_os = "linux")]
fn first_field(
    fields: &std::collections::HashMap<String, Vec<String>>,
    key: &str,
) -> Option<String> {
    fields.get(key)?.first().cloned()
}

#[cfg(target_os = "linux")]
fn address_fields(
    fields: &std::collections::HashMap<String, Vec<String>>,
    key: &str,
    fallback: u8,
) -> Vec<NetworkProfileAddress> {
    fields
        .get(key)
        .into_iter()
        .flatten()
        .filter(|value| !value.is_empty())
        .map(|value| {
            let (address, prefix) = split_cidr(value, fallback);
            NetworkProfileAddress { address, prefix }
        })
        .collect()
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn split_cidr(value: &str, fallback: u8) -> (String, u8) {
    value
        .rsplit_once('/')
        .and_then(|(address, prefix)| {
            prefix
                .parse()
                .ok()
                .map(|prefix| (address.to_string(), prefix))
        })
        .unwrap_or_else(|| (value.to_string(), fallback))
}

fn ipv4_mask_to_prefix(mask: &str) -> Option<u8> {
    let value = u32::from(mask.parse::<Ipv4Addr>().ok()?);
    let prefix = value.leading_ones() as u8;
    let expected = if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix)
    };
    (value == expected).then_some(prefix)
}

#[cfg(any(all(target_os = "macos", not(feature = "mac-app-store")), test))]
fn ipv4_prefix_to_mask(prefix: u8) -> String {
    let mask = if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix)
    };
    mask.to_be_bytes()
        .iter()
        .map(u8::to_string)
        .collect::<Vec<_>>()
        .join(".")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_address_families_and_manual_addresses() {
        let family = NetworkFamilySnapshot {
            mode: IpMode::Manual,
            addresses: vec![NetworkProfileAddress {
                address: "192.168.1.5".into(),
                prefix: 24,
            }],
            gateway: Some("192.168.1.1".into()),
        };
        assert!(validate_family(&family, false).is_ok());
        assert!(validate_family(&family, true).is_err());
    }

    #[test]
    fn converts_ipv4_prefixes_and_masks() {
        assert_eq!(ipv4_prefix_to_mask(24), "255.255.255.0");
        assert_eq!(ipv4_mask_to_prefix("255.255.0.0"), Some(16));
        assert_eq!(ipv4_mask_to_prefix("255.0.255.0"), None);
    }

    #[test]
    fn windows_automatic_mode_removes_manual_addresses_and_routes() {
        let family = NetworkFamilySnapshot {
            mode: IpMode::Automatic,
            addresses: Vec::new(),
            gateway: None,
        };
        let statements = windows_family_statements("IPv4", "ms_tcpip", &family).join("\n");
        assert!(statements.contains("-Dhcp Enabled"));
        assert!(statements.contains("PrefixOrigin -eq 'Manual'"));
        assert!(statements.contains("Protocol -eq 'NetMgmt'"));
    }

    #[test]
    fn network_manager_clears_non_manual_addresses_and_gateways() {
        let family = NetworkFamilySnapshot {
            mode: IpMode::Automatic,
            addresses: vec![NetworkProfileAddress {
                address: "192.168.1.5".into(),
                prefix: 24,
            }],
            gateway: Some("192.168.1.1".into()),
        };
        let mut args = Vec::new();
        append_nm_family(&mut args, "ipv4", &family);
        assert_eq!(
            args,
            [
                "ipv4.method",
                "auto",
                "ipv4.addresses",
                "",
                "ipv4.gateway",
                "",
            ]
        );
    }

    #[test]
    fn rejects_control_characters_in_adapter_ids() {
        assert!(validate_identifier("Ethernet\nInjected", "adapter").is_err());
    }

    #[test]
    fn overlapping_apply_is_rejected_before_any_os_command() {
        let guard = PROFILE_APPLY_LOCK.lock().unwrap();
        let family = NetworkFamilySnapshot {
            mode: IpMode::Automatic,
            addresses: Vec::new(),
            gateway: None,
        };
        let error = apply(ApplyNetworkProfileRequest {
            adapter_id: "test-adapter-not-a-real-device".into(),
            service_id: None,
            ipv4: family.clone(),
            ipv6: family,
            dns_servers: Vec::new(),
        }).unwrap_err();
        assert_eq!(error, "another network profile is already being applied");
        drop(guard);
        assert!(PROFILE_APPLY_LOCK.try_lock().is_ok());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_snapshot_handles_unicode_multiple_gateways_and_empty_arrays() {
        // Stub discovery commands only; never inspect or change the host network.
        let fixtures = r#"
function Get-NetAdapter { [pscustomobject]@{ Virtual=$false; ifIndex=42; InterfaceGuid=[guid]'00000000-0000-0000-0000-000000000042'; Name='乙太網路'; InterfaceDescription='測試介面'; Status='Up' } }
function Get-NetIPInterface { [pscustomobject]@{ Dhcp='Enabled'; RouterDiscovery='Enabled' } }
function Get-NetIPConfiguration { [pscustomobject]@{
  IPv4Address=@([pscustomobject]@{ IPAddress='192.0.2.10'; PrefixLength=24 });
  IPv4DefaultGateway=@([pscustomobject]@{ NextHop='192.0.2.2'; RouteMetric=20 }, [pscustomobject]@{ NextHop='192.0.2.1'; RouteMetric=5 });
  IPv6DefaultGateway=@()
} }
function Get-NetAdapterBinding { [pscustomobject]@{ Enabled=$true } }
function Get-NetIPAddress { }
function Get-DnsClientServerAddress { [pscustomobject]@{ ServerAddresses=@('192.0.2.53') } }
"#;
        let script = format!("{fixtures}\n{}", windows_snapshot_script());
        let raw = command_output(windows_snapshot_command(&script), "PowerShell fixture").unwrap();
        let values: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
        assert_eq!(values.len(), 1);
        assert_eq!(values[0]["name"], "乙太網路");
        assert_eq!(values[0]["detail"], "測試介面");
        assert_eq!(values[0]["ipv4Gateway"], "192.0.2.1");
        assert!(values[0]["ipv6Gateway"].is_null());
        assert_eq!(values[0]["ipv4Addresses"], serde_json::json!(["192.0.2.10/24"]));
        assert_eq!(values[0]["ipv6Addresses"], serde_json::json!([]));
        assert_eq!(values[0]["dnsServers"], serde_json::json!(["192.0.2.53"]));

        let script = format!("function Get-NetAdapter {{ }}\n{}", windows_snapshot_script());
        let raw = command_output(windows_snapshot_command(&script), "PowerShell empty fixture").unwrap();
        let values: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
        assert!(values.is_empty());
    }
}
