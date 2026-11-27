package com.teamcarol.live

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Live chat of the running YouTube broadcast, read through the carol-live server
 * (/api/device/youtube/live and /chat; the API key lives there).
 *
 * Polls only while a stream runs AND the live screen is visible: the team shares one daily quota
 * and every chat poll costs 5 units, so nothing is fetched with the screen off. Polling slows down
 * when the chat is quiet.
 *
 * All state is touched on the main thread; network calls run on one background thread.
 */
object YouTubeChat {

  data class Message(
    val id: String,
    /** text | superchat | supersticker | member */
    val type: String,
    val author: String,
    val text: String,
    val amount: String?,
    val owner: Boolean,
    val mod: Boolean,
    val member: Boolean,
  )

  enum class Status {
    /** not streaming, no channel set, or chat turned off in settings */
    OFF,
    NEED_PAIRING,
    SEARCHING,
    LIVE,
    /** the broadcast ended; looking for a new one */
    ENDED,
    /** stopped: tap to search again */
    GAVE_UP,
    QUOTA,
    ERROR,
  }

  fun interface Listener {
    fun onChatChanged()
  }

  var listener: Listener? = null

  var status = Status.OFF
    private set

  /** error text, or the broadcast title while LIVE */
  var detail: String? = null
    private set

  /** panel folded to its header (kept across screen rotations) */
  var collapsed = false

  /** bumps whenever [messages] changes, so the screen only rebuilds the list when needed */
  var revision = 0
    private set

  val messages: List<Message> get() = buffer.toList()

  private const val KEEP = 60
  private const val FIRST_FIND_DELAY_MS = 10_000L
  private const val FAST_FIND_TRIES = 10
  private const val SLOW_FIND_TRIES = 25
  private const val ACTIVE_POLL_MS = 6_000L
  private const val QUIET_POLL_MS = 12_000L
  private const val QUIET_AFTER_MS = 60_000L

