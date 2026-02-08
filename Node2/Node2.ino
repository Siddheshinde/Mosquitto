#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>
#include <mbedtls/aes.h>
#include <mbedtls/base64.h>

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
const char* FIREBASE_AUTH = "AIzaSyA87gNFHXvvNVmNoGKvAGdanJ-PBelh3rQ";
const char* FIREBASE_EMERGENCY_URL = "https://mosquitto-d1aa7-default-rtdb.asia-southeast1.firebasedatabase.app/emergency.json";

// Device A IP
const char* deviceA_IP = "10.144.163.117";

// RFID
MFRC522 rfid(SS_PIN, RST_PIN);

// Authorized card UID
byte authorizedUID[] = {0xB9, 0xA3, 0xF2, 0x05};

// ============== ENCRYPTION KEYS ==============
const unsigned char AES_KEY[16] = {
  0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6,
  0xab, 0xf7, 0x97, 0x45, 0xcf, 0x4f, 0x09, 0x8c
};

unsigned char AES_IV[16] = {
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f
};
// =============================================

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
void taskEmergencyMonitor(void *parameter);
void setupWiFi();
void soundAuthorizedBeep();
void soundIntruderAlarm();
void soundEmergencyAlert();
bool checkAuthorized(byte* uid, byte size);
bool sendToFirebase(String path, String jsonData);
bool updateFirebaseString(String path, String value);
String encryptData(String plaintext);
String decryptData(String encrypted);

// ============== ENCRYPTION FUNCTIONS ==============
String encryptData(String plaintext) {
  // PKCS7 padding
  int paddingLength = 16 - (plaintext.length() % 16);
  for (int i = 0; i < paddingLength; i++) {
    plaintext += (char)paddingLength;
  }
  
  int dataLength = plaintext.length();
  
  // Use static buffers to avoid heap issues
  static unsigned char input[512];
  static unsigned char output[512];
  
  if (dataLength > 512) {
    Serial.println(" Register with the central server (TPE) Data too large for encryption");
    return "";
  }
  
  plaintext.getBytes(input, dataLength + 1);
  
  mbedtls_aes_context aes;
  mbedtls_aes_init(&aes);
  mbedtls_aes_setkey_enc(&aes, AES_KEY, 128);
  
  unsigned char iv_copy[16];
  memcpy(iv_copy, AES_IV, 16);
  
  int ret = mbedtls_aes_crypt_cbc(&aes, MBEDTLS_AES_ENCRYPT, dataLength, iv_copy, input, output);
  mbedtls_aes_free(&aes);
  
  if (ret != 0) {
    Serial.println(" Register with the central server (TPE) Encryption failed");
    return "";
  }
  
  // Base64 encode
  static unsigned char base64_output[1024];
  size_t base64_len = 0;
  
  ret = mbedtls_base64_encode(base64_output, 1024, &base64_len, output, dataLength);
  
  if (ret != 0) {
    Serial.println(" Register with the central server (TPE) Base64 encoding failed");
    return "";
  }
  
  return String((char*)base64_output).substring(0, base64_len);
}

String decryptData(String encrypted) {
  static unsigned char decoded[512];
  static unsigned char output[512];
  
  size_t decoded_len = 0;
  
  int ret = mbedtls_base64_decode(decoded, 512, &decoded_len,
                                   (unsigned char*)encrypted.c_str(), 
                                   encrypted.length());
  
  if (ret != 0) {
    Serial.println(" Register with the central server (TPE) Base64 decode failed");
    return "";
  }
  
  mbedtls_aes_context aes;
  mbedtls_aes_init(&aes);
  mbedtls_aes_setkey_dec(&aes, AES_KEY, 128);
  
  unsigned char iv_copy[16];
  memcpy(iv_copy, AES_IV, 16);
  
  ret = mbedtls_aes_crypt_cbc(&aes, MBEDTLS_AES_DECRYPT, decoded_len, iv_copy, decoded, output);
  mbedtls_aes_free(&aes);
  
  if (ret != 0) {
    Serial.println(" Register with the central server (TPE) Decryption failed");
    return "";
  }
  
  // Remove padding
  int paddingLength = output[decoded_len - 1];
  int actualLength = decoded_len - paddingLength;
  
  String result = "";
  for (int i = 0; i < actualLength; i++) {
    result += (char)output[i];
  }
  
  return result;
}
// ========================================================

