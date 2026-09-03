# Run on a physical Android phone

Start the backend from the repository root:

```bash
docker compose up -d db api
```

On the phone, enable **Developer options** and **USB debugging**, connect it by
USB, accept the debugging prompt, and verify it is visible:

```bash
adb devices
```

Forward both the Metro and API ports to the phone:

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8010 tcp:8010
```

Then run the app from the mobile directory:

```bash
cd /home/keplerearth/Face_recognition_attendance_system/mobile
npm start
```

Keep Metro running and use a second terminal:

```bash
cd /home/keplerearth/Face_recognition_attendance_system/mobile
npm run android
```

The app uses `http://localhost:8010` on Android, which reaches the Docker API
through the `adb reverse` rule. The Android manifest already permits local HTTP
connections.
