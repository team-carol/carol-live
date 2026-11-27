package com.teamcarol.live

import android.annotation.SuppressLint
import android.content.Context
import android.hardware.camera2.CaptureRequest
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.Range
import android.view.MotionEvent
import android.view.SurfaceView
import android.view.View
import com.pedro.common.ConnectChecker
import com.pedro.common.StreamingStatsReport
import com.pedro.encoder.input.sources.audio.MicrophoneSource
import com.pedro.encoder.input.sources.video.Camera2Source
import com.pedro.library.base.recording.RecordController
import com.pedro.library.generic.GenericStream
import com.pedro.library.util.QueueAwareBitrateAdapter
import java.io.File

/**
 * Owns the camera/mic/encoder pipeline for the whole process, so streaming and recording keep
 * going when the activity is gone (screen off, home button). The activity only attaches a preview
 * and renders state; LiveService keeps the process in the foreground while a session is active.
 *
 * A "session" starts when streaming or recording starts from idle and ends when both have stopped.
 * Its stats become a [LiveSummary]. Everything here runs on the main thread.
 */
@SuppressLint("StaticFieldLeak") // only ever holds the application context
object LiveSession : ConnectChecker {

  enum class State { IDLE, CONNECTING, LIVE, RETRYING }

  interface Listener {
    fun onChanged()
    fun onMessage(text: String)
    fun onSessionEnded(summary: LiveSummary)
  }

  private const val TAG = "CarolLive"
  private const val RETRIES = 10
  private const val RETRY_DELAY_MS = 5000L
  private const val MIN_VIDEO_BPS = 500_000

  private lateinit var app: Context
  private val ui = Handler(Looper.getMainLooper())
  var listener: Listener? = null

  var settings = StreamSettings()
    private set
  lateinit var cameraInfo: BackCameraInfo
    private set
  private var camera: Camera2Source? = null
  private var mic: MicrophoneSource? = null
  private var stream: GenericStream? = null
  private var bitrateAdapter: QueueAwareBitrateAdapter? = null

  var prepared = false
    private set
  var prepareError: String? = null
    private set
  var state = State.IDLE
    private set
  var liveSince = 0L
    private set
  var encoderFps = 0
    private set
  var lastStats: StreamingStatsReport? = null
    private set
  var activeResolution = Resolution.FHD
    private set
  var activeMicSource = MicMode.DEFAULT.audioSource
    private set
  var micLabel = "-"
    private set
  var lockedRange: Range<Int>? = null
    private set
  var exposure = 0
    private set
  var recordSince = 0L
    private set

  /** button clicks per second from the mic, sliced per recording for song splitting on the web */
  private var gameActivity: GameActivity? = null

  private var userStopped = false
  private var recordFile: File? = null
  private var recordStartedWall = 0L
  private var finishedRecord: File? = null
  private var session: SummaryBuilder? = null

  /** summary waiting to be shown (session ended while no activity was on screen) */
  var pendingSummary: LiveSummary? = null

  val isStreaming get() = stream?.isStreaming == true
  val isRecording get() = stream?.isRecording == true
  val isActive get() = isStreaming || isRecording
  val isMuted get() = mic?.isMuted() == true

  fun init(context: Context) {
    if (::app.isInitialized) return
    app = context.applicationContext
    cameraInfo = BackCameraInfo(app)
    app.getSystemService(AudioManager::class.java).registerAudioDeviceCallback(deviceCallback, ui)
    ui.post(ticker)
  }

  // ------------------------------------------------------------------ pipeline

  /** Build the pipeline for [newSettings]. Ignored while a session is active (settings are locked then). */
  fun configure(newSettings: StreamSettings) {
    if (isActive) return
    if (stream != null && prepared && newSettings == settings) return
    releasePipeline()
    settings = newSettings
    val cam = Camera2Source(app).apply {
      // locked: the [fps, fps] range. unlocked: allow dips like [24, 60] in the dark
      setDynamicFps(!newSettings.lockFps)
    }
    val microphone = MicrophoneSource(newSettings.micMode.audioSource)
    val s = GenericStream(app, this, cam, microphone).apply {
      getGlInterface().autoHandleOrientation = true
      getStreamClient().setReTries(RETRIES)
      setFpsListener { fps -> ui.post { encoderFps = fps } }
    }
    camera = cam
    mic = microphone
    stream = s
    val audioBps = newSettings.audioBitrateKbps * 1000
    bitrateAdapter = QueueAwareBitrateAdapter(newSettings.videoBitrateKbps * 1000 + audioBps) { target ->
      stream?.setVideoBitrateOnFly((target - audioBps).coerceAtLeast(MIN_VIDEO_BPS))
    }
    prepared = prepare()
    changed()
  }

