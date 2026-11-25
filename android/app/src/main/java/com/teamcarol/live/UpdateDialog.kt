package com.teamcarol.live

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.appcompat.app.AlertDialog

/** "새 버전" dialog: download the APK in the browser, then install it from the notification. */
object UpdateDialog {
  fun show(activity: Activity, release: Updates.Release) {
    val notes = release.notes.lines().filter { it.isNotBlank() }.take(8).joinToString("\n")
    val message = buildString {
      append("지금 v${Updates.currentVersion} → 새 버전 ${release.tag}\n\n")
      if (notes.isNotEmpty()) append(notes).append("\n\n")
      append("받은 APK를 열어서 설치하면 됨. 설치할 때만 '보안 위험 자동 차단'을 잠깐 꺼야 함. 설정과 연결 정보는 그대로 남음.")
    }
    AlertDialog.Builder(activity)
      .setTitle("새 버전 ${release.tag}")
      .setMessage(message)
      .setPositiveButton("APK 받기") { _, _ -> open(activity, release.apkUrl) }
      .setNeutralButton("릴리스 페이지") { _, _ -> open(activity, release.pageUrl) }
      .setNegativeButton("나중에", null)
      .show()
  }

  private fun open(activity: Activity, url: String) {
    runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
  }
}
