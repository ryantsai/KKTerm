/* eslint-disable jsdoc/require-jsdoc, no-console */
/* KKTerm CyberChef adapter: CyberChef v11.3.0 modified for KKMod host API v2. */

const READY_FALLBACK_MS = 12_000;
let currentContext = {theme: "light", locale: "en"};
let readySent = false;
let readyTimer = 0;

function host() {
    const value = window.KKTerm;
    if (!value || value.apiVersion !== 2) {
        throw new Error("KKTerm host API v2 is unavailable.");
    }
    return value;
}

function cyberChefTheme(theme) {
    return String(theme).toLowerCase() === "dark" ? "dark" : "classic";
}

function applyContext(context) {
    currentContext = {...currentContext, ...context};
    const theme = cyberChefTheme(currentContext.theme);
    document.documentElement.className = theme;
    document.documentElement.lang = "en";
    document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";

    if (window.app?.manager?.options) {
        window.app.options.theme = theme;
        window.app.manager.options.changeTheme(theme);
    }
}

function renderStartupError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const loader = document.getElementById("preloader");
    const status = document.getElementById("preloader-msg");
    const errorBox = document.getElementById("preloader-error");
    loader?.remove();
    status?.remove();
    if (errorBox) {
        errorBox.textContent = `CyberChef could not start in KKTerm: ${message}`;
    }
}

async function signalReady() {
    if (readySent) return;
    readySent = true;
    window.clearTimeout(readyTimer);
    try {
        await host().ready();
    } catch (error) {
        console.error("Failed to signal CyberChef readiness", error);
    }
}

function noticeText(value) {
    const container = document.createElement("div");
    container.innerHTML = String(value);
    return (container.textContent || "CyberChef notification")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
}

function noticeTone(message) {
    if (/error|failed|invalid|sorry|could not|exceeded/i.test(message)) return "error";
    if (/warning|disabled|cancel/i.test(message)) return "warning";
    if (/success|saved|copied|complete/i.test(message)) return "success";
    return "info";
}

function showHostNotice(value) {
    let kkterm;
    try {
        kkterm = host();
    } catch {
        return false;
    }
    const message = noticeText(value);
    void kkterm.ui.notice(message, {tone: noticeTone(message)}).catch(error => {
        console.error("Failed to show CyberChef host notice", error);
    });
    return true;
}

function chartBounds(canvas, heightRatio, maximumHeight) {
    const parent = canvas.closest(".cm-scroller");
    const rect = parent?.getBoundingClientRect() || canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * 0.95));
    const height = Math.max(1, Math.floor(rect.height * heightRatio));
    canvas.height = maximumHeight ? Math.min(maximumHeight, height) : height;
}

function enhanceChart(canvas) {
    if (canvas.dataset.kktermRendered === "true" || !window.CanvasComponents) return;
    canvas.dataset.kktermRendered = "true";

    switch (canvas.dataset.kktermChart) {
        case "entropy": {
            const entropy = Number(canvas.dataset.value);
            chartBounds(canvas, 0.25, 150);
            window.CanvasComponents.drawScaleBar(canvas, entropy, 8, [
                {label: "English text", min: 3.5, max: 5},
                {label: "Encrypted/compressed", min: 7.5, max: 8}
            ]);
            break;
        }
        case "frequency": {
            const scores = JSON.parse(canvas.dataset.values || "[]");
            chartBounds(canvas, 0.9);
            window.CanvasComponents.drawBarChart(canvas, scores, "Byte", "Frequency %", 16, 6);
            break;
        }
        case "coincidence": {
            const coincidence = Math.min(Number(canvas.dataset.value), 0.25);
            chartBounds(canvas, 0.25);
            window.CanvasComponents.drawScaleBar(canvas, coincidence, 0.25, [
                {label: "English text", min: 0.05, max: 0.08},
                {label: "> 0.25", min: 0.24, max: 0.25}
            ]);
            break;
        }
    }
}

function enhanceColourPicker(root) {
    const picker = root.querySelector("[data-kkterm-colorpicker]");
    if (!picker || picker.dataset.kktermRendered === "true") return;
    picker.dataset.kktermRendered = "true";
    $(picker).colorpicker({
        format: "rgba",
        color: picker.dataset.color,
        container: true,
        inline: true,
        useAlpha: true
    }).on("colorpickerChange", event => {
        const color = event.color.string("rgba");
        window.app.manager.input.setInput(color);
        window.app.manager.input.inputChange(new Event("keyup"));
    });
}

function enhanceOutput(root) {
    for (const canvas of root.querySelectorAll("canvas[data-kkterm-chart]")) {
        try {
            enhanceChart(canvas);
        } catch (error) {
            console.error("Failed to render a CyberChef chart", error);
        }
    }
    try {
        enhanceColourPicker(root);
        $(root).find("[data-toggle=\"tooltip\"]").tooltip();
    } catch (error) {
        console.error("Failed to enhance CyberChef output", error);
    }
}

Object.defineProperty(window, "KKTermCyberChef", {
    configurable: false,
    value: Object.freeze({enhanceOutput, notice: showHostNotice})
});

export async function initializeKKTermRuntime() {
    let kkterm;
    try {
        kkterm = host();
        document.addEventListener("apploaded", () => void signalReady(), {once: true});
        window.addEventListener("error", () => void signalReady(), {once: true});
        readyTimer = window.setTimeout(() => {
            renderStartupError(new Error("startup exceeded the 12-second module limit"));
            void signalReady();
        }, READY_FALLBACK_MS);

        applyContext(await kkterm.getContext());
        kkterm.on("contextChanged", detail => applyContext(detail));
        kkterm.on("visibilityChanged", detail => {
            if (detail?.visible) {
                window.requestAnimationFrame(() => window.app?.adjustComponentSizes());
            }
        });
        kkterm.on("focusChanged", detail => {
            if (detail?.focused) {
                window.requestAnimationFrame(() => window.app?.adjustComponentSizes());
            }
        });
        kkterm.on("suspending", () => undefined);
        kkterm.on("closing", () => undefined);
    } catch (error) {
        renderStartupError(error);
        await signalReady();
        throw error;
    }

    return {
        theme: cyberChefTheme(currentContext.theme),
        locale: "en"
    };
}
