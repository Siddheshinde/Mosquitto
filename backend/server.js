const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();
const twilio = require("twilio");
const crypto = require("crypto");

// ---------- Firebase Init ----------
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    "https://mosquitto-d1aa7-default-rtdb.asia-southeast1.firebasedatabase.app",
});

const rtdb = admin.database();

// ---------- Twilio ----------
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

// ============== DECRYPTION SETUP ==============
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
  } catch (err) {
    return null;
  }
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
        } else {
          decrypted[key] = decryptedValue;
        }
      } else {
        decrypted[key] = value;
      }
    } else {
      decrypted[key] = value;
    }
  }
  return decrypted;
}

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

let lastEmergencySent = false;

// =====================================================
// ✅ MAIN API
// =====================================================

app.get("/data", async (req, res) => {
  try {
    const [healthSnap, sosSnap, motionSnap, rfidSnap] = await Promise.all([
      rtdb.ref("new_health").get(),
      rtdb.ref("emergency/button").get(),
      rtdb.ref("motion/lastEvent").get(),
      rtdb.ref("rfid/lastEvent").get()
    ]);

    const health = decryptObject(healthSnap.val() || {});
    const sosRaw = sosSnap.val();
    const sos = typeof sosRaw === 'string' ? decryptData(sosRaw) === 'true' : sosRaw === true;
    const motion = decryptObject(motionSnap.val() || {});
    const rfid = decryptObject(rfidSnap.val() || {});

    const emergency = sos || health?.fall === true || health?.bpm > 200;

    if (emergency && !lastEmergencySent) {
      await client.messages.create({
        body: "🚨 EMERGENCY ALERT! Critical condition detected.",
        from: process.env.TWILIO_PHONE,
        to: process.env.DOCTOR_PHONE,
      });
      lastEmergencySent = true;
    }
    if (!emergency) lastEmergencySent = false;

    res.json({
      temperature: health?.temperature ?? null,
      heartRate: health?.bpm ?? null,
      posture: health?.posture ?? null,
      humidity: health?.humidity ?? null,
      fallDetected: health?.fall ?? false,
      sos,
      emergency,
      motion: {
        deviceID: motion?.deviceID ?? null,
        event: motion?.event ?? null,
        timestamp: motion?.timestamp ?? null
      },
      rfid: {
        cardUID: rfid?.cardUID ?? null,
        deviceID: rfid?.deviceID ?? null,
        event: rfid?.event ?? null,
        timestamp: rfid?.timestamp ?? null
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to read data" });
  }
});

app.listen(PORT, () => {
  console.log(`Server: http://localhost:${PORT}/data`);
});