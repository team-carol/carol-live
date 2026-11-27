package com.teamcarol.live

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.TextUtils
import android.text.TextPaint
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.content.res.ResourcesCompat
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.text.Normalizer
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * Experimental: finds out which song is being played while a session runs, by reading the title off the
 * cabinet's upper monitor in the picture that is being streamed.
 *
 * Every few seconds one frame is taken from the stream ([LiveSession.grabFrame]), the text in its upper
 * part is recognized on this phone (ML Kit, Japanese model: kana, kanji and Latin) and each line is compared
 * with the list of song titles. A title counts once two reads in a row agree. Reading is rare and off the
 * main thread, so it costs little next to encoding; taking the frame copies it out of the GPU once per read.
 *
 * Everything here is wrapped so that a failure only turns the readout off: the stream must not care.
 * Driven from the main thread by [LiveSession] once a second ([tick]).
 */
object SongSpotter {

  enum class Status { OFF, LOADING_TITLES, NO_TITLES, WATCHING }

  /** a song that was recognized, with how far into the session */
  data class Found(val atMs: Long, val title: String)

  private const val TAG = "CarolSong"
  /** song titles as the aliases of team carol's maimai bot list them ({ aliases: [{ title, alias, … }] }) */
  private const val TITLES_URL = "https://maimai.team-carol.com/api/aliases"
  private const val TITLES_FILE = "song_titles.txt"
  private const val TITLES_MAX_AGE_MS = 24 * 60 * 60 * 1000L

  /** between reads while looking for a song / once one is known */
  private const val SEARCH_INTERVAL_MS = 3_000L
  private const val KNOWN_INTERVAL_MS = 6_000L
  /** a read that never comes back (no frames) is given up after this long */
  private const val READ_TIMEOUT_MS = 10_000L
  /** this many reads in a row without the title and the song is over */
  private const val MISSES_TO_CLEAR = 5

