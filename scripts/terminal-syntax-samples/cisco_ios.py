#!/usr/bin/env python3
"""Small interactive Cisco IOS-like CLI for terminal highlighting tests."""

import argparse
import random
import re


INTERFACES = [
    "GigabitEthernet1/0/1",
    "GigabitEthernet1/0/2",
    "Te1/1/1",
    "Port-channel1",
    "Vlan10",
    "Loopback0",
]


def random_ipv4(network=None):
    if network:
        return f"{network}.{random.randint(1, 254)}"
    return ".".join(str(random.randint(1, 254)) for _ in range(4))


def random_mac():
    return ".".join(f"{random.randint(0, 0xFFFF):04x}" for _ in range(3))


def show_version(hostname):
    days = random.randint(2, 900)
    hours = random.randint(0, 23)
    serial = "FCW" + "".join(random.choices("0123456789ABCDEFGHJKLMNPQRSTUVWXYZ", k=8))
    print("Cisco IOS XE Software, Version 17.09.04a")
    print("Cisco IOS Software [Cupertino], Catalyst L3 Switch Software (CAT9K_IOSXE)")
    print(f"{hostname} uptime is {days} days, {hours} hours")
    print("System returned to ROM by PowerOn")
    print("System image file is \"bootflash:packages.conf\"")
    print("cisco C9300-48P (X86) processor with 8388608K bytes of memory.")
    print(f"Processor board ID {serial}")
    print("48 Gigabit Ethernet interfaces")
    print("4 Ten Gigabit Ethernet interfaces")
    print("Configuration register is 0x102")


def show_ip_interface_brief():
    states = [
        ("up", "up"),
        ("up", "up"),
        ("connected", "up"),
        ("administratively down", "down"),
        ("down", "down"),
        ("err-disabled", "down"),
    ]
    print("Interface              IP-Address      OK? Method Status                Protocol")
    for index, interface in enumerate(INTERFACES):
        address = "unassigned" if index < 3 else f"10.{index}.0.{random.randint(1, 254)}"
        status, protocol = random.choice(states)
        print(f"{interface:<22} {address:<15} YES manual {status:<21} {protocol}")


def show_interfaces():
    for interface in random.sample(INTERFACES, k=3):
        status, protocol = random.choice(
            [("up", "up"), ("up", "up"), ("down", "down"), ("administratively down", "down")]
        )
        mac = random_mac()
        print(f"{interface} is {status}, line protocol is {protocol}")
        print(f"  Hardware is Ethernet, address is {mac} (bia {mac})")
        print(f"  Internet address is 10.{random.randint(1, 99)}.{random.randint(0, 254)}.1/24")
        print("  MTU 1500 bytes, BW 1000000 Kbit/sec, DLY 10 usec")
        print(
            f"  5 minute input rate {random.randint(0, 9000)} bits/sec, "
            f"{random.randint(0, 80)} packets/sec"
        )
        print(
            f"  {random.randint(1000, 999999)} packets input, "
            f"{random.randint(0, 12)} input errors, {random.randint(0, 3)} CRC"
        )
        print(
            f"  {random.randint(1000, 999999)} packets output, "
            f"{random.randint(0, 8)} output errors"
        )


def show_ip_route():
    next_hop = random_ipv4("10.20.0")
    print("Codes: C - connected, S - static, O - OSPF, B - BGP, D - EIGRP")
    print("Gateway of last resort is 10.20.0.1 to network 0.0.0.0")
    print("S*    0.0.0.0/0 [1/0] via 10.20.0.1")
    print("C     10.10.10.0/24 is directly connected, Vlan10")
    print("L     10.10.10.1/32 is directly connected, Vlan10")
    print(f"O     172.16.{random.randint(0, 99)}.0/24 [110/20] via {next_hop}, GigabitEthernet1/0/1")
    print(f"B     192.0.2.0/24 [20/0] via {random_ipv4('10.30.0')}, Port-channel1")


def show_bgp_summary():
    print("BGP router identifier 10.255.0.1, local AS number 65001")
    print("Neighbor        V    AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd")
    for neighbor, state in [
        ("192.0.2.2", str(random.randint(10, 500))),
        ("198.51.100.2", "Active"),
        ("203.0.113.2", "Idle"),
    ]:
        print(
            f"{neighbor:<15} 4 65002 {random.randint(10, 9000):>7} {random.randint(10, 9000):>7} "
            f"{random.randint(1, 99):>8}    0    0 2d04h    {state}"
        )


