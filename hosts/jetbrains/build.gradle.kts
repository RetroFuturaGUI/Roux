import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

//Kotlin passes a block to a call only when it opens on the call's line, so these braces can't go on a line of their own.
plugins {
    id("org.jetbrains.kotlin.jvm") version "2.4.21"
    id("org.jetbrains.intellij.platform") version "2.20.1"
}

group = "org.retrofuturagui"
version = "0.0.1"

//The IDE to build against and to try the plugin in: an installed one, named in local.properties (rouxIde=<its folder>),
//which isn't checked in.
val localProperties = Properties().apply {
    file("local.properties").takeIf { it.exists() }?.reader()?.use { load(it) }
}

repositories {
    mavenCentral()

    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        local(localProperties.getProperty("rouxIde") ?: error("Name an installed JetBrains IDE in local.properties: rouxIde=<its folder>"))

        //The IDE's browser, which shows the UI: a bundled plugin since 2026.3, its JBCef classes a module of it.
        bundledPlugin("com.intellij.modules.jcef")
        bundledModule("intellij.platform.ui.jcef")
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_25
    targetCompatibility = JavaVersion.VERSION_25
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_25)
    }
}

intellijPlatform {
    buildSearchableOptions = false

    pluginConfiguration {
        ideaVersion {
            sinceBuild = "263"
            untilBuild = provider { null }
        }
    }
}