  private val buffer = ArrayDeque<Message>()
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "yt-chat").apply { isDaemon = true } }
  private val tick = Runnable { step() }

  private var running = false
  /** bumped when polling stops so late responses are dropped */
  private var generation = 0
  private var paired: UploadConfig.Paired? = null
  private var channel = ""
  private var liveChatId: String? = null
  private var pageToken: String? = null
  private var findTries = 0
  private var lastMessageAt = 0L

  /** chat id and title of the broadcast the app made itself ([YouTubeAccount]): nothing to search for then */
  private var known: Pair<String, String?>? = null

  /** [LiveSession] calls this when it starts pushing to an account broadcast, and with null when that ends */
  fun attach(chatId: String?, title: String?) {
    known = if (chatId.isNullOrEmpty()) null else chatId to title
  }

  /**
   * Called by the live screen on every render: lines polling up with the stream and the screen.
   * Cheap when nothing changes.
   */
  fun update(ctx: Context, settings: StreamSettings, streaming: Boolean, visible: Boolean) {
    if (!streaming) {
      if (status != Status.OFF || liveChatId != null || buffer.isNotEmpty()) reset()
      return
    }
    val p = UploadConfig.paired(ctx)
    val blocked = when {
      !settings.showChat || (settings.youtubeChannel.isBlank() && known == null) -> Status.OFF
      p == null -> Status.NEED_PAIRING
      else -> null
    }
    if (blocked != null) {
      stop()
      set(blocked, null)
      return
    }
    paired = p
    channel = settings.youtubeChannel.trim()
    if (!visible) {
      stop()
      return
    }
    if (running || status in TERMINAL) return
    when (status) {
      Status.OFF, Status.NEED_PAIRING -> {
        if (!useKnown()) set(Status.SEARCHING, null)
        schedule(FIRST_FIND_DELAY_MS)
      }
      else -> schedule(0)
    }
  }

  /** @return true when the chat of the app's own broadcast is now the one being read */
  private fun useKnown(): Boolean {
    val k = known ?: return false
    liveChatId = k.first
    pageToken = null
    set(Status.LIVE, k.second)
    return true
  }

  /** tap on the panel header after giving up */
  fun retry() {
    if (status != Status.GAVE_UP && status != Status.ERROR) return
    findTries = 0
    liveChatId = null
    pageToken = null
    if (!useKnown()) set(Status.SEARCHING, null)
    schedule(0)
  }

  private fun reset() {
    stop()
    liveChatId = null
    pageToken = null
    findTries = 0
    lastMessageAt = 0
    buffer.clear()
    revision++
    set(Status.OFF, null)
  }

  private fun stop() {
    main.removeCallbacks(tick)
    if (running) generation++
    running = false
  }

  private fun schedule(delayMs: Long) {
    main.removeCallbacks(tick)
    running = true
    main.postDelayed(tick, delayMs)
  }

  private fun set(s: Status, d: String?) {
    if (status == s && detail == d) return
    status = s
    detail = d
    listener?.onChatChanged()
  }

  // ---------------------------------------------------------------- polling

  private fun step() {
    val p = paired ?: return
    val gen = generation
    val chatId = liveChatId
    val path = if (chatId == null) {
      // search.list (capped at 100 calls a day) only every third try
      val deep = findTries % 3 == 2
      "/api/device/youtube/live?channel=${Uri.encode(channel)}" + if (deep) "&deep=1" else ""
    } else {
      "/api/device/youtube/chat?liveChatId=${Uri.encode(chatId)}" + (pageToken?.let { "&pageToken=${Uri.encode(it)}" } ?: "")
    }
    io.execute {
      val result = runCatching { Api.request(p, "GET", path) }
      main.post {
        if (gen != generation || !running) return@post
        if (chatId == null) onFind(result) else onChat(result)
      }
    }
  }

  private fun onFind(result: Result<JSONObject>) {
    result
      .onSuccess { o ->
        if (o.optBoolean("live") && o.optString("liveChatId").isNotEmpty()) {
          liveChatId = o.getString("liveChatId")
          pageToken = null
          findTries = 0
          set(Status.LIVE, o.optString("title").ifEmpty { null })
          schedule(0)
        } else {
          findTries++
          when {
            findTries < FAST_FIND_TRIES -> schedule(15_000)
            findTries < SLOW_FIND_TRIES -> schedule(60_000)
            else -> {
              stop()
              set(Status.GAVE_UP, "@${channel.removePrefix("@")} 라이브를 찾지 못했습니다 · 누르면 다시 찾습니다")
            }
          }
        }
      }
      .onFailure { e -> onError(e, finding = true) }
  }

  private fun onChat(result: Result<JSONObject>) {
    result
      .onSuccess { o ->
        val changed = merge(o.optJSONArray("messages"))
        pageToken = o.optString("nextPageToken").ifEmpty { pageToken }
        if (o.optBoolean("offline")) {
          broadcastEnded()
          return@onSuccess
        }
        if (status != Status.LIVE) set(Status.LIVE, detail)
        if (changed) listener?.onChatChanged()
        val quiet = SystemClock.elapsedRealtime() - lastMessageAt > QUIET_AFTER_MS
        val asked = o.optLong("pollingIntervalMillis", 5_000)
        schedule(maxOf(asked, if (quiet) QUIET_POLL_MS else ACTIVE_POLL_MS))
      }
      .onFailure { e -> onError(e, finding = false) }
  }

  private fun broadcastEnded() {
    liveChatId = null
    pageToken = null
    findTries = 0
    if (channel.isEmpty()) {
      // the app's own broadcast is over and there is no channel to look for another one on
      stop()
      set(Status.GAVE_UP, "방송이 끝났습니다")
      return
    }
    set(Status.ENDED, null)
    schedule(30_000)
  }

  private fun onError(e: Throwable, finding: Boolean) {
    val code = (e as? HttpError)?.code
    val reason = (e as? HttpError)?.message
    when {
      reason == "quota" -> {
        stop()
        set(Status.QUOTA, "오늘 유튜브 할당량을 다 썼습니다 · 한국 시간 오후 4~5시에 초기화됩니다")
      }
      reason == "too_fast" -> schedule(10_000)
      reason == "chat_ended" -> broadcastEnded()
      reason == "chat_disabled" -> fail("이 방송은 채팅이 꺼져 있습니다")
      reason == "no_key" -> fail("서버에 유튜브 API 키가 아직 없습니다")
      code == 404 && finding -> fail("@${channel.removePrefix("@")} 채널을 찾지 못했습니다 · 설정에서 확인해 주세요")
      code == 401 -> fail("서버 연결이 해제됐습니다 · 설정에서 다시 연결해 주세요")
      // network trouble or a server hiccup: keep trying quietly
      else -> schedule(15_000)
    }
  }

  private fun fail(text: String) {
    stop()
    set(Status.ERROR, text)
  }

  /** @return true when the visible list changed */
  private fun merge(items: org.json.JSONArray?): Boolean {
    if (items == null || items.length() == 0) return false
    var changed = false
    for (i in 0 until items.length()) {
      val m = items.optJSONObject(i) ?: continue
      val id = m.optString("id")
      val type = m.optString("type")
      if (type == "deleted") {
        val target = m.optString("target")
        if (buffer.removeAll { it.id == target }) changed = true
        continue
      }
      if (id.isEmpty() || buffer.any { it.id == id }) continue
      buffer.addLast(
        Message(
          id = id,
          type = type,
          author = m.optString("author"),
          text = m.optString("text"),
          amount = m.optString("amount").ifEmpty { null },
          owner = m.optBoolean("owner"),
          mod = m.optBoolean("mod"),
          member = m.optBoolean("member"),
        ),
      )
      lastMessageAt = SystemClock.elapsedRealtime()
      changed = true
    }
    while (buffer.size > KEEP) buffer.removeFirst()
    if (changed) revision++
    return changed
  }

  private val TERMINAL = setOf(Status.GAVE_UP, Status.QUOTA, Status.ERROR)
}
