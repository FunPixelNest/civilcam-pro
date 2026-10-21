package com.funpixelnest.civilcampro

import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONArray
import java.io.File

/**
 * Exposed to the web page as `window.AndroidBridge`.
 *
 *  - saveFile(): images go to Pictures/CivilCam (so they show in the Gallery),
 *    PDF / Excel / Word reports go to Download/CivilCam.
 *  - shareFiles(): opens the Android share sheet (WhatsApp, Gmail, Drive...).
 *  - shareToApp(): sends straight to one app, e.g. "whatsapp".
 *  - authAvailable() / signIn() / getIdToken() / signOut(): Firebase sign-in.
 */
class WebAppBridge(
    private val activity: Activity,
    private val auth: AuthHelper,
    private val billing: BillingHelper,
    private val ads: AdsManager,
    private val importer: PhotoImporter
) {

    // ----- sign-in (see AuthHelper) -----
    @JavascriptInterface
    fun authAvailable(): Boolean = auth.available()

    @JavascriptInterface
    fun signIn(provider: String) = auth.signIn(provider)

    @JavascriptInterface
    fun getIdToken(requestId: String) = auth.getIdToken(requestId)

    @JavascriptInterface
    fun signOut() = auth.signOut()

    // ----- Google Drive backup (see AuthHelper.getDriveToken) -----
    @JavascriptInterface
    fun getDriveToken(requestId: String, interactive: Boolean) = auth.getDriveToken(requestId, interactive)

    /** Opens a web link (e.g. a photo's Google Drive page) in the browser or the Drive app. */
    @JavascriptInterface
    fun openLink(url: String): Boolean {
        if (!url.startsWith("https://")) return false
        activity.runOnUiThread {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (e: ActivityNotFoundException) {
                Toast.makeText(activity, "No app on this phone can open the link", Toast.LENGTH_LONG).show()
            }
        }
        return true
    }

    // ---------- photos from other camera apps ----------
    @JavascriptInterface fun importPhotos(job: String) = importer.pickPhotos(job)
    @JavascriptInterface fun importFolders(): String = importer.foldersJson()
    @JavascriptInterface fun addImportFolder() = importer.addFolder()
    @JavascriptInterface fun removeImportFolder(uri: String) = importer.removeFolder(uri)
    @JavascriptInterface fun scanImportFolders(job: String, sinceJson: String) = importer.scanFolders(job, sinceJson)

    // ---------- ads (free version) ----------
    @JavascriptInterface fun setBannerVisible(visible: Boolean) = ads.setBannerVisible(visible)
    @JavascriptInterface fun showInterstitial(id: String) = ads.showInterstitial(id)
    @JavascriptInterface fun rewardedReady(): Boolean = ads.rewardedReady()
    @JavascriptInterface fun showRewarded(id: String) = ads.showRewarded(id)
    @JavascriptInterface fun adPrivacyRequired(): Boolean = ads.privacyOptionsRequired()
    @JavascriptInterface fun showAdPrivacy() = ads.showPrivacyOptions()

    // ---------- CivilCam Pro ----------
    @JavascriptInterface fun isPro(): Boolean = billing.isPro
    @JavascriptInterface fun proPlans(): String = billing.plansJson()
    @JavascriptInterface fun buyPro(plan: String) = billing.buy(plan)
    @JavascriptInterface fun restorePro() = billing.refreshPurchases()
    @JavascriptInterface fun managePro() = billing.manage()

    /**
     * Place name for the photo stamp ("Banjara Hills, Hyderabad, Telangana"), using the phone's own
     * geocoder (needs internet). Answers window.onNativeAddress(id, text) with "" if not found.
     */
    @JavascriptInterface
    fun reverseGeocode(id: String, lat: Double, lng: Double) {
        Thread {
            var text = ""
            try {
                if (android.location.Geocoder.isPresent()) {
                    @Suppress("DEPRECATION")
                    val list = android.location.Geocoder(activity, java.util.Locale.getDefault()).getFromLocation(lat, lng, 1)
                    val a = list?.firstOrNull()
                    if (a != null) {
                        text = listOfNotNull(a.subLocality, a.locality ?: a.subAdminArea, a.adminArea)
                            .filter { it.isNotBlank() }.distinct().joinToString(", ")
                            .ifEmpty { a.getAddressLine(0) ?: "" }
                    }
                }
            } catch (e: Exception) { Log.w("CivilCam", "Geocoder: ${e.message}") }
            activity.runOnUiThread {
                activity.findViewById<android.webkit.WebView>(R.id.webView)?.evaluateJavascript("window.onNativeAddress && window.onNativeAddress(${org.json.JSONObject.quote(id)}, ${org.json.JSONObject.quote(text)})", null)
            }
        }.start()
    }

    /** Opens the phone's e-mail app with a message ready to send (support and suggestions). */
    @JavascriptInterface
    fun sendEmail(to: String, subject: String, body: String): Boolean {
        val intent = Intent(Intent.ACTION_SENDTO).apply {
            data = Uri.parse("mailto:")
            putExtra(Intent.EXTRA_EMAIL, arrayOf(to))
            putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, body)
        }
        activity.runOnUiThread {
            try {
                activity.startActivity(Intent.createChooser(intent, "Send with"))
            } catch (e: ActivityNotFoundException) {
                Toast.makeText(activity, "No e-mail app on this phone. Write to $to", Toast.LENGTH_LONG).show()
            }
        }
        return true
    }

    /** App version, for support messages. */
    @JavascriptInterface
    fun appVersion(): String = try {
        val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
        "${info.versionName} (${if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()})"
    } catch (e: Exception) { "" }

    /** Phone model and Android version, for support messages. */
    @JavascriptInterface
    fun deviceInfo(): String = "${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"

    private fun cleanName(name: String): String =
        name.replace(Regex("[\\\\/:*?\"<>|\\s]+"), "_").take(150)

    /**
     * Saves the file and returns a content:// link to it, or "" if saving failed.
     * The page uses the link for the "Open" button.
     */
    @JavascriptInterface
    fun saveFile(base64: String, fileName: String, mimeType: String): String {
        return try {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val name = cleanName(fileName)
            val isImage = mimeType.startsWith("image/")

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val collection: Uri
                val relativePath: String
                if (isImage) {
                    collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                    relativePath = Environment.DIRECTORY_PICTURES + "/CivilCam"
                } else {
                    collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
                    relativePath = Environment.DIRECTORY_DOWNLOADS + "/CivilCam"
                }
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                    put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val resolver = activity.contentResolver
                val uri = resolver.insert(collection, values) ?: return ""
                resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return ""
                // Mark the file as finished so the Files and Gallery apps show it
                resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                Log.i("CivilCam", "Saved $relativePath/$name (${bytes.size} bytes) -> $uri")
                uri.toString()
            } else {
                @Suppress("DEPRECATION")
                val base = Environment.getExternalStoragePublicDirectory(
                    if (isImage) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_DOWNLOADS
                )
                val dir = File(base, "CivilCam").apply { mkdirs() }
                val file = File(dir, name)
                file.writeBytes(bytes)
                MediaScannerConnection.scanFile(activity, arrayOf(file.absolutePath), arrayOf(mimeType), null)
                Log.i("CivilCam", "Saved ${file.absolutePath} (${bytes.size} bytes)")
                FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file).toString()
            }
        } catch (e: Exception) {
            Log.e("CivilCam", "saveFile failed", e)
            ""
        }
    }

    /** Opens a saved file in the phone's PDF viewer, Excel/Word app or Gallery. */
    @JavascriptInterface
    fun openFile(uriString: String, mimeType: String): Boolean {
        return try {
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(Uri.parse(uriString), mimeType)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            activity.runOnUiThread {
                try {
                    activity.startActivity(Intent.createChooser(intent, "Open with"))
                } catch (e: ActivityNotFoundException) {
                    Toast.makeText(activity, "No app on this phone can open this file type", Toast.LENGTH_LONG).show()
                }
            }
            true
        } catch (e: Exception) {
            Log.e("CivilCam", "openFile failed", e)
            false
        }
    }

    /**
     * Opens the phone's file manager at the folder the app saves into:
     * kind "photos" -> Pictures/CivilCam, anything else -> Download/CivilCam.
     * Phones differ, so it tries the folder itself first, then the Downloads list,
     * and finally tells the user where to look.
     */
    @JavascriptInterface
    fun openFolder(kind: String): Boolean {
        val folder = if (kind == "photos") "Pictures/CivilCam" else "Download/CivilCam"
        val folderUri = DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:$folder")
        val attempts = mutableListOf(
            Intent(Intent.ACTION_VIEW).setDataAndType(folderUri, DocumentsContract.Document.MIME_TYPE_DIR),
            Intent(Intent.ACTION_VIEW).setDataAndType(folderUri, "resource/folder")
        )
        if (kind != "photos") attempts.add(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS))
        activity.runOnUiThread {
            for (intent in attempts) {
                try {
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                    activity.startActivity(intent)
                    return@runOnUiThread
                } catch (e: Exception) {
                    Log.i("CivilCam", "openFolder: ${intent.action} not handled (${e.javaClass.simpleName})")
                }
            }
            Toast.makeText(activity, "Open the Files app and go to $folder", Toast.LENGTH_LONG).show()
        }
        return true
    }

    @JavascriptInterface
    fun shareFiles(filesJson: String, text: String) {
        val intent = buildShareIntent(filesJson, text) ?: return
        activity.runOnUiThread { activity.startActivity(Intent.createChooser(intent, "Share")) }
    }

    /** app: "whatsapp" sends straight to WhatsApp (or WhatsApp Business); falls back to the share sheet. */
    @JavascriptInterface
    fun shareToApp(filesJson: String, text: String, app: String) {
        val intent = buildShareIntent(filesJson, text) ?: return
        val packages = when (app) {
            "whatsapp" -> listOf("com.whatsapp", "com.whatsapp.w4b")
            else -> emptyList()
        }
        val target = packages.firstOrNull { isInstalled(it) }
        activity.runOnUiThread {
            try {
                if (target != null) {
                    intent.setPackage(target)
                    activity.startActivity(intent)
                } else {
                    if (packages.isNotEmpty()) Toast.makeText(activity, "WhatsApp is not installed", Toast.LENGTH_SHORT).show()
                    activity.startActivity(Intent.createChooser(intent, "Share"))
                }
            } catch (e: ActivityNotFoundException) {
                intent.setPackage(null)
                activity.startActivity(Intent.createChooser(intent, "Share"))
            }
        }
    }

    private fun isInstalled(pkg: String): Boolean = try {
        @Suppress("DEPRECATION")
        activity.packageManager.getPackageInfo(pkg, 0)
        true
    } catch (e: Exception) {
        false
    }

    private fun buildShareIntent(filesJson: String, text: String): Intent? {
        return try {
            val items = JSONArray(filesJson)
            val dir = File(activity.cacheDir, "shared").apply {
                deleteRecursively()
                mkdirs()
            }
            val uris = ArrayList<Uri>()
            val mimes = HashSet<String>()
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val file = File(dir, cleanName(item.getString("name")))
                file.writeBytes(Base64.decode(item.getString("data"), Base64.DEFAULT))
                uris.add(FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file))
                mimes.add(item.optString("mime", "application/octet-stream"))
            }
            if (uris.isEmpty()) return null
            val intent = if (uris.size == 1) {
                Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris[0])
            } else {
                Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            }
            intent.type = if (mimes.size == 1) mimes.first() else "*/*"
            if (text.isNotBlank()) intent.putExtra(Intent.EXTRA_TEXT, text)
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            intent
        } catch (e: Exception) {
            Log.e("CivilCam", "share failed", e)
            null
        }
    }
}
