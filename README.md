# CivilCam Pro

Site photography app for civil engineers. Android app (Kotlin + WebView) with the app screens written in HTML/CSS/JS.

## Features

- **Photo stamp** with project, activity, chainage, side (LHS / RHS / Both Sides / Median / Centre Line), date and time, GPS and remarks
- **18 activity types** (Earthwork, Roadwork, Concrete Works, Drainage, Bridge Works and more)
- **Gallery** grouped by day, week, month, quarter, year or activity, and searchable by activity, chainage, side and remarks
- **Reports** in PDF (4 layouts: Grid, Inspection, Activity-wise, Log Sheet), Excel and Word
- **Saving on the phone:** photos go to `Pictures/CivilCam` and reports go to `Download/CivilCam`
- **Sharing** through the Android share sheet (WhatsApp, Gmail, Drive and so on)
- Photos are stored on the device (IndexedDB) and work offline

## Opening the project

1. Open this folder in Android Studio (**File → Open**).
2. Let Gradle sync, then press **Run ▶**.

The first build downloads the PDF and Excel libraries into `app/src/main/assets/civilcam/`. If that download fails, the app loads them from the internet the first time you export.

`gradle/wrapper/gradle-wrapper.properties` points to a Gradle zip saved locally in Downloads. On another computer, switch it back to the online URL noted in that file.

## Where things live

| What | File |
|------|------|
| Screen layout | `app/src/main/assets/civilcam/index.html` |
| Styles | `app/src/main/assets/civilcam/css/app.css` |
| State, storage, save/share helpers | `app/src/main/assets/civilcam/js/core.js` |
| Camera, chainage/side, photo stamp | `app/src/main/assets/civilcam/js/camera.js` |
| Gallery and photo details | `app/src/main/assets/civilcam/js/gallery.js` |
| PDF reports | `app/src/main/assets/civilcam/js/export-pdf.js` |
| Excel and Word reports | `app/src/main/assets/civilcam/js/export-office.js` |
| Project setup, tabs, start-up | `app/src/main/assets/civilcam/js/app.js` |
| Android screen and permissions | `app/src/main/java/com/funpixelnest/civilcampro/MainActivity.kt` |
| Native saving and sharing | `app/src/main/java/com/funpixelnest/civilcampro/WebAppBridge.kt` |
