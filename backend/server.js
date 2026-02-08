const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();
const twilio = require("twilio");
const crypto = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Firebase initialization
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) 
  : require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://mosquitto-d1aa7-default-rtdb.asia-southeast1.firebasedatabase.app",
});

const rtdb = admin.database();

// Twilio initialization
const client = process.env.TWILIO_SID && process.env.TWILIO_TOKEN
  ? twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN)
  : null;

// Gemini AI initialization
const genAI = process.env.GEMINI_API_KEY 
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-1.5-flash" }) : null;

// ============== AES ENCRYPTION SETUP ==============
const AES_KEY = Buffer.from([
  0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6,
  0xab, 0xf7, 0x97, 0x45, 0xcf, 0x4f, 0x09, 0x8c
]);

const AES_IV = Buffer.from([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f
]);

/**
 * Decrypt AES-128-CBC encrypted data
 */
function decryptData(encryptedBase64) {
  try {
    if (!encryptedBase64 || typeof encryptedBase64 !== 'string') {
      return null;
    }
    
    // Check if it's actually encrypted (base64 string)
    if (encryptedBase64.length < 10) {
      return encryptedBase64; // Too short to be encrypted
    }
    
    const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
    const decipher = crypto.createDecipheriv('aes-128-cbc', AES_KEY, AES_IV);
    
    let decrypted = Buffer.concat([
      decipher.update(encryptedBuffer),
      decipher.final()
    ]);
    
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('Decryption error:', err.message);
    return null;
  }
}

/**
 * Decrypt all string fields in an object
 */
function decryptObject(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  
  const decrypted = {};
  
  for (const key in obj) {
    const val = obj[key];
    
    // Skip timestamp and other non-encrypted fields
    if (key === 'timestamp' || key === 'alert') {
      decrypted[key] = val;
      continue;
    }
    
    if (typeof val === 'string' && val.length > 10) {
      const dec = decryptData(val);
      
      if (dec !== null) {
        // Try to parse as boolean or number
        if (dec === 'true') {
          decrypted[key] = true;
        } else if (dec === 'false') {
          decrypted[key] = false;
        } else if (!isNaN(dec) && dec.trim() !== '') {
          decrypted[key] = parseFloat(dec);
        } else {
          decrypted[key] = dec;
        }
      } else {
        // Decryption failed, keep original
        decrypted[key] = val;
      }
    } else if (typeof val === 'boolean' || typeof val === 'number') {
      // Already plain value
      decrypted[key] = val;
    } else {
      decrypted[key] = val;
    }
  }
  
  return decrypted;
}

// ============== EXPRESS APP SETUP ==============
const app = express();
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============== STATE MANAGEMENT ==============
let lastEmergencySent = false;
let lastEmergencyType = null;
let lastEmergencyTime = 0;
const EMERGENCY_COOLDOWN = 30000; // 30 seconds between SMS

let unauthorizedAccessLog = [];

// ============== ROUTES ==============

/**
 * GET /data
 * Main endpoint to fetch all health and security data
 */
