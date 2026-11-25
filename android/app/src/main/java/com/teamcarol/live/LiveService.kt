package com.teamcarol.live

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.util.Locale

/**
 * Keeps the process in the foreground (camera + microphone) while a session is active, so the
 * stream survives the screen turning off or the app going to the background.
 * Also holds a partial wake lock and a low-latency Wi-Fi lock for the same reason.
 */
class LiveService : Service() {

  companion object {
    private const val CHANNEL = "live"
    private const val NOTIFICATION_ID = 1
    private const val ACTION_STOP = "com.teamcarol.live.STOP"

    private var instance: LiveService? = null
    private var lastRefresh = 0L

    fun start(context: Context) {
      ContextCompat.startForegroundService(context, Intent(context, LiveService::class.java))
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, LiveService::class.java))
    }

    /** throttled notification update (called every second by LiveSession) */
    fun refresh() {
      val now = SystemClock.elapsedRealtime()
      if (now - lastRefresh < 3000) return
      lastRefresh = now
      instance?.update()
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL, "방송·녹화 중", NotificationManager.IMPORTANCE_LOW).apply {
        description = "방송이나 녹화가 진행 중일 때 표시됨"
        setShowBadge(false)
      },
    )
    wakeLock = getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CarolLive:live")
      .apply { acquire(6 * 60 * 60 * 1000L) }
    @Suppress("DEPRECATION")
    wifiLock = applicationContext.getSystemService(WifiManager::class.java)
      .createWifiLock(WifiManager.WIFI_MODE_FULL_LOW_LATENCY, "CarolLive:live")
      .apply { acquire() }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // must call startForeground right away, even when we are about to stop
    startForeground(
      NOTIFICATION_ID,
      build(),
      ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
    )
    if (intent?.action == ACTION_STOP) {
      LiveSession.stopAll("알림에서 종료")
    } else if (!LiveSession.isActive) {
      stopSelf()
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    instance = null
    wakeLock?.let { if (it.isHeld) it.release() }
    wifiLock?.let { if (it.isHeld) it.release() }
    super.onDestroy()
  }

  private fun update() {
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, build())
  }

  private fun build(): Notification {
    val s = LiveSession
    val title = when {
      s.state == LiveSession.State.LIVE -> "LIVE " + clock(SystemClock.elapsedRealtime() - s.liveSince)
      s.state == LiveSession.State.RETRYING -> "재연결 중"
      s.state == LiveSession.State.CONNECTING -> "연결 중"
      s.isRecording -> "녹화 중 " + clock(SystemClock.elapsedRealtime() - s.recordSince)
      else -> "carol live"
    }
    val stats = s.lastStats
    val parts = buildList {
      if (s.state == LiveSession.State.LIVE && stats != null) {
        add(String.format(Locale.US, "%.1fMbps", stats.smoothedBitrate / 1_000_000f))
      }
      if (s.isStreaming && s.isRecording) add("녹화 중")
      val phone = PhoneStatus.read(this@LiveService)
      add(String.format(Locale.US, "%.0f°C", phone.tempC))
      if (phone.batteryPct >= 0) add("배터리 ${phone.batteryPct}%")
    }
    val open = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE,
    )
    val stop = PendingIntent.getService(
      this, 1, Intent(this, LiveService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_IMMUTABLE,
    )
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.ic_stat_live)
      .setColor(ContextCompat.getColor(this, R.color.crl_accent))
      .setContentTitle(title)
      .setContentText(parts.joinToString(" · "))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setContentIntent(open)
      .addAction(0, "모두 종료", stop)
      .build()
  }

  private fun clock(ms: Long): String {
    val s = ms / 1000
    return String.format(Locale.US, "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60)
  }
}
