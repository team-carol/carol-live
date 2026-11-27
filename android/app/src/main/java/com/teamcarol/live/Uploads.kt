package com.teamcarol.live

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

// ============================================================================ pairing / config

/**
 * Connection to the carol-live server. Pairing: the app opens {server}/auth/device in a browser,
 * the user logs in with Discord once, the server redirects to carollive://paired with a device token.
 */
object UploadConfig {
  private const val PREFS = "carol_live_upload"

  /** team carol server; prefilled in settings, can be changed there */
  const val DEFAULT_SERVER = "https://live.team-carol.com"

  data class Paired(val server: String, val token: String, val deviceName: String, val account: String?)

  private fun p(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun paired(ctx: Context): Paired? {
    val p = p(ctx)
    val token = p.getString("token", null) ?: return null
    return Paired(p.getString("server", "")!!, token, p.getString("deviceName", "")!!, p.getString("account", null))
  }

  fun savePaired(ctx: Context, paired: Paired) {
    p(ctx).edit()
      .putString("server", paired.server)
      .putString("token", paired.token)
      .putString("deviceName", paired.deviceName)
      .putString("account", paired.account)
      .remove("nonce")
      .apply()
  }

  fun disconnect(ctx: Context) {
    p(ctx).edit().remove("token").remove("account").apply()
  }

  /** server typed in settings (kept even when not paired); blank falls back to the team server */
  fun draftServer(ctx: Context): String =
    p(ctx).getString("draftServer", null)?.takeIf { it.isNotBlank() }
      ?: paired(ctx)?.server?.takeIf { it.isNotBlank() }
      ?: DEFAULT_SERVER

  fun draftDeviceName(ctx: Context): String =
    p(ctx).getString("draftDeviceName", null) ?: paired(ctx)?.deviceName ?: defaultDeviceName(ctx)

  fun saveDrafts(ctx: Context, server: String, deviceName: String) {
    p(ctx).edit().putString("draftServer", server).putString("draftDeviceName", deviceName).apply()
  }

  /** "로에나의 S25" style name from system settings, else the model */
  fun defaultDeviceName(ctx: Context): String =
    Settings.Global.getString(ctx.contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() } ?: Build.MODEL

  fun autoUpload(ctx: Context): Boolean = p(ctx).getBoolean("autoUpload", true)

  fun allowMobileData(ctx: Context): Boolean = p(ctx).getBoolean("allowMobile", false)

  /** remove the phone copy once the server has the whole file (off by default) */
  fun deleteAfterUpload(ctx: Context): Boolean = p(ctx).getBoolean("deleteAfterUpload", false)

  fun setUploadPrefs(ctx: Context, auto: Boolean, mobile: Boolean, deleteAfter: Boolean) {
    p(ctx).edit()
      .putBoolean("autoUpload", auto)
      .putBoolean("allowMobile", mobile)
      .putBoolean("deleteAfterUpload", deleteAfter)
      .apply()
  }

  /** browser URL that starts pairing; the nonce must come back with the token */
  fun pairingUrl(ctx: Context, server: String, deviceName: String): Uri {
    val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
    val nonce = bytes.joinToString("") { "%02x".format(it) }
    p(ctx).edit().putString("nonce", nonce).apply()
    return Uri.parse(server.trimEnd('/') + "/auth/device").buildUpon()
      .appendQueryParameter("name", deviceName)
      .appendQueryParameter("nonce", nonce)
      .build()
  }

  fun expectedNonce(ctx: Context): String? = p(ctx).getString("nonce", null)
}

// ============================================================================ queue

/** files waiting to be uploaded, with multipart progress so an upload can resume */
object UploadQueue {
  private const val PREFS = "carol_live_uploads"

  data class Item(
    val path: String,
    val name: String,
    val size: Long,
    val recordedAt: Long,
    val durationMs: Long,
    val summary: String,
    /** GameActivity.toAnalysisJson, "" for files recorded before it existed */
    val analysis: String = "",
    var recordingId: String? = null,
    var partSize: Long = 0,
    val parts: MutableMap<Int, String> = mutableMapOf(),
    var failed: String? = null,
  ) {
    fun toJson(): JSONObject = JSONObject()
      .put("path", path).put("name", name).put("size", size).put("recordedAt", recordedAt)
      .put("durationMs", durationMs).put("summary", summary).put("analysis", analysis)
      .put("recordingId", recordingId).put("partSize", partSize).put("failed", failed)
      .put("parts", JSONObject(parts.mapKeys { it.key.toString() }))

    companion object {
      fun fromJson(o: JSONObject): Item {
        val parts = o.optJSONObject("parts")
        return Item(
          path = o.getString("path"),
          name = o.getString("name"),
          size = o.getLong("size"),
          recordedAt = o.getLong("recordedAt"),
          durationMs = o.getLong("durationMs"),
          summary = o.getString("summary"),
          analysis = o.optString("analysis"),
          recordingId = o.optString("recordingId").takeIf { it.isNotEmpty() && it != "null" },
          partSize = o.optLong("partSize"),
          parts = parts?.keys()?.asSequence()?.associate { it.toInt() to parts.getString(it) }?.toMutableMap() ?: mutableMapOf(),
          failed = o.optString("failed").takeIf { it.isNotEmpty() && it != "null" },
        )
      }
    }
  }

