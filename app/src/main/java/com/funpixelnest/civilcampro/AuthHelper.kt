package com.funpixelnest.civilcampro

import android.os.CancellationSignal
import android.util.Log
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.AuthCredential
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.auth.OAuthProvider
import org.json.JSONObject

/**
 * Sign-in with Google, Microsoft (incl. company / Entra ID accounts) and Apple through Firebase Auth.
 * Google blocks sign-in pages inside a WebView, so this runs natively and reports back to the page
 * by calling window.onNativeAuth(json) and window.onNativeToken(id, token, error).
 *
 * Works only when app/google-services.json is present (see firebase/SETUP.md); otherwise
 * available() is false and the page hides the sign-in buttons.
 */
class AuthHelper(private val activity: AppCompatActivity, private val webView: WebView) {

    private val auth: FirebaseAuth? by lazy {
        try {
            if (FirebaseApp.getApps(activity).isEmpty()) FirebaseApp.initializeApp(activity)
            if (FirebaseApp.getApps(activity).isEmpty()) null else FirebaseAuth.getInstance()
        } catch (e: Exception) {
            Log.w("CivilCam", "Firebase not configured", e)
            null
        }
    }

    private val webClientId: String?
        get() {
            val id = activity.resources.getIdentifier("default_web_client_id", "string", activity.packageName)
            return if (id == 0) null else activity.getString(id)
        }

    fun available(): Boolean = auth != null

    fun signIn(provider: String) {
        activity.runOnUiThread {
            when (provider) {
                "google" -> signInWithGoogle()
                "microsoft" -> signInWithProvider("microsoft.com", "Microsoft", listOf("email", "profile", "openid"))
                "apple" -> signInWithProvider("apple.com", "Apple", listOf("email", "name"))
                else -> reportError("Unknown sign-in option")
            }
        }
    }

    private fun signInWithGoogle() {
        val clientId = webClientId ?: return reportError("Google sign-in is not set up (no web client ID)")
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetSignInWithGoogleOption.Builder(clientId).build())
            .build()
        CredentialManager.create(activity).getCredentialAsync(
            activity, request, CancellationSignal(), ContextCompat.getMainExecutor(activity),
            object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                override fun onResult(result: GetCredentialResponse) {
                    val cred = result.credential
                    if (cred is CustomCredential && cred.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                        val google = GoogleIdTokenCredential.createFrom(cred.data)
                        firebaseSignIn(GoogleAuthProvider.getCredential(google.idToken, null), "Google")
                    } else {
                        reportError("Unexpected Google account type")
                    }
                }

                override fun onError(e: GetCredentialException) {
                    if (e is GetCredentialCancellationException) reportError("cancelled") else reportError(e.message ?: "Google sign-in failed")
                }
            })
    }

    private fun signInWithProvider(providerId: String, label: String, scopes: List<String>) {
        val a = auth ?: return reportError("Sign-in is not set up")
        val provider = OAuthProvider.newBuilder(providerId).apply {
            setScopes(scopes)
            if (providerId == "microsoft.com") addCustomParameter("prompt", "select_account")
        }.build()
        val pending = a.pendingAuthResult
        val task = pending ?: a.startActivityForSignInWithProvider(activity, provider)
        task.addOnSuccessListener { report(it.user, label) }
            .addOnFailureListener { reportError(it.message ?: "$label sign-in failed") }
    }

    private fun firebaseSignIn(credential: AuthCredential, label: String) {
        val a = auth ?: return reportError("Sign-in is not set up")
        a.signInWithCredential(credential)
            .addOnSuccessListener { report(it.user, label) }
            .addOnFailureListener { reportError(it.message ?: "Sign-in failed") }
    }

    fun getIdToken(requestId: String) {
        val user = auth?.currentUser
        if (user == null) {
            sendToken(requestId, null, "Not signed in")
            return
        }
        user.getIdToken(false)
            .addOnSuccessListener { sendToken(requestId, it.token, null) }
            .addOnFailureListener { sendToken(requestId, null, it.message) }
    }

    fun signOut() {
        activity.runOnUiThread {
            auth?.signOut()
            try {
                CredentialManager.create(activity).clearCredentialStateAsync(
                    androidx.credentials.ClearCredentialStateRequest(), CancellationSignal(),
                    ContextCompat.getMainExecutor(activity),
                    object : CredentialManagerCallback<Void?, androidx.credentials.exceptions.ClearCredentialException> {
                        override fun onResult(result: Void?) {}
                        override fun onError(e: androidx.credentials.exceptions.ClearCredentialException) {}
                    })
            } catch (e: Exception) { /* nothing to clear */ }
        }
    }

    // ----- replies to the page -----
    private fun report(user: FirebaseUser?, label: String) {
        if (user == null) return reportError("No account returned")
        val email = user.email ?: user.providerData.firstOrNull { !it.email.isNullOrBlank() }?.email ?: ""
        val name = user.displayName ?: user.providerData.firstOrNull { !it.displayName.isNullOrBlank() }?.displayName ?: ""
        val json = JSONObject()
            .put("ok", true).put("uid", user.uid).put("email", email).put("name", name).put("provider", label)
        callPage("window.onNativeAuth(${JSONObject.quote(json.toString())})")
    }

    private fun reportError(message: String) {
        val json = JSONObject().put("ok", false).put("error", message)
        callPage("window.onNativeAuth(${JSONObject.quote(json.toString())})")
    }

    private fun sendToken(requestId: String, token: String?, error: String?) {
        val t = if (token == null) "null" else JSONObject.quote(token)
        val e = if (error == null) "null" else JSONObject.quote(error)
        callPage("window.onNativeToken(${JSONObject.quote(requestId)}, $t, $e)")
    }

    private fun callPage(js: String) {
        webView.post { webView.evaluateJavascript(js, null) }
    }
}
