const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();
const twilio = require("twilio");
const crypto = require("crypto");

/// Replace the old require line with this:
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) 
  : require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    "https://mosquitto-d1aa7-default-rtdb.asia-southeast1.firebasedatabase.app",
});

const rtdb = admin.database();

// Twilio
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

// DECRYPTION SETUP
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

// TRACKING VARIABLES
let lastEmergencySent = false;
let unauthorizedAccessLog = []; // Store unauthorized access attempts
let authorizedAccessLog = []; // Store authorized access (doctor visits)

// MAIN API - /data

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

    // RFID EVENT TRACKING
    const currentTime = Date.now();
    const fiveMinutesAgo = currentTime - 5 * 60 * 1000;
    
    // Clean old entries from both logs
    unauthorizedAccessLog = unauthorizedAccessLog.filter(
      (entry) => entry.timestamp > fiveMinutesAgo
    );
    authorizedAccessLog = authorizedAccessLog.filter(
      (entry) => entry.timestamp > fiveMinutesAgo
    );
    
    // Track AUTHORIZED access (doctor visits)
    if (rfid?.event === "authorized" || rfid?.event === "Authorized") {
      const lastAuthEntry = authorizedAccessLog[authorizedAccessLog.length - 1];
      // Only add if it's a new event (different timestamp)
      if (!lastAuthEntry || lastAuthEntry.rfidTimestamp !== rfid.timestamp) {
        authorizedAccessLog.push({
          timestamp: currentTime,
          rfidTimestamp: rfid.timestamp,
          cardUID: rfid.cardUID,
          deviceID: rfid.deviceID
        });
        console.log(`Authorized Access - Doctor Visit Logged (Total: ${authorizedAccessLog.length})`);
      }
    }
    
    // Track UNAUTHORIZED access
    if (rfid?.event === "unauthorized" || rfid?.event === "Unauthorized") {
      const lastEntry = unauthorizedAccessLog[unauthorizedAccessLog.length - 1];
      // Only add if it's a new event (different timestamp)
      if (!lastEntry || lastEntry.rfidTimestamp !== rfid.timestamp) {
        unauthorizedAccessLog.push({
          timestamp: currentTime,
          rfidTimestamp: rfid.timestamp,
          cardUID: rfid.cardUID,
          deviceID: rfid.deviceID
        });
        console.log(`Unauthorized Access Logged - Total: ${unauthorizedAccessLog.length}`);
      }
    }

    // EMERGENCY LOGIC
    // Emergency triggers:
    // 1. SOS button pressed (sos === true)
    // 2. BPM > 200
    // 3. BPM < 40
    // 4. Temperature > 40
    // 5. Temperature < 15
    // 6. Fall detected (fall === true)
    // 7. Unauthorized access >= 5 times in 5 minutes (more than 4)
    
    const bpmHigh = health?.bpm > 200;
    const bpmLow = health?.bpm < 40;
    const tempHigh = health?.temperature > 40;
    const tempLow = health?.temperature < 15;
    const fallDetected = health?.fall === true;
    const unauthorizedCount = unauthorizedAccessLog.length;
    const tooManyUnauthorized = unauthorizedCount >= 5;
    
    // Separate medical and security emergencies
    const medicalEmergency = sos || bpmHigh || bpmLow || tempHigh || tempLow || fallDetected;
    const securityEmergency = tooManyUnauthorized;
    
    // OVERALL EMERGENCY
    const emergency = medicalEmergency || securityEmergency;
    
    // Determine emergency type for frontend
    let emergencyType = null;
    if (sos) emergencyType = "SOS Button Pressed";
    else if (bpmHigh) emergencyType = "Critical Heart Rate (High)";
    else if (bpmLow) emergencyType = "Critical Heart Rate (Low)";
    else if (tempHigh) emergencyType = "Critical Temperature (High)";
    else if (tempLow) emergencyType = "Critical Temperature (Low)";
    else if (fallDetected) emergencyType = "Fall Detected";
    else if (tooManyUnauthorized) emergencyType = "Security Breach";

    console.log(`\nStatus Update:`);
    console.log(`   RFID Event: ${rfid?.event || "None"}`);
    console.log(`   Card UID: ${rfid?.cardUID || "None"}`);
    console.log(`   Doctor Visits (5min): ${authorizedAccessLog.length}`);
    console.log(`   Unauthorized (5min): ${unauthorizedCount}`);
    console.log(`   BPM: ${health?.bpm || "N/A"} (High: ${bpmHigh}, Low: ${bpmLow})`);
    console.log(`   Temperature: ${health?.temperature || "N/A"}°C (High: ${tempHigh}, Low: ${tempLow})`);
    console.log(`   Medical Emergency: ${medicalEmergency ? "YES" : "NO"}`);
    console.log(`   Security Emergency: ${securityEmergency ? "YES (≥5)" : "NO"}`);
    console.log(`---`);

    // Send Twilio SMS only once per emergency
    if (emergency && !lastEmergencySent) {
      let alertMessage = "EMERGENCY ALERT!\n";
      if (sos) alertMessage += "- SOS Button Pressed\n";
      if (bpmHigh) alertMessage += `- Critical Heart Rate (High): ${health.bpm} BPM\n`;
      if (bpmLow) alertMessage += `- Critical Heart Rate (Low): ${health.bpm} BPM\n`;
      if (tempHigh) alertMessage += `- Critical Temperature (High): ${health.temperature}°C\n`;
      if (tempLow) alertMessage += `- Critical Temperature (Low): ${health.temperature}°C\n`;
      if (fallDetected) alertMessage += "- Fall Detected\n";
      if (tooManyUnauthorized) alertMessage += `- Security Breach: ${unauthorizedCount} unauthorized access attempts in 5 minutes\n`;
      
      await client.messages.create({
        body: alertMessage,
        from: process.env.TWILIO_PHONE,
        to: process.env.DOCTOR_PHONE,
      });
      lastEmergencySent = true;
      console.log(`SMS Alert Sent!`);
    }
    
    if (!emergency) lastEmergencySent = false;

    // Determine authorization status based on event
    let authorizationStatus = "No Scan";
    let isAuthorized = null;
    
    if (rfid?.event) {
      if (rfid.event === "authorized" || rfid.event === "Authorized") {
        authorizationStatus = "Authorized";
        isAuthorized = true;
      } else if (rfid.event === "unauthorized" || rfid.event === "Unauthorized") {
        authorizationStatus = "Unauthorized";
        isAuthorized = false;
      }
    }

    res.json({
      temperature: health?.temperature ?? null,
      heartRate: health?.bpm ?? null,
      posture: health?.posture ?? null,
      humidity: health?.humidity ?? null,
      fallDetected: health?.fall ?? false,
      sos,
      emergency,
      medicalEmergency,
      securityEmergency,
      emergencyType,
      bpmHigh,
      bpmLow,
      tempHigh,
      tempLow,
      unauthorizedCount,
      tooManyUnauthorized,
      motion: {
        deviceID: motion?.deviceID ?? null,
        event: motion?.event ?? null,
        timestamp: motion?.timestamp ?? null
      },
      rfid: {
        cardUID: rfid?.cardUID ?? null,
        deviceID: rfid?.deviceID ?? null,
        event: rfid?.event ?? null,
        timestamp: rfid?.timestamp ?? null,
        isAuthorized: isAuthorized,
        authorizationStatus: authorizationStatus
      },
      accessStats: {
        doctorVisits: authorizedAccessLog.length,
        unauthorizedAttempts: unauthorizedCount,
        recentUnauthorized: unauthorizedAccessLog.slice(-5).reverse(), // Last 5
        recentAuthorized: authorizedAccessLog.slice(-5).reverse() // Last 5
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error("Error fetching data:", err);
    res.status(500).json({ error: "Failed to read data" });
  }
});

