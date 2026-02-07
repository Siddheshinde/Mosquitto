const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();
const twilio = require("twilio");


// Firebase init
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Twilio init
const client = twilio(
  process.env.TWILIO_SID,
  process.env.TWILIO_TOKEN
);


const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());


let latestData = {
  temperature: null,
  heartRate: null,
  posture: null,
  fallDetected: null,
  emergency: null,
};

app.get("/", (req, res) => {
  res.send("Patient Monitoring Server is running");
});
let lastEmergencySent = false; // prevent spam

app.post("/data", async (req, res) => {
  try {
    const data = {
      ...req.body,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection("patients").add(data);

    // 🔴 Send SMS only when emergency becomes TRUE
    if (data.emergency && !lastEmergencySent) {
      await client.messages.create({
        body: "🚨 EMERGENCY ALERT! Patient needs help immediately!",
        from: process.env.TWILIO_PHONE,
        to: process.env.DOCTOR_PHONE,
      });

      lastEmergencySent = true;
    }

    // Reset flag when emergency false
    if (!data.emergency) {
      lastEmergencySent = false;
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save data" });
  }
});


app.get("/data", (req, res) => {
  res.json(latestData);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
