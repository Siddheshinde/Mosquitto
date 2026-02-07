import React, { useEffect, useState, useRef } from "react";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";

import Card from "./Card";
import Graph from "./Graph";
import AccessLog from "./AccessLog";

function Dashboard() {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const audioRef = useRef(null);

  // 🔹 Fetch realtime data from backend every 2 sec
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("http://localhost:5000/data");

        if (!res.ok) throw new Error("Server not responding");

        const json = await res.json();

        // attach readable timestamp for graphs/log
        const enriched = {
          ...json,
          timestamp: Date.now(),
        };

        setData(enriched);

        // avoid pushing duplicate same-value data
        setHistory((prev) => {
          if (prev.length && prev[prev.length - 1].timestamp === enriched.timestamp) {
            return prev;
          }
          return [...prev, enriched].slice(-50);
        });
      } catch (err) {
        console.error("❌ Fetch error:", err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 2000);

    return () => clearInterval(interval);
  }, []);

  // 🔹 Emergency sound logic
  useEffect(() => {
    if (!audioRef.current) return;

    if (data?.emergency) {
      audioRef.current.loop = true;
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [data?.emergency]);

  return (
    <div className="page">
      {/* HEADER */}
      <div className="header">
        <h2>🏥 Patient Monitoring Dashboard</h2>
        <button onClick={() => signOut(auth)}>Logout</button>
      </div>

      {/* ALERT */}
      {data?.emergency && (
        <div className="alert">🚨 EMERGENCY DETECTED 🚨</div>
      )}

      {/* CARDS */}
      <div className="cards">
        <Card title="Temperature" value={`${data?.temperature ?? "--"} °C`} />
        <Card title="Heart Rate" value={`${data?.heartRate ?? "--"} BPM`} />
        <Card title="Posture" value={data?.posture ?? "--"} />
        <Card title="Fall" value={data?.fallDetected ? "YES ⚠️" : "No"} />
        <Card
          title="Emergency"
          value={data?.emergency ? "🚨 ALERT" : "Normal"}
          color={data?.emergency ? "#ff4d4f" : "#00c853"}
        />
      </div>

      {/* GRAPHS */}
      <div className="graphRow">
        <Graph title="Temperature Trend" data={history} dataKey="temperature" color="#ff4d4f" />
        <Graph title="Heart Rate Trend" data={history} dataKey="heartRate" color="#1890ff" />
      </div>

      {/* ACCESS LOG */}
      <AccessLog history={history} />

      {/* AUDIO */}
      <audio ref={audioRef} src="/sounds/preview.mp3" preload="auto" />
    </div>
  );
}

export default Dashboard;
