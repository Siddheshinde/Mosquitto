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

/* ================= OBJECTS ================= */
DHT dht(DHT_PIN, DHT_TYPE);

/* ================= SHARED DATA ================= */
float temperature = 0;
float humidity = 0;
volatile float bpm = 0;
String posture = "UNKNOWN";
bool fallDetected = false;

/* ================= RTOS ================= */
SemaphoreHandle_t dataMutex;

/* ================= MPU ================= */
float ax, ay, az;
float lastAz = 1.0;
bool mpuInitialized = false;
unsigned long lastFallTime = 0;
unsigned long fallTriggerTime = 0;

#define IMPACT_THRESHOLD   1.8
#define ORIENTATION_LIMIT  0.6
#define FALL_RESET_TIME    3000
#define FALL_COOLDOWN      4000

/* ================= ENCRYPTION ================= */
const unsigned char AES_KEY[16] = {
  0x2b,0x7e,0x15,0x16,0x28,0xae,0xd2,0xa6,
  0xab,0xf7,0x97,0x45,0xcf,0x4f,0x09,0x8c
};

unsigned char AES_IV[16] = {
  0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,
  0x08,0x09,0x0a,0x0b,0x0c,0x0d,0x0e,0x0f
};

/* ================= PROTOTYPES ================= */
void taskDHT(void *pv);
void taskPulse(void *pv);
void taskMPU(void *pv);
void taskCloud(void *pv);
void taskButton(void *pv);
bool initMPU();
String encryptData(String plaintext);

/* ================= SETUP ================= */
void setup() {
  Serial.begin(115200);
  delay(1000);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  Wire.begin(21, 22);
  dht.begin();

  pinMode(PULSE_PIN, INPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  dataMutex = xSemaphoreCreateMutex();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected");

  mpuInitialized = initMPU();

  xTaskCreatePinnedToCore(taskDHT,    "DHT",    4096, NULL, 1, NULL, 1);
  xTaskCreatePinnedToCore(taskPulse,  "Pulse",  4096, NULL, 2, NULL, 1);
  xTaskCreatePinnedToCore(taskMPU,    "MPU",    4096, NULL, 1, NULL, 1);
  xTaskCreatePinnedToCore(taskCloud,  "Cloud",  8192, NULL, 1, NULL, 0);
  xTaskCreatePinnedToCore(taskButton, "Button", 4096, NULL, 1, NULL, 0);
}

void loop() {}

/* ================= MPU INIT ================= */
bool initMPU() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0x00);
  return (Wire.endTransmission(true) == 0);
}

/* ================= TASK : DHT ================= */
void taskDHT(void *pv) {
  while (1) {
    float t = dht.readTemperature();
    float h = dht.readHumidity();

    if (!isnan(t) && !isnan(h)) {
      xSemaphoreTake(dataMutex, portMAX_DELAY);
      temperature = t;
      humidity = h;
      xSemaphoreGive(dataMutex);
    }
    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

/* ================= TASK : PULSE (REAL BPM) ================= */
void taskPulse(void *pv) {
  int threshold = 2000;
  bool beatDetected = false;
  unsigned long lastBeatTime = 0;

  while (1) {
    int signal = analogRead(PULSE_PIN);

    if (signal > threshold && !beatDetected) {
      beatDetected = true;
      unsigned long now = millis();
      unsigned long ibi = now - lastBeatTime;
      lastBeatTime = now;

      if (ibi > 300 && ibi < 1500) {
        float calculatedBPM = 60000.0 / ibi;

        if (calculatedBPM >= 40 && calculatedBPM <= 180) {
          xSemaphoreTake(dataMutex, portMAX_DELAY);
          bpm = calculatedBPM;
          xSemaphoreGive(dataMutex);

          Serial.print("❤️ BPM: ");
          Serial.println(bpm);
        }
      }
    }

    if (signal < threshold - 300) {
      beatDetected = false;
    }

    vTaskDelay(pdMS_TO_TICKS(2)); // 500 Hz sampling
  }
}

/* ================= TASK : MPU ================= */
void taskMPU(void *pv) {
  while (1) {
    if (!mpuInitialized) {
      mpuInitialized = initMPU();
      vTaskDelay(pdMS_TO_TICKS(2000));
      continue;
    }

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

    String localPosture;
    bool localFall = fallDetected;

    if (abs(az) > 0.8 && abs(ax) < 0.3) localPosture = "SLEEPING";
    else if (abs(ax) > 0.7) localPosture = "SITTING";
    else localPosture = "STANDING";

    bool impact = sqrt(ax*ax + ay*ay + az*az) > IMPACT_THRESHOLD;
    bool flip = (lastAz > ORIENTATION_LIMIT && az < -ORIENTATION_LIMIT);

    if (impact && flip && millis() - lastFallTime > FALL_COOLDOWN) {
      localFall = true;
      lastFallTime = millis();
      fallTriggerTime = millis();
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

/* ================= TASK : CLOUD ================= */
void taskCloud(void *pv) {
  while (1) {
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

    Serial.println("==== DATA ====");
    Serial.printf("Temp: %.1f\n", t);
    Serial.printf("Humidity: %.1f\n", h);
    Serial.printf("BPM: %.1f\n", b);
    Serial.printf("Posture: %s\n", p.c_str());
    Serial.printf("Fall: %s\n", f ? "YES" : "NO");

    HTTPClient http;
    http.begin(String(DATABASE_URL) + DB_PATH);
    http.addHeader("Content-Type", "application/json");

    String payload = "{";
    payload += "\"temperature\":\"" + encryptData(String(t,1)) + "\",";
    payload += "\"humidity\":\"" + encryptData(String(h,1)) + "\",";
    payload += "\"bpm\":\"" + encryptData(String(b,1)) + "\",";
    payload += "\"posture\":\"" + encryptData(p) + "\",";
    payload += "\"fall\":\"" + encryptData(f ? "true" : "false") + "\"}";
    http.PUT(payload);
    http.end();

    vTaskDelay(pdMS_TO_TICKS(5000));
  }
}

/* ================= TASK : BUTTON ================= */
void taskButton(void *pv) {
  bool lastState = HIGH;
  while (1) {
    bool state = digitalRead(BUTTON_PIN);
    if (state == LOW && lastState == HIGH) {
      HTTPClient http;
      http.begin(EMERGENCY_URL);
      http.addHeader("Content-Type", "application/json");
      http.PUT("{\"button\":\"" + encryptData("true") + "\"}");
      http.end();
    }
    lastState = state;
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

/* ================= ENCRYPT ================= */
String encryptData(String plaintext) {
  int pad = 16 - (plaintext.length() % 16);
  for (int i = 0; i < pad; i++) plaintext += (char)pad;

  unsigned char input[128], output[128];
  plaintext.getBytes(input, plaintext.length() + 1);

  mbedtls_aes_context ctx;
  mbedtls_aes_init(&ctx);
  mbedtls_aes_setkey_enc(&ctx, AES_KEY, 128);

  unsigned char iv[16];
  memcpy(iv, AES_IV, 16);

  mbedtls_aes_crypt_cbc(&ctx, MBEDTLS_AES_ENCRYPT, plaintext.length(), iv, input, output);
  mbedtls_aes_free(&ctx);

  unsigned char b64[256];
  size_t len;
  mbedtls_base64_encode(b64, 256, &len, output, plaintext.length());

  return String((char*)b64).substring(0, len);
}
