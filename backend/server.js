const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();
const twilio = require("twilio");
const crypto = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Firebase Init - Securely loading from Environment Variables for Render
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) 
  : require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://mosquitto-d1aa7-default-rtdb.asia-southeast1.firebasedatabase.app",
});

const rtdb = admin.database();

// Twilio
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

// Gemini AI Setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// DECRYPTION SETUP (Original Logic Preserved)
const AES_KEY = Buffer.from([
  0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6,
  0xab, 0xf7, 0x97, 0x45, 0xcf, 0x4f, 0x09, 0x8c
]);

const AES_IV = Buffer.from([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f
]);

function decryptData(encryptedBase64) {
  try {
    if (!encryptedBase64 || typeof encryptedBase64 !== 'string') return null;
    const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
    const decipher = crypto.createDecipheriv('aes-128-cbc', AES_KEY, AES_IV);
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(encryptedBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) { return null; }
}

function decryptObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const decrypted = {};
  for (const key in obj) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 20) {
      const decryptedValue = decryptData(value);
      if (decryptedValue !== null) {
        if (decryptedValue === 'true') decrypted[key] = true;
        else if (decryptedValue === 'false') decrypted[key] = false;
        else if (!isNaN(decryptedValue) && decryptedValue.trim() !== '') {
          decrypted[key] = parseFloat(decryptedValue);
        } else { decrypted[key] = decryptedValue; }
      } else { decrypted[key] = value; }
    } else { decrypted[key] = value; }
  }
  return decrypted;
}

// AI HEALTH BRIEF GENERATOR
async function generateHealthBrief(eventData) {
  try {
    const prompt = `You are a medical triage AI assistant for a high-security hospital.
    STATUS: HR: ${eventData.bpm} BPM, Temp: ${eventData.temperature}°C, Fall: ${eventData.fallDetected ? 'YES' : 'NO'}, SOS: ${eventData.sos ? 'YES' : 'NO'}.
    SECURITY: ${eventData.unauthorizedCount} unauthorized attempts.
    TASK: Provide clinical assessment in EXACT JSON:
    {"riskLevel": "Low|Medium|High|Critical", "explanation": "2 sentence summary", "suggestedResponse": "action", "priority": 1-5}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error("Invalid AI JSON");
  } catch (err) {
    return { riskLevel: "High", explanation: "AI analysis unavailable. Manual review required.", suggestedResponse: "Immediate check", priority: 4 };
  }
}

const app = express();
app.use(cors());
app.use(express.json());

let lastEmergencySent = false;
let unauthorizedAccessLog = [];
let authorizedAccessLog = [];
let lastAIBriefCache = null;
let lastAIBriefTime = 0;
const AI_CACHE_DURATION = 30000;

app.get("/data", async (req, res) => {
  try {
    const [healthSnap, sosSnap, motionSnap, rfidSnap] = await Promise.all([
      rtdb.ref("new_health").get(), rtdb.ref("emergency/button").get(),
      rtdb.ref("motion/lastEvent").get(), rtdb.ref("rfid/lastEvent").get()
    ]);

    const health = decryptObject(healthSnap.val() || {});
    const sosRaw = sosSnap.val();
    const sos = typeof sosRaw === 'string' ? decryptData(sosRaw) === 'true' : sosRaw === true;
    const rfid = decryptObject(rfidSnap.val() || {});

    const currentTime = Date.now();
    const fiveMinutesAgo = currentTime - 5 * 60 * 1000;
    unauthorizedAccessLog = unauthorizedAccessLog.filter(e => e.timestamp > fiveMinutesAgo);
    
    // RFID Logic (Preserved)
    if (rfid?.event?.toLowerCase() === "unauthorized") {
      if (!unauthorizedAccessLog.length || unauthorizedAccessLog[unauthorizedAccessLog.length-1].rfidTimestamp !== rfid.timestamp) {
        unauthorizedAccessLog.push({ timestamp: currentTime, rfidTimestamp: rfid.timestamp, cardUID: rfid.cardUID });
      }
    }

    const unauthorizedCount = unauthorizedAccessLog.length;
    const tooManyUnauthorized = unauthorizedCount >= 5;
    const emergency = sos || health?.bpm > 200 || health?.bpm < 40 || health?.fall || tooManyUnauthorized;

    let aiBrief = null;
    if (emergency) {
      if (currentTime - lastAIBriefTime > AI_CACHE_DURATION) {
        aiBrief = await generateHealthBrief({ ...health, sos, unauthorizedCount, tooManyUnauthorized });
        lastAIBriefCache = aiBrief;
        lastAIBriefTime = currentTime;
      } else { aiBrief = lastAIBriefCache; }
    }

    if (emergency && !lastEmergencySent) {
      const msg = `🚨 EMERGENCY: ${aiBrief?.riskLevel || 'CRITICAL'}. ${aiBrief?.explanation || 'Check Patient.'}`;
      await client.messages.create({ body: msg, from: process.env.TWILIO_PHONE, to: process.env.DOCTOR_PHONE });
      lastEmergencySent = true;
    }
    if (!emergency) lastEmergencySent = false;

    res.json({ ...health, sos, emergency, unauthorizedCount, tooManyUnauthorized, aiBrief, rfid, heartRate: health.bpm });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(5000, () => console.log("🏥 AI Medical Server Started"));
