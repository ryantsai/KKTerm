const PROMPT_WINDOW_MS = 30_000;
const PASSWORD_PROMPT = /(?:^|[\r\n])\s*(?:\[sudo\]\s*)?password(?:\s+for\s+[^:\r\n]+)?:\s*$/iu;

function visibleTerminalText(data: string) {
  let result = "";
  for (let index = 0; index < data.length; index += 1) {
    if (data.charCodeAt(index) !== 27) {
      result += data[index];
      continue;
    }
    const kind = data[index + 1];
    if (kind === "[") {
      index += 2;
      while (index < data.length && !(data.charCodeAt(index) >= 64 && data.charCodeAt(index) <= 126)) index += 1;
    } else if (kind === "]") {
      index += 2;
      while (index < data.length && data.charCodeAt(index) !== 7
        && !(data.charCodeAt(index) === 27 && data[index + 1] === "\\")) index += 1;
      if (data.charCodeAt(index) === 27) index += 1;
    }
  }
  return result;
}

/** Watches only output following a command the user sent to this Session. */
export class SavedPasswordPromptDetector {
  private inputLine = "";
  private outputTail = "";
  private pendingUntil = 0;
  private offered = false;

  observeInput(data: string, now = Date.now()) {
    for (const character of visibleTerminalText(data)) {
      if (character === "\r" || character === "\n") {
        if (/^\s*(?:sudo|su)(?:\s|$)/u.test(this.inputLine)) {
          this.pendingUntil = now + PROMPT_WINDOW_MS;
          this.outputTail = "";
          this.offered = false;
        }
        this.inputLine = "";
      } else if (character === "\x7f" || character === "\b") {
        this.inputLine = this.inputLine.slice(0, -1);
      } else if (character >= " " && character !== "\x7f") {
        this.inputLine = (this.inputLine + character).slice(-512);
      }
    }
  }

  observeOutput(data: string, now = Date.now()) {
    if (!this.pendingUntil || now > this.pendingUntil || this.offered) return false;
    this.outputTail = (this.outputTail + data).slice(-512);
    if (!PASSWORD_PROMPT.test(visibleTerminalText(this.outputTail))) return false;
    this.offered = true;
    return true;
  }

  reset() {
    this.inputLine = "";
    this.outputTail = "";
    this.pendingUntil = 0;
    this.offered = false;
  }
}
