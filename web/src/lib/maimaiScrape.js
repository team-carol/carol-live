// Runs ON maimai DX NET's record page (as a bookmarklet), so it must be plain, self-contained JS.
// Reads the recent plays (up to 50) and returns what /api/plays takes.
// Markup checked on maimaidx-eng.com/maimai-mobile/record/ (2026-11).
function scrapeMaimaiRecord(doc) {
  const name = (src, re) => ((src || "").match(re) || [])[1] || null;
  const out = [];
  for (const top of doc.querySelectorAll(".playlog_top_container")) {
    const e = top.parentElement;
    const spans = top.querySelectorAll(".sub_title span");
    const date = (spans[spans.length - 1] || {}).textContent || "";
    const m = date.match(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})/);
    if (!m) continue;
    // maimai DX NET shows Japan time
    const playedAt = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`);
    const titleEl = e.querySelector(".basic_block.break");
    let title = "";
    let level = null;
    if (titleEl) {
      const c = titleEl.cloneNode(true);
      const lv = c.querySelector(".playlog_level_icon");
      level = lv ? lv.textContent.trim() : null;
      c.querySelectorAll("div").forEach((d) => d.remove());
      title = c.textContent.trim();
    }
    const ach = e.querySelector(".playlog_achievement_txt");
    const idx = (e.querySelector("input[name=idx]") || {}).value || "";
    const sec = Number(idx.split(",")[1]);
    const imgs = [...e.querySelectorAll("img")].map((i) => i.getAttribute("src") || "");
    // FC/AP then sync marks: playlog/{fc,fcplus,ap,applus}.png, playlog/{sync,fs,fsplus,fsd,fsdplus}.png,
    // "*_dummy.png" when there is none
    const markImgs = [...e.querySelectorAll(".playlog_result_innerblock img.h_35")];
    const mark = (i) => {
      const n = name(markImgs[i] && markImgs[i].getAttribute("src"), /playlog\/(\w+)\.png/);
      return n && !/_dummy$/.test(n) ? n : null;
    };
    out.push({
      playedAt,
      track: Number(((spans[0] || {}).textContent || "").replace(/\D/g, "")) || 0,
      title,
      difficulty: name((top.querySelector(".playlog_diff") || {}).getAttribute?.("src"), /diff_(\w+)\.png/),
      achievement: ach ? parseFloat(ach.textContent.replace(/[^\d.]/g, "")) : null,
      details: {
        level,
        kind: imgs.some((s) => /music_dx\.png/.test(s)) ? "dx" : imgs.some((s) => /music_standard\.png/.test(s)) ? "std" : undefined,
        rank: name((e.querySelector(".playlog_scorerank") || {}).getAttribute?.("src"), /playlog\/(\w+)\.png/),
        dxScore: ((e.querySelector(".playlog_score_block .white") || {}).textContent || "").trim() || undefined,
        fc: mark(0),
        sync: mark(1),
        jacket: (e.querySelector(".music_img") || {}).getAttribute?.("src") || undefined,
        idx: idx || undefined,
        // exact second of the play; only trusted when it agrees with the shown minute
        playedAtSec: Number.isFinite(sec) && Math.abs(sec * 1000 - playedAt) < 120000 ? sec : undefined,
      },
    });
  }
  return out;
}
