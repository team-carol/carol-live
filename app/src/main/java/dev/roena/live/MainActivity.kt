package dev.roena.live

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.hardware.camera2.CaptureRequest
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import android.util.Range
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.pedro.common.ConnectChecker
import com.pedro.common.StreamingStatsReport
import com.pedro.encoder.input.sources.audio.MicrophoneSource
import com.pedro.encoder.input.sources.video.Camera2Source
import com.pedro.library.generic.GenericStream
import com.pedro.library.util.QueueAwareBitrateAdapter
import java.util.Locale

class MainActivity : AppCompatActivity(), ConnectChecker {

  private enum class LiveState { IDLE, CONNECTING, LIVE, RETRYING }

  private lateinit var settings: StreamSettings
  private lateinit var cameraInfo: BackCameraInfo
  private lateinit var camera: Camera2Source
  private lateinit var mic: MicrophoneSource
  private lateinit var stream: GenericStream
  private lateinit var bitrateAdapter: QueueAwareBitrateAdapter

  private lateinit var preview: SurfaceView
  private lateinit var txtState: TextView
  private lateinit var statBitrate: TextView
  private lateinit var statFps: TextView
  private lateinit var statBattery: TextView
  private lateinit var statTemp: TextView
  private lateinit var txtVideoMeta: TextView
  private lateinit var txtAudioMeta: TextView
  private lateinit var txtExposure: TextView
  private lateinit var btnGoLive: Button
  private lateinit var btnSettings: Button
  private lateinit var btnMute: Button

  private val ui = Handler(Looper.getMainLooper())
  private var prepared = false
  private var surfaceReady = false
  private var state = LiveState.IDLE
  private var userStopped = false
  private var liveSince = 0L
  private var encoderFps = 0
  private var lastStats: StreamingStatsReport? = null
  private var activeResolution = Resolution.FHD
  private var activeMicSource = MicMode.DEFAULT.audioSource
  private var micLabel = "-"
  private var lockedRange: Range<Int>? = null
  private var exposure = 0

  private val audioManager by lazy { getSystemService(AudioManager::class.java) }

