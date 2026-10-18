# Turning on sign-in, cloud sync and AI

The app works fully offline without any of this. Do these steps once to add:
- Google / Microsoft (company ID) / Apple sign-in,
- shared projects for your company,
- the AI buttons.

## 1. Create the Firebase project
1. Go to https://console.firebase.google.com and click **Add project**. Name it, e.g. `civilcam-pro`.
2. Switch to the **Blaze** (pay-as-you-go) plan. Cloud Functions need it. Normal use stays within the free allowance.

## 2. Add the Android app
1. In the project, click **Add app → Android**.
2. Enter the package name `com.funpixelnest.civilcampro`.
3. Add your signing key's **SHA-1**. Get it in Android Studio with **Gradle → app → Tasks → android → signingReport**, or run `keytool -list -v -keystore ~/.android/debug.keystore` (password `android`). Add the SHA-1 of your release key as well.
4. Download **google-services.json** and put it in the `app/` folder, next to `app/build.gradle`. The build picks it up automatically.

## 3. Turn on the sign-in methods
Go to **Authentication → Sign-in method** and enable:
- **Google:** just enable it.
- **Microsoft:**
  1. In Azure Portal, create an app registration under **Entra ID → App registrations**.
  2. Choose account type *Accounts in any organizational directory and personal Microsoft accounts*.
  3. Add the redirect URI that Firebase shows (`https://<project>.firebaseapp.com/__/auth/handler`).
  4. Copy the **Application (client) ID** and a **client secret** into Firebase.
- **Apple:**
  1. You need an Apple Developer account.
  2. Create a **Services ID**, enable *Sign in with Apple*, and use the same redirect URI as above.
  3. Fill in the Services ID, Team ID, Key ID and private key in Firebase.

## 4. Create the database and file storage
1. Go to **Firestore Database → Create database**. Choose the region `asia-south1` (Mumbai), in production mode.
2. Go to **Storage → Get started**, same region.

## 5. Deploy the rules and the AI function
On your computer, with Node 20 installed:

```bash
npm install -g firebase-tools
firebase login
cd firebase
firebase use --add          # pick your project
cd functions && npm install && cd ..
firebase functions:secrets:set ANTHROPIC_API_KEY   # paste your Anthropic API key
firebase deploy --only firestore:rules,storage,functions
```

The deploy prints the function URL, e.g. `https://asia-south1-civilcam-pro.cloudfunctions.net/ai`.

You can change which Claude models the function uses. Set `AI_MODEL_FAST` and `AI_MODEL_VISION` in `functions/.env`, e.g. `AI_MODEL_VISION=claude-sonnet-5-5`.

## 6. Tell the app where things are
Edit `app/src/main/assets/civilcam/js/config.js`:

```js
window.CIVILCAM_CONFIG = {
  firebase: { projectId: 'civilcam-pro', storageBucket: 'civilcam-pro.firebasestorage.app' },
  aiEndpoint: 'https://asia-south1-civilcam-pro.cloudfunctions.net/ai'
};
```

Rebuild the app. On first start you'll now see the sign-in buttons.

## How sharing works
- **Company e-mail** (e.g. `name@yourcompany.com`): everyone with the same e-mail domain sees the same projects, photos and custom list values ("Others").
- **Personal e-mail** (Gmail, Outlook.com, iCloud…): your data is private to you, and syncs between your own phones.
- Photos are uploaded in the background when there is internet. Until then they stay safe on the phone.
