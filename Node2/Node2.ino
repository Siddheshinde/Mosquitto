#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>

// Pin Definitions
#define SS_PIN 21
#define RST_PIN 22
#define MOTION_PIN 13
#define BUZZER_PIN 25

// WiFi Credentials
const char* ssid = "Galaxy S23 FE";
const char* password = "123456789";

// Firebase REST API Configuration
const char* FIREBASE_HOST = "https://mosquitto-d1aa7-default-rtdb.asia-southeast1.firebasedatabase.app";
const char* FIREBASE_AUTH = "AIzaSyA87gNFHXvvNVmNoGKvAGdanJ-PBelh3rQ";  // Your API key

// Device A IP
const char* deviceA_IP = "10.144.163.117";

// RFID
MFRC522 rfid(SS_PIN, RST_PIN);

// Authorized card UID
byte authorizedUID[] = {0xB9, 0xA3, 0xF2, 0x05};

// Shared data
SemaphoreHandle_t dataMutex;

struct AccessData {
  bool isAuthorized;
  unsigned long lastAuthTime;
  bool intruderDetected;
  String lastCardUID;
} accessData;

// Function Prototypes
void taskRFIDScanner(void *parameter);
void taskMotionMonitor(void *parameter);
void taskAlertSender(void *parameter);
void setupWiFi();
void soundAuthorizedBeep();
void soundIntruderAlarm();
bool checkAuthorized(byte* uid, byte size);
bool sendToFirebase(String path, String jsonData);
bool updateFirebaseString(String path, String value);

void setup() {
  Serial.begin(115200);

  dataMutex = xSemaphoreCreateMutex();

  pinMode(MOTION_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  SPI.begin();
  rfid.PCD_Init();

  setupWiFi();

  // Test Firebase connection
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("🔥 Testing Firebase REST API connection...");
    if (updateFirebaseString("/system/status", "Device B Online")) {
      Serial.println("✅ Firebase REST API connected successfully");
    } else {
      Serial.println("❌ Firebase REST API connection failed");
    }
  }

  if (xSemaphoreTake(dataMutex, portMAX_DELAY)) {
    accessData.isAuthorized = false;
    accessData.lastAuthTime = 0;
    accessData.intruderDetected = false;
    accessData.lastCardUID = "";
    xSemaphoreGive(dataMutex);
  }

  xTaskCreatePinnedToCore(taskRFIDScanner, "RFIDScanner", 4096, NULL, 2, NULL, 1);
  xTaskCreatePinnedToCore(taskMotionMonitor, "MotionMonitor", 4096, NULL, 2, NULL, 1);
  xTaskCreatePinnedToCore(taskAlertSender, "AlertSender", 8192, NULL, 1, NULL, 1);

  Serial.println("✅ Device B: All FreeRTOS tasks created");
  Serial.println("🔐 Sentry Unit Active - Monitoring entry point");
}

void loop() {
  vTaskDelay(pdMS_TO_TICKS(1000));
}

// WiFi Setup
void setupWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  Serial.println("Connecting to WiFi...");
  int attempts = 0;

  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n❌ WiFi connection failed!");
    Serial.println("➡️ Continuing without WiFi...");
  }
}

// Firebase REST API Functions
bool sendToFirebase(String path, String jsonData) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ WiFi not connected");
    return false;
  }

  HTTPClient http;
  String url = String(FIREBASE_HOST) + path + ".json?auth=" + String(FIREBASE_AUTH);
  
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  
  int httpResponseCode = http.PUT(jsonData);
  
  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.println("✅ Firebase PUT: " + String(httpResponseCode));
    Serial.println("Response: " + response);
    http.end();
    return true;
  } else {
    Serial.print("❌ Firebase PUT Error: ");
    Serial.println(httpResponseCode);
    http.end();
    return false;
  }
}

bool updateFirebaseString(String path, String value) {
  StaticJsonDocument<200> doc;
  doc["value"] = value;
  doc["timestamp"] = millis();
  
  String jsonData;
  serializeJson(doc, jsonData);
  
  return sendToFirebase(path, jsonData);
}

