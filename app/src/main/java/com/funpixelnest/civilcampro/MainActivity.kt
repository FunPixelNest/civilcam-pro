package com.funpixelnest.civilcampro

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.*
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var auth: AuthHelper
    lateinit var billing: BillingHelper
    lateinit var ads: AdsManager
    lateinit var importer: PhotoImporter
    lateinit var oneDrive: OneDriveHelper

    private val requiredPermissions: Array<String>
        get() {
            val list = mutableListOf(
                Manifest.permission.CAMERA,
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            )
            // Android 9 and below need this to save into Downloads / Pictures
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
                list.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            }
            return list.toTypedArray()
        }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        if (!permissions.values.all { it }) {
            Toast.makeText(
                this,
                "Camera, Location and Storage permissions are needed for full functionality",
                Toast.LENGTH_LONG
            ).show()
        }
        loadApp()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        applySystemBarInsets()
        setupWebView()
        setupBack()
        checkAndRequestPermissions()
        billing.start()
        ads.start()
    }

    // Android 15+ draws apps edge to edge: keep the page clear of the status bar, the
    // navigation bar and the keyboard.
    private fun applySystemBarInsets() {
        val root = findViewById<View>(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
    }

    // The page closes its own sheets / goes up a screen first; only then does Back leave the app
    private fun setupBack() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("(window.onAndroidBack && window.onAndroidBack()) ? 'y' : 'n'") { result ->
                    if (result?.contains("y") != true) finish()
                }
            }
        })
    }

    private fun setupWebView() {
        webView = findViewById(R.id.webView)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = true
            mediaPlaybackRequiresUserGesture = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        // Native bridge used by the page for saving and sharing files
        auth = AuthHelper(this, webView)
        billing = BillingHelper(this, webView)
        ads = AdsManager(this, findViewById<FrameLayout>(R.id.adContainer), webView) { billing.isPro }
        importer = PhotoImporter(this, webView)
        oneDrive = OneDriveHelper(this, webView)
        billing.onProChanged = { pro -> ads.onProChanged(pro) }
        webView.addJavascriptInterface(WebAppBridge(this, auth, billing, ads, importer, oneDrive), "AndroidBridge")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { request.grant(request.resources) }
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String,
                callback: GeolocationPermissions.Callback
            ) {
                callback.invoke(origin, true, false)
            }

            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                filePathCallback.onReceiveValue(null)
                return true
            }

            override fun onConsoleMessage(cm: ConsoleMessage): Boolean {
                Log.d("CivilCam", "[${cm.messageLevel()}] ${cm.message()} (${cm.sourceId()}:${cm.lineNumber()})")
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = false

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                Log.e("CivilCam", "WebView error: ${error.description}")
            }
        }

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
    }

    private fun checkAndRequestPermissions() {
        val missing = requiredPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) loadApp() else permissionLauncher.launch(missing.toTypedArray())
    }

    private fun loadApp() {
        if (webView.url == null) {
            webView.loadUrl("file:///android_asset/civilcam/index.html")
        }
    }

    override fun onStart() {
        super.onStart()
        ads.onAppForeground()
    }

    override fun onStop() {
        super.onStop()
        ads.onAppBackground()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        billing.refreshPurchases()
    }

    override fun onDestroy() {
        ads.destroy()
        billing.end()
        webView.destroy()
        super.onDestroy()
    }
}
