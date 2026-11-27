package com.teamcarol.live

import android.content.Context
import android.net.Uri
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.time.LocalDate
import java.util.concurrent.TimeUnit

/**
 * Broadcasts on the YouTube channel that was linked on the web (/youtube), made through the carol-live server:
 * /api/device/youtube/account, /broadcasts and /broadcasts/:id/end. The Google sign-in lives on the server;
 * the app only ever holds its device token.
 *
 * The server answers a new broadcast with the address and stream key to push to. Those are kept in memory for
 * that broadcast ([LiveSession.Broadcast]) and nowhere else: not in preferences, not in logs.
 *
 * The network calls here block; call them off the main thread.
 */
object YouTubeAccount {

  enum class Privacy(val api: String, val label: String) {
    PUBLIC("public", "공개"),
    UNLISTED("unlisted", "일부 공개"),
    PRIVATE("private", "비공개");

    companion object {
      fun of(api: String?): Privacy = entries.firstOrNull { it.api == api } ?: UNLISTED
    }
  }

  /** a starting point made on the web: fills the form, and brings its thumbnail along */
  data class Preset(
    val id: String,
    val name: String,
    val title: String,
    val description: String,
    val privacy: Privacy,
    val hasThumbnail: Boolean,
  )

  data class Account(
    /** false while the server has no Google OAuth client */
    val configured: Boolean,
    /** title of the linked channel, null when none is linked */
    val channel: String?,
    val presets: List<Preset>,
  )

  /** what the form held last time, so it comes back filled */
  data class Draft(
    /** null: never chosen (start from the first preset). "": typed by hand. Else a preset id */
    val presetId: String?,
    val title: String,
    val description: String,
    val privacy: Privacy,
  )

  class Created(
    val broadcast: LiveSession.Broadcast,
    /** something that went wrong without stopping the broadcast (the thumbnail), to tell the user */
    val note: String?,
  )

  fun account(paired: UploadConfig.Paired): Account {
    val o = Api.request(paired, "GET", "/api/device/youtube/account")
    val list = o.optJSONArray("presets")
    val presets = (0 until (list?.length() ?: 0)).mapNotNull { i ->
      val p = list?.optJSONObject(i) ?: return@mapNotNull null
      Preset(
        id = p.optString("id"),
        name = p.optString("name"),
        title = p.optString("title"),
        description = p.optString("description"),
        privacy = Privacy.of(p.optString("privacy")),
        hasThumbnail = p.optBoolean("hasThumbnail"),
      )
    }
    return Account(
      configured = o.optBoolean("configured"),
      channel = o.optJSONObject("channel")?.optString("title")?.takeIf { it.isNotEmpty() },
      presets = presets,
    )
  }

  /** Makes the broadcast. [rtmps] picks the encrypted address of the two the server sends. */
  fun create(
    paired: UploadConfig.Paired,
    title: String,
    description: String,
    privacy: Privacy,
    presetId: String?,
    rtmps: Boolean,
  ): Created {
    val body = JSONObject()
      .put("title", title)
      .put("description", description)
      .put("privacy", privacy.api)
    if (presetId != null) body.put("presetId", presetId)
    val o = Api.request(paired, "POST", "/api/device/youtube/broadcasts", body)
    val address = o.optString(if (rtmps) "rtmpsUrl" else "rtmpUrl").ifEmpty { o.optString("rtmpUrl") }
    val key = o.optString("key")
    val id = o.optString("id")
    if (id.isEmpty() || address.isEmpty() || key.isEmpty()) throw IOException("서버 응답에 송출 주소가 없습니다")
    return Created(
      LiveSession.Broadcast(
        id = id,
        endpoint = address.trimEnd('/') + "/" + key,
        liveChatId = o.optString("liveChatId").ifEmpty { null },
        watchUrl = o.optString("watchUrl"),
        title = title,
      ),
      note = if (o.optString("thumbnail") == "failed") {
        "썸네일은 올리지 못했습니다: " + o.optString("thumbnailMessage").ifEmpty { "알 수 없는 이유" }
      } else {
        null
      },
    )
  }

  /** the sentence to show for a failed call */
  fun message(e: Throwable): String {
    val http = e as? HttpError
    return http?.detail ?: when {
      http?.code == 401 -> "서버 연결이 해제됐습니다. 설정 → 업로드에서 다시 연결해 주세요"
      http?.code == 404 -> "서버가 유튜브 계정 방송을 아직 지원하지 않습니다"
      http != null -> "서버가 요청을 받지 못했습니다 (${http.message})"
      e is IOException -> "서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요"
      else -> e.message ?: "알 수 없는 오류입니다"
    }
  }

  /** "{date}" in a preset's title becomes today's date, like 2026-11-28 */
  fun fillDate(title: String): String = title.replace("{date}", LocalDate.now().toString())

  // ---------------------------------------------------------------- the form's last values

  private const val PREFS = "carol_live_youtube"

  fun draft(ctx: Context): Draft {
    val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return Draft(
      presetId = p.getString("presetId", null),
      title = p.getString("title", null) ?: "",
      description = p.getString("description", null) ?: "",
      privacy = Privacy.of(p.getString("privacy", null)),
    )
  }

  /** [typed] values are only remembered for the hand-typed form; a preset is re-read from the server each time */
  fun saveDraft(ctx: Context, presetId: String?, typed: Draft?) {
    val e = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("presetId", presetId ?: "")
    if (typed != null) {
      e.putString("title", typed.title).putString("description", typed.description).putString("privacy", typed.privacy.api)
    }
    e.apply()
  }

  // ---------------------------------------------------------------- ending

  /**
   * Ends the broadcast on YouTube once there is a network: it does not end by itself when the stream stops
   * (so a reconnect keeps the same broadcast). Runs as a job, so it also happens when the stream was given up
   * for lack of network, or the app is closed right after stopping.
   */
  fun endLater(ctx: Context, broadcastId: String) {
    val request = OneTimeWorkRequestBuilder<EndBroadcastWorker>()
      .setInputData(Data.Builder().putString(EndBroadcastWorker.KEY_ID, broadcastId).build())
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      // let the last seconds that were sent arrive first
      .setInitialDelay(5, TimeUnit.SECONDS)
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
      .build()
    WorkManager.getInstance(ctx).enqueueUniqueWork("carol-live-end-$broadcastId", ExistingWorkPolicy.KEEP, request)
  }
}

/** POST /api/device/youtube/broadcasts/:id/end, retried while the network or the server is not there */
class EndBroadcastWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

  companion object {
    const val KEY_ID = "broadcastId"
    private const val MAX_TRIES = 8
  }

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    val id = inputData.getString(KEY_ID) ?: return@withContext Result.failure()
    val paired = UploadConfig.paired(applicationContext) ?: return@withContext Result.failure()
    try {
      Api.request(paired, "POST", "/api/device/youtube/broadcasts/${Uri.encode(id)}/end", JSONObject())
      Result.success()
    } catch (e: HttpError) {
      // a server or YouTube hiccup may pass; any other answer stays the same however often it is asked
      if ((e.code >= 500 || e.code == 429) && runAttemptCount < MAX_TRIES) Result.retry() else Result.failure()
    } catch (e: IOException) {
      if (runAttemptCount < MAX_TRIES) Result.retry() else Result.failure()
    }
  }
}