// RFID Scanner Task
void taskRFIDScanner(void *parameter) {
  TickType_t lastWakeTime = xTaskGetTickCount();
  const TickType_t frequency = pdMS_TO_TICKS(100);

  while (1) {
    if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
      String uidString = "";
      for (byte i = 0; i < rfid.uid.size; i++) {
        if (rfid.uid.uidByte[i] < 0x10) uidString += "0";
        uidString += String(rfid.uid.uidByte[i], HEX);
      }
      uidString.toUpperCase();

      bool authorized = checkAuthorized(rfid.uid.uidByte, rfid.uid.size);

      if (authorized) {
        soundAuthorizedBeep();
        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100))) {
          accessData.isAuthorized = true;
          accessData.lastAuthTime = millis();
          accessData.lastCardUID = uidString;
          xSemaphoreGive(dataMutex);
        }
        
        // Send to Firebase via REST API
        StaticJsonDocument<300> doc;
        doc["event"] = "Authorized Access";
        doc["cardUID"] = uidString;
        doc["timestamp"] = millis();
        doc["deviceID"] = "Device_B";
        
        String jsonData;
        serializeJson(doc, jsonData);
        sendToFirebase("/rfid/lastEvent", jsonData);
        
        Serial.println("✅ Authorized card: " + uidString);
      } else {
        soundIntruderAlarm();
        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100))) {
          accessData.intruderDetected = true;
          accessData.lastCardUID = uidString;
          xSemaphoreGive(dataMutex);
        }
        
        // Send to Firebase via REST API
        StaticJsonDocument<300> doc;
        doc["event"] = "Unauthorized Card";
        doc["cardUID"] = uidString;
        doc["timestamp"] = millis();
        doc["deviceID"] = "Device_B";
        doc["alert"] = true;
        
        String jsonData;
        serializeJson(doc, jsonData);
        sendToFirebase("/rfid/lastEvent", jsonData);
        
        Serial.println("⚠️ Unauthorized card: " + uidString);
      }
      rfid.PICC_HaltA();
    }
    vTaskDelayUntil(&lastWakeTime, frequency);
  }
}

// Motion Monitor Task
void taskMotionMonitor(void *parameter) {
  TickType_t lastWakeTime = xTaskGetTickCount();
  const TickType_t frequency = pdMS_TO_TICKS(100);
  bool lastMotionState = false;

  while (1) {
    bool motionDetected = digitalRead(MOTION_PIN);

    if (motionDetected && !lastMotionState) {
      bool authorized = false;
      unsigned long timeSinceAuth = 0;

      if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100))) {
        timeSinceAuth = millis() - accessData.lastAuthTime;
        authorized = accessData.isAuthorized && (timeSinceAuth < 5000);
        xSemaphoreGive(dataMutex);
      }

      if (!authorized) {
        soundIntruderAlarm();
        
        // Send unauthorized motion to Firebase
        StaticJsonDocument<300> doc;
        doc["event"] = "Unauthorized Motion";
        doc["timestamp"] = millis();
        doc["deviceID"] = "Device_B";
        doc["alert"] = true;
        
        String jsonData;
        serializeJson(doc, jsonData);
        sendToFirebase("/motion/lastEvent", jsonData);
        
        Serial.println("⚠️ Unauthorized motion detected!");
      } else {
        // Send authorized entry to Firebase
        StaticJsonDocument<300> doc;
        doc["event"] = "Authorized Entry";
        doc["timestamp"] = millis();
        doc["deviceID"] = "Device_B";
        
        String jsonData;
        serializeJson(doc, jsonData);
        sendToFirebase("/motion/lastEvent", jsonData);
        
        Serial.println("✅ Authorized entry detected");
      }
    }

    lastMotionState = motionDetected;
    vTaskDelayUntil(&lastWakeTime, frequency);
  }
}

// Alert Sender Task (placeholder for future expansion)
void taskAlertSender(void *parameter) {
  while (1) {
    vTaskDelay(pdMS_TO_TICKS(500));
  }
}

// Check if card is authorized
bool checkAuthorized(byte* uid, byte size) {
  if (size != sizeof(authorizedUID)) return false;
  
  for (byte i = 0; i < size; i++) {
    if (uid[i] != authorizedUID[i]) return false;
  }
  return true;
}

// Sound functions
void soundAuthorizedBeep() {
  tone(BUZZER_PIN, 1000, 200);
  delay(250);
}

void soundIntruderAlarm() {
  for (int i = 0; i < 5; i++) {
    tone(BUZZER_PIN, 1000, 200);
    delay(150);
    noTone(BUZZER_PIN);
    delay(100);
  }
}