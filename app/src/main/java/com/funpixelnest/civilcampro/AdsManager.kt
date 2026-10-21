package com.funpixelnest.civilcampro

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log
import android.view.View
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.appopen.AppOpenAd
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Ads in the free version (none for CivilCam Pro):
 *  - Banner under the app on Gallery, Strip, Hindrance and Reports. Never on the camera.
 *  - Interstitial after a report is created, at most once every 3 minutes and 6 times a day.
 *  - Rewarded: the engineer chooses to watch one to remove the "free version" line from a report.
 *  - App open: when coming back to the app after 30+ minutes away, at most once every 4 hours.
 *
 * The EU / UK consent message (UMP) is shown first when needed; ads load only after consent.
 *
 * Release builds use the real CivilCam Pro ad units; debug builds use Google's test units.
 */
class AdsManager(
    private val activity: AppCompatActivity,
    private val container: FrameLayout,
    private val webView: WebView,
    private val isPro: () -> Boolean
) {
    /**
     * Real AdMob units for the CivilCam Pro app (ca-app-pub-5089346574611451~1477640643).
     * Debug builds (run from Android Studio) use Google's test units instead, so testing never
     * clicks real ads, which AdMob treats as invalid traffic.
     */
    private val debugBuild = (activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    private object Live {
        const val BANNER = "ca-app-pub-5089346574611451/1775567278"        // CivilCam Banner
        const val INTERSTITIAL = "ca-app-pub-5089346574611451/7851477304"  // CivilCam Interstitial
        const val REWARDED = "ca-app-pub-5089346574611451/2104326602"      // CivilCam Rewarded
        const val APP_OPEN = "ca-app-pub-5089346574611451/6836322264"      // CivilCam App Open
    }

    private object Test {
        const val BANNER = "ca-app-pub-3940256099942544/9214589741"
        const val INTERSTITIAL = "ca-app-pub-3940256099942544/1033173712"
        const val REWARDED = "ca-app-pub-3940256099942544/5224354917"
        const val APP_OPEN = "ca-app-pub-3940256099942544/9257395921"
    }

    private inner class Units {
        val BANNER get() = if (debugBuild) Test.BANNER else Live.BANNER
        val INTERSTITIAL get() = if (debugBuild) Test.INTERSTITIAL else Live.INTERSTITIAL
        val REWARDED get() = if (debugBuild) Test.REWARDED else Live.REWARDED
        val APP_OPEN get() = if (debugBuild) Test.APP_OPEN else Live.APP_OPEN
    }
    private val Ids = Units()

    private val prefs = activity.getSharedPreferences("civilcam_ads", Context.MODE_PRIVATE)
    private val consent: ConsentInformation = UserMessagingPlatform.getConsentInformation(activity)
    private val started = AtomicBoolean(false)
    private var ready = false

    private var banner: AdView? = null
    private var bannerWanted = false
    private var interstitial: InterstitialAd? = null
    private var rewarded: RewardedAd? = null
    private var appOpen: AppOpenAd? = null
    private var appOpenLoadedAt = 0L
    private var showingFullScreen = false
    private var backgroundAt = 0L
    private val sessionStart = System.currentTimeMillis()

    // ---------- start: consent first, then the SDK ----------
    fun start() {
        val params = ConsentRequestParameters.Builder().build()
        consent.requestConsentInfoUpdate(activity, params, {
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { error ->
                if (error != null) Log.w("CivilCam", "Consent form: ${error.message}")
                if (consent.canRequestAds()) initSdk()
            }
        }, { error ->
            Log.w("CivilCam", "Consent info: ${error.message}")
            if (consent.canRequestAds()) initSdk()
        })
        // Consent from an earlier session lets ads start at once
        if (consent.canRequestAds()) initSdk()
    }

    private fun initSdk() {
        if (!started.compareAndSet(false, true)) return
        Thread {
            MobileAds.initialize(activity) {}
            activity.runOnUiThread {
                ready = true
                if (!isPro()) {
                    loadInterstitial(); loadRewarded(); loadAppOpen()
                    if (bannerWanted) showBanner()
                }
            }
        }.start()
    }

    /** True when the EU / UK privacy options entry point must be offered in settings. */
    fun privacyOptionsRequired(): Boolean =
        consent.privacyOptionsRequirementStatus == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED

    fun showPrivacyOptions() = activity.runOnUiThread {
        UserMessagingPlatform.showPrivacyOptionsForm(activity) { error ->
            if (error != null) Log.w("CivilCam", "Privacy options: ${error.message}")
        }
    }

    // ---------- banner ----------
    fun setBannerVisible(visible: Boolean) = activity.runOnUiThread {
        bannerWanted = visible
        if (visible && ready && !isPro()) {
            showBanner()
        } else {
            container.visibility = View.GONE
        }
    }

    private fun showBanner() {
        if (banner == null) {
            val ad = AdView(activity)
            ad.adUnitId = Ids.BANNER
            ad.setAdSize(adaptiveSize())
            ad.adListener = object : AdListener() {
                override fun onAdFailedToLoad(error: LoadAdError) {
                    Log.w("CivilCam", "Banner: ${error.message}")
                    container.visibility = View.GONE
                }
                override fun onAdLoaded() {
                    if (bannerWanted && !isPro()) container.visibility = View.VISIBLE
                }
            }
            container.removeAllViews()
            container.addView(ad)
            banner = ad
            ad.loadAd(AdRequest.Builder().build())
        } else {
            container.visibility = View.VISIBLE
        }
    }

    @Suppress("DEPRECATION")
    private fun adaptiveSize(): AdSize {
        val metrics = activity.resources.displayMetrics
        val widthDp = (metrics.widthPixels / metrics.density).toInt()
        return AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(activity, widthDp)
    }

    // ---------- interstitial: a natural break, e.g. after a report is created ----------
    private fun loadInterstitial() {
        if (interstitial != null || isPro()) return
        InterstitialAd.load(activity, Ids.INTERSTITIAL, AdRequest.Builder().build(), object : InterstitialAdLoadCallback() {
            override fun onAdLoaded(ad: InterstitialAd) { interstitial = ad }
            override fun onAdFailedToLoad(error: LoadAdError) { interstitial = null }
        })
    }

    private fun interstitialAllowed(): Boolean {
        val now = System.currentTimeMillis()
        val day = now / 86_400_000L
        if (prefs.getLong("day", -1) != day) prefs.edit().putLong("day", day).putInt("countToday", 0).apply()
        return !isPro() &&
            now - sessionStart > 60_000 &&                          // not in the first minute
            now - prefs.getLong("lastInterstitial", 0) > 180_000 &&  // 3 minutes apart
            prefs.getInt("countToday", 0) < 6
    }

    /** Shows an interstitial if one is ready and allowed; always calls back window.onNativeAdDone(id, shown). */
    fun showInterstitial(id: String) = activity.runOnUiThread {
        val ad = interstitial
        if (ad == null || !interstitialAllowed() || showingFullScreen) {
            done(id, false); loadInterstitial(); return@runOnUiThread
        }
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() { showingFullScreen = false; done(id, true); loadInterstitial() }
            override fun onAdFailedToShowFullScreenContent(error: AdError) { showingFullScreen = false; done(id, false); loadInterstitial() }
        }
        interstitial = null
        showingFullScreen = true
        prefs.edit().putLong("lastInterstitial", System.currentTimeMillis())
            .putInt("countToday", prefs.getInt("countToday", 0) + 1).apply()
        ad.show(activity)
    }

    private fun done(id: String, shown: Boolean) =
        js("window.onNativeAdDone && window.onNativeAdDone(${JSONObject.quote(id)}, $shown)")

    // ---------- rewarded: only when the engineer asks for it ----------
    private fun loadRewarded() {
        if (rewarded != null || isPro()) return
        RewardedAd.load(activity, Ids.REWARDED, AdRequest.Builder().build(), object : RewardedAdLoadCallback() {
            override fun onAdLoaded(ad: RewardedAd) { rewarded = ad }
            override fun onAdFailedToLoad(error: LoadAdError) { rewarded = null }
        })
    }

    fun rewardedReady(): Boolean = rewarded != null

    /** Calls back window.onNativeReward(id, earned, reason): reason is "" or "notready". */
    fun showRewarded(id: String) = activity.runOnUiThread {
        val ad = rewarded
        if (ad == null) { reward(id, false, "notready"); loadRewarded(); return@runOnUiThread }
        var earned = false
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() { showingFullScreen = false; reward(id, earned, ""); loadRewarded() }
            override fun onAdFailedToShowFullScreenContent(error: AdError) { showingFullScreen = false; reward(id, false, "notready"); loadRewarded() }
        }
        rewarded = null
        showingFullScreen = true
        ad.show(activity) { earned = true }
    }

    private fun reward(id: String, earned: Boolean, reason: String) =
        js("window.onNativeReward && window.onNativeReward(${JSONObject.quote(id)}, $earned, ${JSONObject.quote(reason)})")

    // ---------- app open: returning after a long break ----------
    private fun loadAppOpen() {
        if (appOpen != null || isPro()) return
        AppOpenAd.load(activity, Ids.APP_OPEN, AdRequest.Builder().build(), object : AppOpenAd.AppOpenAdLoadCallback() {
            override fun onAdLoaded(ad: AppOpenAd) { appOpen = ad; appOpenLoadedAt = System.currentTimeMillis() }
            override fun onAdFailedToLoad(error: LoadAdError) { appOpen = null }
        })
    }

    fun onAppBackground() { backgroundAt = System.currentTimeMillis() }

    fun onAppForeground() {
        val now = System.currentTimeMillis()
        val away = if (backgroundAt == 0L) 0L else now - backgroundAt
        backgroundAt = 0L
        if (!ready || isPro() || showingFullScreen || away < 30 * 60_000L) return
        if (now - prefs.getLong("lastAppOpen", 0) < 4 * 3_600_000L) return
        val ad = appOpen ?: run { loadAppOpen(); return }
        if (now - appOpenLoadedAt > 4 * 3_600_000L) { appOpen = null; loadAppOpen(); return }   // ads expire after 4 h
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() { showingFullScreen = false; loadAppOpen() }
            override fun onAdFailedToShowFullScreenContent(error: AdError) { showingFullScreen = false; loadAppOpen() }
        }
        appOpen = null
        showingFullScreen = true
        prefs.edit().putLong("lastAppOpen", now).apply()
        ad.show(activity)
    }

    /** Pro bought: remove everything. */
    fun onProChanged(pro: Boolean) = activity.runOnUiThread {
        if (pro) {
            container.visibility = View.GONE
            banner?.destroy(); banner = null
            interstitial = null; rewarded = null; appOpen = null
        } else if (ready) {
            loadInterstitial(); loadRewarded(); loadAppOpen()
            if (bannerWanted) showBanner()
        }
    }

    fun destroy() { banner?.destroy() }

    private fun js(code: String) = activity.runOnUiThread { webView.evaluateJavascript(code, null) }
}
