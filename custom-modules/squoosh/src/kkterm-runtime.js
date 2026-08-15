(() => {
  const host = window.KKTerm;
  if (!host || host.apiVersion !== 2) {
    console.error("KKTerm host API v2 is unavailable.");
    return;
  }

  let readySent = false;
  const applyContext = (context) => {
    document.documentElement.lang = "en";
    document.documentElement.dataset.kktermTheme = context?.theme || "light";
    document.documentElement.style.colorScheme = String(context?.theme || "light")
      .toLowerCase()
      .includes("dark")
      ? "dark"
      : "light";
  };
  const signalReady = async () => {
    if (readySent) return;
    readySent = true;
    try {
      await host.ready();
    } catch (error) {
      readySent = false;
      throw error;
    }
  };
  const waitForUsableUi = async () => {
    if (document.readyState === "loading") {
      await new Promise((resolve) => {
        document.addEventListener("DOMContentLoaded", resolve, { once: true });
      });
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!document.getElementById("app")) {
      throw new Error("Squoosh application root is missing.");
    }
  };

  host.on("contextChanged", applyContext);
  host.on("visibilityChanged", () => undefined);
  host.on("focusChanged", () => undefined);
  host.on("suspending", () => undefined);
  host.on("closing", () => undefined);

  void (async () => {
    const [context] = await Promise.all([
      host.getContext(),
      host.getCapabilities(),
    ]);
    applyContext(context);
    await waitForUsableUi();
    await signalReady();
  })().catch((error) => {
    console.error("Failed to initialize the Squoosh KKTerm adapter", error);
    void signalReady().catch((readyError) => {
      console.error("Failed to reveal the Squoosh startup error", readyError);
    });
  });
})();
