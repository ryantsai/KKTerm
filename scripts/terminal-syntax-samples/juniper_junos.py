#!/usr/bin/env python3
"""Small interactive Juniper Junos-like CLI for terminal highlighting tests."""

import argparse
import random
import re


INTERFACES = ["ge-0/0/0", "ge-0/0/1", "xe-0/1/0", "ae0", "irb.10", "lo0.0", "reth0.0", "st0.1"]


def random_ipv4(network):
    return f"{network}.{random.randint(1, 254)}"


def show_version(hostname):
    print(f"Hostname: {hostname}")
    print("Model: mx204")
    print("Junos: 23.4R2-S3.9")
    print("JUNOS OS Kernel 64-bit  [2025.01.10]")
    print("JUNOS Packet Forwarding Engine Support (MX204) [23.4R2-S3.9]")


def show_interfaces_terse():
    states = [("up", "up"), ("up", "up"), ("down", "down"), ("enabled", "probing")]
    print("Interface               Admin Link Proto    Local                 Remote")
    for index, interface in enumerate(INTERFACES):
        admin, link = random.choice(states)
        proto = "inet" if "." in interface else "eth-switch"
        address = f"10.{index}.0.{random.randint(1, 254)}/24" if "." in interface else ""
        print(f"{interface:<23} {admin:<5} {link:<4} {proto:<8} {address}")


def show_route():
    print("inet.0: 18 destinations, 22 routes (16 active, 2 holddown, 4 hidden)")
    print("+ = Active Route, - = Last Active, * = Both")
    print("0.0.0.0/0          *[Static/5] 2d 04:11:03")
    print("                    >  to 10.0.0.1 via ge-0/0/0.0")
    print("10.10.10.0/24      *[Direct/0] 5w2d 01:22:10")
    print("                    >  via irb.10")
    print(f"172.16.{random.randint(1, 99)}.0/24 *[OSPF/10] 00:14:22, metric 20")
    print(f"                    >  to {random_ipv4('10.20.0')} via ae0.0")
    print("192.0.2.0/24       *[BGP/170] 1d 12:03:51, localpref 100")
    print("                    >  to 198.51.100.2 via xe-0/1/0.0")


def show_bgp_summary():
    print("Groups: 2 Peers: 4 Down peers: 1")
    print("Table          Tot Paths  Act Paths Suppressed    History Damp State    Pending")
    print(f"inet.0              {random.randint(500, 900)}        {random.randint(400, 500)}          0          0          0          0")
    print("Peer               AS      InPkt     OutPkt    OutQ   Flaps Last Up/Dwn State|#Active/Received/Accepted/Damped...")
    print(f"192.0.2.2       65002      {random.randint(1000, 9000):>5}      {random.randint(1000, 9000):>5}       0       1 2d04h Establ")
    print("  inet.0: 120/150/150/0")
    print("198.51.100.2    65003         14         17       0       7 00:02:11 Active")
    print("203.0.113.2     65004          0          0       0       0 00:10:44 Connect")


def show_alarms():
    alarms = random.choice(
        [
            ["No alarms currently active"],
            [
                "2 alarms currently active",
                "Alarm time               Class  Description",
                "2026-08-11 09:42:10 CST  Minor  FPC 0 temperature warning",
                "2026-08-11 09:43:02 CST  Major  xe-0/1/0 optic degraded; backup path active",
            ],
        ]
    )
    print("\n".join(alarms))


def show_log_messages(count=12):
    messages = [
        "RPD_BGP_NEIGHBOR_STATE_CHANGED: BGP peer 192.0.2.2 changed from Connect to Established",
        "RPD_OSPF_NBRDOWN: OSPF neighbor 10.20.0.2 is down",
        "SNMP_TRAP_LINK_UP: ifIndex 519, ge-0/0/1 up",
        "SNMP_TRAP_LINK_DOWN: ifIndex 520, xe-0/1/0 down",
        "UI_COMMIT_COMPLETED: commit complete by admin",
        "CHASSISD_FPC_TEMP_WARNING: FPC 0 temperature warning; backup fan active",
        "RPD_ROUTE_REJECTED: BGP route 203.0.113.0/24 reject policy applied",
        "EVENTD_SYSTEM_CALL_FAILED: failed to open statistics file",
        "KERN_ARP_UNREACHABLE: host 198.51.100.9 unreachable; probing",
    ]
    for sequence in range(max(1, min(count, 200))):
        print(f"Aug 11 14:{random.randint(10, 59):02d}:{random.randint(0, 59):02d} edge-junos-01 {random.choice(messages)}")


