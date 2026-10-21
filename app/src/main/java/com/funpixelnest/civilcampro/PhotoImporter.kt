package com.funpixelnest.civilcampro

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.exifinterface.media.ExifInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/**
 * Brings in photos taken with other camera apps (GPS Map Camera, Timestamp Camera, the phone's own
 * camera, WhatsApp images ...), with the date, time and GPS saved inside each photo (EXIF).
 *
 *  - pickPhotos(): the system file picker, any number of photos.
 *  - addFolder() / scanFolders(): "sync a camera folder". The engineer picks e.g. DCIM/GPS Map Camera
 *    once; afterwards new photos in it are found every time the app opens.
 *
 * Only the system pickers are used, so the app does not need the broad photo-library permission
 * (Google Play restricts that). ACCESS_MEDIA_LOCATION lets Android keep the GPS inside the photo.
 *
 * Results go to the page one photo at a time: window.onNativeImportItem(job, json) and finally
 * window.onNativeImportDone(job, count, failed).
 */
class PhotoImporter(private val activity: AppCompatActivity, private val webView: WebView) {

    private val prefs = activity.getSharedPreferences("civilcam_import", Context.MODE_PRIVATE)
    private val worker = Executors.newSingleThreadExecutor()
    private var job = ""
    private var afterPermission: (() -> Unit)? = null

