import React, { useEffect, useState, useRef } from "react";
import { auth, db } from "../firebase";
import { signOut } from "firebase/auth";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";

import Card from "./Card";
import Graph from "./Graph";
import AccessLog from "./AccessLog";

function Dashboard() {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const audioRef = useRef(null);

  // Firestore listener
  useEffect(() => {
    const q = query(
      collection(db, "patients"),
      orderBy("timestamp", "desc"),
      limit(50)
    );

    const unsub = onSnapshot(q, (snap) => {
      const arr = snap.docs.map((doc) => {
        const d = doc.data();
        return {
          ...d,
          time: d.timestamp?.toDate().toLocaleTimeString() || "--",
        };
      }).reverse();

      setHistory(arr);
      setData(arr[arr.length - 1]);
    });

    return () => unsub();
  }, []);

  // Emergency sound
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
      {data?.emergency && <div className="alert">🚨 EMERGENCY DETECTED 🚨</div>}

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

      <audio ref={audioRef} src="/sounds/preview.mp3" preload="auto" />
    </div>
  );
}

export default Dashboard;
