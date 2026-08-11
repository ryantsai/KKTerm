# Terminal syntax-highlighting samples

These dependency-free Python scripts emulate the output targeted by each built-in Keyword Highlighting profile. They are development fixtures, not network-device simulators.

| Built-in profile | Script |
| --- | --- |
| Cisco IOS | `cisco_ios.py` |
| Juniper Junos | `juniper_junos.py` |
| Operational Logs | `operational_logs.py` |

From the repository root, run one in a Local Connection:

```text
python scripts/terminal-syntax-samples/cisco_ios.py
python scripts/terminal-syntax-samples/juniper_junos.py
python scripts/terminal-syntax-samples/operational_logs.py
```

Use `python3` instead of `python` where needed. Then select the matching Keyword Highlighting profile from the terminal Pane menu. Each emulator supports `help` (or `?`), `demo`, several common platform commands, and `exit`/`quit`. Network state, counters, messages, addresses, and identifiers vary between commands.

Pass `--seed NUMBER` to make a run repeatable while debugging, for example:

```text
python scripts/terminal-syntax-samples/cisco_ios.py --seed 42
```
