#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <DHT.h>
#include <mbedtls/aes.h>
#include <mbedtls/base64.h>

/* ================= WIFI & FIREBASE ================= */
#define WIFI_SSID       "Disha"
#define WIFI_PASSWORD   "saritadeshmukh"

#define DATABASE_URL "https://mosquitto-d1aa7-default-rtdb.asia-southeast1.firebasedatabase.app"
#define DB_PATH "/new_health.json"
#define EMERGENCY_URL "https://mosquitto-d1aa7-default-rtdb.asia-southeast1.firebasedatabase.app/emergency.json"

/* ================= SENSOR PINS ================= */
#define DHT_PIN     4
#define DHT_TYPE    DHT11
#define PULSE_PIN   34
#define BUTTON_PIN  27

#define MPU_ADDR    0x68

/* ================= ENCRYPTION KEYS (SAME AS DEVICE B) ================= */
const unsigned char AES_KEY[16] = {
  0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6,
  0xab, 0xf7, 0x97, 0x45, 0xcf, 0x4f, 0x09, 0x8c
};

unsigned char AES_IV[16] = {
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f
};

/* ================= OBJECTS ================= */
DHT dht(DHT_PIN, DHT_TYPE);

/* ================= SHARED DATA ================= */
float temperature = 0;
float humidity = 0;
float bpm = 0;
String posture = "UNKNOWN";
bool fallDetected = false;

/* ================= RTOS ================= */
TaskHandle_t dhtTaskHandle;
TaskHandle_t pulseTaskHandle;
TaskHandle_t mpuTaskHandle;
TaskHandle_t cloudTaskHandle;
TaskHandle_t buttonTaskHandle;

SemaphoreHandle_t dataMutex;

/* ================= MPU DATA ================= */
float ax, ay, az;
float accelMag;

/* ================= FALL DETECTION ================= */
unsigned long fallTriggerTime = 0;
unsigned long lastFallTime = 0;
float lastAz = 1.0;

#define IMPACT_THRESHOLD   1.8
#define ORIENTATION_LIMIT  0.6
#define FALL_RESET_TIME    3000
#define FALL_COOLDOWN      4000

/* ================= FUNCTION PROTOTYPES ================= */
String encryptData(String plaintext);
String decryptData(String encrypted);

/* ================= ENCRYPTION FUNCTIONS ================= */
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
    Serial.println("Data too large for encryption");
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
    Serial.println("Encryption failed");
    return "";
  }
  
  // Base64 encode
  static unsigned char base64_output[1024];
  size_t base64_len = 0;
  
  ret = mbedtls_base64_encode(base64_output, 1024, &base64_len, output, dataLength);
  
  if (ret != 0) {
    Serial.println("Base64 encoding failed");
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
    Serial.println("Base64 decode failed");
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
    Serial.println("Decryption failed");
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

/* ================= SETUP ================= */
void setup() {
  Serial.begin(115200);

  Wire.begin(21, 22);
  dht.begin();
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  dataMutex = xSemaphoreCreateMutex();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  WiFi.setSleep(false);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n WiFi connected");
  Serial.println(" Encryption: ENABLED (Individual Field Encryption)");

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0);
  Wire.endTransmission(true);

  xTaskCreatePinnedToCore(taskDHT,    "DHT",    4096, NULL, 1, &dhtTaskHandle,    1);
  xTaskCreatePinnedToCore(taskPulse,  "Pulse",  4096, NULL, 1, &pulseTaskHandle,  1);
  xTaskCreatePinnedToCore(taskMPU,    "MPU",    4096, NULL, 1, &mpuTaskHandle,    1);
  xTaskCreatePinnedToCore(taskCloud,  "Cloud",  8192, NULL, 1, &cloudTaskHandle,  0);
  xTaskCreatePinnedToCore(taskButton, "Button", 4096, NULL, 1, &buttonTaskHandle, 0);
}

void loop() {}

