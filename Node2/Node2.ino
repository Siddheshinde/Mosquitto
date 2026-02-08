#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>
#include <mbedtls/aes.h>
#include <mbedtls/base64.h>
#include <esp_wifi.h>
#include <esp_pm.h>
#include <driver/rtc_io.h>

// Pin Definitions
#define SS_PIN 21
#define RST_PIN 22
#define MOTION_PIN 13
#define BUZZER_PIN 25

// WiFi Credentials
const char *ssid = "Galaxy S23 FE";
const char *password = "123456789";

// Firebase REST API Configuration
const char *FIREBASE_HOST = "https://mosquitto-d1aa7-default-rtdb.asia-southeast1.firebasedatabase.app";
const char *FIREBASE_AUTH = "AIzaSyA87gNFHXvvNVmNoGKvAGdanJ-PBelh3rQ";
const char *FIREBASE_EMERGENCY_URL = "https://mosquitto-d1aa7-default-rtdb.asia-southeast1.firebasedatabase.app/emergency.json";

// Device A IP
const char *deviceA_IP = "10.144.163.117";

// RFID
MFRC522 rfid(SS_PIN, RST_PIN);

// Authorized card UID
byte authorizedUID[] = {0xB9, 0xA3, 0xF2, 0x05};

/* ================= POWER MANAGEMENT ================= */
#define CPU_FREQ_MHZ 160  // Increased from 80 MHz for better performance
#define LIGHT_SLEEP_ENABLED false  // Disabled to prevent interference with RFID/sensors
#define RFID_SLEEP_TIMEOUT 60000  // Increased timeout to 60s

// ============== ENCRYPTION KEYS ==============
const unsigned char AES_KEY[16] = {
    0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6,
    0xab, 0xf7, 0x97, 0x45, 0xcf, 0x4f, 0x09, 0x8c};

unsigned char AES_IV[16] = {
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f};
// =============================================

// Shared data
SemaphoreHandle_t dataMutex;

struct AccessData
{
  bool isAuthorized;
  unsigned long lastAuthTime;
  bool intruderDetected;
  String lastCardUID;
} accessData;

/* ================= POWER MANAGEMENT VARIABLES ================= */
unsigned long lastRFIDActivity = 0;
unsigned long lastMotionActivity = 0;
unsigned long lastWifiActivity = 0;
bool rfidSleeping = false;

// Function Prototypes
void taskRFIDScanner(void *parameter);
void taskMotionMonitor(void *parameter);
void taskAlertSender(void *parameter);
void taskEmergencyMonitor(void *parameter);
void setupWiFi();
void soundAuthorizedBeep();
void soundIntruderAlarm();
void soundEmergencyAlert();
bool checkAuthorized(byte *uid, byte size);
bool sendToFirebase(String path, String jsonData);
bool updateFirebaseString(String path, String value);
String encryptData(String plaintext);
String decryptData(String encrypted);
void configurePowerManagement();
void enterLightSleep(uint32_t ms);
void putRFIDToSleep();
void wakeRFID();

/* ================= POWER MANAGEMENT FUNCTIONS ================= */
void configurePowerManagement() {
  // Set CPU frequency to balanced value
  setCpuFrequencyMhz(CPU_FREQ_MHZ);
  
  // Configure automatic light sleep (only if enabled)
  if (LIGHT_SLEEP_ENABLED) {
    esp_pm_config_esp32_t pm_config;
    pm_config.max_freq_mhz = CPU_FREQ_MHZ;
    pm_config.min_freq_mhz = 80;
    pm_config.light_sleep_enable = true;
    esp_pm_configure(&pm_config);
  }
  
  // Configure WiFi power saving mode (minimal to maintain connection)
  esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
  
  Serial.println("⚡ Power Management Configured:");
  Serial.print("   CPU Frequency: ");
  Serial.print(CPU_FREQ_MHZ);
  Serial.println(" MHz");
  Serial.print("   Light Sleep: ");
  Serial.println(LIGHT_SLEEP_ENABLED ? "ENABLED" : "DISABLED");
  Serial.println("   WiFi Power Save: MIN_MODEM");
  Serial.println("   RFID Auto-Sleep: ENABLED");
}