void setup() {
  Serial.begin(115200);

  dataMutex = xSemaphoreCreateMutex();

  pinMode(MOTION_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  SPI.begin();
  rfid.PCD_Init();

  setupWiFi();

  // Test Firebase connection
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("🔥 Testing Firebase REST API connection...");
    if (updateFirebaseString("/system/status", "Device B Online")) {
      Serial.println("✅ Firebase REST API connected successfully");
    } else {
      Serial.println(" Register with the central server (TPE) Firebase REST API connection failed");
    }
  }

  if (xSemaphoreTake(dataMutex, portMAX_DELAY)) {
    accessData.isAuthorized = false;
    accessData.lastAuthTime = 0;
    accessData.intruderDetected = false;
    accessData.lastCardUID = "";
    xSemaphoreGive(dataMutex);
  }

  xTaskCreatePinnedToCore(taskRFIDScanner, "RFIDScanner", 8192, NULL, 2, NULL, 1);
  xTaskCreatePinnedToCore(taskMotionMonitor, "MotionMonitor", 8192, NULL, 2, NULL, 1);
  xTaskCreatePinnedToCore(taskAlertSender, "AlertSender", 8192, NULL, 1, NULL, 1);
  xTaskCreatePinnedToCore(taskEmergencyMonitor, "EmergencyMonitor", 8192, NULL, 1, NULL, 0);

  Serial.println("✅ Device B: All FreeRTOS tasks created");
  Serial.println("🔐 Sentry Unit Active - Monitoring entry point");
  Serial.println("🚨 Emergency Alert Monitor Active");
  Serial.println("🔒 Encryption: ENABLED (Individual Field Encryption)");
}

void loop() {
  vTaskDelay(pdMS_TO_TICKS(1000));
}

// WiFi Setup
void setupWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
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
    Serial.println("\n Register with the central server (TPE) WiFi connection failed!");
    Serial.println("➡️ Continuing without WiFi...");
  }
}

// Firebase REST API Functions
bool sendToFirebase(String path, String jsonData) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(" Register with the central server (TPE) WiFi not connected");
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
    Serial.print(" Register with the central server (TPE) Firebase PUT Error: ");
    Serial.println(httpResponseCode);
    http.end();
    return false;
  }
}