def print_demo(hostname, user):
    print(f"{user}@{hostname}> show syntax-highlighting-demo")
    print("ge-0/0/0 xe-0/1/0.0 ae0 irb.10 lo0.0 reth0.0 st0.1")
    print("10.10.10.1/24 2001:db8:10::1/64 00:11:22:33:44:55")
    print("active up established master primary enabled complete success online ready")
    print("warning backup secondary standby probing degraded pending hold unknown")
    print("down disabled failed inactive reject timeout unreachable fault offline Major alarm")
    print("BGP OSPFv3 IS-IS LDP MPLS RSVP BFD EVPN VRRP PIM static direct")
    print("policy-statement prefix-list route-filter firewall term from then next-hop community")
    print("interfaces protocols routing-options policy-options security class-of-service traceoptions")
    print("family inet inet6 ethernet-switching bridge EVPN CCC MPLS ISO")
    print("set delete deactivate activate commit confirmed rollback load save compare edit top")


def print_help():
    print("Supported commands:")
    print("  show version                 show Junos and platform details")
    print("  show interfaces terse        show randomized interface states")
    print("  show route                   show a small mixed-protocol route table")
    print("  show bgp summary             show established and inactive peers")
    print("  show system alarms           show randomized alarm state")
    print("  show log messages [COUNT]    emit randomized Junos-style messages")
    print("  demo                         print every built-in highlight category")
    print("  configure                    enter configuration mode")
    print("  set | delete STATEMENT       edit the mock candidate configuration")
    print("  show | show | compare        inspect the mock candidate configuration")
    print("  commit | rollback            emulate candidate configuration actions")
    print("  exit | quit                  leave a mode or the emulator")


def run_show(command, hostname, user):
    if command in {"show version", "show system information"}:
        show_version(hostname)
    elif command in {"show interfaces terse", "show interfaces"}:
        show_interfaces_terse()
    elif command in {"show route", "show route terse"}:
        show_route()
    elif command in {"show bgp summary", "show route protocol bgp summary"}:
        show_bgp_summary()
    elif command == "show system alarms":
        show_alarms()
    elif command.startswith("show log messages"):
        match = re.search(r"(\d+)$", command)
        show_log_messages(int(match.group(1)) if match else 12)
    elif command == "demo":
        print_demo(hostname, user)
    else:
        print("syntax error, expecting <command>.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, help="make randomized output repeatable")
    args = parser.parse_args()
    random.seed(args.seed)

    user = "admin"
    hostname = "edge-junos-01"
    configuring = False
    candidate = []
    print("Junos OS mock terminal for KKTerm keyword highlighting")
    print("Type help or ? for supported commands. Type demo for full keyword coverage.\n")

    while True:
        if configuring:
            print("[edit]")
        try:
            raw = input(f"{user}@{hostname}{'#' if configuring else '>'} ")
        except (EOFError, KeyboardInterrupt):
            print("\nConnection closed.")
            break

        command = " ".join(raw.strip().split())
        lowered = command.lower()
        if not command:
            continue
        if lowered in {"help", "?"}:
            print_help()
        elif lowered in {"quit", "exit"}:
            if configuring:
                configuring = False
            else:
                print("Connection closed.")
                break
        elif not configuring and lowered in {"configure", "edit"}:
            configuring = True
            print("Entering configuration mode")
        elif configuring and lowered.startswith(("set ", "delete ")):
            candidate.append(command)
        elif configuring and lowered in {"show", "show | compare"}:
            if candidate:
                for line in candidate:
                    marker = "+" if line.lower().startswith("set ") else "-"
                    print(f"{marker} {line}")
            else:
                print("## No candidate changes")
        elif configuring and lowered == "commit":
            print("configuration check succeeds")
            print("commit complete")
            candidate.clear()
        elif configuring and lowered == "rollback":
            candidate.clear()
            print("load complete")
        else:
            operational = lowered[4:] if configuring and lowered.startswith("run ") else lowered
            run_show(operational, hostname, user)


if __name__ == "__main__":
    main()
