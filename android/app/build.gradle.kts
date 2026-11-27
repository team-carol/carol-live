import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
}

/**
 * Release signing comes from either
 *  - CI: env ANDROID_KEYSTORE_FILE / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD
 *  - local: android/keystore.properties (gitignored) with storeFile / storePassword / keyAlias / keyPassword
 * Without either, release builds are left unsigned and debug builds work as before.
 */
val keystoreProps = Properties().apply {
  val f = rootProject.file("keystore.properties")
  if (f.exists()) f.inputStream().use { load(it) }
}

fun signingValue(env: String, prop: String): String? =
  System.getenv(env)?.takeIf { it.isNotBlank() } ?: keystoreProps.getProperty(prop)?.takeIf { it.isNotBlank() }

val releaseStoreFile = signingValue("ANDROID_KEYSTORE_FILE", "storeFile")?.let { rootProject.file(it) }

// CI passes -PappVersionName=0.3.1 -PappVersionCode=<run number>
val appVersionName = providers.gradleProperty("appVersionName").orNull ?: "0.6.0"
val appVersionCode = providers.gradleProperty("appVersionCode").orNull?.toIntOrNull() ?: 6

android {
  namespace = "com.teamcarol.live"
  compileSdk = 37

  defaultConfig {
    applicationId = "com.teamcarol.live"
    minSdk = 29
    // 34: avoids forced edge-to-edge (35+) and local-network permission (37) for this personal build
    targetSdk = 34
    versionCode = appVersionCode
    versionName = appVersionName
  }

  signingConfigs {
    if (releaseStoreFile?.exists() == true) {
      create("release") {
        storeFile = releaseStoreFile
        storePassword = signingValue("ANDROID_KEYSTORE_PASSWORD", "storePassword")
        keyAlias = signingValue("ANDROID_KEY_ALIAS", "keyAlias")
        keyPassword = signingValue("ANDROID_KEY_PASSWORD", "keyPassword")
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      signingConfig = signingConfigs.findByName("release")
    }
  }

  buildFeatures {
    buildConfig = true
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

kotlin {
  jvmToolchain(17)
}

dependencies {
  // resolved to ../RootEncoder/library through the included build (settings.gradle.kts)
  implementation("com.github.pedroSG94:library:2.8.2")
  implementation(libs.androidx.appcompat)
  // background uploads that resume after network loss / reboot
  implementation(libs.androidx.work)
  implementation(libs.kotlinx.coroutines.android)
}
