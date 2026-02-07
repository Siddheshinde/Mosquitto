#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <DHT.h>

/* ================= WIFI & FIREBASE ================= */
#define WIFI_SSID       "Disha"
#define WIFI_PASSWORD   "saritadeshmukh"

#define DATABASE_URL "https://mosquitto-d1aa7-default-rtdb.asia-southeast1.firebasedatabase.app"
#define DB_PATH "/new_health.json"

/* ================= SENSOR PINS ================= */
#define DHT_PIN     4
#define DHT_TYPE    DHT11
#define PULSE_PIN   34

#define MPU_ADDR    0x68

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

SemaphoreHandle_t dataMutex;

/* ================= MPU DATA ================= */
float ax, ay, az;
float accelMag;

/* ================= FALL DETECTION ================= */
unsigned long fallTriggerTime = 0;
unsigned long lastFallTime = 0;
float lastAz = 1.0;

#define IMPACT_THRESHOLD   1.8     // sensitive
#define ORIENTATION_LIMIT  0.6
#define FALL_RESET_TIME    3000
#define FALL_COOLDOWN      4000

/* ================= SETUP ================= */
void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  dht.begin();

  dataMutex = xSemaphoreCreateMutex();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi connected");

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);   // wake MPU6050
  Wire.write(0);
  Wire.endTransmission(true);

  xTaskCreatePinnedToCore(taskDHT,   "DHT",   4096, NULL, 1, &dhtTaskHandle,   1);
  xTaskCreatePinnedToCore(taskPulse, "Pulse", 4096, NULL, 1, &pulseTaskHandle, 1);
  xTaskCreatePinnedToCore(taskMPU,   "MPU",   4096, NULL, 1, &mpuTaskHandle,   1);
  xTaskCreatePinnedToCore(taskCloud, "Cloud", 8192, NULL, 1, &cloudTaskHandle, 0);
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

    /* ---------- POSTURE ---------- */
    if (abs(az) > 0.8 && abs(ax) < 0.3)       localPosture = "SLEEPING";
    else if (abs(ax) > 0.7)                  localPosture = "SITTING";
    else                                     localPosture = "STANDING";

    /* ---------- FALL DETECTION ---------- */
    bool strongImpact = accelMag > IMPACT_THRESHOLD;
    bool orientationFlip =
      (lastAz > ORIENTATION_LIMIT && az < -ORIENTATION_LIMIT) ||
      (lastAz < -ORIENTATION_LIMIT && az > ORIENTATION_LIMIT);

    if (strongImpact &&
        orientationFlip &&
        millis() - lastFallTime > FALL_COOLDOWN) {

      localFall = true;
      fallTriggerTime = millis();
      lastFallTime = millis();

      Serial.println("🚨 FALL DETECTED (IMPACT + ORIENTATION CHANGE)");
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

/* ================= TASK 4 : CLOUD ================= */
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

      HTTPClient http;
      String payload = "{";
      payload += "\"temperature\":" + String(t,1) + ",";
      payload += "\"humidity\":" + String(h,1) + ",";
      payload += "\"bpm\":" + String(b,1) + ",";
      payload += "\"posture\":\"" + p + "\",";
      payload += "\"fall\":" + String(f ? "true" : "false");
      payload += "}";

      http.begin(String(DATABASE_URL) + DB_PATH);
      http.addHeader("Content-Type", "application/json");
      http.PUT(payload);
      http.end();
    }
    vTaskDelay(pdMS_TO_TICKS(3000));
  }
}
