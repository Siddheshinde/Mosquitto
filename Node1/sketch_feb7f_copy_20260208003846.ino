#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <DHT.h>
#include <mbedtls/aes.h>
#include <mbedtls/base64.h>
#include <esp_wifi.h>
#include <esp_pm.h>
#include <driver/rtc_io.h>

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

/* ================= POWER MANAGEMENT ================= */
#define DEEP_SLEEP_DURATION 0  // Disabled for continuous monitoring
#define LIGHT_SLEEP_ENABLED true
#define CPU_FREQ_MHZ 160  // Increased from 80 for better stability

/* ================= PULSE SENSOR CONFIGURATION ================= */
#define PULSE_THRESHOLD 550      // Baseline threshold (adjust based on your sensor)
#define PULSE_FADE_RATE 0.95     // How fast threshold adapts
#define MIN_BPM 40               // Minimum valid BPM
#define MAX_BPM 200              // Maximum valid BPM
#define MIN_IBI 300              // Minimum Inter-Beat Interval (ms) = 200 BPM
#define MAX_IBI 1500             // Maximum Inter-Beat Interval (ms) = 40 BPM
#define SIGNAL_CHANGE_THRESHOLD 20  // Minimum signal change to detect beat

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
bool mpuInitialized = false;

/* ================= FALL DETECTION ================= */
unsigned long fallTriggerTime = 0;
unsigned long lastFallTime = 0;
float lastAz = 1.0;

#define IMPACT_THRESHOLD   1.8
#define ORIENTATION_LIMIT  0.6
#define FALL_RESET_TIME    3000
#define FALL_COOLDOWN      4000

/* ================= POWER MANAGEMENT VARIABLES ================= */
bool wifiConnected = false;
unsigned long lastWifiActivity = 0;
unsigned long lastWifiCheck = 0;
#define WIFI_TIMEOUT 300000  // 5 minutes of inactivity
#define WIFI_CHECK_INTERVAL 30000  // Check WiFi every 30 seconds

/* ================= FUNCTION PROTOTYPES ================= */
String encryptData(String plaintext);
String decryptData(String encrypted);
void configurePowerManagement();
void enterLightSleep(uint32_t ms);
void putMPUToSleep();
void wakeMPU();
bool initMPU();
void ensureWiFiConnected();

/* ================= POWER MANAGEMENT FUNCTIONS ================= */
void configurePowerManagement() {
  // Set CPU frequency to moderate value for stability and power saving
  setCpuFrequencyMhz(CPU_FREQ_MHZ);
  
  // Configure automatic light sleep
  esp_pm_config_esp32_t pm_config;
  pm_config.max_freq_mhz = CPU_FREQ_MHZ;
  pm_config.min_freq_mhz = 80;  // Minimum frequency during light sleep
  pm_config.light_sleep_enable = LIGHT_SLEEP_ENABLED;
  esp_pm_configure(&pm_config);
  
  // Configure WiFi power saving mode (less aggressive)
  esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
  
  Serial.println("⚡ Power Management Configured:");
  Serial.print("   CPU Frequency: ");
  Serial.print(CPU_FREQ_MHZ);
  Serial.println(" MHz");
  Serial.println("   Light Sleep: ENABLED");
  Serial.println("   WiFi Power Save: MIN_MODEM");
}

void enterLightSleep(uint32_t ms) {
  if (LIGHT_SLEEP_ENABLED && ms > 50) {
    // Only use light sleep for longer delays
    esp_sleep_enable_timer_wakeup(ms * 1000);
    esp_light_sleep_start();
  } else {
    vTaskDelay(pdMS_TO_TICKS(ms));
  }
}

void putMPUToSleep() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);  // PWR_MGMT_1 register
  Wire.write(0x40);  // Set SLEEP bit
  Wire.endTransmission(true);
}

void wakeMPU() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);  // PWR_MGMT_1 register
  Wire.write(0x00);  // Clear SLEEP bit
  Wire.endTransmission(true);
  delay(30);  // Wait for MPU to stabilize
}

