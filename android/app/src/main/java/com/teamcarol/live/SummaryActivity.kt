package com.teamcarol.live

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Shown after a session ends: how the broadcast went + where the recordings are going. */
class SummaryActivity : AppCompatActivity() {

  companion object {
    private const val EXTRA = "summary"

    fun open(context: Context, summary: LiveSummary) {
      context.startActivity(Intent(context, SummaryActivity::class.java).putExtra(EXTRA, summary.toJson()))
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_summary)
    val s = LiveSummary.fromJson(intent.getStringExtra(EXTRA) ?: run { finish(); return })

    val tag = findViewById<TextView>(R.id.sum_tag)
    if (s.endReason != null && s.endReason != "알림에서 종료") {
      tag.text = s.endReason
      tag.setBackgroundResource(R.drawable.crl_tag_warning)
      tag.setTextColor(color(R.color.crl_warning))
    } else {
      tag.text = if (s.streamed) "방송 끝" else "녹화 끝"
      tag.setBackgroundResource(R.drawable.crl_tag_accent)
      tag.setTextColor(color(R.color.crl_accent_ink))
    }
    findViewById<TextView>(R.id.sum_title).text = clock(s.durationMs)
    val fmt = SimpleDateFormat("M월 d일 (E) HH:mm", Locale.KOREAN)
    findViewById<TextView>(R.id.sum_sub).text =
      "${fmt.format(Date(s.startedAt))} 시작 · ${s.resolution}${s.fps} · ${s.mic}"

    val stats = buildList {
      if (s.streamed) {
        add("평균 송출" to (s.avgSentKbps?.let { mbps(it) } ?: "-"))
        add("최저 송출" to (s.minSentKbps?.let { mbps(it) } ?: "-"))
        add("평균 FPS" to (s.avgFps?.let { String.format(Locale.US, "%.1f", it) } ?: "-"))
        add("최저 FPS" to (s.minFps?.toString() ?: "-"))
        add("재연결" to "${s.reconnects}회")
      }
      add("최고 온도" to (s.maxTempC?.let { String.format(Locale.US, "%.0f°C", it) } ?: "-"))
      add("배터리" to if (s.batteryStart != null && s.batteryEnd != null) "${s.batteryStart}→${s.batteryEnd}%" else "-")
    }
    fillStats(findViewById(R.id.sum_stats), stats)

    findViewById<TextView>(R.id.sum_files).text =
      if (s.files.isEmpty()) "녹화 안 함" else s.files.joinToString("\n") { f ->
        val size = File(f.path).length()
        "${f.name} · ${clock(f.durationMs)} · ${String.format(Locale.US, "%.1fGB", size / 1024.0 / 1024 / 1024)}"
      }

    val upload = findViewById<TextView>(R.id.sum_upload)
    val uploadNow = findViewById<Button>(R.id.sum_upload_now)
    val paired = UploadConfig.paired(this)
    when {
      s.files.isEmpty() -> upload.visibility = View.GONE
      paired == null -> {
        upload.text = "설정 → 업로드에서 기기를 연결하면 웹에서 보고 자를 수 있음. 녹화는 폰의 Movies/CarolLive에 있음"
        uploadNow.text = "설정 열기"
        uploadNow.visibility = View.VISIBLE
        uploadNow.setOnClickListener { startActivity(Intent(this, SettingsActivity::class.java)) }
      }
      UploadConfig.autoUpload(this) -> {
        val net = if (UploadConfig.allowMobileData(this)) "인터넷" else "와이파이"
        upload.text = "${net}에 연결되면 '${paired.deviceName}' 폴더로 자동 업로드됨. 진행 상황은 알림에 뜸"
      }
      else -> {
        upload.text = "자동 업로드가 꺼져 있음"
        uploadNow.text = "지금 업로드"
        uploadNow.visibility = View.VISIBLE
        uploadNow.setOnClickListener {
          Uploads.schedule(this)
          upload.text = "업로드 예약됨. 진행 상황은 알림에 뜸"
          uploadNow.visibility = View.GONE
        }
      }
    }

    findViewById<Button>(R.id.sum_close).setOnClickListener { finish() }
  }

  /** two-column crl-stat grid */
  private fun fillStats(container: LinearLayout, stats: List<Pair<String, String>>) {
    container.removeAllViews()
    stats.chunked(2).forEachIndexed { i, row ->
      val line = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        if (i > 0) setPadding(0, resources.getDimensionPixelSize(R.dimen.crl_space_6), 0, 0)
      }
      for ((label, value) in row) {
        val cell = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        cell.addView(TextView(this, null, 0, R.style.Crl_Text_StatLabel).apply { text = label })
        cell.addView(TextView(this, null, 0, R.style.Crl_Text_StatValue).apply { text = value })
        line.addView(cell, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
      }
      if (row.size == 1) line.addView(View(this), LinearLayout.LayoutParams(0, 0, 1f))
      container.addView(line)
    }
  }

  private fun color(res: Int) = ContextCompat.getColor(this, res)

  private fun mbps(kbps: Int) = String.format(Locale.US, "%.1fM", kbps / 1000f)

  private fun clock(ms: Long): String {
    val s = ms / 1000
    return if (s >= 3600) String.format(Locale.US, "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60)
    else String.format(Locale.US, "%d:%02d", s / 60, s % 60)
  }
}
