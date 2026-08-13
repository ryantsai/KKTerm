function applyContext(context) {
  document.documentElement.dataset.theme = context.theme;
  document.documentElement.lang = context.locale;
  document.querySelector("#context").textContent =
    `Theme: ${context.theme} · Locale: ${context.locale}`;
}

window.KKTerm.on("contextChanged", applyContext);
applyContext(await window.KKTerm.getContext());

await window.KKTerm.ready();