bool initMPU() {
  Serial.println("Initializing MPU6050...");
  
  // Wake up MPU6050
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);  // PWR_MGMT_1 register
  Wire.write(0x00);  // Clear sleep mode
  byte error = Wire.endTransmission(true);
  
  if (error != 0) {
    Serial.println("❌ MPU6050 not found!");
    return false;
  }
  
  delay(100);
  
  // Configure accelerometer range (±2g)
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1C);  // ACCEL_CONFIG register
  Wire.write(0x00);  // ±2g range
  Wire.endTransmission(true);
  
  Serial.println("✅ MPU6050 initialized");
  return true;
}

void ensureWiFiConnected() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("🔄 Reconnecting WiFi...");
    WiFi.disconnect();
    delay(100);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
      delay(500);
      Serial.print(".");
      attempts++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\n✅ WiFi reconnected");
      wifiConnected = true;
      lastWifiActivity = millis();
    } else {
      Serial.println("\n❌ WiFi reconnection failed");
      wifiConnected = false;
    }
  }
}

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
  
  if (ret != 0) {
    Serial.println("❌ Encryption failed");
    return "";
  }
  
  // Base64 encode
  static unsigned char base64_output[1024];
  size_t base64_len = 0;
  
  ret = mbedtls_base64_encode(base64_output, 1024, &base64_len, output, dataLength);
  
  if (ret != 0) {
    Serial.println("❌ Base64 encoding failed");
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
  
  if (ret != 0) {
    Serial.println("❌ Decryption failed");
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
  delay(1000);  // Wait for serial to initialize
  
  Serial.println("\n\n========================================");
  Serial.println("   ESP32 Health Monitor - Node 1");
  Serial.println("========================================\n");

  // Configure ADC for pulse sensor
  analogReadResolution(12);  // 12-bit resolution (0-4095)
  analogSetAttenuation(ADC_11db);  // Full range 0-3.3V
  
  // Initialize I2C
  Wire.begin(21, 22);
  Wire.setClock(100000);  // 100kHz for stability
  
  // Initialize DHT sensor
  Serial.println("Initializing DHT11...");
  dht.begin();
  delay(2000);  // DHT needs time to stabilize
  Serial.println("✅ DHT11 initialized");
  
  // Initialize button
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  Serial.println("✅ Button initialized");
  
  // Initialize pulse sensor pin
  pinMode(PULSE_PIN, INPUT);
  Serial.println("✅ Pulse sensor initialized");

  dataMutex = xSemaphoreCreateMutex();

  // Configure power management
  configurePowerManagement();

  // Initialize WiFi with retry logic
  Serial.println("\nConnecting to WiFi...");
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  // Don't enable WiFi sleep during connection
  esp_wifi_set_ps(WIFI_PS_NONE);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi connected");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Signal Strength: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    
    // Now enable power saving
    esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
    
    wifiConnected = true;
    lastWifiActivity = millis();
  } else {
    Serial.println("\n❌ WiFi connection failed - will retry in tasks");
    wifiConnected = false;
  }
  
  Serial.println("🔒 Encryption: ENABLED (Individual Field Encryption)");

  // Initialize MPU6050
  mpuInitialized = initMPU();
  if (!mpuInitialized) {
    Serial.println("⚠️ Starting without MPU - will retry in task");
  }

  // Create tasks
  Serial.println("\nCreating FreeRTOS tasks...");
  xTaskCreatePinnedToCore(taskDHT,    "DHT",    4096, NULL, 1, &dhtTaskHandle,    1);
  xTaskCreatePinnedToCore(taskPulse,  "Pulse",  4096, NULL, 2, &pulseTaskHandle,  1);  // Higher priority
  xTaskCreatePinnedToCore(taskMPU,    "MPU",    4096, NULL, 1, &mpuTaskHandle,    1);
  xTaskCreatePinnedToCore(taskCloud,  "Cloud",  8192, NULL, 1, &cloudTaskHandle,  0);
  xTaskCreatePinnedToCore(taskButton, "Button", 4096, NULL, 1, &buttonTaskHandle, 0);
  
  Serial.println("✅ All tasks created");
  Serial.println("\n========================================");
  Serial.println("   System Ready - Monitoring Started");
  Serial.println("========================================\n");
}

void loop() {}