  private fun p(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  @Synchronized
  fun all(ctx: Context): List<Item> {
    val arr = JSONArray(p(ctx).getString("queue", "[]"))
    return (0 until arr.length()).map { Item.fromJson(arr.getJSONObject(it)) }
  }

  @Synchronized
  private fun write(ctx: Context, items: List<Item>) {
    p(ctx).edit().putString("queue", JSONArray(items.map { it.toJson() }).toString()).apply()
  }

  @Synchronized
  fun add(ctx: Context, item: Item) {
    write(ctx, all(ctx).filter { it.path != item.path } + item)
  }

  @Synchronized
  fun update(ctx: Context, item: Item) {
    write(ctx, all(ctx).map { if (it.path == item.path) item else it })
  }

  @Synchronized
  fun remove(ctx: Context, path: String) {
    write(ctx, all(ctx).filter { it.path != path })
  }

  /** next item that can be uploaded; drops entries whose file was deleted */
  @Synchronized
  fun next(ctx: Context): Item? {
    val items = all(ctx)
    val alive = items.filter { File(it.path).exists() }
    if (alive.size != items.size) write(ctx, alive)
    return alive.firstOrNull { it.failed == null }
  }

  fun pendingCount(ctx: Context): Int = all(ctx).count { it.failed == null }
}

// ============================================================================ scheduling

object Uploads {
  private const val WORK = "carol-live-upload"

  /** queue every recorded file of a finished session; start uploading if allowed */
  fun onSessionEnded(ctx: Context, summary: LiveSummary) {
    if (summary.files.isEmpty()) return
    val web = summary.toWebJson()
    for (f in summary.files) {
      val file = File(f.path)
      UploadQueue.add(
        ctx,
        UploadQueue.Item(
          path = f.path,
          name = f.name,
          size = file.length(),
          recordedAt = f.startedAt,
          durationMs = f.durationMs,
          summary = web.toString(),
          analysis = f.activity?.let { GameActivity.toAnalysisJson(it).toString() } ?: "",
        ),
      )
    }
    if (UploadConfig.autoUpload(ctx) && UploadConfig.paired(ctx) != null) schedule(ctx)
  }

  fun schedule(ctx: Context) {
    val network = if (UploadConfig.allowMobileData(ctx)) NetworkType.CONNECTED else NetworkType.UNMETERED
    val request = OneTimeWorkRequestBuilder<UploadWorker>()
      .setConstraints(Constraints.Builder().setRequiredNetworkType(network).build())
      // give MediaMuxer a moment to finish writing the last file
      .setInitialDelay(10, TimeUnit.SECONDS)
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
      .build()
    WorkManager.getInstance(ctx).enqueueUniqueWork(WORK, ExistingWorkPolicy.KEEP, request)
  }
}

// ============================================================================ http

class HttpError(val code: Int, message: String) : IOException(message)

internal object Api {
  fun request(paired: UploadConfig.Paired, method: String, path: String, json: JSONObject? = null): JSONObject {
    val conn = open(paired, method, path)
    if (json != null) {
      val body = json.toString().toByteArray()
      conn.doOutput = true
      conn.setRequestProperty("Content-Type", "application/json")
      conn.setFixedLengthStreamingMode(body.size)
      conn.outputStream.use { it.write(body) }
    }
    return read(conn)
  }

  /** streams bytes [from, from+length) of the file as the request body */
  fun putPart(paired: UploadConfig.Paired, path: String, file: File, from: Long, length: Long, onBytes: (Long) -> Unit): JSONObject {
    val conn = open(paired, "PUT", path)
    conn.doOutput = true
    conn.setRequestProperty("Content-Type", "application/octet-stream")
    conn.setFixedLengthStreamingMode(length)
    RandomAccessFile(file, "r").use { raf ->
      raf.seek(from)
      val buf = ByteArray(256 * 1024)
      var left = length
      conn.outputStream.use { out ->
        while (left > 0) {
          val n = raf.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
          if (n < 0) throw IOException("파일이 예상보다 짧음")
          out.write(buf, 0, n)
          left -= n
          onBytes(n.toLong())
        }
      }
    }
    return read(conn)
  }

