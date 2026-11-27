package com.teamcarol.live

import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import kotlin.concurrent.thread

/** Receives carollive://paired?token=..&name=..&server=..&nonce=.. after the browser login. */
class PairActivity : AppCompatActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_pair)
    val title = findViewById<TextView>(R.id.pair_title)
    val body = findViewById<TextView>(R.id.pair_body)
    val tag = findViewById<TextView>(R.id.pair_tag)
    findViewById<Button>(R.id.pair_done).setOnClickListener { finish() }

    val uri = intent.data
    val token = uri?.getQueryParameter("token")
    val name = uri?.getQueryParameter("name")
    val server = uri?.getQueryParameter("server")
    val nonce = uri?.getQueryParameter("nonce")
    val expected = UploadConfig.expectedNonce(this)

    // only accept a pairing this app started (stops other apps/sites from pairing us to their account)
    if (token == null || name == null || server == null || nonce == null || nonce != expected) {
      fail(tag, title, body, "연결 요청을 확인할 수 없습니다. 설정에서 연결하기를 다시 눌러 주세요")
      return
    }
    val paired = UploadConfig.Paired(server, token, name, null)
    title.text = name
    body.text = "연결 확인 중…"
    thread {
      val result = checkPairing(paired)
      runOnUiThread {
        result
          .onSuccess { account ->
            UploadConfig.savePaired(this, paired.copy(account = account))
            UploadConfig.saveDrafts(this, server, name)
            tag.text = "연결됨"
            tag.setBackgroundResource(R.drawable.crl_tag_success)
            tag.setTextColor(ContextCompat.getColor(this, R.color.crl_success))
            val pending = UploadQueue.pendingCount(this)
            body.text = buildString {
              append(account?.let { "$it 계정에 연결됐습니다. " } ?: "")
              append("이 폰의 녹화는 '$name' 폴더로 올라갑니다.")
              if (pending > 0) append(" 대기 중인 녹화 ${pending}개를 와이파이에서 올립니다.")
            }
            if (pending > 0 && UploadConfig.autoUpload(this)) Uploads.schedule(this)
          }
          .onFailure { fail(tag, title, body, "서버에서 연결을 확인하지 못했습니다: ${it.message}") }
      }
    }
  }

  private fun fail(tag: TextView, title: TextView, body: TextView, message: String) {
    tag.text = "실패"
    tag.setBackgroundResource(R.drawable.crl_tag_danger)
    tag.setTextColor(ContextCompat.getColor(this, R.color.crl_danger))
    title.text = "기기 연결"
    body.text = message
  }
}
