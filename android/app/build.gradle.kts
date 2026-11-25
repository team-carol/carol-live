plugins {
  alias(libs.plugins.android.application)
}

android {
  namespace = "com.teamcarol.live"
  compileSdk = 37

  defaultConfig {
    applicationId = "com.teamcarol.live"
    minSdk = 29
    // 34: avoids forced edge-to-edge (35+) and local-network permission (37) for this personal build
    targetSdk = 34
    versionCode = 3
    versionName = "0.3.0"
  }

  buildTypes {
    release {
      isMinifyEnabled = false
    }
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