app.get("/data", async (req, res) => {
  try {
    const [healthSnap, sosSnap, rfidSnap, motionSnap] = await Promise.all([
      rtdb.ref("new_health").get(),
      rtdb.ref("emergency/button").get(),
      rtdb.ref("rfid/lastEvent").get(),
      rtdb.ref("motion/lastEvent").get()
    ]);

    // Decrypt health data
    const healthRaw = healthSnap.val() || {};
    const health = decryptObject(healthRaw);
    
    // Decrypt RFID data
    const rfidRaw = rfidSnap.val() || {};
    const rfid = decryptObject(rfidRaw);
    
    // Decrypt motion data
    const motionRaw = motionSnap.val() || {};
    const motion = decryptObject(motionRaw);
    
    // Handle SOS button - can be encrypted or plain boolean
    const sosRaw = sosSnap.val();
    let sos = false;
    
    if (sosRaw !== null && sosRaw !== undefined) {
      if (typeof sosRaw === 'object' && sosRaw.button) {
        // New format with object
        const buttonValue = sosRaw.button;
        if (typeof buttonValue === 'string') {
          const decrypted = decryptData(buttonValue);
          sos = decrypted === 'true';
        } else {
          sos = buttonValue === true;
        }
      } else if (typeof sosRaw === 'string') {
        // Old format - encrypted string directly
        const decrypted = decryptData(sosRaw);
        sos = decrypted === 'true';
      } else if (typeof sosRaw === 'boolean') {
        // Plain boolean
        sos = sosRaw;
      }
    }

    // Extract vital signs
    const bpm = health.bpm || 0;
    const temp = health.temperature || 0;
    const fall = health.fall === true;
    const posture = health.posture || "Unknown";

    // ============== EMERGENCY DETECTION ==============
    const bpmHigh = bpm > 0 && bpm > 200;
    const bpmLow = bpm > 0 && bpm < 40;
    const tempHigh = temp > 0 && temp > 40;
    const tempLow = temp > 0 && temp < 15;

    let emergencyType = null;
    let emergencyPriority = 0;

    // Priority levels: SOS=5, Fall=4, Critical vitals=3
    if (sos) {
      emergencyType = "SOS Button Pressed";
      emergencyPriority = 5;
    } else if (fall) {
      emergencyType = "Fall Detected";
      emergencyPriority = 4;
    } else if (bpmHigh) {
      emergencyType = "Critical High Heart Rate";
      emergencyPriority = 3;
    } else if (bpmLow) {
      emergencyType = "Critical Low Heart Rate";
      emergencyPriority = 3;
    } else if (tempHigh) {
      emergencyType = "Critical High Temperature";
      emergencyPriority = 3;
    } else if (tempLow) {
      emergencyType = "Critical Low Temperature";
      emergencyPriority = 3;
    }

    const emergency = !!emergencyType;

    // ============== TWILIO SMS ALERT ==============
    if (emergency && !lastEmergencySent) {
      const timeSinceLastEmergency = Date.now() - lastEmergencyTime;
      
      // Only send if cooldown passed or it's a different emergency type
      if (timeSinceLastEmergency > EMERGENCY_COOLDOWN || emergencyType !== lastEmergencyType) {
        
        if (client && process.env.TWILIO_PHONE && process.env.DOCTOR_PHONE) {
          try {
            await client.messages.create({
              body: `🚨 EMERGENCY ALERT 🚨\n\nType: ${emergencyType}\n\nVitals:\n❤️ Heart Rate: ${bpm} BPM\n🌡️ Temperature: ${temp}°C\n📍 Posture: ${posture}\n⚠️ Fall: ${fall ? 'YES' : 'NO'}\n\nTime: ${new Date().toLocaleString()}`,
              from: process.env.TWILIO_PHONE,
              to: process.env.DOCTOR_PHONE
            });
            
            console.log(`✅ SMS sent: ${emergencyType}`);
            lastEmergencySent = true;
            lastEmergencyType = emergencyType;
            lastEmergencyTime = Date.now();
          } catch (smsError) {
            console.error('❌ Twilio SMS Error:', smsError.message);
          }
        } else {
          console.log(`⚠️ SMS not configured - Emergency: ${emergencyType}`);
        }
      } else {
        console.log(`⏳ Emergency cooldown active (${Math.round((EMERGENCY_COOLDOWN - timeSinceLastEmergency)/1000)}s remaining)`);
      }
    } else if (!emergency) {
      lastEmergencySent = false;
      lastEmergencyType = null;
    }

    // ============== RESPONSE ==============
    res.json({
      heartRate: bpm,
      temperature: temp,
      humidity: health.humidity || 0,
      fallDetected: fall,
      posture: posture,
      sos: sos,
      emergency: emergency,
      emergencyType: emergencyType,
      rfid: {
        event: rfid.event || "No events",
        cardUID: rfid.cardUID || "N/A",
        timestamp: rfid.timestamp || 0,
        alert: rfid.alert || false
      },
      motion: {
        event: motion.event || "No motion",
        timestamp: motion.timestamp || 0,
        alert: motion.alert || false
      },
      timestamp: Date.now()
    });
    
  } catch (err) {
    console.error('❌ Error in /data:', err);
    res.status(500).json({ 
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

/**
 * POST /emergency/reset
 * Manually reset emergency state
 */
app.post("/emergency/reset", async (req, res) => {
  try {
    await rtdb.ref("emergency/button").set(false);
    lastEmergencySent = false;
    lastEmergencyType = null;
    
    console.log('✅ Emergency state reset manually');
    
    res.json({ 
      success: true, 
      message: "Emergency reset successfully" 
    });
  } catch (err) {
    console.error('❌ Error resetting emergency:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: Date.now(),
    services: {
      firebase: "connected",
      twilio: client ? "configured" : "not configured",
      gemini: genAI ? "configured" : "not configured"
    }
  });
});

/**
 * GET /rfid/history
 * Get RFID access history
 */
app.get("/rfid/history", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const snapshot = await rtdb.ref("rfid/lastEvent").get();
    
    if (snapshot.exists()) {
      const data = decryptObject(snapshot.val());
      res.json(data);
    } else {
      res.json({ message: "No RFID history found" });
    }
  } catch (err) {
    console.error('❌ Error fetching RFID history:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /motion/history
 * Get motion detection history
 */
app.get("/motion/history", async (req, res) => {
  try {
    const snapshot = await rtdb.ref("motion/lastEvent").get();
    
    if (snapshot.exists()) {
      const data = decryptObject(snapshot.val());
      res.json(data);
    } else {
      res.json({ message: "No motion history found" });
    }
  } catch (err) {
    console.error('❌ Error fetching motion history:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /test/decrypt
 * Test decryption endpoint
 */
app.post("/test/decrypt", (req, res) => {
  try {
    const { encrypted } = req.body;
    
    if (!encrypted) {
      return res.status(400).json({ error: "Missing 'encrypted' field" });
    }
    
    const decrypted = decryptData(encrypted);
    
    res.json({
      encrypted: encrypted,
      decrypted: decrypted,
      success: decrypted !== null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============== ERROR HANDLING ==============

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: "Not Found",
    path: req.path 
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ 
    error: "Internal Server Error",
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ============== SERVER START ==============
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("\n========================================");
  console.log("   HEALTH MONITORING BACKEND");
  console.log("========================================");
  console.log(`🏥 Server running on port ${PORT}`);
  console.log(`🔥 Firebase: Connected`);
  console.log(`📱 Twilio: ${client ? 'Configured ✅' : 'Not configured ⚠️'}`);
  console.log(`🤖 Gemini AI: ${genAI ? 'Configured ✅' : 'Not configured ⚠️'}`);
  console.log(`🔒 Encryption: ENABLED (AES-128-CBC)`);
  console.log("\nAvailable endpoints:");
  console.log("  GET  /data              - Get all sensor data");
  console.log("  POST /emergency/reset   - Reset emergency state");
  console.log("  GET  /health            - Health check");
  console.log("  GET  /rfid/history      - RFID access log");
  console.log("  GET  /motion/history    - Motion detection log");
  console.log("  POST /test/decrypt      - Test decryption");
  console.log("========================================\n");
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});
