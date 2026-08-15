const setText = (id, value) => {
  document.getElementById(id).textContent = value;
};

const renderContext = (context) => {
  document.documentElement.dataset.theme = context.theme;
  document.documentElement.lang = context.locale;
  setText("context", `${context.locale} / ${context.theme}`);
};

window.KKTerm.on("contextChanged", renderContext);
renderContext(await window.KKTerm.getContext());

const capabilities = await window.KKTerm.capabilities();
setText(
  "capabilities",
  `directories=${capabilities.features.directoryTokens}; chunks=${capabilities.limits.fileChunkBytes}`,
);

const worker = new Worker("./worker.js", { name: "kkmod-v2-fixture" });
worker.addEventListener("message", (event) => {
  setText("worker", event.data === "pong" ? "packaged worker OK" : "unexpected reply");
  worker.terminate();
});
worker.addEventListener("error", () => setText("worker", "worker failed"));
worker.postMessage("ping");

const launches = Number((await window.KKTerm.storage.get("launches")) ?? 0) + 1;
await window.KKTerm.storage.set("launches", launches);
setText("launches", String(launches));

document.getElementById("external").addEventListener("click", () => {
  void window.KKTerm.openExternal("https://kkterm.ryantsai.com");
});

await window.KKTerm.ready();