    private val pickLauncher = activity.registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) done(job, 0, 0) else load(job, uris.map { Item(it, "", "", 0L, 0L) }, "Picked")
    }

    private val treeLauncher = activity.registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri == null) { js("window.onNativeFolders && window.onNativeFolders(${JSONObject.quote(foldersJson())}, '')"); return@registerForActivityResult }
        try {
            activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (e: SecurityException) { Log.w("CivilCam", "No persistable permission", e) }
        val list = folders().apply { put(JSONObject().put("uri", uri.toString()).put("name", folderName(uri)).put("added", System.currentTimeMillis())) }
        prefs.edit().putString("folders", list.toString()).apply()
        js("window.onNativeFolders && window.onNativeFolders(${JSONObject.quote(foldersJson())}, ${JSONObject.quote(uri.toString())})")
    }

    private val locationPermission = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { _ ->
        afterPermission?.invoke(); afterPermission = null
    }

    private fun withMediaLocation(then: () -> Unit) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_MEDIA_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            then(); return
        }
        afterPermission = then
        locationPermission.launch(Manifest.permission.ACCESS_MEDIA_LOCATION)
    }

    fun pickPhotos(jobId: String) = activity.runOnUiThread {
        job = jobId
        withMediaLocation { pickLauncher.launch(arrayOf("image/jpeg", "image/png", "image/heic", "image/heif", "image/webp")) }
    }

    // ---------- synced camera folders ----------
    private fun folders(): JSONArray = try { JSONArray(prefs.getString("folders", "[]")) } catch (e: Exception) { JSONArray() }

    fun foldersJson(): String {
        // drop folders whose permission was removed in Android settings
        val granted = activity.contentResolver.persistedUriPermissions.map { it.uri.toString() }.toSet()
        val out = JSONArray()
        val all = folders()
        for (i in 0 until all.length()) { val f = all.getJSONObject(i); if (f.getString("uri") in granted) out.put(f) }
        return out.toString()
    }

    fun addFolder() = activity.runOnUiThread { withMediaLocation { treeLauncher.launch(null) } }

    fun removeFolder(uri: String) {
        val all = folders(); val out = JSONArray()
        for (i in 0 until all.length()) { val f = all.getJSONObject(i); if (f.getString("uri") != uri) out.put(f) }
        prefs.edit().putString("folders", out.toString()).apply()
        try { activity.contentResolver.releasePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (e: Exception) {}
    }

    private fun folderName(tree: Uri): String = try {
        val id = DocumentsContract.getTreeDocumentId(tree)            // "primary:DCIM/GPS Map Camera"
        id.substringAfter(':').ifEmpty { "Phone storage" }
    } catch (e: Exception) { "Folder" }

    /**
     * Lists photos in the synced folders changed after `sinceJson` ({folderUri: millis}) and loads them.
     * Looks one level of sub-folders deep (many camera apps file photos by date).
     */
    fun scanFolders(jobId: String, sinceJson: String) {
        worker.execute {
            val since = try { JSONObject(sinceJson) } catch (e: Exception) { JSONObject() }
            val items = mutableListOf<Item>()
            val all = JSONArray(foldersJson())
            for (i in 0 until all.length()) {
                val f = all.getJSONObject(i)
                val tree = Uri.parse(f.getString("uri"))
                val after = since.optLong(f.getString("uri"), 0L)
                try {
                    listTree(tree, DocumentsContract.getTreeDocumentId(tree), f.optString("name"), f.getString("uri"), after, items, 0)
                } catch (e: Exception) { Log.w("CivilCam", "Folder scan failed: ${f.optString("name")}", e) }
            }
            items.sortBy { it.modified }
            loadNow(jobId, items.take(300), "Folder")
        }
    }

    private fun listTree(tree: Uri, docId: String, folder: String, folderUri: String, after: Long, out: MutableList<Item>, depth: Int) {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
        val cols = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_SIZE)
        activity.contentResolver.query(children, cols, null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val id = c.getString(0); val name = c.getString(1) ?: ""; val mime = c.getString(2) ?: ""
                val modified = c.getLong(3); val size = c.getLong(4)
                if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                    if (depth < 1) listTree(tree, id, "$folder/$name", folderUri, after, out, depth + 1)
                } else if (mime.startsWith("image/") && modified > after) {
                    out.add(Item(DocumentsContract.buildDocumentUriUsingTree(tree, id), name, folder, modified, size, folderUri))
                }
            }
        }
    }

    // ---------- reading each photo ----------
    data class Item(val uri: Uri, val name: String, val folder: String, val modified: Long, val size: Long, val folderUri: String = "")

    private fun load(jobId: String, items: List<Item>, source: String) = worker.execute { loadNow(jobId, items, source) }

    private fun loadNow(jobId: String, items: List<Item>, source: String) {
        var ok = 0; var failed = 0
        items.forEachIndexed { index, it ->
            try {
                val json = read(it, source)
                json.put("index", index).put("total", items.size)
                js("window.onNativeImportItem && window.onNativeImportItem(${JSONObject.quote(jobId)}, ${JSONObject.quote(json.toString())})")
                ok++
            } catch (e: Throwable) {
                Log.w("CivilCam", "Could not import ${it.uri}", e); failed++
            }
        }
        done(jobId, ok, failed)
    }

    private fun read(item: Item, source: String): JSONObject {
        val cr = activity.contentResolver
        val meta = describe(item)
        // Try the original (GPS kept) first; fall back to the file as given
        val bytes = (try { cr.openInputStream(originalUri(item.uri))?.use { it.readBytes() } } catch (e: Exception) { null })
            ?: cr.openInputStream(item.uri)?.use { it.readBytes() } ?: throw IllegalStateException("empty")
        val exif = try { ExifInterface(ByteArrayInputStream(bytes)) } catch (e: Exception) { null }
        val out = JSONObject()
            .put("key", item.uri.toString())
            .put("name", meta.first.ifEmpty { item.name })
            .put("folder", item.folder)
            .put("folderUri", item.folderUri)
            .put("source", source)
            .put("modified", if (item.modified > 0) item.modified else meta.second)
            .put("bytes", bytes.size)
        exif?.let { e ->
            e.latLong?.let { ll -> if (ll[0] != 0.0 || ll[1] != 0.0) out.put("lat", ll[0]).put("lng", ll[1]) }
            if (e.hasAttribute(ExifInterface.TAG_GPS_ALTITUDE)) out.put("alt", e.getAltitude(0.0))
            e.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL)?.let { out.put("taken", it) }
                ?: e.getAttribute(ExifInterface.TAG_DATETIME)?.let { out.put("taken", it) }
            e.getAttribute(ExifInterface.TAG_OFFSET_TIME_ORIGINAL)?.let { out.put("offset", it) }
            e.getAttribute(ExifInterface.TAG_MAKE)?.let { out.put("make", it) }
            e.getAttribute(ExifInterface.TAG_MODEL)?.let { out.put("model", it) }
            e.getAttribute(ExifInterface.TAG_SOFTWARE)?.let { out.put("software", it) }
            e.getAttribute(ExifInterface.TAG_IMAGE_DESCRIPTION)?.let { if (it.isNotBlank()) out.put("description", it.trim()) }
            e.getAttribute(ExifInterface.TAG_USER_COMMENT)?.let { if (it.isNotBlank()) out.put("comment", it.trim()) }
        }
        out.put("image", "data:image/jpeg;base64," + Base64.encodeToString(shrink(bytes, exif?.rotationDegrees ?: 0), Base64.NO_WRAP))
        return out
    }

    // For photos coming from the phone's media library, ask Android for the original with GPS kept
    private fun originalUri(uri: Uri): Uri {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return uri
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_MEDIA_LOCATION) != PackageManager.PERMISSION_GRANTED) return uri
        return try {
            when (uri.authority) {
                MediaStore.AUTHORITY -> MediaStore.setRequireOriginal(uri)
                // "Images" in the file picker: turn the document into its media item to get the original
                "com.android.providers.media.documents" ->
                    MediaStore.getMediaUri(activity, uri)?.let { MediaStore.setRequireOriginal(it) } ?: uri
                else -> uri
            }
        } catch (e: Exception) { uri }
    }

    private fun describe(item: Item): Pair<String, Long> = try {
        activity.contentResolver.query(item.uri, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_LAST_MODIFIED), null, null, null)?.use { c ->
            if (c.moveToFirst()) Pair(c.getString(0) ?: "", if (c.columnCount > 1 && !c.isNull(1)) c.getLong(1) else 0L) else Pair("", 0L)
        } ?: Pair("", 0L)
    } catch (e: Exception) { Pair("", 0L) }

    /** Keeps photos sharp but small enough for the app: longest side 2048 px, upright, JPEG. */
    private fun shrink(bytes: ByteArray, rotation: Int): ByteArray {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 2048) sample *= 2
        var bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw IllegalStateException("not an image")
        val longest = maxOf(bmp.width, bmp.height)
        if (longest > 2048 || rotation != 0) {
            val k = minOf(1f, 2048f / longest)
            val m = Matrix().apply { postScale(k, k); if (rotation != 0) postRotate(rotation.toFloat()) }
            val rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
            if (rotated != bmp) bmp.recycle()
            bmp = rotated
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 88, out)
        bmp.recycle()
        return out.toByteArray()
    }

    private fun done(jobId: String, ok: Int, failed: Int) =
        js("window.onNativeImportDone && window.onNativeImportDone(${JSONObject.quote(jobId)}, $ok, $failed)")

    private fun js(code: String) = activity.runOnUiThread { webView.evaluateJavascript(code, null) }
}
