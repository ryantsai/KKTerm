export function normalizeHtmlReferences(html, packageRootPrefix) {
  return html
    .replace(/(href|src)=(['"])\.\.\/\.\.\//g, `$1=$2${packageRootPrefix}`)
    .replace(/(href|src)=(['"])\/(?!\/)/g, `$1=$2${packageRootPrefix}`);
}

export function normalizeRootHtmlReferences(html) {
  return normalizeHtmlReferences(html, './');
}
