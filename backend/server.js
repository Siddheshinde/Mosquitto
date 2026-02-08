const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();
const twilio = require("twilio");
const crypto = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) 
  : require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://mosquitto-d1aa7-default-rtdb.asia-southeast1.firebasedatabase.app",
});

const rtdb = admin.database();
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// AES SETUP
const AES_KEY = Buffer.from([0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6, 0xab, 0xf7, 0x97, 0x45, 0xcf, 0x4f, 0x09, 0x8c]);
const AES_IV = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f]);

function decryptData(encryptedBase64) {
  try {
    if (!encryptedBase64 || typeof encryptedBase64 !== 'string') return null;
    const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
    const decipher = crypto.createDecipheriv('aes-128-cbc', AES_KEY, AES_IV);
    let decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) { return null; }
}

function decryptObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const decrypted = {};
  for (const key in obj) {
    const val = obj[key];
    if (typeof val === 'string' && val.length > 10) {
      const dec = decryptData(val);
      if (dec !== null) {
        if (dec === 'true') decrypted[key] = true;
        else if (dec === 'false') decrypted[key] = false;
        else if (!isNaN(dec)) decrypted[key] = parseFloat(dec);
        else decrypted[key] = dec;
      } else decrypted[key] = val;
    } else decrypted[key] = val;
  }
  return decrypted;
}

const app = express();
app.use(cors());
app.use(express.json());

let lastEmergencySent = false;
let unauthorizedAccessLog = [];

app.get("/data", async (req, res) => {
  try {
    const [healthSnap, sosSnap, rfidSnap] = await Promise.all([
      rtdb.ref("new_health").get(),
      rtdb.ref("emergency/button").get(),
      rtdb.ref("rfid/lastEvent").get()
    ]);

    const health = decryptObject(healthSnap.val() || {});
    const rfid = decryptObject(rfidSnap.val() || {});
    
    // SOS logic: Handles both encrypted and raw boolean
    const sosRaw = sosSnap.val();
    const sos = (typeof sosRaw === 'string') ? decryptData(sosRaw) === 'true' : sosRaw === true;

    // EMERGENCY THRESHOLDS (Using decrypted data)
    const bpm = health.bpm || 0;
    const temp = health.temperature || 0;
    const fall = health.fall === true;

    const bpmHigh = bpm > 200;
    const bpmLow = bpm > 0 && bpm < 40;
    const tempHigh = temp > 40;
    const tempLow = temp > 0 && temp < 15;

    let emergencyType = null;
    if (sos) emergencyType = "SOS Button Pressed";
    else if (fall) emergencyType = "Fall Detected";
    else if (bpmHigh) emergencyType = "Critical High Heart Rate";
    else if (bpmLow) emergencyType = "Critical Low Heart Rate";
    else if (tempHigh) emergencyType = "Critical High Temperature";
    else if (tempLow) emergencyType = "Critical Low Temperature";

    const emergency = !!emergencyType;

    // Twilio SMS Trigger
    if (emergency && !lastEmergencySent) {
      await client.messages.create({
        body: `🚨 EMERGENCY: ${emergencyType}\nHR: ${bpm} BPM, Temp: ${temp}C`,
        from: process.env.TWILIO_PHONE,
        to: process.env.DOCTOR_PHONE
      });
      lastEmergencySent = true;
    } else if (!emergency) {
      lastEmergencySent = false;
    }

    res.json({
      heartRate: bpm,
      temperature: temp,
      fallDetected: fall,
      sos: sos,
      emergency: emergency,
      emergencyType: emergencyType,
      posture: health.posture || "Unknown",
      rfid: rfid
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(5000, () => console.log("🏥 Backend Live on 5000"));