  fun putBytes(paired: UploadConfig.Paired, path: String, body: ByteArray, type: String): JSONObject {
    val conn = open(paired, "PUT", path)
    conn.doOutput = true
    conn.setRequestProperty("Content-Type", type)
    conn.setFixedLengthStreamingMode(body.size)
    conn.outputStream.use { it.write(body) }
    return read(conn)
  }

  private fun open(paired: UploadConfig.Paired, method: String, path: String): HttpURLConnection =
    (URL(paired.server.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
      requestMethod = method
      connectTimeout = 15_000
      readTimeout = 120_000
      setRequestProperty("Authorization", "Bearer ${paired.token}")
      setRequestProperty("Accept", "application/json")
    }

  private fun read(conn: HttpURLConnection): JSONObject {
    try {
      val code = conn.responseCode
      val stream = if (code in 200..299) conn.inputStream else conn.errorStream
      val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
      if (code !in 200..299) {
        val msg = runCatching { JSONObject(text).optString("error") }.getOrNull()?.takeIf { it.isNotEmpty() } ?: "HTTP $code"
        throw HttpError(code, msg)
      }
      return if (text.isBlank()) JSONObject() else JSONObject(text)
    } finally {
      conn.disconnect()
    }
  }

  fun me(paired: UploadConfig.Paired): JSONObject = request(paired, "GET", "/api/device/me")
}

/** used by PairActivity to confirm the token and read the account name */
fun checkPairing(paired: UploadConfig.Paired): Result<String?> = runCatching {
  Api.me(paired).optJSONObject("user")?.optString("name")
}

// ============================================================================ thumbnails

object Thumbnails {
  /** a 480px-wide JPEG from ~10 s in (or a third of the way for short clips) */
  fun jpeg(file: File, durationMs: Long): ByteArray {
    val r = android.media.MediaMetadataRetriever()
    try {
      r.setDataSource(file.absolutePath)
      val atMs = minOf(10_000L, maxOf(0L, durationMs / 3))
      val frame = r.getScaledFrameAtTime(atMs * 1000, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 480, 480)
        ?: throw IOException("프레임을 못 뽑음")
      val out = java.io.ByteArrayOutputStream()
      frame.compress(android.graphics.Bitmap.CompressFormat.JPEG, 80, out)
      frame.recycle()
      return out.toByteArray()
    } finally {
      r.release()
    }
  }
}

// ============================================================================ worker

class UploadWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

  companion object {
    private const val TAG = "CarolLiveUpload"
    private const val CHANNEL = "upload"
    private const val NOTIFICATION_ID = 2
  }

  private val notifications by lazy {
    applicationContext.getSystemService(NotificationManager::class.java).also {
      it.createNotificationChannel(NotificationChannel(CHANNEL, "녹화 업로드", NotificationManager.IMPORTANCE_LOW))
    }
  }

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    val ctx = applicationContext
    val paired = UploadConfig.paired(ctx) ?: return@withContext Result.failure()
    // long uploads: try to run as a foreground job. Android may refuse when the app is in the
    // background; then we just keep going and resume from the saved parts if the job is cut off.
    runCatching { setForeground(foregroundInfo("업로드 준비 중", 0, 0)) }

    while (!isStopped) {
      val item = UploadQueue.next(ctx) ?: break
      try {
        upload(paired, item)
      } catch (e: HttpError) {
        Log.w(TAG, "upload failed ${e.code}", e)
        when (e.code) {
          401 -> {
            notify("기기 연결이 끊겼음. 앱 설정에서 다시 연결해줘")
            return@withContext Result.failure()
          }
          413 -> {
            item.failed = e.message
            UploadQueue.update(ctx, item)
            notify("${item.name}: ${e.message}")
          }
          else -> return@withContext Result.retry()
        }
      } catch (e: IOException) {
        Log.w(TAG, "upload interrupted", e)
        return@withContext Result.retry()
      }
    }
    notifications.cancel(NOTIFICATION_ID)
    if (isStopped) Result.retry() else Result.success()
  }

