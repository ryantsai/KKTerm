const MERMAID_DECLARATION = /^(?:(?:graph|flowchart)\s+(?:TB|TD|BT|RL|LR)\b|(?:sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|C4(?:Context|Container|Component|Dynamic|Deployment)|mindmap|timeline|zenuml|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture-beta|radar-beta|treemap-beta)\b)/i;

export function isStandaloneMermaidDocument(text: string): boolean {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let index = lines.findIndex((line) => line.trim().length > 0);
  if (index < 0) return false;

  if (lines[index].trim() === "---") {
    index += 1;
    while (index < lines.length && lines[index].trim() !== "---") index += 1;
    if (index >= lines.length) return false;
    index += 1;
  }

  while (index < lines.length) {
    const line = lines[index].trim();
    if (line.length === 0 || line.startsWith("%%")) {
      index += 1;
      continue;
    }
    return MERMAID_DECLARATION.test(line);
  }

  return false;
}
