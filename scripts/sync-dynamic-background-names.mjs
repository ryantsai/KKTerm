// The picker owns the IDs/order/moods in this lightweight shared catalog. This
// script refreshes only translated name aliases after a localization change.
import {readFile,writeFile,readdir} from "node:fs/promises";
const catalogUrl = new URL("../src/shared/dynamicBackgroundCatalog.json",import.meta.url);
const localeRoot = new URL("../src/i18n/locales/",import.meta.url);
const catalog = JSON.parse(await readFile(catalogUrl,"utf8"));
const names = {};
for (const file of (await readdir(localeRoot)).filter((name)=>name.endsWith(".json")).sort()) {
  names[file.slice(0,-5)] = JSON.parse(await readFile(new URL(file,localeRoot),"utf8")).dashboard.dynamicBackgrounds;
}
for (const entry of catalog) {
  const key = entry.labelKey.split(".").at(-1);
  entry.names = Object.fromEntries(Object.entries(names).map(([locale,labels])=> {
    if(typeof labels[key] !== "string") throw new Error(`Missing ${locale} label: ${entry.labelKey}`);
    return [locale,labels[key]];
  }));
}
await writeFile(catalogUrl,JSON.stringify(catalog,null,2)+"\n");