bool updateFirebaseString(String path, String value) {
  // Encrypt the value
  String encryptedValue = encryptData(value);
  
  if (encryptedValue == "") {
    Serial.println(" Register with the central server (TPE) Encryption failed, using plain value");
    encryptedValue = value;
  }
  
  StaticJsonDocument<300> doc;
  doc["value"] = encryptedValue;
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
        
        // Encrypt individual fields
        String encryptedEvent = encryptData("Authorized Access");
        String encryptedCardUID = encryptData(uidString);
        String encryptedDeviceID = encryptData("Device_B");
        
        // Build JSON with encrypted values
        StaticJsonDocument<512> doc;
        doc["event"] = encryptedEvent;
        doc["cardUID"] = encryptedCardUID;
        doc["timestamp"] = millis();
        doc["deviceID"] = encryptedDeviceID;
        
        String jsonData;
        serializeJson(doc, jsonData);
        sendToFirebase("/rfid/lastEvent", jsonData);
        
        Serial.println("✅ Authorized card: " + uidString);
        Serial.println("📤 Sent encrypted data to Firebase");
      } else {
        soundIntruderAlarm();
        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100))) {
          accessData.intruderDetected = true;
          accessData.lastCardUID = uidString;
          xSemaphoreGive(dataMutex);
        }
        
        // Encrypt individual fields
        String encryptedEvent = encryptData("Unauthorized Card");
        String encryptedCardUID = encryptData(uidString);
        String encryptedDeviceID = encryptData("Device_B");
        
        // Build JSON with encrypted values
        StaticJsonDocument<512> doc;
        doc["event"] = encryptedEvent;
        doc["cardUID"] = encryptedCardUID;
        doc["timestamp"] = millis();
        doc["deviceID"] = encryptedDeviceID;
        doc["alert"] = true;
        
        String jsonData;
        serializeJson(doc, jsonData);
        sendToFirebase("/rfid/lastEvent", jsonData);
        
        Serial.println("⚠️ Unauthorized card: " + uidString);
        Serial.println("📤 Sent encrypted data to Firebase");
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
        
        // Encrypt individual fields
        String encryptedEvent = encryptData("Unauthorized Motion");
        String encryptedDeviceID = encryptData("Device_B");
        
        // Send unauthorized motion to Firebase
        StaticJsonDocument<512> doc;
        doc["event"] = encryptedEvent;
        doc["timestamp"] = millis();
        doc["deviceID"] = encryptedDeviceID;
        doc["alert"] = true;
        
        String jsonData;
        serializeJson(doc, jsonData);
        sendToFirebase("/motion/lastEvent", jsonData);
        
        Serial.println("⚠️ Unauthorized motion detected!");
        Serial.println("📤 Sent encrypted data to Firebase");
      } else {
        // Encrypt individual fields
        String encryptedEvent = encryptData("Authorized Entry");
        String encryptedDeviceID = encryptData("Device_B");
        
        // Send authorized entry to Firebase
        StaticJsonDocument<512> doc;
        doc["event"] = encryptedEvent;
        doc["timestamp"] = millis();
        doc["deviceID"] = encryptedDeviceID;
        
        String jsonData;
        serializeJson(doc, jsonData);
        sendToFirebase("/motion/lastEvent", jsonData);
        
        Serial.println("✅ Authorized entry detected");
        Serial.println("📤 Sent encrypted data to Firebase");
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

// Emergency Monitor Task
void taskEmergencyMonitor(void *parameter) {
  while (1) {
    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(FIREBASE_EMERGENCY_URL);
      int code = http.GET();

      if (code == 200) {
        String payload = http.getString();
        StaticJsonDocument<512> doc;
        deserializeJson(doc, payload);

        bool emergencyDetected = false;
        
        // Try to decrypt the button value if it's encrypted
        if (doc.containsKey("button")) {
          String buttonValue = doc["button"].as<String>();
          
          // Check if it's encrypted (base64 string)
          if (buttonValue.length() > 10 && buttonValue != "true" && buttonValue != "false") {
            String decryptedValue = decryptData(buttonValue);
            if (decryptedValue == "true") {
              emergencyDetected = true;
            }
          } else {
            // Plain boolean value
            if (doc["button"] == true) {
              emergencyDetected = true;
            }
          }
        }

        if (emergencyDetected) {
          Serial.println("🚨 EMERGENCY ALERT RECEIVED");
          soundEmergencyAlert();

          // Reset flag
          HTTPClient resetHttp;
          resetHttp.begin(FIREBASE_EMERGENCY_URL);
          resetHttp.addHeader("Content-Type", "application/json");
          resetHttp.PUT("{\"button\":false}");
          resetHttp.end();
        }
      }
      http.end();
    }
    
    vTaskDelay(pdMS_TO_TICKS(1000));
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

void soundEmergencyAlert() {
  // Continuous loud emergency alarm for 3 seconds
  for (int i = 0; i < 15; i++) {
    tone(BUZZER_PIN, 2000);  // High frequency tone for maximum volume
    delay(100);
    tone(BUZZER_PIN, 1000);  // Alternating frequency
    delay(100);
  }
  noTone(BUZZER_PIN);
}