/* ================= TASK 1 : DHT ================= */
void taskDHT(void *pv) {
  while (1) {
    float h = dht.readHumidity();
    float t = dht.readTemperature();

    if (!isnan(h) && !isnan(t)) {
      xSemaphoreTake(dataMutex, portMAX_DELAY);
      humidity = h;
      temperature = t;
      xSemaphoreGive(dataMutex);
    }
    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

/* ================= TASK 2 : PULSE ================= */
void taskPulse(void *pv) {
  static int lastSignal = 0;
  static unsigned long lastBeat = 0;
  static float threshold = 2000;

  while (1) {
    int signal = analogRead(PULSE_PIN);
    int diff = signal - lastSignal;

    if (diff > 25 && signal > threshold) {
      unsigned long now = millis();
      if (now - lastBeat > 400) {
        float localBPM = 60000.0 / (now - lastBeat);
        xSemaphoreTake(dataMutex, portMAX_DELAY);
        bpm = localBPM;
        xSemaphoreGive(dataMutex);
        lastBeat = now;
      }
    }

    threshold = threshold * 0.9 + signal * 0.1;
    lastSignal = signal;
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

/* ================= TASK 3 : MPU (POSTURE + FALL) ================= */
void taskMPU(void *pv) {
  while (1) {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x3B);
    Wire.endTransmission(false);
    Wire.requestFrom(MPU_ADDR, 6, true);

    int16_t axRaw = (Wire.read() << 8) | Wire.read();
    int16_t ayRaw = (Wire.read() << 8) | Wire.read();
    int16_t azRaw = (Wire.read() << 8) | Wire.read();

    ax = axRaw / 16384.0;
    ay = ayRaw / 16384.0;
    az = azRaw / 16384.0;

    accelMag = sqrt(ax*ax + ay*ay + az*az);

    String localPosture;
    bool localFall = fallDetected;

    if (abs(az) > 0.8 && abs(ax) < 0.3) localPosture = "SLEEPING";
    else if (abs(ax) > 0.7)            localPosture = "SITTING";
    else                               localPosture = "STANDING";

    bool strongImpact = accelMag > IMPACT_THRESHOLD;
    bool orientationFlip =
      (lastAz > ORIENTATION_LIMIT && az < -ORIENTATION_LIMIT) ||
      (lastAz < -ORIENTATION_LIMIT && az > ORIENTATION_LIMIT);

    if (strongImpact && orientationFlip &&
        millis() - lastFallTime > FALL_COOLDOWN) {
      localFall = true;
      fallTriggerTime = millis();
      lastFallTime = millis();
      Serial.println("FALL DETECTED");
    }

    if (localFall && millis() - fallTriggerTime > FALL_RESET_TIME) {
      localFall = false;
    }

    lastAz = az;

    xSemaphoreTake(dataMutex, portMAX_DELAY);
    posture = localPosture;
    fallDetected = localFall;
    xSemaphoreGive(dataMutex);

    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

/* ================= TASK 4 : CLOUD (WITH ENCRYPTION) ================= */
void taskCloud(void *pv) {
  while (1) {
    if (WiFi.status() == WL_CONNECTED) {
      float t, h, b;
      String p;
      bool f;

      xSemaphoreTake(dataMutex, portMAX_DELAY);
      t = temperature;
      h = humidity;
      b = bpm;
      p = posture;
      f = fallDetected;
      xSemaphoreGive(dataMutex);

      // Display actual values on Serial Monitor
      Serial.println("\n========== SENSOR DATA ==========");
      Serial.print("Temperature: ");
      Serial.print(t, 1);
      Serial.println(" °C");
      
      Serial.print("Humidity: ");
      Serial.print(h, 1);
      Serial.println(" %");
      
      Serial.print("Heart Rate: ");
      Serial.print(b, 1);
      Serial.println(" BPM");
      
      Serial.print("Posture: ");
      Serial.println(p);
      
      Serial.print("Fall Detected: ");
      Serial.println(f ? "YES" : "NO");
      Serial.println("=================================\n");

      // Encrypt individual field values
      String encryptedTemp = encryptData(String(t, 1));
      String encryptedHumidity = encryptData(String(h, 1));
      String encryptedBPM = encryptData(String(b, 1));
      String encryptedPosture = encryptData(p);
      String encryptedFall = encryptData(f ? "true" : "false");

      // Build JSON with encrypted values
      HTTPClient http;
      String payload = "{";
      payload += "\"temperature\":\"" + encryptedTemp + "\",";
      payload += "\"humidity\":\"" + encryptedHumidity + "\",";
      payload += "\"bpm\":\"" + encryptedBPM + "\",";
      payload += "\"posture\":\"" + encryptedPosture + "\",";
      payload += "\"fall\":\"" + encryptedFall + "\"";
      payload += "}";

      http.begin(String(DATABASE_URL) + DB_PATH);
      http.addHeader("Content-Type", "application/json");
      int responseCode = http.PUT(payload);
      
      if (responseCode > 0) {
        Serial.println("   Data sent to Firebase (encrypted)");
      } else {
        Serial.println("Failed to send data");
      }
      
      http.end();
    }
    vTaskDelay(pdMS_TO_TICKS(3000));
  }
}

/* ================= TASK 5 : SOS BUTTON (30s AUTO RESET WITH ENCRYPTION) ================= */
void taskButton(void *pv) {
  bool lastButtonState = HIGH;
  bool sosActive = false;
  unsigned long sosStartTime = 0;

  while (1) {
    bool buttonState = digitalRead(BUTTON_PIN);

    // Button pressed
    if (buttonState == LOW && lastButtonState == HIGH) {
      Serial.println("\nSOS BUTTON PRESSED");
      Serial.println("Button State: TRUE");

      sosActive = true;
      sosStartTime = millis();

      if (WiFi.status() == WL_CONNECTED) {
        // Encrypt the button state
        String encryptedButton = encryptData("true");
        
        HTTPClient http;
        http.begin(EMERGENCY_URL);
        http.addHeader("Content-Type", "application/json");
        String payload = "{\"button\":\"" + encryptedButton + "\"}";
        http.PUT(payload);
        http.end();
        
        Serial.println("Emergency alert sent (encrypted)");
      }
    }

    // Auto reset after 30 seconds
    if (sosActive && millis() - sosStartTime >= 30000) {
      Serial.println("\nSOS AUTO RESET");
      Serial.println("Button State: FALSE");

      sosActive = false;

      if (WiFi.status() == WL_CONNECTED) {
        // Encrypt the button state
        String encryptedButton = encryptData("false");
        
        HTTPClient http;
        http.begin(EMERGENCY_URL);
        http.addHeader("Content-Type", "application/json");
        String payload = "{\"button\":\"" + encryptedButton + "\"}";
        http.PUT(payload);
        http.end();
        
        Serial.println("Emergency reset sent (encrypted)");
      }
    }

    lastButtonState = buttonState;
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}