void enterLightSleep(uint32_t ms) {
  if (LIGHT_SLEEP_ENABLED && ms > 10) {
    esp_sleep_enable_timer_wakeup(ms * 1000);
    esp_light_sleep_start();
  } else {
    vTaskDelay(pdMS_TO_TICKS(ms));
  }
}

void putRFIDToSleep() {
  if (!rfidSleeping) {
    rfid.PCD_SoftPowerDown();
    rfidSleeping = true;
    Serial.println("💤 RFID Reader entered sleep mode");
  }
}

void wakeRFID() {
  if (rfidSleeping) {
    rfid.PCD_SoftPowerUp();
    rfidSleeping = false;
    delay(50); // Give RFID time to wake up properly
    Serial.println("⏰ RFID Reader woke up");
  }
}

// ============== ENCRYPTION FUNCTIONS ==============
String encryptData(String plaintext)
{
  // PKCS7 padding
  int paddingLength = 16 - (plaintext.length() % 16);
  for (int i = 0; i < paddingLength; i++)
  {
    plaintext += (char)paddingLength;
  }

  int dataLength = plaintext.length();

  // Use static buffers to avoid heap issues
  static unsigned char input[512];
  static unsigned char output[512];

  if (dataLength > 512)
  {
    Serial.println("❌ Data too large for encryption");
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

  if (ret != 0)
  {
    Serial.println("❌ Encryption failed");
    return "";
  }

  // Base64 encode
  static unsigned char base64_output[1024];
  size_t base64_len = 0;

  ret = mbedtls_base64_encode(base64_output, 1024, &base64_len, output, dataLength);

  if (ret != 0)
  {
    Serial.println("❌ Base64 encoding failed");
    return "";
  }

  return String((char *)base64_output).substring(0, base64_len);
}

String decryptData(String encrypted)
{
  static unsigned char decoded[512];
  static unsigned char output[512];

  size_t decoded_len = 0;

  int ret = mbedtls_base64_decode(decoded, 512, &decoded_len,
                                  (unsigned char *)encrypted.c_str(),
                                  encrypted.length());

  if (ret != 0)
  {
    Serial.println("❌ Base64 decode failed");
    return "";
  }

  mbedtls_aes_context aes;
  mbedtls_aes_init(&aes);
  mbedtls_aes_setkey_dec(&aes, AES_KEY, 128);

  unsigned char iv_copy[16];
  memcpy(iv_copy, AES_IV, 16);

  ret = mbedtls_aes_crypt_cbc(&aes, MBEDTLS_AES_DECRYPT, decoded_len, iv_copy, decoded, output);
  mbedtls_aes_free(&aes);

  if (ret != 0)
  {
    Serial.println("❌ Decryption failed");
    return "";
  }

  // Remove padding
  int paddingLength = output[decoded_len - 1];
  int actualLength = decoded_len - paddingLength;

  String result = "";
  for (int i = 0; i < actualLength; i++)
  {
    result += (char)output[i];
  }

  return result;
}
// ========================================================

void setup()
{
  Serial.begin(115200);
  delay(1000); // Give serial time to initialize
  
  Serial.println("\n\n=================================");
  Serial.println("🚀 Device B Starting Up...");
  Serial.println("=================================");

  dataMutex = xSemaphoreCreateMutex();

  pinMode(MOTION_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  Serial.println("🔧 Initializing SPI and RFID...");
  SPI.begin();
  rfid.PCD_Init();
  delay(100); // Give RFID time to initialize
  
  // Verify RFID is working
  byte version = rfid.PCD_ReadRegister(rfid.VersionReg);
  Serial.print("📡 MFRC522 Version: 0x");
  Serial.println(version, HEX);
  
  if (version == 0x00 || version == 0xFF) {
    Serial.println("⚠️ WARNING: RFID communication problem!");
  } else {
    Serial.println("✅ RFID reader initialized successfully");
  }

  // Configure power management
  configurePowerManagement();

  setupWiFi();

  // Test Firebase connection
  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.println("🔥 Testing Firebase REST API connection...");
    if (updateFirebaseString("/system/status", "Device B Online"))
    {
      Serial.println("✅ Firebase REST API connected successfully");
      lastWifiActivity = millis();
    }
    else
    {
      Serial.println("❌ Firebase REST API connection failed");
    }
  }

  if (xSemaphoreTake(dataMutex, portMAX_DELAY))
  {
    accessData.isAuthorized = false;
    accessData.lastAuthTime = 0;
    accessData.intruderDetected = false;
    accessData.lastCardUID = "";
    xSemaphoreGive(dataMutex);
  }

  Serial.println("\n🔄 Creating FreeRTOS tasks...");
  xTaskCreatePinnedToCore(taskRFIDScanner, "RFIDScanner", 8192, NULL, 2, NULL, 1);
  xTaskCreatePinnedToCore(taskMotionMonitor, "MotionMonitor", 8192, NULL, 2, NULL, 1);
  xTaskCreatePinnedToCore(taskAlertSender, "AlertSender", 4096, NULL, 1, NULL, 1);
  xTaskCreatePinnedToCore(taskEmergencyMonitor, "EmergencyMonitor", 8192, NULL, 1, NULL, 0);

  Serial.println("✅ Device B: All FreeRTOS tasks created");
  Serial.println("\n=================================");
  Serial.println("🔐 Sentry Unit Active - Monitoring entry point");
  Serial.println("🚨 Emergency Alert Monitor Active");
  Serial.println("🔒 Encryption: ENABLED (Individual Field Encryption)");
  Serial.println("=================================\n");
  
  lastRFIDActivity = millis();
  lastMotionActivity = millis();
}

void loop()
{
  vTaskDelay(pdMS_TO_TICKS(1000));
}

// WiFi Setup
void setupWiFi()
{
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // Disable WiFi sleep for better reliability
  WiFi.begin(ssid, password);

  Serial.println("📡 Connecting to WiFi...");
  int attempts = 0;

  while (WiFi.status() != WL_CONNECTED && attempts < 30)
  {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.println("\n✅ WiFi Connected!");
    Serial.print("   IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("   Signal Strength: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  }
  else
  {
    Serial.println("\n❌ WiFi connection failed!");
    Serial.println("➡️ Continuing without WiFi...");
  }
}

// Firebase REST API Functions
bool sendToFirebase(String path, String jsonData)
{
  if (WiFi.status() != WL_CONNECTED)
  {
    Serial.println("❌ WiFi not connected - cannot send to Firebase");
    return false;
  }

  lastWifiActivity = millis();

  HTTPClient http;
  http.setTimeout(10000);  // 10 second timeout
  String url = String(FIREBASE_HOST) + path + ".json?auth=" + String(FIREBASE_AUTH);

  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  int httpResponseCode = http.PUT(jsonData);

  if (httpResponseCode > 0)
  {
    String response = http.getString();
    Serial.println("✅ Firebase PUT Success: " + String(httpResponseCode));
    http.end();
    return true;
  }
  else
  {
    Serial.print("❌ Firebase PUT Error: ");
    Serial.println(httpResponseCode);
    http.end();
    return false;
  }
}

bool updateFirebaseString(String path, String value)
{
  // Encrypt the value
  String encryptedValue = encryptData(value);

  if (encryptedValue == "")
  {
    Serial.println("⚠️ Encryption failed, using plain value");
    encryptedValue = value;
  }

  StaticJsonDocument<300> doc;
  doc["value"] = encryptedValue;
  doc["timestamp"] = millis();

  String jsonData;
  serializeJson(doc, jsonData);

  return sendToFirebase(path, jsonData);
}

// RFID Scanner Task (FIXED)
void taskRFIDScanner(void *parameter)
{
  Serial.println("✅ RFID Scanner Task Started");
  TickType_t lastWakeTime = xTaskGetTickCount();
  const TickType_t frequency = pdMS_TO_TICKS(200); // Check every 200ms
  
  int scanCount = 0;

  while (1)
  {
    // Wake RFID if it's sleeping
    if (rfidSleeping) {
      wakeRFID();
    }
    
    // Debug output every 50 scans (every ~10 seconds)
    scanCount++;
    if (scanCount % 50 == 0) {
      Serial.println("🔍 RFID Scanner running... (scan #" + String(scanCount) + ")");
    }
    
    // Check for new card
    if (!rfid.PICC_IsNewCardPresent()) {
      vTaskDelayUntil(&lastWakeTime, frequency);
      continue;
    }
    
    if (!rfid.PICC_ReadCardSerial()) {
      vTaskDelayUntil(&lastWakeTime, frequency);
      continue;
    }
    
    // Card detected!
    lastRFIDActivity = millis();
    
    Serial.println("\n📇 RFID Card Detected!");
    
    String uidString = "";
    Serial.print("   UID: ");
    for (byte i = 0; i < rfid.uid.size; i++)
    {
      if (rfid.uid.uidByte[i] < 0x10) {
        uidString += "0";
        Serial.print("0");
      }
      uidString += String(rfid.uid.uidByte[i], HEX);
      Serial.print(rfid.uid.uidByte[i], HEX);
      if (i < rfid.uid.size - 1) Serial.print(":");
    }
    Serial.println();
    uidString.toUpperCase();

    bool authorized = checkAuthorized(rfid.uid.uidByte, rfid.uid.size);

    if (authorized)
    {
      Serial.println("   ✅ AUTHORIZED CARD");
      soundAuthorizedBeep();
      
      if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)))
      {
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
      
      Serial.println("   📤 Sending to Firebase...");
      if (sendToFirebase("/rfid/lastEvent", jsonData)) {
        Serial.println("   ✅ Data sent successfully\n");
      } else {
        Serial.println("   ❌ Failed to send data\n");
      }
    }
    else
    {
      Serial.println("   ⚠️ UNAUTHORIZED CARD - ALARM!");
      soundIntruderAlarm();
      
      if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)))
      {
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
      
      Serial.println("   📤 Sending alert to Firebase...");
      if (sendToFirebase("/rfid/lastEvent", jsonData)) {
        Serial.println("   ✅ Alert sent successfully\n");
      } else {
        Serial.println("   ❌ Failed to send alert\n");
      }
    }
    
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    
    // Prevent rapid re-reads
    vTaskDelay(pdMS_TO_TICKS(1000));
    
    // Put RFID to sleep if inactive for too long
    if (millis() - lastRFIDActivity > RFID_SLEEP_TIMEOUT && !rfidSleeping) {
      putRFIDToSleep();
    }
    
    vTaskDelayUntil(&lastWakeTime, frequency);
  }
}

