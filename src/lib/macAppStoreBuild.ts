import { useEffect, useState } from "react";
import { isMacAppStoreBuild } from "./tauri";

// React view of `isMacAppStoreBuild()`. The backend answer needs a round trip,
// so components start from `false` (the shape every other build keeps) and
// re-render once the answer arrives. Use it to hide features the App Sandbox
// makes impossible in the Mac App Store build; never to change behavior on any
// other platform or packaging.
export function useMacAppStoreBuild(): boolean {
  const [macAppStoreBuild, setMacAppStoreBuild] = useState(false);

  useEffect(() => {
    let disposed = false;
    void isMacAppStoreBuild()
      .then((value) => {
        if (!disposed) {
          setMacAppStoreBuild(value);
        }
      })
      .catch(() => {
        // Treat an unreachable backend as a normal build: the sandbox-only
        // restrictions below are additive, so falling back shows more, not less.
      });
    return () => {
      disposed = true;
    };
  }, []);

  return macAppStoreBuild;
}
