package com.teamcarol.live

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Checks the latest GitHub release of team-carol/carol-live and reports it when it is newer than
 * this build. Installing is done by the user (browser download + package installer), because
 * the APK comes from outside the Play Store.
 */
object Updates {
  private const val LATEST = "https://api.github.com/repos/team-carol/carol-live/releases/latest"
  private const val PREFS = "carol_live_updates"
  private const val CHECK_EVERY_MS = 6 * 60 * 60 * 1000L

  data class Release(val version: String, val tag: String, val apkUrl: String, val pageUrl: String, val notes: String)

  val currentVersion: String get() = BuildConfig.VERSION_NAME

  private val main = Handler(Looper.getMainLooper())

  /**
   * @param force ignore the 6 h throttle (settings "업데이트 확인")
   * @param done called on the main thread with the newer release, or null when up to date / failed
   */
  fun check(context: Context, force: Boolean, done: (Result<Release?>) -> Unit) {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val now = System.currentTimeMillis()
    if (!force && now - prefs.getLong("lastCheck", 0) < CHECK_EVERY_MS) {
      // reuse the last answer so the button stays visible between checks
      val cached = prefs.getString("latest", null)?.let { runCatching { parse(JSONObject(it)) }.getOrNull() }
      main.post { done(Result.success(cached?.takeIf { isNewer(it.version, currentVersion) })) }
      return
    }
    thread(name = "update-check") {
      val result = runCatching {
        val conn = (URL(LATEST).openConnection() as HttpURLConnection).apply {
          connectTimeout = 10_000
          readTimeout = 10_000
          setRequestProperty("Accept", "application/vnd.github+json")
        }
        try {
          when (conn.responseCode) {
            404 -> null // no release yet
            in 200..299 -> {
              val text = conn.inputStream.bufferedReader().use { it.readText() }
              prefs.edit().putLong("lastCheck", now).putString("latest", text).apply()
              parse(JSONObject(text))?.takeIf { isNewer(it.version, currentVersion) }
            }
            else -> throw IllegalStateException("GitHub ${conn.responseCode}")
          }
        } finally {
          conn.disconnect()
        }
      }
      main.post { done(result) }
    }
  }

  private fun parse(o: JSONObject): Release? {
    val tag = o.optString("tag_name").takeIf { it.isNotEmpty() } ?: return null
    val assets = o.optJSONArray("assets")
    val apk = (0 until (assets?.length() ?: 0))
      .map { assets!!.getJSONObject(it) }
      .firstOrNull { it.optString("name").endsWith(".apk") }
      ?.optString("browser_download_url")
      ?: return null
    return Release(
      version = tag.removePrefix("v"),
      tag = tag,
      apkUrl = apk,
      pageUrl = o.optString("html_url"),
      notes = o.optString("body").take(600),
    )
  }

  /** "0.3.10" > "0.3.9"; anything after '-' (0.4.0-beta) is ignored */
  fun isNewer(candidate: String, current: String): Boolean {
    fun parts(v: String) = v.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
    val a = parts(candidate)
    val b = parts(current)
    for (i in 0 until maxOf(a.size, b.size)) {
      val x = a.getOrElse(i) { 0 }
      val y = b.getOrElse(i) { 0 }
      if (x != y) return x > y
    }
    return false
  }
}