/* ================= TASK 1 : DHT (WITH POWER SAVING) ================= */
void taskDHT(void *pv) {
  Serial.println("📊 DHT Task started");
  vTaskDelay(pdMS_TO_TICKS(2000));  // Initial delay for sensor stabilization
  
  while (1) {
    float h = dht.readHumidity();
    float t = dht.readTemperature();

    if (!isnan(h) && !isnan(t)) {
      xSemaphoreTake(dataMutex, portMAX_DELAY);
      humidity = h;
      temperature = t;
      xSemaphoreGive(dataMutex);
      
      // Debug output every 10 readings
      static int readCount = 0;
      if (readCount++ % 10 == 0) {
        Serial.printf("DHT: %.1f°C, %.1f%%\n", t, h);
      }
    } else {
      Serial.println("⚠️ DHT read error");
    }
    
    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

/* ================= TASK 2 : PULSE (IMPROVED ALGORITHM) ================= */
void taskPulse(void *pv) {
  Serial.println("❤️  Pulse Task started");
  Serial.println("📊 Calibrating pulse sensor...");
  
  // Variables for peak detection
  int Signal;                   // Raw analog input
  int IBI = 600;               // Inter-Beat Interval in ms
  boolean Pulse = false;       // True when pulse wave is high
  int rate[10];                // Array to hold last 10 IBI values
  unsigned long sampleCounter = 0;
  unsigned long lastBeatTime = 0;
  int P = 512;                 // Peak value
  int T = 512;                 // Trough value
  int thresh = 530;            // Threshold (between P and T)
  int amp = 0;                 // Amplitude of pulse waveform
  boolean firstBeat = true;
  boolean secondBeat = false;
  
  // Initialize rate array
  for (int i = 0; i < 10; i++) {
    rate[i] = 0;
  }
  
  // Calibration phase - read sensor for 3 seconds to establish baseline
  Serial.println("🔄 Reading baseline values (3 seconds)...");
  int calibSamples = 0;
  long sumSignal = 0;
  unsigned long calibStart = millis();
  
  while (millis() - calibStart < 3000) {
    Signal = analogRead(PULSE_PIN);
    sumSignal += Signal;
    calibSamples++;
    vTaskDelay(pdMS_TO_TICKS(2));
  }
  
  int avgSignal = sumSignal / calibSamples;
  thresh = avgSignal + 50;  // Set initial threshold above average
  P = avgSignal + 100;
  T = avgSignal - 100;
  
  Serial.printf("✅ Calibration complete - Avg: %d, Thresh: %d\n", avgSignal, thresh);
  Serial.println("👆 Place finger on sensor now...");
  
  vTaskDelay(pdMS_TO_TICKS(2000));
  
  while (1) {
    Signal = analogRead(PULSE_PIN);
    sampleCounter += 2;  // Keep track of time in ms
    int N = sampleCounter - lastBeatTime;  // Time since last beat
    
    // Print raw signal periodically for debugging
    static unsigned long lastDebug = 0;
    if (millis() - lastDebug > 2000) {
      Serial.printf("📊 Raw Signal: %d, Thresh: %d, P: %d, T: %d, Pulse: %s\n", 
                    Signal, thresh, P, T, Pulse ? "YES" : "NO");
      lastDebug = millis();
    }
    
    // Find peak and trough of pulse wave
    if (Signal < thresh && N > (IBI/5)*3) {
      if (Signal < T) {
        T = Signal;  // Keep track of lowest point
      }
    }
    
    if (Signal > thresh && Signal > P) {
      P = Signal;  // Keep track of highest point
    }
    
    // Signal surges up in value - look for the peak
    if (N > 250) {  // Avoid noise at the beginning
      if (Signal > thresh && !Pulse && N > (IBI/5)*3) {
        Pulse = true;
        IBI = sampleCounter - lastBeatTime;
        lastBeatTime = sampleCounter;
        
        if (secondBeat) {
          secondBeat = false;
          for (int i = 0; i <= 9; i++) {
            rate[i] = IBI;
          }
        }
        
        if (firstBeat) {
          firstBeat = false;
          secondBeat = true;
        } else {
          // Keep a running total of last 10 IBI values
          long runningTotal = 0;
          for (int i = 0; i <= 8; i++) {
            rate[i] = rate[i+1];
            runningTotal += rate[i];
          }
          rate[9] = IBI;
          runningTotal += rate[9];
          runningTotal /= 10;
          
          // Calculate BPM
          float calculatedBPM = 60000.0 / runningTotal;
          
          // Validate BPM is in reasonable range
          if (calculatedBPM >= MIN_BPM && calculatedBPM <= MAX_BPM) {
            xSemaphoreTake(dataMutex, portMAX_DELAY);
            bpm = calculatedBPM;
            xSemaphoreGive(dataMutex);
            
            Serial.printf("💓 Heart Beat! BPM: %.0f (IBI: %d ms)\n", calculatedBPM, IBI);
          }
        }
      }
    }
    
    // Signal goes down - the beat is over
    if (Signal < thresh && Pulse) {
      Pulse = false;
      amp = P - T;
      thresh = amp/2 + T;
      P = thresh;
      T = thresh;
    }
    
    // If no beat for 2.5 seconds, reset
    if (N > 2500) {
      thresh = avgSignal + 50;
      P = avgSignal + 100;
      T = avgSignal - 100;
      lastBeatTime = sampleCounter;
      firstBeat = true;
      secondBeat = false;
      
      xSemaphoreTake(dataMutex, portMAX_DELAY);
      bpm = 0;  // Reset BPM
      xSemaphoreGive(dataMutex);
      
      static unsigned long lastNoSignal = 0;
      if (millis() - lastNoSignal > 5000) {
        Serial.println("⚠️ No pulse detected - check sensor connection");
        lastNoSignal = millis();
      }
    }
    
    vTaskDelay(pdMS_TO_TICKS(2));  // Sample every 2ms (500Hz)
  }
}

/* ================= TASK 3 : MPU (POSTURE + FALL) WITH POWER MANAGEMENT ================= */
void taskMPU(void *pv) {
  Serial.println("🏃 MPU Task started");
  
  // Try to initialize MPU if not already done
  if (!mpuInitialized) {
    vTaskDelay(pdMS_TO_TICKS(2000));
    mpuInitialized = initMPU();
  }
  
  while (1) {
    if (!mpuInitialized) {
      // Retry initialization every 10 seconds
      vTaskDelay(pdMS_TO_TICKS(10000));
      mpuInitialized = initMPU();
      continue;
    }
    
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x3B);
    byte error = Wire.endTransmission(false);
    
    if (error != 0) {
      Serial.println("⚠️ MPU read error - reinitializing");
      mpuInitialized = false;
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }
    
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
      Serial.println("🚨 FALL DETECTED");
    }

    if (localFall && millis() - fallTriggerTime > FALL_RESET_TIME) {
      localFall = false;
    }

    lastAz = az;

    xSemaphoreTake(dataMutex, portMAX_DELAY);
    posture = localPosture;
    fallDetected = localFall;
    xSemaphoreGive(dataMutex);

638634635636637632633629630631627628624625626
      lastFallTime = millis();
      Serial.println("🚨 FALL DETECTED");
    }

    if (localFall && millis() - fallTriggerTime > FALL_RESET_TIME) {
      localFall = false;
    }

    lastAz = az;

…      Serial.printf("🚨 Fall Detected: %s\n", f ? "YES" : "NO");
      Serial.println("=================================\n");

      // Only send if we have valid data
      if (t != 0 || h != 0) {
        // Encrypt individual field values
        String encryptedTemp = encryptData(String(t, 1));
        String encryptedHumidity = encryptData(String(h, 1));
        String encryptedBPM = encryptData(String(b, 1));
        String encryptedPosture = encryptData(p);


Writing at 0x0005c708 [=====>                        ]  21.5% 147456/686789 bytes... 

Writing at 0x00061c48 [======>                       ]  23.9% 163840/686789 bytes... 

Writing at 0x00066fb8 [======>                       ]  26.2% 180224/686789 bytes... 

Writing at 0x0006c629 [=======>                      ]  28.6% 196608/686789 bytes... 

Writing at 0x00071c0f [========>                     ]  31.0% 212992/686789 bytes... 
…
Writing at 0x000e5b31 [=======================>      ]  81.1% 557056/686789 bytes... 

Writing at 0x000ee844 [========================>     ]  83.5% 573440/686789 bytes... 

Writing at 0x000f3ed0 [========================>     ]  85.9% 589824/686789 bytes... 

Writing at 0x000f9392 [=========================>    ]  88.3% 606208/686789 bytes... 

Writing at 0x000ff3c5 [==========================>   ]  90.7% 622592/686789 bytes... 


    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

/* ================= TASK 4 : CLOUD (WITH ENCRYPTION & POWER MANAGEMENT) ================= */
void taskCloud(void *pv) {
  Serial.println("☁️  Cloud Task started");
  vTaskDelay(pdMS_TO_TICKS(5000));  // Initial delay
  
  while (1) {
    // Periodic WiFi check
    if (millis() - lastWifiCheck > WIFI_CHECK_INTERVAL) {
      ensureWiFiConnected();
      lastWifiCheck = millis();
    }
    
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
      Serial.printf("🌡️  Temperature: %.1f °C\n", t);
      Serial.printf("💧 Humidity: %.1f %%\n", h);
      Serial.printf("❤️  Heart Rate: %.1f BPM\n", b);
      Serial.printf("🧍 Posture: %s\n", p.c_str());
      Serial.printf("🚨 Fall Detected: %s\n", f ? "YES" : "NO");
      Serial.println("=================================\n");

      // Only send if we have valid data
      if (t != 0 || h != 0) {
        // Encrypt individual field values
        String encryptedTemp = encryptData(String(t, 1));
        String encryptedHumidity = encryptData(String(h, 1));
        String encryptedBPM = encryptData(String(b, 1));
        String encryptedPosture = encryptData(p);
        String encryptedFall = encryptData(f ? "true" : "false");

        // Build JSON with encrypted values
        HTTPClient http;
        http.setTimeout(10000);  // 10 second timeout
        http.setConnectTimeout(5000);  // 5 second connection timeout
        
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
          Serial.printf("✅ Data sent to Firebase (encrypted) - Code: %d\n", responseCode);
          lastWifiActivity = millis();
        } else {
          Serial.printf("❌ Failed to send data - Error: %d\n", responseCode);
          if (responseCode == -1) {
            Serial.println("   Connection timeout - will retry");
          }
        }
        
        http.end();
      } else {
        Serial.println("⏳ Waiting for valid sensor data...");
      }
    } else {
      Serial.println("⚠️ WiFi not connected - attempting reconnection");
      ensureWiFiConnected();
    }
    
    vTaskDelay(pdMS_TO_TICKS(5000));  // Send every 5 seconds
  }
}

