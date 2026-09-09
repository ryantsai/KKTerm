"""Check the actual signed bundle before preparing an App Store submission."""
import pathlib
import plistlib
import subprocess
import sys

app = pathlib.Path(sys.argv[1])
subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
signed = subprocess.run(
    ["codesign", "-d", "--entitlements", ":-", str(app)],
    check=True, capture_output=True,
)
entitlements = plistlib.loads(signed.stdout)
for key in ("com.apple.security.app-sandbox", "com.apple.security.files.user-selected.read-write"):
    if entitlements.get(key) is not True:
        raise SystemExit(f"Missing required entitlement: {key}")
if "com.apple.security.files.downloads.read-write" in entitlements:
    raise SystemExit("Remove the unrestricted Downloads entitlement before submission")
if not (app / "Contents/embedded.provisionprofile").is_file():
    raise SystemExit("The signed bundle has no embedded provisioning profile")
print("App Store bundle signature and file-access entitlements verified.")