// UNAUTHORIZED ACCESS LOG

app.get("/unauthorized-access-log", async (req, res) => {
  try {
    res.json({
      total: unauthorizedAccessLog.length,
      logs: unauthorizedAccessLog.slice(-20).reverse() // Last 20, newest first
    });
  } catch (err) {
    console.error("Error fetching unauthorized log:", err);
    res.status(500).json({ error: "Failed to fetch log" });
  }
});

// AUTHORIZED ACCESS LOG (Doctor Visits)

app.get("/doctor-visits", async (req, res) => {
  try {
    res.json({
      totalVisits: authorizedAccessLog.length,
      visitsInLast5Min: authorizedAccessLog.length,
      recentVisits: authorizedAccessLog.slice(-20).reverse() // Last 20, newest first
    });
  } catch (err) {
    console.error("Error fetching doctor visits:", err);
    res.status(500).json({ error: "Failed to fetch doctor visits" });
  }
});

// RESET ENDPOINTS

app.post("/reset-unauthorized", async (req, res) => {
  try {
    unauthorizedAccessLog = [];
    res.json({ 
      success: true, 
      message: "Unauthorized attempts cleared",
      count: 0
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to reset" });
  }
});

app.post("/reset-doctor-visits", async (req, res) => {
  try {
    authorizedAccessLog = [];
    res.json({ 
      success: true, 
      message: "Doctor visit count reset",
      count: 0
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to reset" });
  }
});

app.listen(PORT, () => {
  console.log(`\nMedical Monitoring Server Started`);
  console.log(`Main Data API: http://localhost:${PORT}/data`);
  console.log(`Unauthorized Log: http://localhost:${PORT}/unauthorized-access-log`);
  console.log(`Doctor Visits: http://localhost:${PORT}/doctor-visits`);
  console.log(`Reset Unauthorized: POST http://localhost:${PORT}/reset-unauthorized`);
  console.log(`Reset Doctor Visits: POST http://localhost:${PORT}/reset-doctor-visits`);
  console.log(`\nMonitoring active...\n`);
  console.log(`Authorization is based on RFID event field:`);
  console.log(`   - event: "authorized" → Authorized`);
  console.log(`   - event: "unauthorized" → Unauthorized`);
  console.log(`Security Emergency triggers at ≥5 unauthorized attempts\n`);
});