/* ================= TASK 5 : SOS BUTTON (30s AUTO RESET WITH ENCRYPTION) ================= */
void taskButton(void *pv) {
  Serial.println("🆘 Button Task started");
  bool lastButtonState = HIGH;
  bool sosActive = false;
  unsigned long sosStartTime = 0;

  while (1) {
    bool buttonState = digitalRead(BUTTON_PIN);

    // Button pressed
    if (buttonState == LOW && lastButtonState == HIGH) {
      Serial.println("\n🚨 SOS BUTTON PRESSED");
      Serial.println("Button State: TRUE");

      sosActive = true;
      sosStartTime = millis();

      ensureWiFiConnected();  // Make sure WiFi is connected for emergency

      if (WiFi.status() == WL_CONNECTED) {
        String encryptedButton = encryptData("true");
        
        HTTPClient http;
        http.setTimeout(10000);
        http.begin(EMERGENCY_URL);
        http.addHeader("Content-Type", "application/json");
        String payload = "{\"button\":\"" + encryptedButton + "\"}";
        int code = http.PUT(payload);
        http.end();
        
        if (code > 0) {
          Serial.println("📤 Emergency alert sent (encrypted)");
        } else {
          Serial.println("❌ Failed to send emergency alert");
        }
      }
    }

    // Auto reset after 30 seconds
    if (sosActive && millis() - sosStartTime >= 30000) {
      Serial.println("\n✅ SOS AUTO RESET");
      Serial.println("Button State: FALSE");

      sosActive = false;

      if (WiFi.status() == WL_CONNECTED) {
        String encryptedButton = encryptData("false");
        
        HTTPClient http;
        http.setTimeout(10000);
        http.begin(EMERGENCY_URL);
        http.addHeader("Content-Type", "application/json");
        String payload = "{\"button\":\"" + encryptedButton + "\"}";
        http.PUT(payload);
        http.end();
        
        Serial.println("📤 Emergency reset sent (encrypted)");
      }
    }

    lastButtonState = buttonState;
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}
