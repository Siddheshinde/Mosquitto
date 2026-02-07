const express = require("express");

const app = express();
const PORT = 5000;

app.use(express.json());

let latestTemperature = null;

// Home route
app.get("/", (req, res) => {
  res.send("Server is running");
});

// POST temperature
app.post("/temperature", (req, res) => {
  const { temperature } = req.body;

  if (temperature === undefined) {
    return res.status(400).json({ error: "Temperature is required" });
  }

  latestTemperature = temperature;

  res.json({
    message: "Temperature received successfully",
    temperature: latestTemperature,
  });
});

// GET latest temperature
app.get("/temperature", (req, res) => {
  res.json({ latestTemperature });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
