const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();
const twilio = require("twilio");

// ---------- Firebase Init ----------
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ---------- Twilio Init ----------
const client = twilio(
  process.env.TWILIO_SID,
  process.env.TWILIO_TOKEN
);

// ---------- Express Setup ----------
const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// ---------- Latest Data Cache ----------
let latestData = {
  temperature: null,
  heartRate: null,
  posture: null,
  fallDetected: null,
  emergency: null,
  timestamp: null,
};

// Prevent SMS spam
let lastEmergencySent = false;

// ---------- Routes ----------

// Health check
app.get("/", (req, res) => {
  res.send("Patient Monitoring Server is running");
});

// POST sensor data
app.post("/data", async (req, res) => {
  try {
    const data = {
      ...req.body,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Save to Firestore
    const docRef = await db.collection("patients").add(data);

    // Update latest cache
    latestData = { ...req.body, id: docRef.id };

    // ---------- Emergency SMS ----------
    if (data.emergency === true && !lastEmergencySent) {
      await client.messages.create({
        body: "🚨 EMERGENCY ALERT! Patient needs help immediately!",
        from: process.env.TWILIO_PHONE,
        to: process.env.DOCTOR_PHONE,
      });

      console.log("🚨 SMS SENT");
      lastEmergencySent = true;
    }

    // Reset when emergency ends
    if (data.emergency === false) {
      lastEmergencySent = false;
    }

    res.json({ success: true, id: docRef.id });
  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: "Failed to save data" });
  }
});

// GET latest data (for ESP / testing / fallback)
app.get("/data", (req, res) => {
  res.json(latestData);
});

// ---------- Start Server ----------
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
