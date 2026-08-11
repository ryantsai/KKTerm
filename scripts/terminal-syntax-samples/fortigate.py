#!/usr/bin/env python3
"""Small interactive FortiGate-like CLI for terminal highlighting tests."""

import argparse
import random


def show_system_status(hostname):
    print(f"Hostname: {hostname}")
    print("Version: FortiGate-VM64 v7.6.3,build2573,250416 (GA.F)")
    print("Operation Mode: NAT")
    print(f"System time: Tue Aug 11 15:{random.randint(10, 59):02d}:00 2026")
    print("Current HA mode: primary")
    print("Uptime: 18 days, 3 hours, 12 minutes")


def show_interfaces():
    print("name                 status   ip                         mac")
    print("wan1                 up       203.0.113.1/24             00:09:0f:aa:bb:01")
    print("port2                down     0.0.0.0/0                  00:09:0f:aa:bb:02")
    print("fortilink            active   10.255.1.1/24              00:09:0f:aa:bb:03")
    print("ssl.root             up       2001:db8:20::1/64          00:09:0f:aa:bb:04")
    print("virtual-wan-link     degraded SLA health-check flapping")


def show_routing():
    print("Routing table for VRF=0")
    print("S*  0.0.0.0/0 [10/0] via 203.0.113.254, wan1")
    print("C   203.0.113.0/24 is directly connected, wan1")
    print("B   10.20.0.0/16 [20/0] via 192.0.2.2, port3, established")
    print("O   10.30.0.0/16 [110/20] via 192.0.2.6, port4, BFD up")
    print("BGP OSPFv3 RIPng IS-IS static connected kernel route-map prefix-list")


def show_vpn():
    print("IPsec VPN tunnel summary")
    print("name=branch-hq IKEv2 phase1=up phase2=installed selector=valid")
    print("proxyid=branch-subnets status=active security association established")
    print("name=backup-advpn status=down error=timeout out-of-sync")
    print("SSL-VPN ssl.root dialup tunnel negotiating")


def show_ha():
    print("HA Health Status: OK")
    print("Model: FortiGate-VM64")
    print("Mode: HA A-P FGCP cluster")
    print("Primary: FGT-EDGE synchronized in-sync heartbeat alive")
    print("Secondary: FGT-STANDBY standby member reachable")
    print("SD-WAN SLA link-monitor health-check failover virtual-wan-link")


def show_security():
    print("firewall policy policy6 address addrgrp service VIP IP pool SNAT DNAT NAT")
    print("UTM IPS antivirus webfilter dnsfilter application control SSL inspection DoS")
    print("FortiGuard LDAP RADIUS TACACS+ FSSO SAML FortiToken two-factor authentication")
    print("CPU 8% memory 41% sessions 18240 uptime NPU offload NP7 FortiASIC")
    print("allow accept success enabled valid blocked denied dropped critical fault")


def print_demo(hostname):
    print(f"{hostname} (root) # show syntax-highlighting-demo")
    show_interfaces()
    show_routing()
    show_vpn()
    show_ha()
    show_security()
    print("config edit set unset append select unselect next end show get diagnose execute tree")


def print_help():
    print("Supported commands:")
    print("  get system status            show FortiOS and HA details")
    print("  get system interface         show interface states and addresses")
    print("  get router info routing-table all")
    print("  diagnose vpn tunnel list     show IPsec and SSL-VPN states")
    print("  get system ha status         show HA and SD-WAN states")
    print("  show firewall policy         show security and resource vocabulary")
    print("  demo                         print every built-in highlight category")
    print("  exit | quit                  leave the emulator")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, help="make randomized output repeatable")
    args = parser.parse_args()
    random.seed(args.seed)
    hostname = "FGT-EDGE"

    print("FortiGate FortiOS, mock terminal for KKTerm keyword highlighting")
    print("Type help or ? for supported commands. Type demo for full keyword coverage.\n")
    while True:
        try:
            command = " ".join(input(f"{hostname} (root) # ").strip().split()).lower()
        except (EOFError, KeyboardInterrupt):
            print("\nConnection closed.")
            break
        if not command:
            continue
        if command in {"help", "?"}:
            print_help()
        elif command in {"exit", "quit", "logout"}:
            print("Connection closed.")
            break
        elif command == "get system status":
            show_system_status(hostname)
        elif command in {"get system interface", "diagnose netlink interface list"}:
            show_interfaces()
        elif command in {"get router info routing-table all", "diagnose ip route list"}:
            show_routing()
        elif command in {"diagnose vpn tunnel list", "get vpn ipsec tunnel summary"}:
            show_vpn()
        elif command == "get system ha status":
            show_ha()
        elif command == "show firewall policy":
            show_security()
        elif command == "demo":
            print_demo(hostname)
        else:
            print("Command fail. Return code -61")


if __name__ == "__main__":
    main()
