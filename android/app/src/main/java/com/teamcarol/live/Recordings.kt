package com.teamcarol.live

import android.content.Context
import android.media.MediaScannerConnection
import android.os.Environment
import android.os.StatFs
import android.provider.MediaStore
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Local recordings live in the public Movies/CarolLive folder so they show up in the gallery
 * and can be copied off over USB. Android 11+ lets an app create media files there by path
 * without a storage permission.
 */
object Recordings {
  /** refuse to start below this */
  const val START_MIN_FREE_BYTES = 2L * 1024 * 1024 * 1024

  /** stop the recording (stream keeps going) below this, so the mp4 can still be finalized */
  const val STOP_MIN_FREE_BYTES = 1L * 1024 * 1024 * 1024

  fun folder(): File =
    File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "CarolLive")

  fun newFile(): File {
    val dir = folder().apply { mkdirs() }
    val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
    return File(dir, "carol-live_$stamp.mp4")
  }

  fun freeBytes(): Long = runCatching {
    val dir = folder().apply { mkdirs() }
    StatFs(dir.path).availableBytes
  }.getOrDefault(0L)

  /** "약 1시간 20분" style estimate of how long we can keep recording */
  fun remainingLabel(freeBytes: Long, bytesPerSecond: Long): String {
    if (bytesPerSecond <= 0) return "-"
    val usable = (freeBytes - STOP_MIN_FREE_BYTES).coerceAtLeast(0)
    val minutes = usable / bytesPerSecond / 60
    return if (minutes >= 60) "약 ${minutes / 60}시간 ${minutes % 60}분" else "약 ${minutes}분"
  }

  fun gigabytes(bytes: Long): String = String.format(Locale.US, "%.1fGB", bytes / 1024.0 / 1024.0 / 1024.0)

  /** removes a recording and its gallery entry; false when it is still there */
  @Suppress("DEPRECATION") // DATA is still the way to find our own file's row
  fun delete(context: Context, file: File): Boolean {
    runCatching {
      context.contentResolver.delete(
        MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
        "${MediaStore.MediaColumns.DATA}=?",
        arrayOf(file.absolutePath),
      )
    }
    if (file.exists()) file.delete()
    return !file.exists()
  }

  /** make the finished file visible in the gallery */
  fun publish(context: Context, file: File) {
    MediaScannerConnection.scanFile(context.applicationContext, arrayOf(file.absolutePath), arrayOf("video/mp4"), null)
  }
}
