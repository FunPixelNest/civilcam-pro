package com.funpixelnest.civilcampro

import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import android.util.Log
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import com.microsoft.identity.client.AcquireTokenParameters
import com.microsoft.identity.client.AcquireTokenSilentParameters
import com.microsoft.identity.client.AuthenticationCallback
import com.microsoft.identity.client.IAccount
import com.microsoft.identity.client.IAuthenticationResult
import com.microsoft.identity.client.IPublicClientApplication
import com.microsoft.identity.client.ISingleAccountPublicClientApplication
import com.microsoft.identity.client.PublicClientApplication
import com.microsoft.identity.client.SignInParameters
import com.microsoft.identity.client.SilentAuthenticationCallback
import com.microsoft.identity.client.exception.MsalException
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URLEncoder
import java.security.MessageDigest

/**
 * OneDrive access for engineers who keep their photos in Microsoft OneDrive.
 *
 * Uses MSAL (Microsoft Authentication Library) with the "CivilCam Pro" app registered in
 * Microsoft Entra (client ID below). Photos go to the app's own folder:
 * OneDrive › Apps › CivilCam Pro. The app cannot see any other file (Files.ReadWrite.AppFolder).
 *
 * The redirect address is built from the key the app is signed with, so it is right for both
 * debug and release builds. Each signing key's hash must be added once in Entra
 * (App registrations › CivilCam Pro › Authentication › Android).
 *
 * The page asks with AndroidBridge.getOneDriveToken(id, interactive) and gets the answer in
 * window.onNativeOneDriveToken(id, token, error, accountJson).
 */
class OneDriveHelper(private val activity: AppCompatActivity, private val webView: WebView) {

    companion object {
        const val CLIENT_ID = "39ac0e55-c252-4782-8a43-d1e80856f27b"
        val SCOPES = listOf("Files.ReadWrite.AppFolder", "User.Read")
    }

    private var app: ISingleAccountPublicClientApplication? = null
    private var failed: String? = null
    private val waiting = mutableListOf<() -> Unit>()

    init { create() }

    /** Base64 SHA-1 of the signing certificate, as Entra shows it. */
    private fun signatureHash(): String {
        val pm = activity.packageManager
        val sig = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val info = pm.getPackageInfo(activity.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
            info.signingInfo?.apkContentsSigners?.firstOrNull()
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(activity.packageName, PackageManager.GET_SIGNATURES).signatures?.firstOrNull()
        } ?: return ""
        val sha1 = MessageDigest.getInstance("SHA-1").digest(sig.toByteArray())
        return Base64.encodeToString(sha1, Base64.NO_WRAP)
    }

    private fun configFile(): File {
        val redirect = "msauth://${activity.packageName}/" + URLEncoder.encode(signatureHash(), "UTF-8")
        val json = JSONObject()
            .put("client_id", CLIENT_ID)
            .put("authorization_user_agent", "DEFAULT")
            .put("redirect_uri", redirect)
            .put("account_mode", "SINGLE")
            .put("broker_redirect_uri_registered", false)
            .put("authorities", JSONArray().put(JSONObject()
                .put("type", "AAD")
                .put("default", true)
                .put("audience", JSONObject().put("type", "AzureADandPersonalMicrosoftAccount").put("tenant_id", "common"))))
        val f = File(activity.filesDir, "msal_config.json")
        f.writeText(json.toString())
        return f
    }

    private fun create() {
        try {
            PublicClientApplication.createSingleAccountPublicClientApplication(activity, configFile(),
                object : IPublicClientApplication.ISingleAccountApplicationCreatedListener {
                    override fun onCreated(application: ISingleAccountPublicClientApplication) {
                        app = application
                        waiting.toList().forEach { it() }
                        waiting.clear()
                    }
                    override fun onError(e: MsalException) {
                        failed = e.message ?: "OneDrive is not available"
                        Log.w("CivilCam", "MSAL: ${e.message}")
                        waiting.toList().forEach { it() }
                        waiting.clear()
                    }
                })
        } catch (e: Exception) {
            failed = e.message ?: "OneDrive is not available"
            Log.w("CivilCam", "MSAL", e)
        }
    }

