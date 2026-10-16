package com.funpixelnest.civilcampro

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
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
 */
class WebAppBridge(private val activity: Activity) {

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

    @JavascriptInterface
    fun shareFiles(filesJson: String, text: String) {
        try {
            val items = JSONArray(filesJson)
            val dir = File(activity.cacheDir, "shared").apply {
                deleteRecursively()
                mkdirs()
            }
            val uris = ArrayList<Uri>()
            var mime = "image/jpeg"
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val file = File(dir, cleanName(item.getString("name")))
                file.writeBytes(Base64.decode(item.getString("data"), Base64.DEFAULT))
                uris.add(FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file))
                mime = item.optString("mime", mime)
            }
            if (uris.isEmpty()) return

            val intent = if (uris.size == 1) {
                Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris[0])
            } else {
                Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            }
            intent.type = mime
            if (text.isNotBlank()) intent.putExtra(Intent.EXTRA_TEXT, text)
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

            activity.runOnUiThread {
                activity.startActivity(Intent.createChooser(intent, "Share photos"))
            }
        } catch (e: Exception) {
            Log.e("CivilCam", "shareFiles failed", e)
        }
    }
}
