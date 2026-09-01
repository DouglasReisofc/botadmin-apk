plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
    id("dev.flutter.flutter-gradle-plugin")
}

val resolvedAppId =
    providers.environmentVariable("APP_ID")
        .orElse(providers.environmentVariable("APP_PACKAGE"))
        .orElse("com.botadmin.shop")
        .get()
val envVersionName =
    providers.environmentVariable("APP_VERSION_NAME")
        .orElse(providers.environmentVariable("FLUTTER_BUILD_NAME"))
        .orNull
val envVersionCode =
    providers.environmentVariable("APP_VERSION_CODE")
        .orElse(providers.environmentVariable("FLUTTER_BUILD_NUMBER"))
        .orNull
val releaseKeystorePath =
    providers.environmentVariable("ANDROID_KEYSTORE")
        .orElse(providers.environmentVariable("ANDROID_KEYSTORE_FILE"))
        .orNull
val releaseKeystorePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("ANDROID_KEY_ALIAS_PASSWORD").orNull
val hasReleaseSigning =
    !releaseKeystorePath.isNullOrBlank() &&
        !releaseKeystorePassword.isNullOrBlank() &&
        !releaseKeyAlias.isNullOrBlank() &&
        !releaseKeyPassword.isNullOrBlank()

android {
    namespace = resolvedAppId
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = resolvedAppId
        minSdk = 26
        targetSdk = 35
        versionCode = envVersionCode?.toIntOrNull() ?: flutter.versionCode
        versionName = envVersionName?.takeIf { it.isNotBlank() } ?: flutter.versionName
    }

    signingConfigs {
        create("release") {
            if (hasReleaseSigning) {
                storeFile = file(releaseKeystorePath!!)
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName(
                if (hasReleaseSigning) "release" else "debug"
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    val firebaseBom = platform("com.google.firebase:firebase-bom:33.1.2")
    implementation(firebaseBom)
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}
