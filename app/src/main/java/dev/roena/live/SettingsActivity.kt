package dev.roena.live

import android.os.Bundle
import android.text.InputType
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.RadioGroup
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat

class SettingsActivity : AppCompatActivity() {

  private lateinit var etServer: EditText
  private lateinit var etKey: EditText
  private lateinit var etVideoBitrate: EditText
  private lateinit var txtBitrateHint: TextView
  private lateinit var txtCameraInfo: TextView
  private lateinit var rgResolution: RadioGroup
  private lateinit var rgFps: RadioGroup
  private lateinit var rgOrientation: RadioGroup
  private lateinit var rgAudioBitrate: RadioGroup
  private lateinit var rgSampleRate: RadioGroup
  private lateinit var rgMicMode: RadioGroup
  private lateinit var swLockFps: SwitchCompat
  private lateinit var swStereo: SwitchCompat
  private lateinit var swPreferUsb: SwitchCompat

  private val cameraInfo by lazy { BackCameraInfo(this) }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_settings)

    etServer = findViewById(R.id.et_server)
    etKey = findViewById(R.id.et_key)
    etVideoBitrate = findViewById(R.id.et_video_bitrate)
    txtBitrateHint = findViewById(R.id.txt_bitrate_hint)
    txtCameraInfo = findViewById(R.id.txt_camera_info)
    rgResolution = findViewById(R.id.rg_resolution)
    rgFps = findViewById(R.id.rg_fps)
    rgOrientation = findViewById(R.id.rg_orientation)
    rgAudioBitrate = findViewById(R.id.rg_audio_bitrate)
    rgSampleRate = findViewById(R.id.rg_sample_rate)
    rgMicMode = findViewById(R.id.rg_mic_mode)
    swLockFps = findViewById(R.id.sw_lock_fps)
    swStereo = findViewById(R.id.sw_stereo)
    swPreferUsb = findViewById(R.id.sw_prefer_usb)

    fill(SettingsStore.load(this))

    findViewById<CheckBox>(R.id.cb_show_key).setOnCheckedChangeListener { _, show ->
      etKey.inputType = InputType.TYPE_CLASS_TEXT or
        if (show) InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD else InputType.TYPE_TEXT_VARIATION_PASSWORD
      etKey.setSelection(etKey.text.length)
    }
    rgResolution.setOnCheckedChangeListener { _, _ -> refreshHints() }
    rgFps.setOnCheckedChangeListener { _, _ -> refreshHints() }
    findViewById<Button>(R.id.btn_close).setOnClickListener { finish() }
    findViewById<Button>(R.id.btn_save).setOnClickListener { save() }

    txtCameraInfo.text = cameraSummary()
    txtInputsText()
  }

  private fun fill(s: StreamSettings) {
    etServer.setText(s.serverUrl)
    etKey.setText(s.streamKey)
    etVideoBitrate.setText(s.videoBitrateKbps.toString())
    rgResolution.check(if (s.resolution == Resolution.FHD) R.id.res_1080 else R.id.res_720)
    rgFps.check(if (s.fps >= 60) R.id.fps_60 else R.id.fps_30)
    rgOrientation.check(if (s.orientation == StreamOrientation.PORTRAIT) R.id.orient_port else R.id.orient_land)
    rgAudioBitrate.check(
      when (s.audioBitrateKbps) {
        128 -> R.id.ab_128
        192 -> R.id.ab_192
        else -> R.id.ab_160
      }
    )
    rgSampleRate.check(if (s.sampleRate == 44100) R.id.sr_44 else R.id.sr_48)
    rgMicMode.check(
      when (s.micMode) {
        MicMode.UNPROCESSED -> R.id.mic_unprocessed
        MicMode.CAMCORDER -> R.id.mic_camcorder
        MicMode.DEFAULT -> R.id.mic_default
      }
    )
    swLockFps.isChecked = s.lockFps
    swStereo.isChecked = s.stereo
    swPreferUsb.isChecked = s.preferUsbMic
    refreshHints()
  }

  private fun selectedResolution() =
    if (rgResolution.checkedRadioButtonId == R.id.res_720) Resolution.HD else Resolution.FHD

  private fun selectedFps() = if (rgFps.checkedRadioButtonId == R.id.fps_30) 30 else 60

  private fun refreshHints() {
    val res = selectedResolution()
    val fps = selectedFps()
    val rec = StreamSettings.recommendedVideoKbps(res, fps)
    txtBitrateHint.text = "권장 $rec · 오락실 업로드 속도의 60~70% 이하로 (1000~20000)"
  }

  private fun cameraSummary(): String {
    val fhd = cameraInfo.maxFpsFor(1920, 1080)
    val hd = cameraInfo.maxFpsFor(1280, 720)
    val lock60 = cameraInfo.lockedRangeFor(60)?.let { "${it.lower}–${it.upper}" } ?: "지원 안 함"
    return "후면 카메라: 1080p 최대 ${fhd}fps · 720p 최대 ${hd}fps · 60fps 고정 범위 $lock60"
  }

  private fun txtInputsText() {
    val unprocessed = if (AudioInputs.supportsUnprocessed(this)) "원음 모드 지원" else "원음 모드 미지원(자동 대체)"
    val inputs = AudioInputs.all(this).map { AudioInputs.describe(it) }.distinct()
    val list = if (inputs.isEmpty()) "없음" else inputs.joinToString("\n")
    findViewById<TextView>(R.id.txt_inputs).text = "$list\n$unprocessed"
  }

  private fun save() {
    val server = etServer.text.toString().trim()
    if (!server.startsWith("rtmp://") && !server.startsWith("rtmps://")) {
      etServer.error = "rtmp:// 또는 rtmps:// 로 시작해야 함"
      etServer.requestFocus()
      return
    }
    val kbps = etVideoBitrate.text.toString().trim().toIntOrNull()
    if (kbps == null || kbps !in 1000..20000) {
      etVideoBitrate.error = "1000~20000 사이로 넣어줘"
      etVideoBitrate.requestFocus()
      return
    }

    val settings = StreamSettings(
      serverUrl = server,
      streamKey = etKey.text.toString().trim(),
      resolution = selectedResolution(),
      fps = selectedFps(),
      videoBitrateKbps = kbps,
      audioBitrateKbps = when (rgAudioBitrate.checkedRadioButtonId) {
        R.id.ab_128 -> 128
        R.id.ab_192 -> 192
        else -> 160
      },
      sampleRate = if (rgSampleRate.checkedRadioButtonId == R.id.sr_44) 44100 else 48000,
      stereo = swStereo.isChecked,
      micMode = when (rgMicMode.checkedRadioButtonId) {
        R.id.mic_camcorder -> MicMode.CAMCORDER
        R.id.mic_default -> MicMode.DEFAULT
        else -> MicMode.UNPROCESSED
      },
      preferUsbMic = swPreferUsb.isChecked,
      orientation = if (rgOrientation.checkedRadioButtonId == R.id.orient_port) {
        StreamOrientation.PORTRAIT
      } else {
        StreamOrientation.LANDSCAPE
      },
      lockFps = swLockFps.isChecked,
    )
    SettingsStore.save(this, settings)
    setResult(RESULT_OK)
    finish()
  }
}
