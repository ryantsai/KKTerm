self.addEventListener("message", (event) => {
  if (event.data === "ping") self.postMessage("pong");
});
