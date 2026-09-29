from pathlib import Path
import re


def functions(path, names):
    text = Path(path).read_text(encoding='utf-8')
    lines = text.splitlines()
    for name in names:
        hits = [i for i, line in enumerate(lines) if re.search(r'\bfn\s+' + re.escape(name) + r'\b', line)]
        for start in hits:
            end = next((i for i in range(start + 1, len(lines)) if re.match(r'^(?:pub(?:\([^)]*\))? )?(?:async )?fn ', lines[i])), len(lines))
            print('\n###', path, name, start + 1, end)
            print('\n'.join(f'{i+1}: {lines[i]}' for i in range(start, min(end, start + 260))))

functions('src-tauri/src/ai.rs', ['ai_tool_definitions_with_skills', 'tool_requires_allow_all', 'is_live_tool', 'execute_tool', 'execute_tool_call', 'tool_enabled', 'tool_definition'])
functions('src-tauri/src/mcp_bridge.rs', ['call_tool', 'dispatch_tool', 'handle_tool_call', 'is_dangerous_tool', 'tool_descriptors'])
for path, patterns in {
    'src-tauri/src/ai.rs': ['request_live_tool', 'tool_requires_allow_all', 'ai_tool_definitions_with_skills', 'ai_tool_settings', 'starts_with("session_', 'settings.connections()'],
    'src-tauri/src/mcp_bridge.rs': ['async fn', 'fn tool', 'allow_all_dangerous', 'request_live_tool', 'tool_descriptors'],
    'src/store.ts': ['updateTerminalSettings', 'terminalAppearance', 'setConnectionTerminal', 'updateConnectionTerminal', 'fileBrowserViewOptions'],
    'src/modules/dashboard/registry/dynamicBackgrounds.tsx': ['export const DYNAMIC_BACKGROUNDS', 'DynamicBackgroundId'],
    'src/modules/workspace/connections/terminal/syntaxHighlighting.ts': ['export function', 'export const BUILTIN'],
}.items():
    p = Path(path)
    if not p.exists():
        print('MISSING', path)
        continue
    lines = p.read_text(encoding='utf-8').splitlines()
    for i, line in enumerate(lines):
        if any(pattern in line for pattern in patterns):
            print('\n###', path, i + 1)
            print('\n'.join(f'{j+1}: {lines[j]}' for j in range(max(0, i-3), min(len(lines), i+12))))
print('\n### source files')
for root in ['src/store', 'src/modules/dashboard/state', 'src/modules/itops', 'src-tauri/src/storage']:
    p = Path(root)
    if p.exists():
        print(root, [str(child) for child in p.iterdir()])
