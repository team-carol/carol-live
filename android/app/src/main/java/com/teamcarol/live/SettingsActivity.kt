package com.teamcarol.live

import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.RadioGroup
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.core.content.ContextCompat

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
  private lateinit var swAutoRecord: SwitchCompat
  private lateinit var rgRecordQuality: RadioGroup
  private lateinit var txtRecordHint: TextView

  private lateinit var upServer: EditText
  private lateinit var upDevice: EditText
  private lateinit var upTag: TextView
  private lateinit var upStatus: TextView
  private lateinit var upPair: Button
  private lateinit var upUnpair: Button
  private lateinit var upAuto: SwitchCompat
  private lateinit var upMobile: SwitchCompat

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
    swAutoRecord = findViewById(R.id.sw_auto_record)
    rgRecordQuality = findViewById(R.id.rg_record_quality)
    txtRecordHint = findViewById(R.id.txt_record_hint)

    upServer = findViewById(R.id.up_server)
    upDevice = findViewById(R.id.up_device)
    upTag = findViewById(R.id.up_tag)
    upStatus = findViewById(R.id.up_status)
    upPair = findViewById(R.id.up_pair)
    upUnpair = findViewById(R.id.up_unpair)
    upAuto = findViewById(R.id.up_auto)
    upMobile = findViewById(R.id.up_mobile)

    fill(SettingsStore.load(this))
    upServer.setText(UploadConfig.draftServer(this))
    upDevice.setText(UploadConfig.draftDeviceName(this))
    upAuto.isChecked = UploadConfig.autoUpload(this)
    upMobile.isChecked = UploadConfig.allowMobileData(this)
    upAuto.setOnCheckedChangeListener { _, _ -> saveUploadPrefs() }
    upMobile.setOnCheckedChangeListener { _, _ -> saveUploadPrefs() }
    upPair.setOnClickListener { startPairing() }
    findViewById<TextView>(R.id.txt_version).text = "현재 버전 v${Updates.currentVersion}"
    findViewById<Button>(R.id.btn_check_update).setOnClickListener { button ->
      button.isEnabled = false
      Updates.check(this, force = true) { result ->
        button.isEnabled = true
        result
          .onSuccess { release ->
            if (release != null) UpdateDialog.show(this, release)
            else android.widget.Toast.makeText(this, "최신 버전임", android.widget.Toast.LENGTH_SHORT).show()
          }
          .onFailure {
            android.widget.Toast.makeText(this, "확인 실패: ${it.message}", android.widget.Toast.LENGTH_SHORT).show()
          }
      }
    }
    upUnpair.setOnClickListener {
      UploadConfig.disconnect(this)
      renderUpload()
    }

    findViewById<CheckBox>(R.id.cb_show_key).setOnCheckedChangeListener { _, show ->
      etKey.inputType = InputType.TYPE_CLASS_TEXT or
        if (show) InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD else InputType.TYPE_TEXT_VARIATION_PASSWORD
      etKey.setSelection(etKey.text.length)
    }
    rgResolution.setOnCheckedChangeListener { _, _ -> refreshHints() }
    rgFps.setOnCheckedChangeListener { _, _ -> refreshHints() }
    rgRecordQuality.setOnCheckedChangeListener { _, _ -> refreshHints() }
    findViewById<Button>(R.id.btn_close).setOnClickListener { finish() }
    findViewById<Button>(R.id.btn_save).setOnClickListener { save() }

    txtCameraInfo.text = cameraSummary()
    findViewById<TextView>(R.id.txt_storage).text =
      "남은 저장공간 ${Recordings.gigabytes(Recordings.freeBytes())} · 저장 위치 Movies/CarolLive"
    txtInputsText()
  }

  override fun onResume() {
    super.onResume()
    renderUpload()
  }

  private fun renderUpload() {
    val paired = UploadConfig.paired(this)
    val pending = UploadQueue.pendingCount(this)
    if (paired != null) {
      upTag.text = "연결됨"
      upTag.setBackgroundResource(R.drawable.crl_tag_success)
      upTag.setTextColor(ContextCompat.getColor(this, R.color.crl_success))
      upStatus.text = buildString {
        append("'${paired.deviceName}' 폴더로 올라감")
        paired.account?.let { append(" · $it 계정") }
        if (pending > 0) append(" · 대기 ${pending}개")
      }
      upPair.text = "다시 연결"
      upUnpair.visibility = android.view.View.VISIBLE
    } else {
      upTag.text = "연결 안 됨"
      upTag.setBackgroundResource(R.drawable.crl_tag_neutral)
      upTag.setTextColor(ContextCompat.getColor(this, R.color.crl_muted))
      upStatus.text = if (pending > 0) "업로드 대기 ${pending}개 · 연결하면 올라감" else "녹화를 웹에서 보고 자르려면 서버에 연결해줘"
      upPair.text = "연결하기"
      upUnpair.visibility = android.view.View.GONE
    }
  }

  private fun saveUploadPrefs() {
    UploadConfig.setUploadPrefs(this, upAuto.isChecked, upMobile.isChecked)
  }

  private fun startPairing() {
    val server = upServer.text.toString().trim().trimEnd('/')
    val name = upDevice.text.toString().trim()
    if (!server.startsWith("https://") && !server.startsWith("http://")) {
      upServer.error = "https:// 로 시작하는 주소"
      upServer.requestFocus()
      return
    }
    if (name.isEmpty()) {
      upDevice.error = "기기 이름을 적어줘"
      upDevice.requestFocus()
      return
    }
    UploadConfig.saveDrafts(this, server, name)
    saveUploadPrefs()
    startActivity(Intent(Intent.ACTION_VIEW, UploadConfig.pairingUrl(this, server, name)))
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
    swAutoRecord.isChecked = s.autoRecord
    rgRecordQuality.check(if (s.recordBitrateKbps > 0) R.id.rq_high else R.id.rq_same)
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

    val streamKbps = etVideoBitrate.text.toString().trim().toIntOrNull() ?: rec
    val high = rgRecordQuality.checkedRadioButtonId == R.id.rq_high
    val recordKbps = if (high) HIGH_RECORD_KBPS else streamKbps
    val gbPerHour = recordKbps * 3600.0 / 8 / 1024 / 1024
    txtRecordHint.text = String.format(
      java.util.Locale.US,
      "1시간에 약 %.1fGB%s",
      gbPerHour,
      if (high) " · 인코더를 하나 더 써서 발열이 늘어남" else " · 송출 영상을 그대로 저장",
    )
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
      autoRecord = swAutoRecord.isChecked,
      recordBitrateKbps = if (rgRecordQuality.checkedRadioButtonId == R.id.rq_high) HIGH_RECORD_KBPS else 0,
    )
    SettingsStore.save(this, settings)
    UploadConfig.saveDrafts(this, upServer.text.toString().trim().trimEnd('/'), upDevice.text.toString().trim())
    saveUploadPrefs()
    setResult(RESULT_OK)
    finish()
  }

  companion object {
    private const val HIGH_RECORD_KBPS = 20000
  }
}
