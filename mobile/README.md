# FaceAttend Android

Native Kotlin/Jetpack Compose frontend rebuilt from the FaceAttend UI/UX architecture.

Run from this directory:

```bash
./gradlew :app:assembleDebug
```

The app targets the backend at `http://10.0.2.2:8080/` for the Android emulator. Update `Network.BASE_URL` in `app/src/main/java/com/faceattend/mobile/Api.kt` for a physical device or deployed API.

Implemented foundations include Material 3 styling, single-activity Compose navigation, role-based student/teacher/admin destinations, camera/location/notification permissions, Retrofit/OkHttp API access with bearer-token interception, Room/offline-cache dependencies, and recognition/attendance error-state UI.
