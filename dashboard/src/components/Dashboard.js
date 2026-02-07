import React, { useEffect, useState, useRef } from "react";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";
import Card from "./Card";
import Graph from "./Graph";

function Dashboard() {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);

  // ================= REALTIME DATA =================
  useEffect(() => {
    const fetchRealtime = async () => {
      try {
        const res = await fetch("http://localhost:5000/data");
        if (!res.ok) throw new Error(`Server error: ${res.status}`);

        const json = await res.json();
        if (json) {
          setData(json);
          setError(null);

          // Build history with timestamp
          setHistory((prev) => {
            const newEntry = {
              ...json,
              timestamp: Date.now(),
            };
            return [...prev, newEntry].slice(-50);
          });
        }
      } catch (err) {
        console.error("❌ Fetch error:", err);
        setError(err.message);
      }
    };

    fetchRealtime();
    const interval = setInterval(fetchRealtime, 1000);
    return () => clearInterval(interval);
  }, []);

  // ================= EMERGENCY SOUND =================
  useEffect(() => {
    if (!audioRef.current || !data) return;

    if (data.emergency) {
      audioRef.current.loop = true;
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [data?.emergency]);

  // ================= LOADING STATE =================
  if (!data && !error) {
    return (
      <div className="loading-screen">
        <div className="loader" />
        <p>Connecting to Bio-Telemetry Unit...</p>
      </div>
    );
  }

  // ================= ERROR STATE =================
  if (error && !data) {
    return (
      <div className="loading-screen">
        <div className="error-box">
          <h3>⚠️ Connection Error</h3>
          <p>{error}</p>
          <p className="error-hint">
            Ensure backend server is running on port 5000
          </p>
          <button onClick={() => window.location.reload()}>
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* ================= HEADER ================= */}
      <header className="dashboard-header">
        <div className="header-left">
          <h1>🏥 Medical Monitoring System</h1>
          <p className="patient-info">Patient: Jonas Kahnwald • Room 404</p>
        </div>
        <button className="logout-btn" onClick={() => signOut(auth)}>
          Logout
        </button>
      </header>

      {/* ================= EMERGENCY ALERT ================= */}
      {data?.emergency && (
        <div className="emergency-banner">
          <div className="emergency-content">
            <span className="emergency-icon">🚨</span>
            <span className="emergency-text">EMERGENCY DETECTED</span>
            <span className="emergency-icon">🚨</span>
          </div>
        </div>
      )}

      {/* ================= VITAL SIGNS SECTION ================= */}
      <section className="vitals-section">
        <h2 className="section-title">Vital Signs</h2>
        <div className="vitals-grid">
          <Card
            title="Heart Rate"
            value={
              data?.heartRate !== null && data?.heartRate !== undefined
                ? `${data.heartRate} BPM`
                : "--"
            }
            icon="❤️"
            alert={data?.heartRate > 200}
          />
          <Card
            title="Temperature"
            value={
              data?.temperature !== null && data?.temperature !== undefined
                ? `${data.temperature}°C`
                : "--"
            }
            icon="🌡️"
          />
          <Card
            title="Posture"
            value={data?.posture || "Unknown"}
            icon="🧍"
          />
          <Card
            title="Humidity"
            value={
              data?.humidity !== null && data?.humidity !== undefined
                ? `${data.humidity}%`
                : "--"
            }
            icon="💧"
          />
        </div>
      </section>

      {/* ================= EMERGENCY STATUS SECTION ================= */}
      <section className="status-section">
        <h2 className="section-title">Emergency Status</h2>
        <div className="status-grid">
          <Card
            title="Fall Detection"
            value={data?.fallDetected ? "DETECTED" : "Normal"}
            icon="🤕"
            alert={data?.fallDetected}
            status
          />
          <Card
            title="SOS Button"
            value={data?.sos ? "ACTIVE" : "Inactive"}
            icon="🆘"
            alert={data?.sos}
            status
          />
          <Card
            title="Overall Status"
            value={data?.emergency ? "ALERT" : "Stable"}
            icon={data?.emergency ? "🚨" : "✅"}
            alert={data?.emergency}
            status
          />
        </div>
      </section>

      {/* ================= RFID ACCESS CONTROL ================= */}
      <section className="access-section">
        <h2 className="section-title">Access Control</h2>
        <div className="access-grid">
          <Card
            title="Last RFID Card"
            value={data?.rfid?.cardUID || "No Recent Scan"}
            icon="🏷️"
          />
        </div>
      </section>

      {/* ================= HISTORICAL TRENDS ================= */}
      <section className="trends-section">
        <h2 className="section-title">Historical Trends</h2>
        <div className="graphs-container">
          <Graph
            title="Heart Rate Trend"
            data={history}
            dataKey="heartRate"
            color="#ff4d6d"
            unit="BPM"
          />
          <Graph
            title="Temperature Trend"
            data={history}
            dataKey="temperature"
            color="#06d6a0"
            unit="°C"
          />
        </div>
      </section>

      {/* AUDIO ALERT */}
      <audio ref={audioRef} src="/sounds/preview.mp3" preload="auto" />
    </div>
  );
}

export default Dashboard;