  private val permissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
      if (result.values.all { it }) {
        onPermissionsReady()
      } else {
        txtState.text = "권한 필요"
        toast("카메라랑 마이크 권한이 있어야 방송할 수 있음")
      }
    }

  private val settingsLauncher =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      // settings change the encoder/camera setup, so rebuild everything from scratch
      if (result.resultCode == RESULT_OK && !stream.isStreaming) recreate()
    }

  private val deviceCallback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
      routeMic()
      if (addedDevices.any { it.isSource && AudioInputs.isUsb(it) }) toast("USB 마이크 연결됨: $micLabel")
    }

    override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
      routeMic()
      if (removedDevices.any { it.isSource && AudioInputs.isUsb(it) }) toast("USB 마이크가 빠짐 → $micLabel")
    }
  }

  private val ticker = object : Runnable {
    override fun run() {
      renderStatus()
      ui.postDelayed(this, 1000)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    settings = SettingsStore.load(this)
    requestedOrientation = if (settings.orientation == StreamOrientation.PORTRAIT) {
      ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    } else {
      ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    setContentView(R.layout.activity_main)
    goFullscreen()
    bindViews()

    cameraInfo = BackCameraInfo(this)
    camera = Camera2Source(this).apply {
      // locked: library picks the [fps, fps] range. unlocked: allow dips like [24, 60] in the dark
      setDynamicFps(!settings.lockFps)
    }
    mic = MicrophoneSource(settings.micMode.audioSource)
    stream = GenericStream(this, this, camera, mic).apply {
      getGlInterface().autoHandleOrientation = true
      getStreamClient().setReTries(RETRIES)
      setFpsListener { fps -> ui.post { encoderFps = fps } }
    }
    val audioBps = settings.audioBitrateKbps * 1000
    bitrateAdapter = QueueAwareBitrateAdapter(settings.videoBitrateKbps * 1000 + audioBps) { target ->
      stream.setVideoBitrateOnFly((target - audioBps).coerceAtLeast(MIN_VIDEO_BPS))
    }

    preview.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) {
        surfaceReady = true
        startPreviewIfReady()
      }

      override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        stream.getGlInterface().setPreviewResolution(width, height)
      }

      override fun surfaceDestroyed(holder: SurfaceHolder) {
        surfaceReady = false
        if (stream.isOnPreview) stream.stopPreview()
      }
    })

    wireControls()

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (stream.isStreaming) confirmStop { finish() } else finish()
      }
    })

    if (hasPermissions()) onPermissionsReady() else permissionLauncher.launch(PERMISSIONS)
  }

  override fun onStart() {
    super.onStart()
    ui.post(ticker)
  }

  override fun onStop() {
    super.onStop()
    ui.removeCallbacks(ticker)
  }

  override fun onDestroy() {
    super.onDestroy()
    ui.removeCallbacksAndMessages(null)
    runCatching { audioManager.unregisterAudioDeviceCallback(deviceCallback) }
    if (stream.isStreaming) {
      userStopped = true
      stream.stopStream()
    }
    if (stream.isOnPreview) stream.stopPreview()
    stream.release()
  }

  // ---------------------------------------------------------------- setup

  private fun bindViews() {
    preview = findViewById(R.id.preview)
    txtState = findViewById(R.id.txt_state)
    statBitrate = findViewById(R.id.stat_bitrate)
    statFps = findViewById(R.id.stat_fps)
    statBattery = findViewById(R.id.stat_battery)
    statTemp = findViewById(R.id.stat_temp)
    txtVideoMeta = findViewById(R.id.txt_video_meta)
    txtAudioMeta = findViewById(R.id.txt_audio_meta)
    txtExposure = findViewById(R.id.txt_exposure)
    btnGoLive = findViewById(R.id.btn_go_live)
    btnSettings = findViewById(R.id.btn_settings)
    btnMute = findViewById(R.id.btn_mute)
  }

  private fun goFullscreen() {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    WindowInsetsControllerCompat(window, window.decorView).apply {
      hide(WindowInsetsCompat.Type.systemBars())
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
    val overlay = findViewById<View>(R.id.overlay)
    val base = overlay.paddingLeft
    ViewCompat.setOnApplyWindowInsetsListener(overlay) { v, insets ->
      val i = insets.getInsets(WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.systemBars())
      v.setPadding(base + i.left, base + i.top, base + i.right, base + i.bottom)
      insets
    }
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun wireControls() {
    btnGoLive.setOnClickListener { toggleStream() }
    btnSettings.setOnClickListener { openSettings() }
    btnMute.setOnClickListener {
      if (mic.isMuted()) mic.unMute() else mic.mute()
      btnMute.text = if (mic.isMuted()) "음소거 해제" else "음소거"
      renderStatus()
    }
    findViewById<Button>(R.id.btn_ev_down).setOnClickListener { changeExposure(-1) }
    findViewById<Button>(R.id.btn_ev_up).setOnClickListener { changeExposure(+1) }

    // two fingers: pinch zoom, one finger tap: focus there
    preview.setOnTouchListener { v, event ->
      if (event.pointerCount > 1) {
        camera.setZoom(event)
      } else if (event.action == MotionEvent.ACTION_UP) {
        camera.tapToFocus(v, event)
      }
      true
    }
    updateExposureLabel()
  }

  private fun onPermissionsReady() {
    prepared = prepareStream()
    audioManager.registerAudioDeviceCallback(deviceCallback, ui)
    startPreviewIfReady()
    renderStatus()
  }

  private fun prepareStream(): Boolean {
    var res = settings.resolution
    if (!cameraInfo.supportsSize(res.width, res.height)) {
      toast("카메라가 ${res.label}를 지원 안 해서 720p로 바꿈")
      res = Resolution.HD
    }
    val maxFps = cameraInfo.maxFpsFor(res.width, res.height)
    if (maxFps < settings.fps) toast("${res.label}에서 카메라 최대 ${maxFps}fps라 ${settings.fps}fps가 안 나올 수 있음")

    val rotation = if (settings.orientation == StreamOrientation.PORTRAIT) 90 else 0
    val videoOk = try {
      stream.prepareVideo(
        res.width, res.height, settings.videoBitrateKbps * 1000,
        fps = settings.fps, iFrameInterval = 2, rotation = rotation,
      )
    } catch (e: IllegalArgumentException) {
      Log.e(TAG, "prepareVideo failed", e)
      false
    }
    if (!videoOk) {
      txtState.text = "영상 설정 실패"
      toast("영상 인코더 준비 실패. 해상도나 비트레이트를 바꿔봐")
      return false
    }
    activeResolution = res

    routeMic()
    if (!prepareAudio()) {
      txtState.text = "오디오 설정 실패"
      toast("마이크 준비 실패")
      return false
    }
    return true
  }

  /** Try the chosen mic mode first, then fall back to modes every phone supports. */
  private fun prepareAudio(): Boolean {
    val wanted = settings.micMode.audioSource
    val candidates = listOf(wanted, MicMode.CAMCORDER.audioSource, MicMode.DEFAULT.audioSource).distinct()
    for (source in candidates) {
      mic.audioSource = source
      val ok = try {
        stream.prepareAudio(
          settings.sampleRate, settings.stereo, settings.audioBitrateKbps * 1000,
          echoCanceler = false, noiseSuppressor = false,
        )
      } catch (e: IllegalArgumentException) {
        Log.w(TAG, "prepareAudio failed for source $source", e)
        false
      }
      if (ok) {
        activeMicSource = source
        if (source != wanted) toast("마이크 모드를 ${MicMode.labelOf(source)}(으)로 대체함")
        return true
      }
    }
    return false
  }

  /** Point the recorder at the USB receiver when present; null lets Android pick the built-in mic. */
  private fun routeMic() {
    val usb = if (settings.preferUsbMic) AudioInputs.findUsb(this) else null
    mic.setPreferredDevice(usb)
    micLabel = usb?.let { AudioInputs.describe(it) } ?: "내장 마이크"
  }

  private fun startPreviewIfReady() {
    if (prepared && surfaceReady && !stream.isOnPreview) {
      stream.startPreview(preview)
      scheduleCameraTuning(0)
    }
  }

  /** The capture request only exists once the camera session is up, so retry for a few seconds. */
  private fun scheduleCameraTuning(attempt: Int) {
    ui.postDelayed({
      if (!stream.isOnPreview) return@postDelayed
      if (!applyCameraTuning() && attempt < 20) scheduleCameraTuning(attempt + 1)
    }, 300)
  }

  private fun applyCameraTuning(): Boolean {
    val range = if (settings.lockFps) cameraInfo.lockedRangeFor(settings.fps) else null
    val ok = camera.setCustomRequest { builder ->
      if (range != null) builder.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
      builder.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION, exposure)
    }
    if (ok) lockedRange = range
    return ok
  }

  // ---------------------------------------------------------------- actions

  private fun toggleStream() {
    if (stream.isStreaming) {
      confirmStop(null)
      return
    }
    if (!prepared) {
      toast("아직 준비가 안 됨")
      return
    }
    if (!settings.hasKey) {
      toast("설정에서 스트림 키부터 넣어줘")
      openSettings()
      return
    }
    userStopped = false
    liveSince = 0L
    lastStats = null
    setState(LiveState.CONNECTING)
    stream.startStream(settings.endpoint)
  }

  private fun stopStreaming() {
    userStopped = true
    if (stream.isStreaming) stream.stopStream()
    setState(LiveState.IDLE)
  }

  private fun confirmStop(after: (() -> Unit)?) {
    AlertDialog.Builder(this)
      .setTitle("방송 종료")
      .setMessage("방송을 끝낼까?")
      .setPositiveButton("종료") { _, _ ->
        stopStreaming()
        after?.invoke()
      }
      .setNegativeButton("취소", null)
      .show()
  }

  private fun openSettings() {
    if (stream.isStreaming) {
      toast("방송 중에는 설정을 못 바꿈")
      return
    }
    settingsLauncher.launch(Intent(this, SettingsActivity::class.java))
  }

  private fun changeExposure(delta: Int) {
    val range = cameraInfo.exposureRange ?: return
    exposure = (exposure + delta).coerceIn(range.lower, range.upper)
    camera.setExposure(exposure)
    updateExposureLabel()
  }

  private fun updateExposureLabel() {
    txtExposure.text = String.format(Locale.US, "EV %+.1f", exposure * cameraInfo.exposureStep)
  }

  // ---------------------------------------------------------------- status

  private fun setState(newState: LiveState) {
    state = newState
    renderStatus()
  }

  private fun renderStatus() {
    if (!::stream.isInitialized) return
    val streaming = stream.isStreaming

    // crl-tag tones: accent = on air, warning = reconnecting, neutral = everything else
    val (label, tagBg, tagInk) = when (state) {
      LiveState.IDLE -> Triple(if (prepared) "대기" else txtState.text, R.drawable.crl_tag_neutral, R.color.crl_muted)
      LiveState.CONNECTING -> Triple("연결 중…", R.drawable.crl_tag_neutral, R.color.crl_ink_2)
      LiveState.RETRYING -> Triple("재연결 중…", R.drawable.crl_tag_warning, R.color.crl_warning)
      LiveState.LIVE -> Triple(
        "● LIVE  " + formatElapsed(SystemClock.elapsedRealtime() - liveSince),
        R.drawable.crl_tag_accent, R.color.crl_accent_ink,
      )
    }
    txtState.text = label
    txtState.setBackgroundResource(tagBg)
    txtState.setTextColor(color(tagInk))

    val stats = lastStats
    statBitrate.text = if (streaming && stats != null) {
      String.format(Locale.US, "%.1fM", stats.smoothedBitrate / 1_000_000f)
    } else {
      "-"
    }
    statFps.text = if (streaming) encoderFps.toString() else "-"
    statFps.setTextColor(
      color(if (streaming && encoderFps in 1 until settings.fps - 5) R.color.crl_warning else R.color.crl_ink)
    )

    val phone = PhoneStatus.read(this)
    statBattery.text = if (phone.batteryPct >= 0) "${phone.batteryPct}%" else "-"
    statBattery.setTextColor(color(if (phone.charging) R.color.crl_success else R.color.crl_ink))
    statTemp.text = String.format(Locale.US, "%.0f°", phone.tempC)
    statTemp.setTextColor(
      color(
        when {
          phone.thermal >= PowerManager.THERMAL_STATUS_SEVERE -> R.color.crl_danger
          phone.thermal >= PowerManager.THERMAL_STATUS_MODERATE -> R.color.crl_warning
          else -> R.color.crl_ink
        }
      )
    )

    val ae = lockedRange?.let { " · AE ${it.lower}–${it.upper}" } ?: ""
    txtVideoMeta.text = "${activeResolution.label}${settings.fps} · 목표 ${settings.videoBitrateKbps / 1000.0}M$ae" +
      if (phone.thermal >= PowerManager.THERMAL_STATUS_MODERATE) " · ${PhoneStatus.thermalLabel(phone.thermal)}" else ""
    val muted = if (mic.isMuted()) " · 음소거" else ""
    txtAudioMeta.text = "$micLabel · ${MicMode.labelOf(activeMicSource)} · " +
      "${settings.sampleRate / 1000.0}kHz ${settings.audioBitrateKbps}k$muted"

    if (streaming) {
      btnGoLive.text = "종료"
      btnGoLive.setBackgroundResource(R.drawable.crl_btn_danger)
      btnGoLive.setTextColor(color(R.color.crl_danger))
    } else {
      btnGoLive.text = "방송 시작"
      btnGoLive.setBackgroundResource(R.drawable.crl_btn_primary)
      btnGoLive.setTextColor(color(R.color.crl_accent_ink))
    }
    btnSettings.isEnabled = !streaming
    btnSettings.alpha = if (streaming) DISABLED_ALPHA else 1f
  }

  private fun color(res: Int): Int = ContextCompat.getColor(this, res)

  private fun formatElapsed(ms: Long): String {
    val s = ms / 1000
    return String.format(Locale.US, "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60)
  }

  // ---------------------------------------------------------------- ConnectChecker (any thread)

  override fun onConnectionStarted(url: String) {
    ui.post { bitrateAdapter.reset() }
  }

  override fun onConnectionSuccess() {
    ui.post {
      if (liveSince == 0L) liveSince = SystemClock.elapsedRealtime()
      setState(LiveState.LIVE)
    }
  }

  override fun onConnectionFailed(reason: String) {
    ui.post {
      if (userStopped) return@post
      if (stream.getStreamClient().reTry(RETRY_DELAY_MS, reason, null)) {
        setState(LiveState.RETRYING)
        toast("연결 끊김, 다시 붙는 중")
      } else {
        stream.stopStream()
        setState(LiveState.IDLE)
        toast("연결 실패: $reason")
      }
    }
  }

  override fun onDisconnect() {
    ui.post { if (!stream.isStreaming) setState(LiveState.IDLE) }
  }

  override fun onAuthError() {
    ui.post {
      stream.stopStream()
      setState(LiveState.IDLE)
      toast("인증 실패. 스트림 키를 확인해줘")
    }
  }

  override fun onAuthSuccess() {}

  override fun onStreamingStats(report: StreamingStatsReport) {
    ui.post {
      lastStats = report
      bitrateAdapter.onStreamingStats(report)
    }
  }

  // ---------------------------------------------------------------- utils

  private fun hasPermissions(): Boolean = PERMISSIONS.all {
    ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
  }

  private fun toast(message: String) {
    ui.post { Toast.makeText(this, message, Toast.LENGTH_SHORT).show() }
  }

  companion object {
    private const val TAG = "RoenaLive"
    private const val RETRIES = 10
    private const val RETRY_DELAY_MS = 5000L
    private const val MIN_VIDEO_BPS = 500_000
    private const val DISABLED_ALPHA = 0.45f
    private val PERMISSIONS = arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
  }
}
