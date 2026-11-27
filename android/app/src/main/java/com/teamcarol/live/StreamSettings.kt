package com.teamcarol.live

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

/** how a broadcast is started */
enum class StreamMode {
  /** push to the address and stream key typed in settings */
  KEY,
  /** make a broadcast on the YouTube channel linked on the web, with a title, description and visibility ([YouTubeAccount]) */
  ACCOUNT,
}

data class StreamSettings(
  val streamMode: StreamMode = StreamMode.KEY,
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
  /** start a local recording together with the stream */
  val autoRecord: Boolean = true,
  /** 0 = record the same encoded video that is streamed (one encoder). >0 = separate, higher-bitrate encoder */
  val recordBitrateKbps: Int = 0,
  /** "@handle" (or channel URL / UC id) whose live chat is shown on the live screen */
  val youtubeChannel: String = "",
  val showChat: Boolean = true,
  /** presses button clicks in the mic signal before encoding (stream and recording) */
  val clickLimiter: ClickLimiter.Level = ClickLimiter.Level.OFF,
  /** experimental: read the song title off the upper monitor while live ([SongSpotter]) */
  val songSpotting: Boolean = false,
  /** put the recognized title on the stream itself (it ends up in the recording too) */
  val songOverlay: Boolean = false,
) {
  val hasKey: Boolean get() = streamKey.isNotBlank()

  /** Full RTMP endpoint: server + "/" + key. Never log this, it contains the stream key. */
  val endpoint: String get() = serverUrl.trim().trimEnd('/') + "/" + streamKey.trim()

  /** bytes written to disk per second while recording, used for the remaining-time estimate */
  val recordBytesPerSecond: Long
    get() = ((if (recordBitrateKbps > 0) recordBitrateKbps else videoBitrateKbps) + audioBitrateKbps) * 1000L / 8

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
  private const val PREFS = "carol_live_settings"

  fun load(context: Context): StreamSettings {
    val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val d = StreamSettings()
    return StreamSettings(
      streamMode = enumOr(p.getString("streamMode", null), d.streamMode),
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
      autoRecord = p.getBoolean("autoRecord", d.autoRecord),
      recordBitrateKbps = p.getInt("recordBitrateKbps", d.recordBitrateKbps),
      youtubeChannel = p.getString("youtubeChannel", null) ?: d.youtubeChannel,
      showChat = p.getBoolean("showChat", d.showChat),
      clickLimiter = ClickLimiter.Level.of(p.getString("clickLimiter", null)),
      songSpotting = p.getBoolean("songSpotting", d.songSpotting),
      songOverlay = p.getBoolean("songOverlay", d.songOverlay),
    )
  }

  fun save(context: Context, s: StreamSettings) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("streamMode", s.streamMode.name)
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
      .putBoolean("autoRecord", s.autoRecord)
      .putInt("recordBitrateKbps", s.recordBitrateKbps)
      .putString("youtubeChannel", s.youtubeChannel)
      .putBoolean("showChat", s.showChat)
      .putString("clickLimiter", s.clickLimiter.name)
      .putBoolean("songSpotting", s.songSpotting)
      .putBoolean("songOverlay", s.songOverlay)
      .apply()
  }

  private inline fun <reified T : Enum<T>> enumOr(name: String?, fallback: T): T =
    name?.let { n -> enumValues<T>().firstOrNull { it.name == n } } ?: fallback
}