    fun available(): Boolean = failed == null

    private fun whenReady(block: () -> Unit) {
        if (app != null || failed != null) block() else waiting.add(block)
    }

    /** A Graph access token for OneDrive. interactive = may show Microsoft's sign-in screen. */
    fun getToken(requestId: String, interactive: Boolean, loginHint: String) = activity.runOnUiThread {
        whenReady {
            val a = app
            if (a == null) { reply(requestId, null, failed ?: "OneDrive is not available", null); return@whenReady }
            Thread {
                val account = try { a.currentAccount?.currentAccount } catch (e: Exception) { null }
                activity.runOnUiThread {
                    if (account != null) silent(a, account, requestId, interactive)
                    else if (interactive) signIn(a, requestId, loginHint)
                    else reply(requestId, null, "Not connected to OneDrive", null)
                }
            }.start()
        }
    }

    private fun silent(a: ISingleAccountPublicClientApplication, account: IAccount, requestId: String, interactive: Boolean) {
        val params = AcquireTokenSilentParameters.Builder()
            .forAccount(account)
            .fromAuthority(account.authority)
            .withScopes(SCOPES)
            .withCallback(object : SilentAuthenticationCallback {
                override fun onSuccess(result: IAuthenticationResult) = done(requestId, result)
                override fun onError(e: MsalException) {
                    if (interactive) interactiveToken(a, account, requestId)
                    else reply(requestId, null, e.message ?: "OneDrive sign-in needed", null)
                }
            })
            .build()
        a.acquireTokenSilentAsync(params)
    }

    private fun signIn(a: ISingleAccountPublicClientApplication, requestId: String, loginHint: String) {
        val b = SignInParameters.builder()
            .withActivity(activity)
            .withScopes(SCOPES)
            .withCallback(callback(requestId))
        if (loginHint.isNotBlank()) b.withLoginHint(loginHint)
        a.signIn(b.build())
    }

    private fun interactiveToken(a: ISingleAccountPublicClientApplication, account: IAccount, requestId: String) {
        val params = AcquireTokenParameters.Builder()
            .startAuthorizationFromActivity(activity)
            .forAccount(account)
            .withScopes(SCOPES)
            .withCallback(callback(requestId))
            .build()
        a.acquireToken(params)
    }

    private fun callback(requestId: String) = object : AuthenticationCallback {
        override fun onSuccess(result: IAuthenticationResult) = done(requestId, result)
        override fun onError(e: MsalException) = reply(requestId, null, e.message ?: "OneDrive sign-in failed", null)
        override fun onCancel() = reply(requestId, null, "cancelled", null)
    }

    private fun done(requestId: String, result: IAuthenticationResult) {
        val acc = JSONObject().put("username", result.account.username ?: "")
        reply(requestId, result.accessToken, null, acc.toString())
    }

    /** Forgets the Microsoft account on this phone (photos already in OneDrive stay there). */
    fun signOut() = activity.runOnUiThread {
        whenReady {
            app?.signOut(object : ISingleAccountPublicClientApplication.SignOutCallback {
                override fun onSignOut() {}
                override fun onError(e: MsalException) { Log.w("CivilCam", "MSAL sign-out: ${e.message}") }
            })
        }
    }

    private fun reply(requestId: String, token: String?, error: String?, account: String?) {
        fun q(s: String?) = if (s == null) "null" else JSONObject.quote(s)
        activity.runOnUiThread {
            webView.evaluateJavascript(
                "window.onNativeOneDriveToken && window.onNativeOneDriveToken(${q(requestId)}, ${q(token)}, ${q(error)}, ${account ?: "null"})", null)
        }
    }
}