  /** free camera/encoders when the app is closed and nothing is running */
  fun releaseIfIdle() {
    if (!isActive) releasePipeline()
  }

  private fun releasePipeline() {
    stream?.let {
      if (it.isOnPreview) it.stopPreview()
      it.release()
    }
    stream = null
    camera = null
    mic = null
    prepared = false
    lockedRange = null
  }

  private fun prepare(): Boolean {
    val s = stream ?: return false
    prepareError = null
    var res = settings.resolution
    if (!cameraInfo.supportsSize(res.width, res.height)) {
      message("카메라가 ${res.label}를 지원 안 해서 720p로 바꿈")
      res = Resolution.HD
    }
    val maxFps = cameraInfo.maxFpsFor(res.width, res.height)
    if (maxFps < settings.fps) message("${res.label}에서 카메라 최대 ${maxFps}fps라 ${settings.fps}fps가 안 나올 수 있음")

    val rotation = if (settings.orientation == StreamOrientation.PORTRAIT) 90 else 0
    val streamBps = settings.videoBitrateKbps * 1000
    // a separate record encoder only when a higher record bitrate is asked for (costs heat)
    val recordBps = settings.recordBitrateKbps * 1000
    val separate = recordBps > 0
    val videoOk = try {
      s.prepareVideo(
        res.width, res.height, streamBps,
        fps = settings.fps, iFrameInterval = 2, rotation = rotation,
        recordWidth = if (separate) res.width else 0,
        recordHeight = if (separate) res.height else 0,
        recordBitrate = if (separate) recordBps else streamBps,
      )
    } catch (e: IllegalArgumentException) {
      Log.e(TAG, "prepareVideo failed", e)
      false
    }
    if (!videoOk) {
      prepareError = "영상 설정 실패"
      message("영상 인코더 준비 실패. 해상도나 비트레이트를 바꿔봐")
      return false
    }
    activeResolution = res
    routeMic()
    if (!prepareAudio()) {
      prepareError = "오디오 설정 실패"
      message("마이크 준비 실패")
      return false
    }
    return true
  }

  /** try the chosen mic mode first, then modes every phone supports */
  private fun prepareAudio(): Boolean {
    val s = stream ?: return false
    val m = mic ?: return false
    val wanted = settings.micMode.audioSource
    for (source in listOf(wanted, MicMode.CAMCORDER.audioSource, MicMode.DEFAULT.audioSource).distinct()) {
      m.audioSource = source
      val ok = try {
        s.prepareAudio(
          settings.sampleRate, settings.stereo, settings.audioBitrateKbps * 1000,
          echoCanceler = false, noiseSuppressor = false,
        )
      } catch (e: IllegalArgumentException) {
        Log.w(TAG, "prepareAudio failed for source $source", e)
        false
      }
      if (ok) {
        activeMicSource = source
        val channels = if (settings.stereo) 2 else 1
        val activity = GameActivity(settings.sampleRate, channels)
        gameActivity = activity
        m.setAudioEffect(
          MicEffects(activity, settings.clickLimiter.params?.let { ClickLimiter(settings.sampleRate, channels, it) }),
        )
        if (source != wanted) message("마이크 모드를 ${MicMode.labelOf(source)}(으)로 대체함")
        return true
      }
    }
    return false
  }

  /** USB receiver when present; null lets Android pick the built-in mic */
  private fun routeMic() {
    val usb = if (settings.preferUsbMic) AudioInputs.findUsb(app) else null
    mic?.setPreferredDevice(usb)
    micLabel = usb?.let { AudioInputs.describe(it) } ?: "내장 마이크"
    session?.mic = micLabel
  }

