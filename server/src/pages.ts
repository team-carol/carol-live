// Small server-rendered pages shown in the phone's browser during device pairing.
// Carol rule for server HTML: inline carolCss and use crl-* classes.
import { carolCss } from "@team-carol/design-system/css";
import { fontUrls } from "@team-carol/design-system";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function shell(title: string, body: string, extraHead = ""): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · carol live</title>
<link rel="stylesheet" href="${fontUrls.pretendard}">
<style>${carolCss}
  body { min-height: 100vh; display: grid; place-items: center; padding: 20px; }
  .wrap { width: 100%; max-width: 420px; }
  .actions { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
  .actions .crl-btn { width: 100%; }
</style>
${extraHead}
</head>
<body><main class="wrap">${body}</main></body>
</html>`;
}

/** Chrome blocks silent redirects to app schemes, so show a button as well as trying automatically */
export function pairedPage(deviceName: string, appUrl: string): string {
  return shell(
    "기기 연결됨",
    `<div class="crl-card">
      <span class="crl-tag crl-tag--success">연결됨</span>
      <h1 class="crl-card__title" style="margin-top:12px">${esc(deviceName)}</h1>
      <p class="crl-card__body">이 폰에서 녹화한 영상은 이 이름의 폴더로 올라갑니다. 아래 버튼을 눌러 앱으로 돌아가면 끝입니다.</p>
      <div class="actions">
        <a class="crl-btn crl-btn--primary crl-btn--lg" href="${esc(appUrl)}">앱으로 돌아가기</a>
      </div>
    </div>`,
    `<script>setTimeout(function(){location.href=${JSON.stringify(appUrl)}},300)</script>`,
  );
}

export function errorPage(message: string): string {
  return shell(
    "문제가 생겼습니다",
    `<div class="crl-card">
      <span class="crl-tag crl-tag--danger">오류</span>
      <p class="crl-card__body">${esc(message)}</p>
      <div class="actions"><a class="crl-btn crl-btn--secondary" href="/">처음으로</a></div>
    </div>`,
  );
}
