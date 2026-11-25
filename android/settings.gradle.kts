pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

plugins {
  id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

@Suppress("UnstableApiUsage")
dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google()
    mavenCentral()
  }
}

rootProject.name = "carol-live"
include(":app")

// RootEncoder is used straight from the local clone (./RootEncoder) instead of JitPack,
// so the app always builds against the exact source that is checked out here.
includeBuild("RootEncoder") {
  dependencySubstitution {
    substitute(module("com.github.pedroSG94:library")).using(project(":library"))
  }
}
