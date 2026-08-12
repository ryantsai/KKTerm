import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Code2, Columns2, Eye } from "../../../../../lib/reicon";
import { ChromePortals } from "../chrome/FileViewerChromeContext";
import { FootSeg, Segmented } from "../chrome/controls";
import { isStandaloneMermaidDocument } from "../markdownMermaid";

type MarkdownView = "preview" | "split" | "source";

let mermaidImport: Promise<typeof import("mermaid").default> | null = null;
let mermaidDiagramId = 0;

function loadMermaid() {
  if (!mermaidImport) {
    mermaidImport = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
      return mermaid;
    });
  }
  return mermaidImport;
}

function MarkdownPreview({ html, text }: { html: string; text: string }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const diagrams = root ? Array.from(root.querySelectorAll<HTMLElement>("pre > code.language-mermaid")) : [];
    const standaloneSource = diagrams.length === 0 && isStandaloneMermaidDocument(text) ? text.trim() : null;
    if (!root || (diagrams.length === 0 && !standaloneSource)) return;

    let cancelled = false;
    void loadMermaid().then(async (mermaid) => {
      for (const [index, code] of diagrams.entries()) {
        if (cancelled || !root.isConnected || !code.isConnected) return;
        try {
          const { svg, bindFunctions } = await mermaid.render(
            `fv-mermaid-${++mermaidDiagramId}-${index}`,
            code.textContent ?? "",
          );
          if (cancelled || !code.isConnected) return;
          const container = document.createElement("div");
          container.className = "fv-mermaid";
          container.innerHTML = svg;
          code.parentElement?.replaceWith(container);
          bindFunctions?.(container);
        } catch {
          // Keep the original fenced source visible when a diagram is invalid.
        }
      }

      if (!standaloneSource || cancelled || !root.isConnected) return;
      try {
        const { svg, bindFunctions } = await mermaid.render(
          `fv-mermaid-${++mermaidDiagramId}-standalone`,
          standaloneSource,
        );
        if (cancelled || !root.isConnected) return;
        const container = document.createElement("div");
        container.className = "fv-mermaid";
        container.innerHTML = svg;
        root.replaceChildren(container);
        bindFunctions?.(container);
      } catch {
        // Keep the original Markdown output when standalone Mermaid is invalid.
      }
    });

    return () => {
      cancelled = true;
    };
  }, [html, text]);

  return <div ref={rootRef} className="fv-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Renders Markdown to sanitized HTML (the same marked + DOMPurify pairing used by
 * the assistant and manual renderers; raw HTML is sanitized before the DOM). A
 * Preview / Split / Source segmented control in the shell toolbar switches
 * between the rendered view and the raw source.
 */
export function MarkdownViewer({ text }: { text: string }) {
  const { t } = useTranslation();
  const [view, setView] = useState<MarkdownView>("preview");

  const html = useMemo(() => {
    const parsed = marked.parse(text, { async: false }) as string;
    return DOMPurify.sanitize(parsed);
  }, [text]);
  const wordCount = useMemo(() => text.trim().match(/\S+/g)?.length ?? 0, [text]);

  const source = <div className="fv-md-source">{text}</div>;

  return (
    <>
      <ChromePortals
        center={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "preview", label: t("workspace.fileViewer.view.preview"), icon: Eye },
              { value: "split", label: t("workspace.fileViewer.view.split"), icon: Columns2 },
              { value: "source", label: t("workspace.fileViewer.view.source"), icon: Code2 },
            ]}
          />
        }
        footer={<FootSeg>{t("workspace.fileViewer.wordCount", { count: wordCount })}</FootSeg>}
      />
      {view === "preview" ? (
        <div className="fv-scroll">
          <MarkdownPreview html={html} text={text} />
        </div>
      ) : null}
      {view === "source" ? <div className="fv-scroll">{source}</div> : null}
      {view === "split" ? (
        <div className="fv-split">
          <div className="fv-scroll">{source}</div>
          <div className="fv-scroll">
            <MarkdownPreview html={html} text={text} />
          </div>
        </div>
      ) : null}
    </>
  );
}
