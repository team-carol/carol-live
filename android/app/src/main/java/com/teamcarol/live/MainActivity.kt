package com.teamcarol.live

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.os.SystemClock
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
import java.util.Locale

/**
 * Camera preview + controls. All streaming/recording state lives in [LiveSession], so this screen
 * can be closed, rotated or put behind the lock screen without stopping the broadcast.
 */
class MainActivity : AppCompatActivity(), LiveSession.Listener {

  private lateinit var preview: SurfaceView
  private lateinit var txtState: TextView
  private lateinit var txtRec: TextView
  private lateinit var statBitrate: TextView
  private lateinit var statFps: TextView
  private lateinit var statBattery: TextView
  private lateinit var statTemp: TextView
  private lateinit var txtVideoMeta: TextView
  private lateinit var txtAudioMeta: TextView
  private lateinit var txtRecordMeta: TextView
  private lateinit var txtExposure: TextView
  private lateinit var btnGoLive: Button
  private lateinit var btnSettings: Button
  private lateinit var btnMute: Button
  private lateinit var btnRecord: Button

  private var surfaceReady = false
  private val session = LiveSession

  private val permissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
      if (REQUIRED.all { result[it] == true || has(it) }) {
        onPermissionsReady()
      } else {
        txtState.text = "권한 필요"
        toast("카메라랑 마이크 권한이 있어야 방송할 수 있음")
      }
    }

  private val settingsLauncher =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      // orientation may have changed, so rebuild the screen; the session re-prepares in onCreate
      if (result.resultCode == RESULT_OK && !session.isActive) recreate()
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    session.init(this)
    val settings = SettingsStore.load(this)
    // while a session runs its settings are locked, so keep its orientation
    val orientation = if (session.isActive) session.settings.orientation else settings.orientation
    requestedOrientation = if (orientation == StreamOrientation.PORTRAIT) {
      ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    } else {
      ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    setContentView(R.layout.activity_main)
    goFullscreen()
    bindViews()

    preview.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) {
        surfaceReady = true
        if (hasPermissions()) session.attachPreview(preview)
      }

      override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        session.resizePreview(width, height)
      }

      override fun surfaceDestroyed(holder: SurfaceHolder) {
        surfaceReady = false
        session.detachPreview()
      }
    })

    wireControls()
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (session.isActive) {
          // leaving keeps the broadcast running in the background (notification has a stop button)
          toast("방송·녹화는 백그라운드에서 계속됨. 알림에서 종료할 수 있음")
        }
        finish()
      }
    })

    val missing = (REQUIRED + OPTIONAL).filterNot { has(it) }
    if (REQUIRED.all { has(it) }) {
      onPermissionsReady()
      if (missing.isNotEmpty()) permissionLauncher.launch(missing.toTypedArray())
    } else {
      permissionLauncher.launch(missing.toTypedArray())
    }
  }

  override fun onStart() {
    super.onStart()
    session.listener = this
    render()
  }

  override fun onResume() {
    super.onResume()
    showPendingSummary()
  }

  override fun onStop() {
    super.onStop()
    if (session.listener === this) session.listener = null
  }

  override fun onDestroy() {
    super.onDestroy()
    // closing the app while idle frees the camera; an active session keeps everything
    if (isFinishing) session.releaseIfIdle()
  }

  // ---------------------------------------------------------------- LiveSession.Listener

  override fun onChanged() = render()

  override fun onMessage(text: String) = toast(text)

  override fun onSessionEnded(summary: LiveSummary) = showPendingSummary()

  private fun showPendingSummary() {
    val s = session.pendingSummary ?: return
    session.pendingSummary = null
    SummaryActivity.open(this, s)
  }

  // ---------------------------------------------------------------- setup

  private fun onPermissionsReady() {
    session.configure(SettingsStore.load(this))
    if (surfaceReady) session.attachPreview(preview)
    updateExposureLabel()
    render()
  }

  private fun bindViews() {
    preview = findViewById(R.id.preview)
    txtState = findViewById(R.id.txt_state)
    txtRec = findViewById(R.id.txt_rec)
    statBitrate = findViewById(R.id.stat_bitrate)
    statFps = findViewById(R.id.stat_fps)
    statBattery = findViewById(R.id.stat_battery)
    statTemp = findViewById(R.id.stat_temp)
    txtVideoMeta = findViewById(R.id.txt_video_meta)
    txtAudioMeta = findViewById(R.id.txt_audio_meta)
    txtRecordMeta = findViewById(R.id.txt_record_meta)
    txtExposure = findViewById(R.id.txt_exposure)
    btnGoLive = findViewById(R.id.btn_go_live)
    btnSettings = findViewById(R.id.btn_settings)
    btnMute = findViewById(R.id.btn_mute)
    btnRecord = findViewById(R.id.btn_record)
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
    btnGoLive.setOnClickListener {
      if (session.isStreaming) confirmStop() else session.startStream()?.let { error ->
        toast(error)
        if (!session.settings.hasKey) openSettings()
      }
    }
    btnSettings.setOnClickListener { openSettings() }
    btnRecord.setOnClickListener { session.toggleRecording() }
    btnMute.setOnClickListener { session.toggleMute() }
    findViewById<Button>(R.id.btn_ev_down).setOnClickListener {
      session.changeExposure(-1)
      updateExposureLabel()
    }
    findViewById<Button>(R.id.btn_ev_up).setOnClickListener {
      session.changeExposure(+1)
      updateExposureLabel()
    }
    // two fingers: pinch zoom, one finger tap: focus there
    preview.setOnTouchListener { v, event ->
      if (event.pointerCount > 1) session.zoom(event)
      else if (event.action == MotionEvent.ACTION_UP) session.focus(v, event)
      true
    }
  }

  private fun confirmStop() {
    AlertDialog.Builder(this)
      .setTitle("방송 종료")
      .setMessage(if (session.isRecording) "방송이랑 녹화를 같이 끝낼까?" else "방송을 끝낼까?")
      .setPositiveButton("종료") { _, _ -> session.stopAll() }
      .setNegativeButton("취소", null)
      .show()
  }

  private fun openSettings() {
    if (session.isActive) {
      toast("방송이나 녹화 중에는 설정을 못 바꿈")
      return
    }
    settingsLauncher.launch(Intent(this, SettingsActivity::class.java))
  }

  private fun updateExposureLabel() {
    txtExposure.text = String.format(Locale.US, "EV %+.1f", session.exposure * session.cameraInfo.exposureStep)
  }

  // ---------------------------------------------------------------- render

  private fun render() {
    if (!::txtState.isInitialized) return
    val s = session
    val settings = s.settings
    val streaming = s.isStreaming
    val recording = s.isRecording

    // crl-tag tones: accent = on air, warning = reconnecting, neutral = everything else
    val (label, tagBg, tagInk) = when (s.state) {
      LiveSession.State.IDLE -> Triple(
        if (s.prepared) "대기" else s.prepareError ?: "준비 중",
        R.drawable.crl_tag_neutral, R.color.crl_muted,
      )
      LiveSession.State.CONNECTING -> Triple("연결 중…", R.drawable.crl_tag_neutral, R.color.crl_ink_2)
      LiveSession.State.RETRYING -> Triple("재연결 중…", R.drawable.crl_tag_warning, R.color.crl_warning)
      LiveSession.State.LIVE -> Triple(
        "● LIVE  " + formatElapsed(SystemClock.elapsedRealtime() - s.liveSince),
        R.drawable.crl_tag_accent, R.color.crl_accent_ink,
      )
    }
    txtState.text = label
    txtState.setBackgroundResource(tagBg)
    txtState.setTextColor(color(tagInk))

    txtRec.visibility = if (recording) View.VISIBLE else View.GONE
    if (recording) txtRec.text = "● REC  " + formatElapsed(SystemClock.elapsedRealtime() - s.recordSince)

    val stats = s.lastStats
    statBitrate.text = if (streaming && stats != null) {
      String.format(Locale.US, "%.1fM", stats.smoothedBitrate / 1_000_000f)
    } else {
      "-"
    }
    statFps.text = if (streaming) s.encoderFps.toString() else "-"
    statFps.setTextColor(
      color(if (streaming && s.encoderFps in 1 until settings.fps - 5) R.color.crl_warning else R.color.crl_ink),
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
        },
      ),
    )

    val ae = s.lockedRange?.let { " · AE ${it.lower}–${it.upper}" } ?: ""
    val hot = if (phone.thermal >= PowerManager.THERMAL_STATUS_MODERATE) " · ${PhoneStatus.thermalLabel(phone.thermal)}" else ""
    txtVideoMeta.text = "${s.activeResolution.label}${settings.fps} · 목표 ${settings.videoBitrateKbps / 1000.0}M$ae$hot"
    val muted = if (s.isMuted) " · 음소거" else ""
    txtAudioMeta.text = "${s.micLabel} · ${MicMode.labelOf(s.activeMicSource)} · " +
      "${settings.sampleRate / 1000.0}kHz ${settings.audioBitrateKbps}k$muted"

    val free = Recordings.freeBytes()
    val pending = UploadQueue.pendingCount(this)
    txtRecordMeta.text = "저장공간 ${Recordings.gigabytes(free)} · 녹화 가능 " +
      Recordings.remainingLabel(free, settings.recordBytesPerSecond) +
      if (pending > 0) " · 업로드 대기 ${pending}개" else ""
    txtRecordMeta.setTextColor(
      color(if (free < Recordings.START_MIN_FREE_BYTES) R.color.crl_warning else R.color.crl_muted),
    )

    if (streaming) {
      btnGoLive.text = "종료"
      btnGoLive.setBackgroundResource(R.drawable.crl_btn_danger)
      btnGoLive.setTextColor(color(R.color.crl_danger))
    } else {
      btnGoLive.text = "방송 시작"
      btnGoLive.setBackgroundResource(R.drawable.crl_btn_primary)
      btnGoLive.setTextColor(color(R.color.crl_accent_ink))
    }
    if (recording) {
      btnRecord.text = "녹화 중지"
      btnRecord.setBackgroundResource(R.drawable.crl_btn_danger)
      btnRecord.setTextColor(color(R.color.crl_danger))
    } else {
      btnRecord.text = "녹화"
      btnRecord.setBackgroundResource(R.drawable.crl_btn_secondary)
      btnRecord.setTextColor(color(R.color.crl_ink_2))
    }
    btnMute.text = if (s.isMuted) "음소거 해제" else "음소거"
    val busy = s.isActive
    btnSettings.isEnabled = !busy
    btnSettings.alpha = if (busy) DISABLED_ALPHA else 1f
  }

  private fun formatElapsed(ms: Long): String {
    val sec = ms / 1000
    return String.format(Locale.US, "%d:%02d:%02d", sec / 3600, (sec / 60) % 60, sec % 60)
  }

  // ---------------------------------------------------------------- utils

  private fun has(permission: String) =
    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

  private fun hasPermissions() = REQUIRED.all { has(it) }

  private fun color(res: Int): Int = ContextCompat.getColor(this, res)

  private fun toast(message: String) {
    Toast.makeText(applicationContext, message, Toast.LENGTH_SHORT).show()
  }

  companion object {
    private const val DISABLED_ALPHA = 0.45f
    private val REQUIRED = listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)

    /** notification permission only affects showing the "방송 중" notification */
    private val OPTIONAL = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      listOf(Manifest.permission.POST_NOTIFICATIONS)
    } else {
      emptyList()
    }
  }
}