  private val ui = Handler(Looper.getMainLooper())
  private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "song-spotter").apply { isDaemon = true } }
  private var recognizer: TextRecognizer? = null

  var status = Status.OFF
    private set

  /** the song on screen now */
  var title: String? = null
    private set

  /** what the last read made of the picture, shown on the phone while this is an experiment */
  var lastRead: String? = null
    private set

  private val found = ArrayList<Found>()
  /** songs of the running session, or of the last one once it has ended */
  val history: List<Found> get() = found

  @Volatile private var titles: TitleIndex? = null
  private var loading = false
  private var startedAt = 0L
  private var nextReadAt = 0L
  private var readSince = 0L
  private var pending: String? = null
  private var misses = 0
  private var overlayFor: String? = null

  // ------------------------------------------------------------------ lifecycle (main thread)

  /** [active]: a stream or recording is running. Turns itself on and off with the setting and the session. */
  fun tick(context: Context, settings: StreamSettings, active: Boolean) {
    val app = context.applicationContext
    if (!settings.songSpotting || !active) {
      if (status != Status.OFF) stop()
      return
    }
    try {
      if (status == Status.OFF) start(app)
      val index = titles
      if (index == null) {
        if (!loading) status = Status.NO_TITLES
        return
      }
      status = Status.WATCHING
      syncOverlay(app, settings)
      val now = SystemClock.elapsedRealtime()
      if (readSince != 0L) {
        if (now - readSince < READ_TIMEOUT_MS) return
        readSince = 0L
      }
      if (now < nextReadAt) return
      nextReadAt = now + if (title == null) SEARCH_INTERVAL_MS else KNOWN_INTERVAL_MS
      readSince = now
      val asked = LiveSession.grabFrame { frame -> worker.execute { read(frame, index) } }
      if (!asked) readSince = 0L
    } catch (e: Exception) {
      Log.w(TAG, "tick failed", e)
    }
  }

  private fun start(app: Context) {
    found.clear()
    title = null
    pending = null
    lastRead = null
    misses = 0
    readSince = 0L
    nextReadAt = 0L
    startedAt = SystemClock.elapsedRealtime()
    status = Status.LOADING_TITLES
    if (recognizer == null) recognizer = TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
    if (titles == null && !loading) {
      loading = true
      worker.execute {
        val loaded = runCatching { loadTitles(app) }.onFailure { Log.w(TAG, "titles failed", it) }.getOrNull()
        ui.post {
          loading = false
          if (loaded != null && loaded.size > 0) titles = loaded
        }
      }
    }
  }

  private fun stop() {
    status = Status.OFF
    title = null
    pending = null
    lastRead = null
    readSince = 0L
    overlayFor = null
    runCatching { LiveSession.setSongOverlay(null, 0f, 0f, 0f, 0f) }
  }

  // ------------------------------------------------------------------ one read (worker thread)

  private fun read(frame: Bitmap, index: TitleIndex) {
    var lines = 0
    var match: Match? = null
    var region: Bitmap? = null
    try {
      // the upper monitor is in the upper part of the picture; the lower part is also where our own overlay goes
      val part = if (frame.height > frame.width) 0.45f else 0.75f
      region = Bitmap.createBitmap(frame, 0, 0, frame.width, (frame.height * part).toInt())
      val client = recognizer ?: return
      val text = Tasks.await(client.process(InputImage.fromBitmap(region, 0)), 6, TimeUnit.SECONDS)
      val read = text.textBlocks.flatMap { block -> block.lines.map { it.text } }
      lines = read.size
      match = index.best(read)
    } catch (e: Exception) {
      Log.w(TAG, "read failed", e)
    } finally {
      region?.recycle()
      frame.recycle()
      val seen = lines
      val result = match
      ui.post { onRead(seen, result) }
    }
  }

  private fun onRead(lines: Int, match: Match?) {
    readSince = 0L
    if (status == Status.OFF) return
    lastRead = when {
      match == null -> "글자 ${lines}줄 · 곡명 없음"
      else -> "글자 ${lines}줄 · \"${match.line.take(24)}\" → ${match.title.take(24)} ${(match.score * 100).toInt()}%" +
        if (match.accepted) "" else " (불확실)"
    }
    val hit = match?.takeIf { it.accepted }?.title
    if (hit == null) {
      pending = null
      if (++misses >= MISSES_TO_CLEAR) title = null
      return
    }
    misses = 0
    if (hit == title) {
      pending = null
      return
    }
    if (hit != pending) {
      // wait for a second read to agree, and ask for it soon
      pending = hit
      nextReadAt = SystemClock.elapsedRealtime() + 1_500L
      return
    }
    pending = null
    title = hit
    if (found.lastOrNull()?.title != hit) found.add(Found(SystemClock.elapsedRealtime() - startedAt, hit))
  }

  // ------------------------------------------------------------------ overlay on the stream

  private fun syncOverlay(app: Context, settings: StreamSettings) {
    val wanted = if (settings.songOverlay) title else null
    if (wanted == overlayFor) return
    overlayFor = wanted
    if (wanted == null) {
      LiveSession.setSongOverlay(null, 0f, 0f, 0f, 0f)
      return
    }
    val frameW = LiveSession.frameWidth
    val frameH = LiveSession.frameHeight
    if (frameW <= 0 || frameH <= 0) return
    val card = renderCard(app, wanted, frameW)
    val w = card.width * 100f / frameW
    val h = card.height * 100f / frameH
    // bottom-left, clear of the part of the picture that is read
    LiveSession.setSongOverlay(card, 3f, 100f - h - 4f, w, h)
  }

  /** the title on a dark rounded plate with an accent bar, sized for a frame [frameW] wide */
  private fun renderCard(app: Context, text: String, frameW: Int): Bitmap {
    val size = frameW * 0.036f
    val pad = frameW * 0.02f
    val bar = frameW * 0.008f
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      textSize = size
      color = ContextCompat.getColor(app, R.color.crl_ink)
      typeface = runCatching { ResourcesCompat.getFont(app, R.font.pretendard_bold) }.getOrNull()
    }
    val shown = TextUtils.ellipsize(text, paint, frameW * 0.72f, TextUtils.TruncateAt.END).toString()
    val width = (bar + pad * 2 + paint.measureText(shown)).toInt().coerceAtLeast(1)
    val height = (size * 1.9f).toInt().coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val radius = height * 0.22f
    val plate = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = ContextCompat.getColor(app, R.color.crl_canvas)
      alpha = 225
    }
    canvas.drawRoundRect(RectF(0f, 0f, width.toFloat(), height.toFloat()), radius, radius, plate)
    plate.color = ContextCompat.getColor(app, R.color.crl_accent)
    canvas.drawRoundRect(RectF(pad * 0.5f, height * 0.24f, pad * 0.5f + bar, height * 0.76f), bar / 2, bar / 2, plate)
    val metrics = paint.fontMetrics
    canvas.drawText(shown, bar + pad * 1.2f, height / 2f - (metrics.ascent + metrics.descent) / 2f, paint)
    return bitmap
  }

  // ------------------------------------------------------------------ what the phone shows

  /** one or two lines for the live screen, null when the experiment is off */
  fun describe(): String? = when (status) {
    Status.OFF -> null
    Status.LOADING_TITLES -> "곡 인식 · 곡 목록을 받는 중입니다"
    Status.NO_TITLES -> "곡 인식 · 곡 목록을 받지 못했습니다 (인터넷 연결 확인)"
    Status.WATCHING -> "곡 인식 · " + (title ?: "찾는 중") + (lastRead?.let { "\n$it" } ?: "")
  }

  // ------------------------------------------------------------------ song titles (worker thread)

  private fun loadTitles(app: Context): TitleIndex? {
    val file = File(app.filesDir, TITLES_FILE)
    val fresh = file.exists() && System.currentTimeMillis() - file.lastModified() < TITLES_MAX_AGE_MS
    if (!fresh) {
      runCatching {
        val connection = (URL(TITLES_URL).openConnection() as HttpURLConnection).apply {
          connectTimeout = 10_000
          readTimeout = 20_000
        }
        try {
          if (connection.responseCode != 200) error("HTTP ${connection.responseCode}")
          val body = connection.inputStream.bufferedReader().use { it.readText() }
          val aliases = JSONObject(body).getJSONArray("aliases")
          val set = LinkedHashSet<String>()
          for (i in 0 until aliases.length()) {
            val t = aliases.getJSONObject(i).optString("title").replace('\n', ' ').trim()
            if (t.isNotEmpty()) set.add(t)
          }
          if (set.size < 100) error("only ${set.size} titles")
          file.writeText(set.joinToString("\n"))
        } finally {
          connection.disconnect()
        }
      }.onFailure { Log.w(TAG, "could not refresh titles", it) }
    }
    // an older copy is better than nothing when the phone is offline
    if (!file.exists()) return null
    return TitleIndex(file.readLines().filter { it.isNotBlank() })
  }

  // ------------------------------------------------------------------ matching

  class Match(val line: String, val title: String, val score: Float, val accepted: Boolean)

  /** song titles prepared for comparing with what was read */
  class TitleIndex(titles: List<String>) {
    private class Entry(val title: String, val key: String)

    private val entries: List<Entry> = titles.map { Entry(it, normalize(it)) }.filter { it.key.isNotEmpty() }.distinctBy { it.key }
    val size: Int get() = entries.size

    /** the line that looks most like a title, and whether that is sure enough to believe */
    fun best(lines: List<String>): Match? {
      var top: Match? = null
      for (line in lines) {
        val key = normalize(line)
        if (key.isEmpty() || isScreenWord(key)) continue
        var first: Entry? = null
        var firstScore = 0f
        var secondScore = 0f
        for (e in entries) {
          val s = score(key, e.key)
          if (s > firstScore) {
            secondScore = firstScore
            firstScore = s
            first = e
          } else if (s > secondScore) secondScore = s
        }
        val hit = first ?: continue
        val lead = firstScore - secondScore
        val accepted = when {
          // one or two characters ("竹", "39"): only when read exactly
          key.length < 3 -> firstScore >= 0.999f && key.length == hit.key.length
          firstScore >= 0.97f -> true
          firstScore >= 0.80f -> lead >= 0.05f
          firstScore >= 0.62f -> key.length >= 5 && lead >= 0.12f
          else -> false
        }
        val better = top == null || (accepted && !top.accepted) || (accepted == top.accepted && firstScore > top.score)
        if (better) top = Match(line, hit.title, firstScore, accepted)
      }
      return top
    }

    /**
     * How alike a read line and a title are, 0..1. Long titles scroll through the bar, so a line that is
     * clearly shorter than the title is also compared with the best-fitting part of it (a little less trusted).
     */
    private fun score(read: String, title: String): Float {
      val whole = 1f - distance(read, title, anywhere = false).toFloat() / maxOf(read.length, title.length)
      if (read.length < 6 || title.length < read.length + 3) return whole
      val part = (1f - distance(read, title, anywhere = true).toFloat() / read.length) * 0.92f
      return maxOf(whole, part)
    }

    /** edit distance; with [anywhere], from [a] to the closest stretch inside [b] */
    private fun distance(a: String, b: String, anywhere: Boolean): Int {
      var prev = IntArray(b.length + 1) { if (anywhere) 0 else it }
      var cur = IntArray(b.length + 1)
      for (i in 1..a.length) {
        cur[0] = i
        val ca = a[i - 1]
        for (j in 1..b.length) {
          val swap = prev[j - 1] + if (ca == b[j - 1]) 0 else 1
          cur[j] = minOf(swap, prev[j] + 1, cur[j - 1] + 1)
        }
        val t = prev
        prev = cur
        cur = t
      }
      return if (anywhere) prev.min() else prev[b.length]
    }

    companion object {
      /** words the game shows around the title, which are not it ("Credits" is also a song) */
      private val SCREEN_WORD = Regex("^(track\\d*|credits?\\d*|basic|advanced|expert|master|remaster|achievement|lv\\d*|ver.*|dxscore|freeplay)$")
      private val NUMBER = Regex("^[\\d.,%]+$")

      private fun isScreenWord(key: String): Boolean =
        SCREEN_WORD.matches(key) || key.contains("achievement") || (NUMBER.matches(key) && (key.contains('.') || key.contains('%')))

      /** same letters in the same form: full-width to half-width, lower case, no spaces or marks */
      fun normalize(text: String): String {
        val folded = Normalizer.normalize(text, Normalizer.Form.NFKC).lowercase()
        val out = StringBuilder(folded.length)
        for (c in folded) if (Character.isLetterOrDigit(c)) out.append(c)
        return out.toString()
      }
    }
  }
}
