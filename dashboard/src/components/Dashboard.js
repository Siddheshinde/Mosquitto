import React, { useEffect, useState, useRef } from "react";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";

import Card from "./Card";
import Graph from "./Graph";
import AccessLog from "./AccessLog";
import HeartModel3D from "./HeartModel3D";

function Dashboard() {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    const fetchRealtime = async () => {
      try {
        const res = await fetch("http://localhost:5000/data");
        if (!res.ok) throw new Error(`Server error: ${res.status}`);

        const json = await res.json();
        if (json) {
          setData(json);
          setError(null);

          setHistory((prev) => {
            const newEntry = { ...json, timestamp: Date.now() };
            return [...prev, newEntry].slice(-50);
          });
        }
      } catch (err) {
        console.error("Fetch error:", err);
        setError(err.message);
      }
    };

    fetchRealtime();
    const interval = setInterval(fetchRealtime, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!audioRef.current) return;
    
    if (data?.emergency) {
      audioRef.current.loop = true;
      audioRef.current.play().catch((e) => {
        console.error("Audio play failed:", e);
      });
    } else {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [data?.emergency]);

  if (!data && !error) {
    return (
      <div className="loading-screen">
        <div className="loader" />
        <p>Connecting to Bio-Telemetry Unit...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="loading-screen">
        <div className="error-box">
          <h3>⚠️ Connection Error</h3>
          <p>{error}</p>
          <p className="error-hint">Ensure backend server is running on port 5000</p>
          <button onClick={() => window.location.reload()}>Retry Connection</button>
        </div>
      </div>
    );
  }

  const doctorVisits = data?.accessStats?.doctorVisits || 0;
  const unauthorizedAttempts = data?.accessStats?.unauthorizedAttempts || 0;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <h1>Medical Monitoring System</h1>
          <p className="patient-info">Patient: Jonas Kahnwald • Room 404</p>
        </div>
        <button className="logout-btn" onClick={() => signOut(auth)}>
          Logout
        </button>
      </header>

      {data?.emergency && (
        <div className="emergency-banner">
          🚨 EMERGENCY: {data?.emergencyType} 🚨
          {data?.securityEmergency && ` (${data?.unauthorizedCount} unauthorized attempts)`}
        </div>
      )}
      
      {!data?.securityEmergency && unauthorizedAttempts > 0 && (
        <div className="warning-banner">
          ⚠️ Security Notice: {unauthorizedAttempts} unauthorized access attempt(s) in last 5 minutes
        </div>
      )}

      <section className="hero-section">
        <div className="hero-grid">
          <div className="hero-visual">
            <h2 className="section-title">Live Cardiac Monitor</h2>
            <div className="heart-visual-wrapper">
              <img 
                src="/Crystal-clear heart with blue veins.png" 
                alt="Cardiac Monitor"
                className="heart-background-image"
              />
              <HeartModel3D
                heartRate={data?.heartRate || 72}
                emergency={data?.emergency}
              />
            </div>
          </div>

          <div className="hero-vitals">
            <h2 className="section-title">Vital Signs</h2>
            <div className="vitals-stack">
              <Card
                title="Heart Rate"
                value={`${data?.heartRate ?? "--"} BPM`}
                icon="❤️"
                alert={data?.heartRate > 200}
              />
              <Card
                title="Temperature"
                value={`${data?.temperature ?? "--"} °C`}
                icon="🌡️"
              />
              <Card
                title="Posture"
                value={data?.posture || "Unknown"}
                icon="🧍"
              />
              <Card
                title="Humidity"
                value={`${data?.humidity ?? "--"} %`}
                icon="💧"
              />
            </div>
          </div>
        </div>
      </section>

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
            title="Security Status"
            value={data?.securityEmergency ? "BREACH" : "Secure"}
            icon={data?.securityEmergency ? "🚨" : "🔒"}
            alert={data?.securityEmergency}
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

      <section className="trends-section">
        <h2 className="section-title">Historical Trends</h2>
        <div className="graphs-container">
          <Graph
            title="Heart Rate Trend"
            data={history}
            dataKey="heartRate"
            color="#c89b7b"
            unit="BPM"
          />
          <Graph
            title="Temperature Trend"
            data={history}
            dataKey="temperature"
            color="#4a6fa5"
            unit="°C"
          />
        </div>
      </section>

      <section className="bottom-section">
        <div className="bottom-grid">
          <div className="access-card-wrapper">
            <h2 className="section-title">Access Control</h2>
            <p className="section-subtitle">Tracking last 5 minutes</p>
            <div className="access-cards-stack">
              <Card
                title="Last RFID Card"
                value={data?.rfid?.cardUID || "No Recent Scan"}
                icon="🏷️"
              />
              <Card
                title="RFID Event"
                value={data?.rfid?.event ? 
                  (data.rfid.event.charAt(0).toUpperCase() + data.rfid.event.slice(1)) : 
                  "No Recent Event"}
                icon={data?.rfid?.event === "authorized" ? "✅" : 
                      data?.rfid?.event === "unauthorized" ? "❌" : "⚪"}
                alert={data?.rfid?.event === "unauthorized"}
                status
              />
              <Card
                title="Authorization Status"
                value={data?.rfid?.authorizationStatus || "No Scan"}
                icon={data?.rfid?.isAuthorized === true ? "✅" : 
                      data?.rfid?.isAuthorized === false ? "❌" : "⚪"}
                alert={data?.rfid?.isAuthorized === false}
                status
              />
              <Card
                title="Doctor Visits (5 min)"
                value={doctorVisits}
                icon="👨‍⚕️"
              />
              <Card
                title="Unauthorized (5 min)"
                value={unauthorizedAttempts}
                icon="⚠️"
                alert={unauthorizedAttempts >= 5}
                status
              />
            </div>
          </div>
          
          <div className="log-wrapper">
            <h2 className="section-title">Access Log</h2>
            <AccessLog history={history} />
          </div>
        </div>
      </section>

      <audio ref={audioRef} preload="auto">
        <source src="/sounds/preview.mp3" type="audio/mpeg" />
      </audio>
    </div>
  );
}

export default Dashboard;