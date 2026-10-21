package com.funpixelnest.civilcampro

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import org.json.JSONArray
import org.json.JSONObject

/**
 * CivilCam Pro subscription through Google Play Billing (Library 8).
 *
 * Play Console set-up (Monetize > Products > Subscriptions):
 *   product ID  civilcam_pro
 *   base plans  monthly  (auto-renewing, 1 month)  and  yearly  (auto-renewing, 1 year)
 *   optional    a free-trial offer on either plan
 * Prices are set in Play Console per country; the app shows whatever Play returns.
 *
 * The page is told about changes through window.onNativePro(isPro) and
 * window.onNativePlans(json). For stronger protection later, verify purchase tokens on a server.
 */
class BillingHelper(private val activity: AppCompatActivity, private val webView: WebView) : PurchasesUpdatedListener {

    companion object { const val PRODUCT = "civilcam_pro" }

    private val prefs = activity.getSharedPreferences("civilcam_pro", Context.MODE_PRIVATE)
    var onProChanged: ((Boolean) -> Unit)? = null

    val isPro: Boolean get() = prefs.getBoolean("pro", false)

    private val client: BillingClient = BillingClient.newBuilder(activity)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()

    private var details: ProductDetails? = null
    private var connected = false

    fun start() {
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                connected = result.responseCode == BillingClient.BillingResponseCode.OK
                if (connected) { queryPlans(); refreshPurchases() }
                else Log.w("CivilCam", "Billing not available: ${result.debugMessage}")
            }
            override fun onBillingServiceDisconnected() { connected = false }
        })
    }

    fun end() { client.endConnection() }

    private fun queryPlans() {
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(PRODUCT)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()))
            .build()
        client.queryProductDetailsAsync(params) { result, productResult ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                details = productResult.productDetailsList.firstOrNull()
            }
            js("window.onNativePlans && window.onNativePlans(${JSONObject.quote(plansJson())})")
        }
    }

    /** [{plan, offerToken, price, period, trial}] — empty until Play Console has the product. */
    fun plansJson(): String {
        val out = JSONArray()
        details?.subscriptionOfferDetails?.forEach { offer ->
            val phases = offer.pricingPhases.pricingPhaseList
            val regular = phases.lastOrNull() ?: return@forEach
            out.put(JSONObject()
                .put("plan", offer.basePlanId)
                .put("offerId", offer.offerId ?: "")
                .put("offerToken", offer.offerToken)
                .put("price", regular.formattedPrice)
                .put("period", regular.billingPeriod)   // P1M, P1Y ...
                .put("trial", phases.any { it.priceAmountMicros == 0L }))
        }
        return out.toString()
    }

    /** Starts the Play purchase sheet for a base plan ("monthly" / "yearly"). */
    fun buy(plan: String) = activity.runOnUiThread {
        val d = details
        if (d == null) {
            js("window.onNativeProError && window.onNativeProError('CivilCam Pro is not on sale yet. Try again later.')")
            return@runOnUiThread
        }
        val offers = d.subscriptionOfferDetails.orEmpty().filter { it.basePlanId == plan }
        // Prefer an offer with a free trial, else the plain base plan
        val offer = offers.firstOrNull { o -> o.pricingPhases.pricingPhaseList.any { it.priceAmountMicros == 0L } }
            ?: offers.firstOrNull { it.offerId == null } ?: offers.firstOrNull()
        if (offer == null) {
            js("window.onNativeProError && window.onNativeProError('That plan is not available.')")
            return@runOnUiThread
        }
        val flow = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(
                BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(d)
                    .setOfferToken(offer.offerToken)
                    .build()))
            .build()
        client.launchBillingFlow(activity, flow)
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> purchases?.forEach { handle(it) }
            BillingClient.BillingResponseCode.USER_CANCELED -> {}
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> refreshPurchases()
            else -> js("window.onNativeProError && window.onNativeProError(${JSONObject.quote("Purchase did not go through: " + result.debugMessage)})")
        }
    }

    private fun handle(p: Purchase) {
        if (!p.products.contains(PRODUCT)) return
        if (p.purchaseState == Purchase.PurchaseState.PURCHASED) {
            if (!p.isAcknowledged) {
                client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()) {}
            }
            setPro(true)
        }
    }

    /** Checks Play for an active subscription (also used for "Restore purchase"). */
    fun refreshPurchases() {
        if (!connected) return
        client.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build()
        ) { result, list ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) return@queryPurchasesAsync
            val active = list.any { it.products.contains(PRODUCT) && it.purchaseState == Purchase.PurchaseState.PURCHASED }
            list.forEach { handle(it) }
            setPro(active)
        }
    }

    private fun setPro(pro: Boolean) {
        val changed = prefs.getBoolean("pro", false) != pro
        prefs.edit().putBoolean("pro", pro).apply()
        if (changed) onProChanged?.invoke(pro)
        js("window.onNativePro && window.onNativePro($pro)")
    }

    /** Opens Play's subscription page so the engineer can change or cancel. */
    fun manage() = activity.runOnUiThread {
        val url = "https://play.google.com/store/account/subscriptions?sku=$PRODUCT&package=${activity.packageName}"
        try { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (e: Exception) { Log.w("CivilCam", "No Play Store", e) }
    }

    private fun js(code: String) = activity.runOnUiThread { webView.evaluateJavascript(code, null) }
}
