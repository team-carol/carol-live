package dev.roena.live

import android.content.Context
import android.media.MediaRecorder

enum class Resolution(val label: String, val width: Int, val height: Int) {
  FHD("1080p", 1920, 1080),
  HD("720p", 1280, 720),
}

enum class StreamOrientation { LANDSCAPE, PORTRAIT }

enum class MicMode(val label: String, val audioSource: Int) {
  UNPROCESSED("원음", MediaRecorder.AudioSource.UNPROCESSED),
  CAMCORDER("캠코더", MediaRecorder.AudioSource.CAMCORDER),
  DEFAULT("기본", MediaRecorder.AudioSource.MIC);

  companion object {
    fun labelOf(audioSource: Int): String =
      entries.firstOrNull { it.audioSource == audioSource }?.label ?: "source $audioSource"
  }
}

data class StreamSettings(
  val serverUrl: String = DEFAULT_SERVER,
  val streamKey: String = "",
  val resolution: Resolution = Resolution.FHD,
  val fps: Int = 60,
  val videoBitrateKbps: Int = 8000,
  val audioBitrateKbps: Int = 160,
  val sampleRate: Int = 48000,
  val stereo: Boolean = true,
  val micMode: MicMode = MicMode.UNPROCESSED,
  val preferUsbMic: Boolean = true,
  val orientation: StreamOrientation = StreamOrientation.LANDSCAPE,
  val lockFps: Boolean = true,
) {
  val hasKey: Boolean get() = streamKey.isNotBlank()

  /** Full RTMP endpoint: server + "/" + key. Never log this, it contains the stream key. */
  val endpoint: String get() = serverUrl.trim().trimEnd('/') + "/" + streamKey.trim()

  companion object {
    const val DEFAULT_SERVER = "rtmp://a.rtmp.youtube.com/live2"

    fun recommendedVideoKbps(resolution: Resolution, fps: Int): Int = when {
      resolution == Resolution.FHD && fps >= 60 -> 8000
      resolution == Resolution.FHD -> 6000
      fps >= 60 -> 6000
      else -> 4000
    }
  }
}

/** Plain SharedPreferences; allowBackup=false in the manifest keeps the key off cloud backups. */
object SettingsStore {
  private const val PREFS = "roena_live_settings"

  fun load(context: Context): StreamSettings {
    val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val d = StreamSettings()
    return StreamSettings(
      serverUrl = p.getString("serverUrl", null) ?: d.serverUrl,
      streamKey = p.getString("streamKey", null) ?: d.streamKey,
      resolution = enumOr(p.getString("resolution", null), d.resolution),
      fps = p.getInt("fps", d.fps),
      videoBitrateKbps = p.getInt("videoBitrateKbps", d.videoBitrateKbps),
      audioBitrateKbps = p.getInt("audioBitrateKbps", d.audioBitrateKbps),
      sampleRate = p.getInt("sampleRate", d.sampleRate),
      stereo = p.getBoolean("stereo", d.stereo),
      micMode = enumOr(p.getString("micMode", null), d.micMode),
      preferUsbMic = p.getBoolean("preferUsbMic", d.preferUsbMic),
      orientation = enumOr(p.getString("orientation", null), d.orientation),
      lockFps = p.getBoolean("lockFps", d.lockFps),
    )
  }

  fun save(context: Context, s: StreamSettings) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("serverUrl", s.serverUrl)
      .putString("streamKey", s.streamKey)
      .putString("resolution", s.resolution.name)
      .putInt("fps", s.fps)
      .putInt("videoBitrateKbps", s.videoBitrateKbps)
      .putInt("audioBitrateKbps", s.audioBitrateKbps)
      .putInt("sampleRate", s.sampleRate)
      .putBoolean("stereo", s.stereo)
      .putString("micMode", s.micMode.name)
      .putBoolean("preferUsbMic", s.preferUsbMic)
      .putString("orientation", s.orientation.name)
      .putBoolean("lockFps", s.lockFps)
      .apply()
  }

  private inline fun <reified T : Enum<T>> enumOr(name: String?, fallback: T): T =
    name?.let { n -> enumValues<T>().firstOrNull { it.name == n } } ?: fallback
}
