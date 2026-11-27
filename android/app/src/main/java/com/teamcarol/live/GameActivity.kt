package com.teamcarol.live

import android.os.SystemClock
import android.util.Base64
import com.pedro.encoder.input.audio.CustomAudioEffect
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min

/**
 * Counts arcade button clicks per second in the raw mic signal, so the web can split a long
 * recording into songs (maimai play = minutes of steady clicking, song select / result = quiet).
 * The splitting itself lives in web/src/lib/songs.ts so it can improve without an app release.
 *
 * Click test (same numbers as the analysis that tuned [ClickLimiter]): a 10 ms block whose peak is
 * at least [CLICK_DB] over the median loudness of the last second. On the 58 min test stream game
 * sound sat ~8 dB over that median and clicks ~24 dB over it.
 *
 * Seconds are indexed by elapsedRealtime, not by sample count, so muting (RootEncoder skips the
 * effect while muted) leaves zeros instead of shifting the timeline.
 * The mic thread writes; [slice] is called from the main thread.
 */
class GameActivity(sampleRate: Int, private val channels: Int) {

  private val blockFrames = max(1, sampleRate * BLOCK_MS / 1000)
  private val history = FloatArray(HISTORY_BLOCKS) { -120f }
  private val sorted = FloatArray(HISTORY_BLOCKS)
  private var historyPos = 0
  private var blockSum = 0.0
  private var blockPeak = 0f
  private var blockCount = 0

  private val lock = Any()
  private var origin = -1L
  private var counts = ByteArray(4096)
  private var size = 0

  /** mic thread: one PCM buffer (16-bit interleaved) */
  fun feed(pcm: ByteArray) {
    val now = SystemClock.elapsedRealtime()
    if (origin < 0) origin = now
    val second = ((now - origin) / 1000).toInt()
    var clicks = 0
    val frames = pcm.size / (2 * channels)
    for (f in 0 until frames) {
      val base = f * channels * 2
      for (c in 0 until channels) {
        val i = base + c * 2
        val s = ((pcm[i + 1].toInt() shl 8) or (pcm[i].toInt() and 0xff)).toShort() / 32768f
        blockSum += (s * s).toDouble()
        blockPeak = max(blockPeak, abs(s))
      }
      if (++blockCount == blockFrames && endBlock()) clicks++
    }
    if (clicks > 0) add(second, clicks)
  }

  /** @return true when the finished block was a click */
  private fun endBlock(): Boolean {
    val rms = kotlin.math.sqrt(blockSum / (blockCount * channels))
    val rmsDb = if (rms > 1e-6) (20.0 * log10(rms)).toFloat() else -120f
    val peakDb = if (blockPeak > 1e-6f) 20f * log10(blockPeak) else -120f
    sorted.let { history.copyInto(it); it.sort() }
    val reference = max(sorted[HISTORY_BLOCKS / 2], FLOOR_DB)
    history[historyPos] = rmsDb
    historyPos = if (historyPos + 1 == HISTORY_BLOCKS) 0 else historyPos + 1
    blockSum = 0.0
    blockPeak = 0f
    blockCount = 0
    return peakDb - reference >= CLICK_DB
  }

  private fun add(second: Int, clicks: Int) = synchronized(lock) {
    if (second >= counts.size) counts = counts.copyOf(max(second + 1, counts.size * 2))
    counts[second] = min(255, (counts[second].toInt() and 0xff) + clicks).toByte()
    size = max(size, second + 1)
  }

  /** clicks per second between two elapsedRealtime instants (a recording's span) */
  fun slice(fromElapsed: Long, toElapsed: Long): ByteArray = synchronized(lock) {
    val seconds = max(0, ((toElapsed - fromElapsed + 999) / 1000).toInt())
    val out = ByteArray(seconds)
    if (origin < 0) return out
    // second i of the recording covers [from + i s, from + (i+1) s)
    val offsetMs = fromElapsed - origin
    for (i in 0 until seconds) {
      val src = Math.floorDiv(offsetMs + i * 1000L + 500, 1000L).toInt()
      if (src in 0 until size) out[i] = counts[src]
    }
    out
  }

  companion object {
    const val CLICK_DB = 18f
    private const val FLOOR_DB = -50f
    private const val BLOCK_MS = 10
    private const val HISTORY_BLOCKS = 100

    /** what goes to the server with the upload (web/src/api.ts RecordingAnalysis) */
    fun toAnalysisJson(perSecond: ByteArray): JSONObject = JSONObject()
      .put("v", 1)
      .put("clickDb", CLICK_DB.toDouble())
      .put("clicksPerSecond", Base64.encodeToString(perSecond, Base64.NO_WRAP))
  }
}

/** mic buffers go through the click counter (raw signal) and then the optional limiter */
class MicEffects(private val activity: GameActivity, private val limiter: CustomAudioEffect?) : CustomAudioEffect() {
  override fun process(pcmBuffer: ByteArray): ByteArray {
    activity.feed(pcmBuffer)
    return limiter?.process(pcmBuffer) ?: pcmBuffer
  }
}
