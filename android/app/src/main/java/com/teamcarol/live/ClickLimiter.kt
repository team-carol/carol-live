package com.teamcarol.live

import com.pedro.encoder.input.audio.CustomAudioEffect
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * Tames the arcade button clicks picked up by the lapel mic.
 *
 * Clicks share frequencies with the game music, so an EQ can't separate them. What sets them apart
 * is that they are short peaks far above the surrounding sound. This pulls down only peaks that
 * rise more than [Params.marginDb] over the *median* loudness of the last second (a median ignores
 * click trains and follows song changes), then [Params.makeupDb] lifts everything so the game sound
 * ends up louder next to the clicks.
 *
 *  - lookahead: the detector sees samples [LOOKAHEAD_MS] before they are played and holds the peak
 *    for that long, so the gain is already down when a click reaches the output
 *  - stereo-linked, soft knee, brickwall [Params.ceilingDb] so the makeup never clips
 *  - [Params.floorDb]: nothing below floor + margin is touched (room noise, talking between songs)
 *
 * Runs on RootEncoder's microphone thread for every buffer, so it allocates nothing per call.
 * tools/click-limiter.mjs is a line-by-line port used to tune [Level] presets on real recordings;
 * change both together.
 */
class ClickLimiter(sampleRate: Int, private val channels: Int, private val p: Params) : CustomAudioEffect() {

  data class Params(
    /** how far above the 1 s median a peak may go before it is pressed */
    val marginDb: Float,
    val ratio: Float,
    val makeupDb: Float,
    val kneeDb: Float = 6f,
    val floorDb: Float = -36f,
    val releaseMs: Float = 15f,
    val ceilingDb: Float = -1f,
  )

  /**
   * Tuned on a 58 min maimai stream (DJI Mic Mini on the collar): game sound peaks ~8 dB over the
   * 1 s median, clicks ~24 dB over it, nearly nothing in between. 약 leaves clicks ~16 dB over,
   * 강 ~12 dB, while the game sound comes up by the makeup.
   */
  enum class Level(val label: String, val params: Params?) {
    OFF("끔", null),
    LIGHT("약", Params(marginDb = 12f, ratio = 3f, makeupDb = 5f)),
    STRONG("강", Params(marginDb = 10f, ratio = 8f, makeupDb = 9f)),
    ;

    companion object {
      fun of(name: String?) = entries.firstOrNull { it.name == name } ?: OFF
    }
  }

  private val look = max(1, sampleRate * LOOKAHEAD_MS / 1000)
  private val delay = FloatArray(look * channels)
  private val frame = FloatArray(channels)
  private var pos = 0

  private val attack = exp(-1.0 / (sampleRate * ATTACK_MS / 1000.0)).toFloat()
  private val release = exp(-1.0 / (sampleRate * p.releaseMs / 1000.0)).toFloat()
  private val makeup = dbToLin(p.makeupDb)
  private val ceiling = dbToLin(p.ceilingDb)
  private val slope = 1f / p.ratio - 1f

  // median loudness of the last second, from 10 ms RMS blocks
  private val blockFrames = max(1, sampleRate * BLOCK_MS / 1000)
  private val history = FloatArray(HISTORY_BLOCKS) { p.floorDb }
  private val sorted = FloatArray(HISTORY_BLOCKS)
  private var historyPos = 0
  private var blockSum = 0.0
  private var blockCount = 0
  private var reference = p.floorDb

  /** detector envelope (linear peak), held for the lookahead then released */
  private var env = 0f
  private var hold = 0
  /** smoothed gain, without makeup */
  private var gain = 1f

  override fun process(pcmBuffer: ByteArray): ByteArray {
    val frames = pcmBuffer.size / (2 * channels)
    for (f in 0 until frames) {
      val base = f * channels * 2
      var peak = 0f
      for (c in 0 until channels) {
        val i = base + c * 2
        val s = ((pcmBuffer[i + 1].toInt() shl 8) or (pcmBuffer[i].toInt() and 0xff)).toShort() / 32768f
        frame[c] = s
        peak = max(peak, abs(s))
        blockSum += (s * s).toDouble()
      }
      if (++blockCount == blockFrames) endBlock()

      if (peak >= env) {
        env = peak
        hold = look
      } else if (hold > 0) {
        hold--
      } else {
        env = peak + release * (env - peak)
      }

      val target = min(curve(env), if (env * makeup > ceiling) ceiling / (env * makeup) else 1f)
      gain = if (target < gain) target + attack * (gain - target) else target

      val g = gain * makeup
      for (c in 0 until channels) {
        val d = pos * channels + c
        val y = (delay[d] * g).coerceIn(-ceiling, ceiling)
        delay[d] = frame[c]
        val v = (y * 32767f).toInt()
        val i = base + c * 2
        pcmBuffer[i] = v.toByte()
        pcmBuffer[i + 1] = (v shr 8).toByte()
      }
      pos = if (pos + 1 == look) 0 else pos + 1
    }
    return pcmBuffer
  }

  private fun endBlock() {
    val rms = sqrt(blockSum / (blockCount * channels))
    history[historyPos] = if (rms > 1e-6) (20.0 * log10(rms)).toFloat() else -120f
    historyPos = if (historyPos + 1 == HISTORY_BLOCKS) 0 else historyPos + 1
    history.copyInto(sorted)
    sorted.sort()
    reference = max(sorted[HISTORY_BLOCKS / 2], p.floorDb)
    blockSum = 0.0
    blockCount = 0
  }

  /** compressor gain (linear) for a detector level, soft knee around reference + margin */
  private fun curve(level: Float): Float {
    if (level <= 1e-6f) return 1f
    val over = 20f * log10(level) - (reference + p.marginDb)
    val knee = p.kneeDb
    val grDb = when {
      2f * over < -knee -> return 1f
      2f * abs(over) <= knee -> slope * (over + knee / 2f).pow(2) / (2f * knee)
      else -> slope * over
    }
    return dbToLin(grDb)
  }

  private fun dbToLin(db: Float) = 10f.pow(db / 20f)

  private companion object {
    const val LOOKAHEAD_MS = 2
    const val ATTACK_MS = 0.4
    const val BLOCK_MS = 10
    const val HISTORY_BLOCKS = 100
  }
}