  private val deviceCallback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
      routeMic()
      if (addedDevices.any { it.isSource && AudioInputs.isUsb(it) }) message("USB 마이크 연결됨: $micLabel")
      changed()
    }

    override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
      routeMic()
      if (removedDevices.any { it.isSource && AudioInputs.isUsb(it) }) message("USB 마이크가 빠짐 → $micLabel")
      changed()
    }
  }

  // ------------------------------------------------------------------ preview + camera

  fun attachPreview(view: SurfaceView) {
    val s = stream ?: return
    if (prepared && !s.isOnPreview) {
      s.startPreview(view)
      scheduleCameraTuning(0)
    }
  }

  fun resizePreview(width: Int, height: Int) {
    stream?.getGlInterface()?.setPreviewResolution(width, height)
  }

  /** the stream/recording keep running without a preview */
  fun detachPreview() {
    stream?.let { if (it.isOnPreview) it.stopPreview() }
  }

  fun zoom(event: MotionEvent) {
    camera?.setZoom(event)
  }

  fun focus(view: View, event: MotionEvent) {
    camera?.tapToFocus(view, event)
  }

  fun changeExposure(delta: Int) {
    val range = cameraInfo.exposureRange ?: return
    exposure = (exposure + delta).coerceIn(range.lower, range.upper)
    camera?.setExposure(exposure)
    changed()
  }

  /** the capture request only exists once the camera session is up, so retry for a few seconds */
  private fun scheduleCameraTuning(attempt: Int) {
    ui.postDelayed({
      if (camera?.isRunning() != true) {
        if (attempt < 20) scheduleCameraTuning(attempt + 1)
        return@postDelayed
      }
      if (!applyCameraTuning() && attempt < 20) scheduleCameraTuning(attempt + 1)
    }, 300)
  }

  private fun applyCameraTuning(): Boolean {
    val cam = camera ?: return true
    val range = if (settings.lockFps) cameraInfo.lockedRangeFor(settings.fps) else null
    val ok = cam.setCustomRequest { builder ->
      if (range != null) builder.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
      builder.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION, exposure)
    }
    if (ok) lockedRange = range
    return ok
  }

  fun toggleMute() {
    val m = mic ?: return
    if (m.isMuted()) m.unMute() else m.mute()
    changed()
  }

  // ------------------------------------------------------------------ stream

  /** @return an error message for the user, or null when the stream is starting */
  fun startStream(): String? {
    val s = stream ?: return "아직 준비가 안 됨"
    if (!prepared) return prepareError ?: "아직 준비가 안 됨"
    if (s.isStreaming) return null
    if (!settings.hasKey) return "설정에서 스트림 키부터 넣어줘"
    beginSession().streamed = true
    userStopped = false
    liveSince = 0L
    lastStats = null
    state = State.CONNECTING
    s.startStream(settings.endpoint)
    if (settings.autoRecord && !s.isRecording) startRecording(auto = true)
    LiveService.start(app)
    scheduleCameraTuning(0)
    changed()
    return null
  }

  /** stop everything (stream + recording) and end the session */
  fun stopAll(reason: String? = null) {
    userStopped = true
    stopRecording(null, quiet = true)
    stream?.let { if (it.isStreaming) it.stopStream() }
    state = State.IDLE
    endSessionIfIdle(reason)
    changed()
  }

  // ------------------------------------------------------------------ recording

  fun toggleRecording() {
    if (isRecording) stopRecording(null) else startRecording(auto = false)
  }

  private fun startRecording(auto: Boolean) {
    val s = stream ?: return
    if (!prepared || s.isRecording) return
    val free = Recordings.freeBytes()
    if (free < Recordings.START_MIN_FREE_BYTES) {
      val tail = if (auto) " 방송은 그대로 진행함" else ""
      message("저장공간이 ${Recordings.gigabytes(free)}밖에 없어서 녹화 안 함.$tail")
      return
    }
    val file = Recordings.newFile()
    try {
      s.startRecord(file.absolutePath, listener = recordListener)
    } catch (e: Exception) {
      Log.e(TAG, "startRecord failed", e)
      message("녹화 시작 실패: ${e.message}")
      return
    }
    beginSession()
    recordFile = file
    recordSince = SystemClock.elapsedRealtime()
    recordStartedWall = System.currentTimeMillis()
    LiveService.start(app)
    scheduleCameraTuning(0)
    changed()
  }

  /** stops only the recording; a running stream keeps going. The mp4 is finalized on STOPPED */
  private fun stopRecording(reason: String?, quiet: Boolean = false) {
    val s = stream ?: return
    if (!s.isRecording) return
    val file = recordFile
    finishedRecord = file
    recordFile = null
    s.stopRecord()
    if (file != null) {
      val now = SystemClock.elapsedRealtime()
      session?.files?.add(
        RecordedFile(
          file.absolutePath,
          file.name,
          recordStartedWall,
          now - recordSince,
          activity = gameActivity?.slice(recordSince, now),
        ),
      )
    }
    if (!quiet) message(if (reason != null) "$reason · 그때까지 녹화는 저장됨" else "녹화 저장됨 · Movies/CarolLive")
    endSessionIfIdle(null)
    changed()
  }

  private val recordListener = object : RecordController.Listener {
    override fun onStatusChange(status: RecordController.Status) {
      if (status == RecordController.Status.STOPPED) {
        ui.post {
          finishedRecord?.let { Recordings.publish(app, it) }
          finishedRecord = null
        }
      }
    }

    override fun onError(e: Exception?) {
      Log.e(TAG, "record write error", e)
      ui.post { stopRecording("녹화 파일 쓰기 실패(저장공간 확인)") }
    }
  }

  // ------------------------------------------------------------------ session + summary

  private fun beginSession(): SummaryBuilder =
    session ?: SummaryBuilder(settings, activeResolution, PhoneStatus.read(app).batteryPct)
      .also {
        it.mic = micLabel
        session = it
      }

  private fun endSessionIfIdle(reason: String?) {
    if (isActive) return
    val builder = session ?: return
    session = null
    val summary = builder.build(PhoneStatus.read(app).batteryPct, reason)
    LiveService.stop(app)
    Uploads.onSessionEnded(app, summary)
    pendingSummary = summary
    listener?.onSessionEnded(summary)
  }

  /** every second: storage guard, stats for the summary, notification + UI refresh */
  private val ticker = object : Runnable {
    override fun run() {
      tick()
      ui.postDelayed(this, 1000)
    }
  }

  private fun tick() {
    if (isRecording && Recordings.freeBytes() < Recordings.STOP_MIN_FREE_BYTES) {
      stopRecording("저장공간이 1GB 아래라 녹화만 멈춤. 방송은 계속됨")
    }
    val s = session
    if (s != null) {
      val stats = lastStats
      if (state == State.LIVE && stats != null) s.sampleSent((stats.smoothedBitrate / 1000).toInt())
      if (isStreaming && encoderFps > 0) s.sampleFps(encoderFps)
      s.sampleTemp(PhoneStatus.read(app).tempC)
      LiveService.refresh()
    }
    listener?.onChanged()
  }

  private fun changed() {
    listener?.onChanged()
    LiveService.refresh()
  }

  private fun message(text: String) {
    ui.post { listener?.onMessage(text) }
  }

  // ------------------------------------------------------------------ ConnectChecker (any thread)

  override fun onConnectionStarted(url: String) {
    ui.post { bitrateAdapter?.reset() }
  }

  override fun onConnectionSuccess() {
    ui.post {
      if (liveSince == 0L) liveSince = SystemClock.elapsedRealtime()
      state = State.LIVE
      changed()
    }
  }

  override fun onConnectionFailed(reason: String) {
    ui.post {
      val s = stream ?: return@post
      if (userStopped) return@post
      if (s.getStreamClient().reTry(RETRY_DELAY_MS, reason, null)) {
        if (state != State.RETRYING) session?.let { it.reconnects++ }
        state = State.RETRYING
        message("연결 끊김, 다시 붙는 중")
      } else if (s.isRecording) {
        // network is gone but the local recording is still good: keep it running
        s.stopStream()
        state = State.IDLE
        message("방송 연결이 끊김. 녹화는 계속됨 ($reason)")
      } else {
        stopAll("연결 실패: $reason")
        message("연결 실패: $reason")
      }
      changed()
    }
  }

  override fun onDisconnect() {
    ui.post {
      if (!isStreaming && state != State.IDLE) {
        state = State.IDLE
        changed()
      }
    }
  }

  override fun onAuthError() {
    ui.post {
      stopAll("인증 실패")
      message("인증 실패. 스트림 키를 확인해줘")
    }
  }

  override fun onAuthSuccess() {}

  override fun onStreamingStats(report: StreamingStatsReport) {
    ui.post {
      lastStats = report
      bitrateAdapter?.onStreamingStats(report)
    }
  }
}
