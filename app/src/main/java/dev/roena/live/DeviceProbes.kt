package dev.roena.live

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.BatteryManager
import android.os.PowerManager
import android.util.Range
import android.util.Size

/** Read-only facts about the back camera that Camera2Source opens (first LENS_FACING_BACK id). */
class BackCameraInfo(context: Context) {
  private val manager = context.getSystemService(CameraManager::class.java)

  val id: String? = runCatching {
    manager.cameraIdList.firstOrNull {
      manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) ==
        CameraCharacteristics.LENS_FACING_BACK
    }
  }.getOrNull()

  private val chars: CameraCharacteristics? = id?.let { runCatching { manager.getCameraCharacteristics(it) }.getOrNull() }

  val fpsRanges: List<Range<Int>> =
    chars?.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)?.toList().orEmpty()

  val exposureRange: Range<Int>? = chars?.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE)

  val exposureStep: Float = chars?.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_STEP)?.toFloat() ?: (1f / 3f)

  fun supportsSize(width: Int, height: Int): Boolean {
    val map = chars?.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return true
    val sizes = map.getOutputSizes(SurfaceTexture::class.java) ?: return true
    return sizes.any { it.width == width && it.height == height }
  }

  fun maxFpsFor(width: Int, height: Int): Int {
    val map = chars?.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return 30
    val minFrameNs = runCatching {
      map.getOutputMinFrameDuration(SurfaceTexture::class.java, Size(width, height))
    }.getOrDefault(0L)
    val sensorMax = if (minFrameNs > 0) (1_000_000_000.0 / minFrameNs).toInt() else 30
    val aeMax = fpsRanges.maxOfOrNull { it.upper } ?: sensorMax
    return minOf(sensorMax, aeMax)
  }

  /** [fps, fps] if the camera offers it, otherwise the range ending at fps with the highest floor. */
  fun lockedRangeFor(fps: Int): Range<Int>? =
    fpsRanges.firstOrNull { it.lower == fps && it.upper == fps }
      ?: fpsRanges.filter { it.upper == fps }.maxByOrNull { it.lower }
}

object AudioInputs {
  private val USB_TYPES = setOf(
    AudioDeviceInfo.TYPE_USB_DEVICE,
    AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_USB_ACCESSORY,
  )

  fun isUsb(device: AudioDeviceInfo): Boolean = device.type in USB_TYPES

  fun all(context: Context): List<AudioDeviceInfo> =
    context.getSystemService(AudioManager::class.java)
      .getDevices(AudioManager.GET_DEVICES_INPUTS).toList()

  fun findUsb(context: Context): AudioDeviceInfo? = all(context).firstOrNull { isUsb(it) }

  fun describe(device: AudioDeviceInfo): String {
    val type = when {
      isUsb(device) -> "USB"
      device.type == AudioDeviceInfo.TYPE_BUILTIN_MIC -> "내장"
      device.type == AudioDeviceInfo.TYPE_WIRED_HEADSET -> "유선"
      device.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "블루투스"
      else -> "기타"
    }
    val name = device.productName?.toString()?.takeIf { it.isNotBlank() }
    return if (name != null) "$type ($name)" else type
  }

  fun supportsUnprocessed(context: Context): Boolean =
    context.getSystemService(AudioManager::class.java)
      .getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true"
}

object PhoneStatus {
  data class Snapshot(val batteryPct: Int, val charging: Boolean, val tempC: Float, val thermal: Int)

  fun read(context: Context): Snapshot {
    // sticky system broadcast: passing a null receiver just returns the last value
    val battery: Intent? = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
    val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
    val tenths = battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0
    val thermal = context.getSystemService(PowerManager::class.java).currentThermalStatus
    return Snapshot(
      batteryPct = if (level >= 0 && scale > 0) level * 100 / scale else -1,
      charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL,
      tempC = tenths / 10f,
      thermal = thermal,
    )
  }

  fun thermalLabel(status: Int): String = when (status) {
    PowerManager.THERMAL_STATUS_NONE -> "발열 정상"
    PowerManager.THERMAL_STATUS_LIGHT -> "발열 약간"
    PowerManager.THERMAL_STATUS_MODERATE -> "발열 높음"
    PowerManager.THERMAL_STATUS_SEVERE -> "과열"
    else -> "과열 위험"
  }
}
