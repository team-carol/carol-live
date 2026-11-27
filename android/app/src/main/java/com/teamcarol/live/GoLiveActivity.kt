package com.teamcarol.live

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import kotlin.concurrent.thread

/**
 * The form before going live on the linked YouTube account: preset, title, description, visibility.
 * "방송 시작" makes the broadcast on the server and hands it back to [MainActivity] (through [takeCreated]),
 * which starts the stream. Nothing here touches the camera or the encoder.
 */
class GoLiveActivity : AppCompatActivity() {

  private lateinit var txtChannel: TextView
  private lateinit var txtTag: TextView
  private lateinit var txtStatus: TextView
  private lateinit var rgPresets: RadioGroup
  private lateinit var txtPresetNote: TextView
  private lateinit var etTitle: EditText
  private lateinit var etDescription: EditText
  private lateinit var rgPrivacy: RadioGroup
  private lateinit var txtError: TextView
  private lateinit var btnStart: Button

  private var account: YouTubeAccount.Account? = null
  private var loading = false
  private var creating = false

  /** view id of each preset tab; [customTab] is "직접 입력" */
  private val presetTabs = HashMap<Int, YouTubeAccount.Preset>()
  private var customTab = View.NO_ID

  /** what was typed by hand, kept while a preset is looked at */
  private var typed = YouTubeAccount.Draft(null, "", "", YouTubeAccount.Privacy.UNLISTED)
  private var selectedTab = View.NO_ID

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_go_live)
    txtChannel = findViewById(R.id.live_channel)
    txtTag = findViewById(R.id.live_tag)
    txtStatus = findViewById(R.id.live_status)
    rgPresets = findViewById(R.id.live_presets)
    txtPresetNote = findViewById(R.id.live_preset_note)
    etTitle = findViewById(R.id.live_title)
    etDescription = findViewById(R.id.live_description)
    rgPrivacy = findViewById(R.id.live_privacy)
    txtError = findViewById(R.id.live_error)
    btnStart = findViewById(R.id.live_start)

    typed = YouTubeAccount.draft(this)
    show(typed.title, typed.description, typed.privacy)

    findViewById<Button>(R.id.live_close).setOnClickListener { finish() }
    findViewById<Button>(R.id.live_reload).setOnClickListener { load() }
    findViewById<Button>(R.id.live_web).setOnClickListener { openWeb() }
    rgPresets.setOnCheckedChangeListener { _, id -> onPresetPicked(id) }
    btnStart.setOnClickListener { start() }
    render()
    load()
  }

  // ---------------------------------------------------------------- account

  private fun load() {
    if (loading || creating) return
    val paired = UploadConfig.paired(this)
    if (paired == null) {
      account = null
      render()
      return
    }
    loading = true
    render()
    thread {
      val result = runCatching { YouTubeAccount.account(paired) }
      runOnUiThread {
        loading = false
        if (isFinishing || isDestroyed) return@runOnUiThread
        result
          .onSuccess {
            account = it
            showError(null)
            buildPresets(it.presets)
          }
          .onFailure {
            account = null
            showError(YouTubeAccount.message(it))
          }
        render()
      }
    }
  }

  private fun openWeb() {
    val paired = UploadConfig.paired(this)
    if (paired == null) {
      toast("설정 → 업로드에서 서버에 먼저 연결해 주세요")
      return
    }
    runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(paired.server.trimEnd('/') + "/youtube"))) }
      .onFailure { toast("브라우저를 열지 못했습니다") }
  }

  // ---------------------------------------------------------------- presets

  private fun buildPresets(presets: List<YouTubeAccount.Preset>) {
    val first = customTab == View.NO_ID
    // "" = typed by hand, null = never chosen
    val before: String? = when {
      first -> typed.presetId
      selectedTab == customTab -> ""
      else -> presetTabs[selectedTab]?.id ?: ""
    }
    val heldTitle = typedTitle()
    val heldDescription = typedDescription()
    val heldPrivacy = pickedPrivacy()

    rgPresets.setOnCheckedChangeListener(null)
    rgPresets.removeAllViews()
    presetTabs.clear()
    customTab = addTab("직접 입력")
    for (p in presets) presetTabs[addTab(p.name)] = p
    // the one used last time; the first preset on the very first visit
    val wanted = before ?: presets.firstOrNull()?.id ?: ""
    val pick = presetTabs.entries.firstOrNull { it.value.id == wanted }?.key ?: customTab
    selectedTab = View.NO_ID
    rgPresets.setOnCheckedChangeListener { _, id -> onPresetPicked(id) }
    rgPresets.check(pick)
    // reloading with the same choice keeps what was typed over it
    if (!first && (presetTabs[pick]?.id ?: "") == before) show(heldTitle, heldDescription, heldPrivacy)
  }

  private fun addTab(label: String): Int {
    val tab = layoutInflater.inflate(R.layout.item_tab, rgPresets, false) as RadioButton
    tab.id = View.generateViewId()
    tab.text = label
    rgPresets.addView(tab)
    return tab.id
  }

  private fun onPresetPicked(id: Int) {
    if (id == selectedTab || id == View.NO_ID) return
    // leaving the hand-typed form: keep what it held
    if (selectedTab == customTab && customTab != View.NO_ID) typed = typed.copy(title = typedTitle(), description = typedDescription(), privacy = pickedPrivacy())
    selectedTab = id
    val preset = presetTabs[id]
    if (preset != null) {
      show(YouTubeAccount.fillDate(preset.title), preset.description, preset.privacy)
      txtPresetNote.text = if (preset.hasThumbnail) "이 프리셋의 썸네일을 같이 올립니다. 아래 내용은 이번 방송만 바꿉니다" else "썸네일 없는 프리셋입니다. 아래 내용은 이번 방송만 바꿉니다"
    } else {
      show(typed.title, typed.description, typed.privacy)
      txtPresetNote.text = "프리셋 없이 직접 적습니다. 썸네일은 유튜브가 자동으로 정합니다"
    }
  }

  private fun show(title: String, description: String, privacy: YouTubeAccount.Privacy) {
    etTitle.setText(title)
    etDescription.setText(description)
    rgPrivacy.check(
      when (privacy) {
        YouTubeAccount.Privacy.PUBLIC -> R.id.live_public
        YouTubeAccount.Privacy.UNLISTED -> R.id.live_unlisted
        YouTubeAccount.Privacy.PRIVATE -> R.id.live_private
      },
    )
  }

  private fun typedTitle() = etTitle.text.toString().trim()

  private fun typedDescription() = etDescription.text.toString().trim()

  private fun pickedPrivacy() = when (rgPrivacy.checkedRadioButtonId) {
    R.id.live_public -> YouTubeAccount.Privacy.PUBLIC
    R.id.live_private -> YouTubeAccount.Privacy.PRIVATE
    else -> YouTubeAccount.Privacy.UNLISTED
  }

  // ---------------------------------------------------------------- start

  private fun start() {
    if (creating) return
    val paired = UploadConfig.paired(this) ?: return
    val title = typedTitle()
    if (title.isEmpty()) {
      etTitle.error = "제목을 적어 주세요"
      etTitle.requestFocus()
      return
    }
    if (LiveSession.isStreaming) {
      showError("이미 방송 중입니다")
      return
    }
    val description = typedDescription()
    val privacy = pickedPrivacy()
    val preset = presetTabs[selectedTab]
    val rtmps = SettingsStore.load(this).serverUrl.trim().startsWith("rtmps://", ignoreCase = true)
    creating = true
    showError(null)
    render()
    val app = applicationContext
    thread {
      val result = runCatching { YouTubeAccount.create(paired, title, description, privacy, preset?.id, rtmps) }
      runOnUiThread {
        creating = false
        result
          .onSuccess { made ->
            YouTubeAccount.saveDraft(
              app,
              preset?.id,
              if (preset == null) YouTubeAccount.Draft("", title, description, privacy) else null,
            )
            if (isFinishing || isDestroyed) {
              // closed while the server was working: nobody will push to it
              YouTubeAccount.endLater(app, made.broadcast.id)
              return@runOnUiThread
            }
            made.note?.let { toast(it) }
            created = made.broadcast
            setResult(RESULT_OK)
            finish()
          }
          .onFailure {
            showError(YouTubeAccount.message(it))
            render()
          }
      }
    }
  }

  // ---------------------------------------------------------------- render

  private fun render() {
    val paired = UploadConfig.paired(this)
    val a = account
    val channel = a?.channel
    when {
      paired == null -> status("서버 연결 필요", R.drawable.crl_tag_warning, R.color.crl_warning, "설정 → 업로드에서 서버에 먼저 연결해 주세요")
      loading -> status("확인 중", R.drawable.crl_tag_neutral, R.color.crl_muted, "서버에서 채널과 프리셋을 불러오는 중입니다")
      a == null -> status("확인 못 함", R.drawable.crl_tag_warning, R.color.crl_warning, "채널을 확인하지 못했습니다. 다시 불러와 주세요")
      !a.configured -> status("설정 필요", R.drawable.crl_tag_warning, R.color.crl_warning, "서버에 유튜브 연결 설정이 아직 없습니다")
      channel == null -> status("연결 안 됨", R.drawable.crl_tag_neutral, R.color.crl_muted, "웹에서 유튜브 채널을 연결한 뒤 다시 불러와 주세요")
      else -> status("연결됨", R.drawable.crl_tag_success, R.color.crl_success, "이 채널에 방송을 만듭니다")
    }
    txtChannel.text = channel ?: "채널"
    val ready = channel != null && !loading && !creating
    btnStart.isEnabled = ready
    btnStart.alpha = if (ready) 1f else DISABLED_ALPHA
    btnStart.text = if (creating) "방송을 만드는 중…" else "방송 시작"
  }

  private fun status(tag: String, background: Int, ink: Int, text: String) {
    txtTag.text = tag
    txtTag.setBackgroundResource(background)
    txtTag.setTextColor(ContextCompat.getColor(this, ink))
    txtStatus.text = text
  }

  private fun showError(text: String?) {
    txtError.text = text ?: ""
    txtError.visibility = if (text == null) View.GONE else View.VISIBLE
  }

  private fun toast(message: String) {
    Toast.makeText(applicationContext, message, Toast.LENGTH_LONG).show()
  }

  companion object {
    private const val DISABLED_ALPHA = 0.45f

    /** the broadcast this screen just made, until [MainActivity] takes it (it holds a stream key: memory only) */
    @Volatile
    private var created: LiveSession.Broadcast? = null

    fun takeCreated(): LiveSession.Broadcast? = created.also { created = null }
  }
}
