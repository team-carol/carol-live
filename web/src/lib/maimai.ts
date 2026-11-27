import scrapeSource from "./maimaiScrape.js?raw";
import type { MaimaiProfileImport, PlayImport } from "../api";

/**
 * Bookmarklet that runs lib/maimaiScrape.js on maimai DX NET's record page and opens
 * <origin>/import with the plays in the URL fragment (never sent to a server log).
 * It also reads the player profile from the player data page (same site, the user's own session) for the
 * legacy shorts layout; when that does not answer within a few seconds the plays go alone.
 */
export function bookmarklet(origin: string): string {
  const code = `(function(){${scrapeSource}
var p=scrapeMaimaiRecord(document);
if(!p.length){alert("maimai DX NET의 플레이 기록(Record) 페이지에서 눌러줘");return}
var sent=false;
function go(f){if(sent)return;sent=true;var d={v:1,plays:p};if(f)d.profile=f;
var u=${JSON.stringify(`${origin}/import`)}+"#"+encodeURIComponent(JSON.stringify(d));
if(!window.open(u))location.href=u}
try{fetch("/maimai-mobile/playerData/",{credentials:"same-origin"})
.then(function(r){return r.ok?r.text():""})
.then(function(t){go(t?scrapeMaimaiProfile(new DOMParser().parseFromString(t,"text/html")):null)})
.catch(function(){go(null)});
setTimeout(function(){go(null)},3500)}catch(e){go(null)}})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

export interface ImportPayload {
  plays: PlayImport[];
  profile: MaimaiProfileImport | null;
}

/** reads what the bookmarklet put in the fragment */
export function readImportFragment(hash: string): ImportPayload | null {
  if (!hash || hash.length < 2) return null;
  try {
    const data = JSON.parse(decodeURIComponent(hash.replace(/^#/, ""))) as { plays?: PlayImport[]; profile?: MaimaiProfileImport };
    if (!Array.isArray(data.plays)) return null;
    return { plays: data.plays, profile: data.profile && typeof data.profile === "object" && data.profile.name ? data.profile : null };
  } catch {
    return null;
  }
}

export * from "./maimaiLabels";