  private fun upload(paired: UploadConfig.Paired, item: UploadQueue.Item) {
    val ctx = applicationContext
    val file = File(item.path)
    if (item.recordingId == null) {
      val res = Api.request(
        paired, "POST", "/api/device/uploads",
        JSONObject()
          .put("filename", item.name)
          .put("size", file.length())
          .put("recordedAt", item.recordedAt)
          .put("durationMs", item.durationMs)
          .put("summary", JSONObject(item.summary))
          .apply { if (item.analysis.isNotEmpty()) put("analysis", JSONObject(item.analysis)) },
      )
      item.recordingId = res.getString("id")
      item.partSize = res.getLong("partSize")
      item.parts.clear()
      UploadQueue.update(ctx, item)
      val deleted = res.optJSONArray("deleted")
      if (deleted != null && deleted.length() > 0) notify("저장공간 확보를 위해 오래된 녹화 ${deleted.length()}개가 지워짐")
    }

    val size = file.length()
    val total = ((size + item.partSize - 1) / item.partSize).toInt()
    var sent = item.parts.keys.sumOf { n -> minOf(item.partSize, size - (n - 1) * item.partSize) }
    for (n in 1..total) {
      if (isStopped) throw IOException("stopped")
      if (item.parts.containsKey(n)) continue
      val from = (n - 1) * item.partSize
      val len = minOf(item.partSize, size - from)
      val res = try {
        var lastShown = 0L
        Api.putPart(paired, "/api/device/uploads/${item.recordingId}/parts/$n", file, from, len) { bytes ->
          sent += bytes
          if (sent - lastShown > 8L * 1024 * 1024) {
            lastShown = sent
            progress(item.name, sent, size)
          }
        }
      } catch (e: HttpError) {
        if (e.code == 404) {
          // server dropped the upload (e.g. it went stale): start this file over
          item.recordingId = null
          UploadQueue.update(ctx, item)
          throw IOException("upload restarted")
        }
        throw e
      }
      item.parts[n] = res.getString("etag")
      UploadQueue.update(ctx, item)
    }

    val parts = JSONArray(item.parts.toSortedMap().map { (n, etag) -> JSONObject().put("partNumber", n).put("etag", etag) })
    val done = Api.request(paired, "POST", "/api/device/uploads/${item.recordingId}/complete", JSONObject().put("parts", parts))
    UploadQueue.remove(ctx, item.path)
    // best effort: a frame for the web's file grid
    runCatching { Thumbnails.jpeg(file, item.durationMs) }
      .onSuccess { jpeg -> runCatching { Api.putBytes(paired, "/api/device/recordings/${item.recordingId}/thumbnail", jpeg, "image/jpeg") } }
      .onFailure { Log.w(TAG, "thumbnail failed", it) }
    // only when the server reports the exact byte count we have
    val stored = done.optLong("size", -1)
    val deleted = UploadConfig.deleteAfterUpload(ctx) && stored == file.length() && Recordings.delete(ctx, file)
    if (UploadConfig.deleteAfterUpload(ctx) && !deleted) Log.w(TAG, "kept ${item.name}: server size $stored, local ${file.length()}")
    notify(if (deleted) "${item.name} 업로드 완료 · 폰에서 지움" else "${item.name} 업로드 완료")
  }

  private fun progress(name: String, sent: Long, total: Long) {
    val pct = if (total > 0) (sent * 100 / total).toInt() else 0
    val info = foregroundInfo("$name 업로드 중 $pct%", pct, 100)
    runCatching { setForegroundAsync(info) }.onFailure { notifications.notify(NOTIFICATION_ID, info.notification) }
  }

  private fun notify(text: String) {
    notifications.notify(
      NOTIFICATION_ID + 1,
      NotificationCompat.Builder(applicationContext, CHANNEL)
        .setSmallIcon(R.drawable.ic_stat_live)
        .setColor(ContextCompat.getColor(applicationContext, R.color.crl_accent))
        .setContentTitle("carol live")
        .setContentText(text)
        .setContentIntent(openApp())
        .setAutoCancel(true)
        .build(),
    )
  }

  private fun openApp() = android.app.PendingIntent.getActivity(
    applicationContext, 0,
    Intent(applicationContext, MainActivity::class.java),
    android.app.PendingIntent.FLAG_IMMUTABLE,
  )

  private fun foregroundInfo(text: String, progress: Int, max: Int): ForegroundInfo {
    val n = NotificationCompat.Builder(applicationContext, CHANNEL)
      .setSmallIcon(R.drawable.ic_stat_live)
      .setColor(ContextCompat.getColor(applicationContext, R.color.crl_accent))
      .setContentTitle("녹화 업로드")
      .setContentText(text)
      .setOngoing(true)
      .setSilent(true)
      .setProgress(max, progress, max == 0)
      .setContentIntent(openApp())
      .build()
    notifications.notificationChannels // make sure the channel exists before Android posts this
    return ForegroundInfo(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
  }
}
