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

// The player's profile block, as shown on /maimai-mobile/playerData/ (the bookmarklet fetches that page from
// the record page). Used for the profile card of the legacy shorts layout. Returns null when it is not there.
function scrapeMaimaiProfile(doc) {
  const box = doc.querySelector(".see_through_block .basic_block") || doc.querySelector(".basic_block");
  const name = box && ((box.querySelector(".name_block") || {}).textContent || "").trim();
  if (!name) return null;
  const imgs = [...box.querySelectorAll("img")].map((i) => i.getAttribute("src") || "");
  const src = (re) => {
    for (const s of imgs) {
      const m = s.match(re);
      if (m) return m[1];
    }
    return null;
  };
  const num = (text) => {
    const n = Number(String(text || "").replace(/[^\d]/g, ""));
    return String(text || "").match(/\d/) && Number.isFinite(n) ? n : undefined;
  };
  // "play count of current version : 519 / total play count : 2,795" in the site's language, right under the block
  const counts = (((box.parentElement || doc).querySelector(".t_r.f_12") || {}).textContent || "").match(/\d[\d,]*/g) || [];
  const course = src(/course\/course_rank_(\d+)/);
  const cls = src(/class\/class_rank_s_(\d+)/);
  // the image files themselves (their names end in a random-looking suffix), drawn on the profile card
  const courseImg = src(/course\/(course_rank_[0-9A-Za-z]+)\.png/);
  const classImg = src(/class\/(class_rank_s_[0-9A-Za-z]+)\.png/);
  return {
    name,
    rating: num((box.querySelector(".rating_block") || {}).textContent),
    ratingBase: src(/rating_base_([a-z_]+)\.png/) || undefined,
    icon: imgs.find((s) => /img\/Icon\//.test(s)) || undefined,
    course: course === null ? undefined : Number(course),
    cls: cls === null ? undefined : Number(cls),
    courseImg: courseImg || undefined,
    classImg: classImg || undefined,
    playCountCurrent: counts.length > 1 ? num(counts[0]) : undefined,
    playCount: counts.length ? num(counts[counts.length - 1]) : undefined,
  };
}
