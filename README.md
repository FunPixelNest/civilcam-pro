# CivilCam Pro

Site photography app for civil engineers. It's an Android app (Kotlin + WebView), and its screens are written in HTML/CSS/JS.

## Features

- **Projects:**
  - Each project has a short name, a full name (printed on every report page), a type, and an optional start and end chainage.
  - Photos stay inside their project.
- **Photo details:**
  - Activity, chainage From – To, side, and photo type (General / Hindrance).
  - Hindrance photos get fields for land owner, phone, survey no., village, issue and area, and you can add your own fields.
  - A description box with no length limit.
- **"Others" in every list** (activity, side, type, project type, hindrance fields). A new value is saved once and appears as a normal choice from then on. With sign-in it is shared with the company.
- **Engineer name** goes on the stamp, into the photo's details and into reports.
- **Stamp** on the photo. Long text wraps onto extra lines instead of being cut.
- **Metadata inside the JPEG (EXIF):** description, engineer, date/time and GPS. Phone galleries and Windows file properties can show it.
- **Blur check** after each shot, on the phone. Offers a retake.
- **Gallery:**
  - Filter by period, activity, side, type and chainage range.
  - Plain-words search, e.g. "culvert near 14 km last month".
- **Chainage strip** for road projects:
  - Every photo placed between the start and end chainage.
  - Filter by time period and activity.
  - Nearby photos grouped (25–500 m). Open a group to see its photos date-wise, compare two dates side by side, or make a report of that location.
- **Reports:**
  - PDF, Word (.docx), Excel (.xlsx) and PowerPoint (.pptx).
  - Layouts: 1, 2, 4 or 6 photos per page, or *same chainage, date-wise*.
  - Every page has the full project name at the top with the title below, captions under each photo, and "Prepared by" and page numbers in the footer.
  - Excel is a photo register: S.No, a large photo cell, and the description written as one sentence.
- **Sharing:** WhatsApp, the Android share sheet, Open, and Save. Reports are saved in `Download/CivilCam` and photos in `Pictures/CivilCam`.
- **Optional cloud features** (see `firebase/SETUP.md`):
  - Google / Microsoft (company ID) / Apple sign-in.
  - Sync and company-wide sharing.
  - AI photo descriptions, AI progress summaries for a chainage, and AI search.

Everything except the cloud features works offline.

## Opening the project

1. Open this folder in Android Studio (**File → Open**).
2. Let Gradle sync, then press **Run ▶**.

The PDF, Word, Excel, PowerPoint and EXIF libraries are bundled in `app/src/main/assets/civilcam/lib/`, so no download is needed.

`gradle/wrapper/gradle-wrapper.properties` points to a Gradle zip saved locally in Downloads. On another computer, switch it back to the online URL noted in that file.

Minimum Android version: 6.0 (API 23). Firebase sign-in needs it.

## Where things live

| What | File |
|------|------|
| Screen layout | `app/src/main/assets/civilcam/index.html` |
| Styles | `app/src/main/assets/civilcam/css/app.css` |
| Cloud settings (Firebase project, AI URL) | `app/src/main/assets/civilcam/js/config.js` |
| State, storage, chainage helpers, icons, save/share | `js/core.js` |
| Screens, sheets, chips with "Others" | `js/ui.js` |
| Projects and engineer profile | `js/projects.js` |
| Camera, photo details, stamp, EXIF, blur check | `js/camera.js` |
| Gallery, filters, search, photo viewer | `js/gallery.js` |
| Chainage strip and location groups | `js/chainage.js` |
| Report layouts and captions | `js/report-common.js` |
| PDF / Word / Excel / PowerPoint | `js/export-pdf.js`, `js/export-word.js`, `js/export-excel.js`, `js/export-ppt.js` |
| Reports screen and sharing | `js/export.js` |
| Sign-in, sync, AI calls | `js/account.js` |
| Start-up and back button | `js/app.js` |
| Android screen and permissions | `app/src/main/java/com/funpixelnest/civilcampro/MainActivity.kt` |
| Native saving, sharing, WhatsApp | `app/src/main/java/com/funpixelnest/civilcampro/WebAppBridge.kt` |
| Native sign-in (Firebase) | `app/src/main/java/com/funpixelnest/civilcampro/AuthHelper.kt` |
| Firebase rules and AI function | `firebase/` |
