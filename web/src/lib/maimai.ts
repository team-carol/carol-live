import scrapeSource from "./maimaiScrape.js?raw";
import type { PlayImport } from "../api";

/**
 * Bookmarklet that runs lib/maimaiScrape.js on maimai DX NET's record page and opens
 * <origin>/import with the plays in the URL fragment (never sent to a server log).
 */
export function bookmarklet(origin: string): string {
  const code = `(function(){${scrapeSource}
var p=scrapeMaimaiRecord(document);
if(!p.length){alert("maimai DX NET의 플레이 기록(Record) 페이지에서 눌러줘");return}
var u=${JSON.stringify(`${origin}/import`)}+"#"+encodeURIComponent(JSON.stringify({v:1,plays:p}));
if(!window.open(u))location.href=u})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

/** reads what the bookmarklet put in the fragment */
export function readImportFragment(hash: string): PlayImport[] | null {
  if (!hash || hash.length < 2) return null;
  try {
    const data = JSON.parse(decodeURIComponent(hash.replace(/^#/, ""))) as { plays?: PlayImport[] };
    return Array.isArray(data.plays) ? data.plays : null;
  } catch {
    return null;
  }
}

export * from "./maimaiLabels";
