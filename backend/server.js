const express = require("express");

const app = express();
const PORT = 5000;

app.use(express.json());

let latestData = {
  temperature: null,
  heartRate: null,
  posture: null,
  fallDetected: null,
  emergency: null,
};

app.get("/", (req, res) => {
  res.send("Patient Monitoring Server is running");
});

app.post("/data", (req, res) => {
  const { temperature, heartRate, posture, fallDetected, emergency } = req.body;

  if (temperature === undefined || heartRate === undefined) {
    return res.status(400).json({
      error: "temperature and heartRate are required",
    });
  }

  latestData = {
    temperature,
    heartRate,
    posture: posture ?? "unknown",
    fallDetected: fallDetected ?? false,
    emergency: emergency ?? false,
  };

  res.json({
    message: "Patient data received successfully",
    data: latestData,
  });
});

app.get("/data", (req, res) => {
  res.json(latestData);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