// Motion Monitor Task (FIXED)
void taskMotionMonitor(void *parameter)
{
  Serial.println("✅ Motion Monitor Task Started");
  TickType_t lastWakeTime = xTaskGetTickCount();
  const TickType_t frequency = pdMS_TO_TICKS(200); // Check every 200ms
  bool lastMotionState = false;
  int checkCount = 0;

  while (1)
  {
    bool motionDetected = digitalRead(MOTION_PIN);
    
    // Debug output every 50 checks
    checkCount++;
    if (checkCount % 50 == 0) {
      Serial.println("👁️ Motion Monitor running... Motion: " + String(motionDetected ? "YES" : "NO"));
    }

    if (motionDetected && !lastMotionState)
    {
      Serial.println("\n🚶 MOTION DETECTED!");
      lastMotionActivity = millis();
      
      bool authorized = false;
      unsigned long timeSinceAuth = 0;

      if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)))
      {
        timeSinceAuth = millis() - accessData.lastAuthTime;
        authorized = accessData.isAuthorized && (timeSinceAuth < 5000);
        xSemaphoreGive(dataMutex);
      }

      if (!authorized)
      {
        Serial.println("   ⚠️ UNAUTHORIZED MOTION - ALARM!");
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
        
        Serial.println("   📤 Sending alert to Firebase...");
        if (sendToFirebase("/motion/lastEvent", jsonData)) {
          Serial.println("   ✅ Alert sent successfully\n");
        } else {
          Serial.println("   ❌ Failed to send alert\n");
        }
      }
      else
      {
        Serial.println("   ✅ AUTHORIZED ENTRY (within 5s of card scan)");
        
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
        
        Serial.println("   📤 Sending to Firebase...");
        if (sendToFirebase("/motion/lastEvent", jsonData)) {
          Serial.println("   ✅ Data sent successfully\n");
        } else {
          Serial.println("   ❌ Failed to send data\n");
        }
      }
    }

    lastMotionState = motionDetected;
    vTaskDelayUntil(&lastWakeTime, frequency);
  }
}