def show_logging(count=12):
    messages = [
        "%LINK-3-UPDOWN: Interface GigabitEthernet1/0/2, changed state to down",
        "%LINEPROTO-5-UPDOWN: Line protocol on Interface Vlan10, changed state to up",
        "%SYS-2-MALLOCFAIL: Memory allocation of 4096 bytes failed",
        "%SEC_LOGIN-4-LOGIN_FAILED: Login failed from 198.51.100.44",
        "%OSPF-5-ADJCHG: Process 1, Nbr 10.20.0.2 on Gi1/0/1 from LOADING to FULL",
        "%BGP-5-ADJCHANGE: neighbor 192.0.2.2 Up",
        "%PM-4-ERR_DISABLE: psecure-violation error detected on Gi1/0/2, putting Gi1/0/2 in err-disabled state",
        "%HA_EM-6-LOG: HSRP group 10 is now Active; standby peer 10.10.10.2",
        "%PLATFORM-4-ELEMENT_WARNING: Te1/1/1 optical power degraded",
    ]
    for sequence in range(max(1, min(count, 200))):
        print(f"{sequence + 1:06d}: {random.choice(messages)}")


def print_demo(hostname):
    print(f"{hostname}# show syntax-highlighting-demo")
    print("GigabitEthernet1/0/1 10.10.10.1/24 0011.2233.4455 connected up")
    print("Te1/1/1 203.0.113.10:443 aa:bb:cc:dd:ee:ff trunk standby warning")
    print("Vlan99 administratively down; Port-channel2 is err-disabled and unreachable")
    print("BGP OSPF OSPFv3 EIGRP RIP HSRP VRRP MPLS LDP")
    print("permit active success passed complete enabled")
    print("deny denied invalid timeout failed disabled degraded flapping")
    print("%SYS-2-MALLOCFAIL: allocation failed for routing process")


def print_help():
    print("Supported commands:")
    print("  show version                 show IOS and platform details")
    print("  show ip interface brief      show randomized interface states")
    print("  show interfaces              show randomized interface counters")
    print("  show ip route                show a small mixed-protocol route table")
    print("  show bgp summary             show established and inactive peers")
    print("  show logging [COUNT]         emit randomized IOS-style messages")
    print("  demo                         print every built-in highlight category")
    print("  configure terminal           enter configuration mode")
    print("  interface NAME               enter interface configuration mode")
    print("  hostname NAME                change the emulated hostname")
    print("  shutdown | no shutdown       emit an interface state change")
    print("  end | exit | quit            change mode or leave the emulator")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, help="make randomized output repeatable")
    args = parser.parse_args()
    random.seed(args.seed)

    hostname = "edge-ios-01"
    mode = "privileged"
    selected_interface = None
    print("Cisco IOS XE Software, mock terminal for KKTerm keyword highlighting")
    print("Type help or ? for supported commands. Type demo for full keyword coverage.\n")

    while True:
        suffix = {
            "user": ">",
            "privileged": "#",
            "config": "(config)#",
            "interface": "(config-if)#",
        }[mode]
        try:
            raw = input(f"{hostname}{suffix} ")
        except (EOFError, KeyboardInterrupt):
            print("\nConnection closed by foreign host.")
            break

        command = " ".join(raw.strip().split())
        lowered = command.lower()
        if not command:
            continue
        if lowered in {"help", "?"}:
            print_help()
        elif lowered in {"quit", "logout"}:
            print("Connection closed by foreign host.")
            break
        elif lowered == "exit":
            if mode == "interface":
                mode = "config"
            elif mode == "config":
                mode = "privileged"
            else:
                print("Connection closed by foreign host.")
                break
        elif lowered == "end":
            mode = "privileged"
        elif lowered == "enable":
            mode = "privileged"
        elif lowered == "disable":
            mode = "user"
        elif lowered in {"configure terminal", "conf t"}:
            mode = "config"
            print("Enter configuration commands, one per line. End with CNTL/Z.")
        elif mode in {"config", "interface"} and lowered.startswith("hostname "):
            candidate = re.sub(r"[^A-Za-z0-9._-]", "-", command.split(" ", 1)[1])[:32]
            hostname = candidate or hostname
        elif mode == "config" and lowered.startswith("interface "):
            selected_interface = command.split(" ", 1)[1]
            mode = "interface"
        elif mode == "interface" and lowered in {"shutdown", "no shutdown"}:
            state = "administratively down" if lowered == "shutdown" else "up"
            print(f"%LINK-3-UPDOWN: Interface {selected_interface}, changed state to {state}")
        else:
            operational = lowered[3:] if lowered.startswith("do ") else lowered
            if operational in {"show version", "show ver", "sh ver"}:
                show_version(hostname)
            elif operational in {"show ip interface brief", "sh ip int br"}:
                show_ip_interface_brief()
            elif operational in {"show interfaces", "sh interfaces", "sh int"}:
                show_interfaces()
            elif operational in {"show ip route", "sh ip route"}:
                show_ip_route()
            elif operational in {"show bgp summary", "show ip bgp summary", "sh bgp sum"}:
                show_bgp_summary()
            elif operational.startswith("show logging") or operational.startswith("sh log"):
                match = re.search(r"(\d+)$", operational)
                show_logging(int(match.group(1)) if match else 12)
            elif operational == "demo":
                print_demo(hostname)
            elif operational in {"terminal length 0", "term len 0"}:
                pass
            else:
                print("% Invalid input detected at '^' marker.")


if __name__ == "__main__":
    main()
