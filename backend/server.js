const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();
const twilio = require("twilio");

// ---------- Firebase Init ----------
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://mosquitto-d1aa7-default-rtdb.asia-southeast1.firebasedatabase.app",
});

const rtdb = admin.database();

// ---------- Twilio ----------
const client = twilio(
  process.env.TWILIO_SID,
  process.env.TWILIO_TOKEN
);

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

let lastEmergencySent = false;

// =====================================================
// ✅ GET REALTIME DATA FROM RTDB
// =====================================================
app.get("/data", async (req, res) => {
  try {
    // 🔹 Node-1 health
    const healthSnap = await rtdb.ref("new_health").get();
    const health = healthSnap.val() || {};

    // 🔹 Node-2 RFID
    const rfidSnap = await rtdb.ref("rfid/lastEvent").get();
    const rfid = rfidSnap.val() || {};

    // 🔹 Motion
    const motionSnap = await rtdb.ref("lastEvent").get();
    const motion = motionSnap.val() || {};

    // 🔹 System
    const systemSnap = await rtdb.ref("system/status").get();
    const system = systemSnap.val() || {};

    // 🔹 Emergency logic
    const emergency =
      health?.fall === true ||
      rfid?.alert === true ||
      motion?.alert === true;

    // 🔹 SMS once
    if (emergency && !lastEmergencySent) {
      await client.messages.create({
        body: "🚨 EMERGENCY ALERT! Fall or Intrusion detected!",
        from: process.env.TWILIO_PHONE,
        to: process.env.DOCTOR_PHONE,
      });
      lastEmergencySent = true;
    }

    if (!emergency) lastEmergencySent = false;

    // 🔹 Response to dashboard
    res.json({
      temperature: health?.temperature ?? null,
      heartRate: health?.bpm ?? null,
      posture: health?.posture ?? "UNKNOWN",
      fallDetected: health?.fall ?? false,
      emergency,
      systemStatus: system?.value ?? "Offline",
      timestamp: Date.now(),
    });

  } catch (err) {
    console.error("❌ RTDB ERROR:", err);
    res.status(500).json({ error: "Failed to read realtime data" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
