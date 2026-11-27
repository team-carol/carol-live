package com.teamcarol.live

import org.json.JSONArray
import org.json.JSONObject

/** One recorded mp4 from a session. */
data class RecordedFile(
  val path: String,
  val name: String,
  val startedAt: Long,
  val durationMs: Long,
  /** button clicks per second over the recording ([GameActivity]); not kept in the summary JSON */
  val activity: ByteArray? = null,
)

/**
 * What happened during one session (stream and/or recording, from start until both stop).
 * Shown on the summary screen and sent with each upload; the web reads the same keys (web/src/api.ts LiveSummary).
 */
data class LiveSummary(
  val startedAt: Long,
  val endedAt: Long,
  val streamed: Boolean,
  val resolution: String,
  val fps: Int,
  val targetVideoKbps: Int,
  val avgSentKbps: Int?,
  val minSentKbps: Int?,
  val avgFps: Double?,
  val minFps: Int?,
  val reconnects: Int,
  val maxTempC: Double?,
  val batteryStart: Int?,
  val batteryEnd: Int?,
  val mic: String,
  val endReason: String?,
  val files: List<RecordedFile>,
) {
  val durationMs: Long get() = endedAt - startedAt

  /** the part the web cares about (files are uploaded separately) */
  fun toWebJson(): JSONObject = JSONObject().apply {
    put("startedAt", startedAt)
    put("endedAt", endedAt)
    put("durationMs", durationMs)
    put("streamed", streamed)
    put("resolution", resolution)
    put("fps", fps)
    put("targetVideoKbps", targetVideoKbps)
    avgSentKbps?.let { put("avgSentKbps", it) }
    minSentKbps?.let { put("minSentKbps", it) }
    avgFps?.let { put("avgFps", it) }
    minFps?.let { put("minFps", it) }
    put("reconnects", reconnects)
    maxTempC?.let { put("maxTempC", it) }
    batteryStart?.let { put("batteryStart", it) }
    batteryEnd?.let { put("batteryEnd", it) }
    put("mic", mic)
  }

  fun toJson(): String = toWebJson().apply {
    endReason?.let { put("endReason", it) }
    put("files", JSONArray(files.map {
      JSONObject().put("path", it.path).put("name", it.name).put("startedAt", it.startedAt).put("durationMs", it.durationMs)
    }))
  }.toString()

  companion object {
    fun fromJson(text: String): LiveSummary {
      val o = JSONObject(text)
      fun optInt(k: String) = if (o.has(k)) o.getInt(k) else null
      fun optDouble(k: String) = if (o.has(k)) o.getDouble(k) else null
      val files = o.optJSONArray("files")
      return LiveSummary(
        startedAt = o.getLong("startedAt"),
        endedAt = o.getLong("endedAt"),
        streamed = o.optBoolean("streamed", true),
        resolution = o.optString("resolution"),
        fps = o.optInt("fps"),
        targetVideoKbps = o.optInt("targetVideoKbps"),
        avgSentKbps = optInt("avgSentKbps"),
        minSentKbps = optInt("minSentKbps"),
        avgFps = optDouble("avgFps"),
        minFps = optInt("minFps"),
        reconnects = o.optInt("reconnects"),
        maxTempC = optDouble("maxTempC"),
        batteryStart = optInt("batteryStart"),
        batteryEnd = optInt("batteryEnd"),
        mic = o.optString("mic"),
        endReason = if (o.has("endReason")) o.getString("endReason") else null,
        files = (0 until (files?.length() ?: 0)).map { i ->
          val f = files!!.getJSONObject(i)
          RecordedFile(f.getString("path"), f.getString("name"), f.getLong("startedAt"), f.getLong("durationMs"))
        },
      )
    }
  }
}

/** running min/avg/max while a session is live */
class SummaryBuilder(
  private val settings: StreamSettings,
  private val resolution: Resolution,
  batteryStart: Int,
) {
  val startedAt = System.currentTimeMillis()
  private val batteryAtStart = batteryStart.takeIf { it >= 0 }
  var streamed = false
  var reconnects = 0
  var mic = "-"
  val files = mutableListOf<RecordedFile>()

  private var sentSum = 0L
  private var sentCount = 0
  private var sentMin = Int.MAX_VALUE
  private var fpsSum = 0L
  private var fpsCount = 0
  private var fpsMin = Int.MAX_VALUE
  private var tempMax = Double.NaN

  fun sampleSent(kbps: Int) {
    sentSum += kbps
    sentCount++
    sentMin = minOf(sentMin, kbps)
  }

  fun sampleFps(fps: Int) {
    fpsSum += fps
    fpsCount++
    fpsMin = minOf(fpsMin, fps)
  }

  fun sampleTemp(c: Float) {
    tempMax = if (tempMax.isNaN()) c.toDouble() else maxOf(tempMax, c.toDouble())
  }

  fun build(batteryEnd: Int, endReason: String?): LiveSummary = LiveSummary(
    startedAt = startedAt,
    endedAt = System.currentTimeMillis(),
    streamed = streamed,
    resolution = resolution.label,
    fps = settings.fps,
    targetVideoKbps = settings.videoBitrateKbps,
    avgSentKbps = if (sentCount > 0) (sentSum / sentCount).toInt() else null,
    minSentKbps = if (sentCount > 0) sentMin else null,
    avgFps = if (fpsCount > 0) fpsSum.toDouble() / fpsCount else null,
    minFps = if (fpsCount > 0) fpsMin else null,
    reconnects = reconnects,
    maxTempC = tempMax.takeUnless { it.isNaN() },
    batteryStart = batteryAtStart,
    batteryEnd = batteryEnd.takeIf { it >= 0 },
    mic = mic,
    endReason = endReason,
    files = files.toList(),
  )
}
