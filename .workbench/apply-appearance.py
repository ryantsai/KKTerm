"""Apply the reviewed patch to a clean, pinned checkout (workbench only)."""
from pathlib import Path
import base64
import hashlib
import json
import lzma
import re
import subprocess
import sys

payload_root = Path(__file__).resolve().parent
encoded = ''.join((payload_root / f'appearance-{i}.b64').read_text().strip() for i in range(1, 4))
patch = lzma.decompress(base64.b64decode(encoded, validate=True))
expected = '93d0f7e15aa99f3a03873f0d488a6ce8ce09e3e51274c4ac82660f315eb6ba84'
if hashlib.sha256(patch).hexdigest() != expected:
    raise SystemExit('Implementation patch checksum mismatch; refusing to apply.')
subprocess.run(['git', 'apply', '--check', '-'], input=patch, check=True)

# Extract existing data without changing any values. The code patch replaces
# their old inline declarations with imports of these shared JSON catalogs.
root = Path.cwd()
shared = root / 'src/shared'
shared.mkdir(exist_ok=True)
source = (root / 'src/modules/dashboard/registry/dynamicBackgrounds.tsx').read_text(encoding='utf-8')
match = re.search(r'export const DYNAMIC_BACKGROUNDS: readonly \{[\s\S]+?\}\[\] = \[([\s\S]+?)\n\];', source)
if not match:
    raise SystemExit('Expected original dynamic background catalog was not found.')
locales = {p.stem: json.loads(p.read_text(encoding='utf-8'))['dashboard']['dynamicBackgrounds'] for p in sorted((root / 'src/i18n/locales').glob('*.json'))}
backgrounds = []
for ident, key, mood in re.findall(r'\{ id: "(.*?)", labelKey: "(.*?)", mood: "(.*?)" \}', match[1]):
    backgrounds.append(dict(id=ident, labelKey=key, mood=mood, names={locale: labels[key.split('.')[-1]] for locale, labels in locales.items()}))
if len(backgrounds) != 85:
    raise SystemExit(f'Unexpected dynamic background count: {len(backgrounds)}')
(shared / 'dynamicBackgroundCatalog.json').write_text(json.dumps(backgrounds, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

source = (root / 'src/modules/workspace/connections/terminal/syntaxHighlighting.ts').read_text(encoding='utf-8')
block = source[source.index('const style ='):source.index('\nexport function syntaxHighlightProfileId')]
block = re.sub(r'const style = \([\s\S]+?\): TerminalSyntaxHighlightStyle =>', 'const style = (foreground, options = {}) =>', block, count=1)
block = re.sub(r'const rule = \([\s\S]+?\): TerminalSyntaxHighlightRule =>', 'const rule = (id, name, pattern, ruleStyle) =>', block, count=1)
block = block.replace('export const BUILTIN_SYNTAX_HIGHLIGHT_PROFILES: readonly TerminalSyntaxHighlightProfile[]', 'const profiles')
profiles = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', block + '\nconsole.log(JSON.stringify(profiles));'], text=True))
if len(profiles) != 4:
    raise SystemExit(f'Unexpected built-in highlighting profile count: {len(profiles)}')
(shared / 'builtinHighlightProfiles.json').write_text(json.dumps(profiles, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
subprocess.run(['git', 'apply', '-'], input=patch, check=True)
subprocess.run(['git', 'diff', '--check'], check=True)
print('Applied verified appearance parity patch, preserving 85 backgrounds and 4 built-in highlighting profiles.')