// Alert Sender Task
void taskAlertSender(void *parameter)
{
  Serial.println("✅ Alert Sender Task Started");
  while (1)
  {
    vTaskDelay(pdMS_TO_TICKS(500));
  }
}

// Emergency Monitor Task (FIXED)
void taskEmergencyMonitor(void *parameter)
{
  Serial.println("✅ Emergency Monitor Task Started");
  int checkCount = 0;
  
  while (1)
  {
    checkCount++;
    if (checkCount % 10 == 0) {
      Serial.println("🚨 Emergency Monitor running... (check #" + String(checkCount) + ")");
    }
    
    if (WiFi.status() == WL_CONNECTED)
    {
      lastWifiActivity = millis();
      
      HTTPClient http;
      http.setTimeout(10000);
      http.begin(FIREBASE_EMERGENCY_URL);
      int code = http.GET();

      if (code == 200)
      {
        String payload = http.getString();
        StaticJsonDocument<512> doc;
        deserializeJson(doc, payload);

        bool emergencyDetected = false;

        // Try to decrypt the button value if it's encrypted
        if (doc.containsKey("button"))
        {
          String buttonValue = doc["button"].as<String>();

          // Check if it's encrypted (base64 string)
          if (buttonValue.length() > 10 && buttonValue != "true" && buttonValue != "false")
          {
            String decryptedValue = decryptData(buttonValue);
            if (decryptedValue == "true")
            {
              emergencyDetected = true;
            }
          }
          else
          {
            // Plain boolean value
            if (doc["button"] == true)
            {
              emergencyDetected = true;
            }
          }
        }

        if (emergencyDetected)
        {
          Serial.println("\n🚨🚨🚨 EMERGENCY ALERT RECEIVED 🚨🚨🚨");
          soundEmergencyAlert();

          // Reset flag
          HTTPClient resetHttp;
          resetHttp.setTimeout(10000);
          resetHttp.begin(FIREBASE_EMERGENCY_URL);
          resetHttp.addHeader("Content-Type", "application/json");
          resetHttp.PUT("{\"button\":false}");
          resetHttp.end();
          
          Serial.println("✅ Emergency flag reset\n");
        }
      }
      else if (code < 0) {
        Serial.println("❌ Emergency Monitor: HTTP error " + String(code));
      }
      http.end();
    }
    else
    {
      Serial.println("⚠️ WiFi disconnected, reconnecting...");
      WiFi.reconnect();
      vTaskDelay(pdMS_TO_TICKS(5000));
    }

    vTaskDelay(pdMS_TO_TICKS(2000)); // Check every 2 seconds
  }
}

// Check if card is authorized
bool checkAuthorized(byte *uid, byte size)
{
  if (size != sizeof(authorizedUID))
    return false;

  for (byte i = 0; i < size; i++)
  {
    if (uid[i] != authorizedUID[i])
      return false;
  }
  return true;
}

// Sound functions
void soundAuthorizedBeep()
{
  tone(BUZZER_PIN, 1000, 200);
  delay(250);
  noTone(BUZZER_PIN);
}

void soundIntruderAlarm()
{
  for (int i = 0; i < 5; i++)
  {
    tone(BUZZER_PIN, 1000, 200);
    delay(150);
    noTone(BUZZER_PIN);
    delay(100);
  }
  noTone(BUZZER_PIN);
}

void soundEmergencyAlert()
{
  // Continuous loud emergency alarm for 3 seconds
  for (int i = 0; i < 15; i++)
  {
    tone(BUZZER_PIN, 2000);
    delay(100);
    tone(BUZZER_PIN, 1000);
    delay(100);
  }
  noTone(BUZZER_PIN);
}
