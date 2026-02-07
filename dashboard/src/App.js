import React, { useEffect, useState, useRef } from "react";
import Login from "./Login";
import { auth, db } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";

import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
  Legend
);

function App() {
  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);

  const audioRef = useRef(null);

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  // 🔥 Listen to LAST 50 readings
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, "patients"),
      orderBy("timestamp", "desc"),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map((doc) => doc.data());
      setHistory(docs.reverse());
      setData(docs[docs.length - 1]);
    });

    return () => unsubscribe();
  }, [user]);

  // 🔔 Emergency alarm loop
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

  // Unlock audio after click
  useEffect(() => {
    const unlock = () => {
      if (audioRef.current) {
        audioRef.current.play().then(() => {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        }).catch(() => {});
      }
      document.removeEventListener("click", unlock);
    };
    document.addEventListener("click", unlock);
  }, []);

  if (!user) return <Login onLogin={() => {}} />;

  // 📈 Graph labels
  const labels = history.map((d) =>
    d.timestamp ? d.timestamp.toDate().toLocaleTimeString() : "--"
  );

  // 📊 Temperature chart
  const tempChart = {
    labels,
    datasets: [
      {
        label: "Temperature (°C)",
        data: history.map((d) => d.temperature),
        borderColor: "red",
        backgroundColor: "rgba(255,0,0,0.2)",
      },
    ],
  };

  // ❤️ Heart rate chart
  const hrChart = {
    labels,
    datasets: [
      {
        label: "Heart Rate (BPM)",
        data: history.map((d) => d.heartRate),
        borderColor: "blue",
        backgroundColor: "rgba(0,0,255,0.2)",
      },
    ],
  };

return (
  <div className="dashboard">

    <h1 className="title">Patient Monitoring Dashboard</h1>

    {/* ===== TOP CARDS ===== */}
    <div className="cards">

      <div className="card red">
        <h3>Temperature</h3>
        <p>{data?.temperature ?? "--"} °C</p>
      </div>

      <div className="card blue">
        <h3>Heart Rate</h3>
        <p>{data?.heartRate ?? "--"} BPM</p>
      </div>

      <div className="card purple">
        <h3>Posture</h3>
        <p>{data?.posture ?? "--"}</p>
      </div>

      <div className="card orange">
        <h3>Fall</h3>
        <p>{data?.fallDetected ? "YES ⚠️" : "No"}</p>
      </div>

      <div className={`card ${data?.emergency ? "danger" : "safe"}`}>
        <h3>Emergency</h3>
        <p>{data?.emergency ? "🚨 ALERT" : "Normal"}</p>
      </div>

    </div>


    {/* ===== GRAPHS ===== */}
    <div className="graphs">

      <div className="graphCard">
        <h3>Temperature Trend</h3>
        <Line data={tempChart} />
      </div>

      <div className="graphCard">
        <h3>Heart Rate Trend</h3>
        <Line data={hrChart} />
      </div>

    </div>


    {/* ===== ACCESS LOG ===== */}
    <div className="tableCard">
      <h3>Access Log</h3>

      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Temp</th>
            <th>HR</th>
            <th>Posture</th>
            <th>Fall</th>
            <th>Emergency</th>
          </tr>
        </thead>

        <tbody>
          {history.map((d, i) => (
            <tr key={i}>
              <td>{d.timestamp?.toDate().toLocaleTimeString()}</td>
              <td>{d.temperature}</td>
              <td>{d.heartRate}</td>
              <td>{d.posture}</td>
              <td>{d.fallDetected ? "YES" : "No"}</td>
              <td>{d.emergency ? "🚨" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <audio ref={audioRef} src="/sounds/preview.mp3" preload="auto" />
  </div>
);

}

export default App;
