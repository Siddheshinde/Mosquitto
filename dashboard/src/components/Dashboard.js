import React, { useEffect, useState, useRef } from "react";
import { 
  LayoutDashboard, LogOut, AlertCircle, Activity, 
  Thermometer, User, Zap, Brain, Volume2 
} from "lucide-react";
import Graph from "./Graph";

const Dashboard = () => {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    const fetchInterval = setInterval(async () => {
      try {
        const res = await fetch("https://mosquitto-jshn.onrender.com/data");
        const json = await res.json();
        setData(json);
        setHistory(prev => [...prev, { ...json, timestamp: Date.now() }].slice(-50));
      } catch (e) { console.error("Fetch Error", e); }
    }, 1000);
    return () => clearInterval(fetchInterval);
  }, []);

  // AUDIO TRIGGER
  useEffect(() => {
    if (data?.emergency && audioEnabled && audioRef.current) {
      audioRef.current.loop = true;
      audioRef.current.play().catch(console.error);
    } else if (audioRef.current) {
      audioRef.current.pause();
    }
  }, [data?.emergency, audioEnabled]);

  if (!data) return <div style={styles.loading}>Connecting...</div>;

  return (
    <div style={styles.container}>
      <aside style={styles.sidebar}>
        <div style={styles.logo}>+</div>
        <NavItem icon={<LayoutDashboard />} active />
      </aside>

      <main style={styles.mainContent}>
        <header style={styles.header}>
          <h1 style={styles.title}>Clinical Monitor</h1>
          {!audioEnabled && (
            <button onClick={() => setAudioEnabled(true)} style={styles.audioBtn}>
              <Volume2 size={16} /> Enable Sound
            </button>
          )}
        </header>

        {/* EMERGENCY OVERLAY */}
        {data.emergency && (
          <div style={styles.emergencyBanner}>
            <AlertCircle /> ALERT: {data.emergencyType}
          </div>
        )}

        <div style={styles.grid}>
          <div style={styles.leftCol}>
            <section style={styles.card}>
              <h3>Cardiac Rhythm</h3>
              <div style={{height: '250px'}}>
                <Graph data={history} dataKey="heartRate" color="#A3D9A5" unit="BPM" />
              </div>
            </section>
          </div>

          <div style={styles.rightCol}>
            <VitalCard 
                label="Heart Rate" 
                value={data.heartRate} 
                unit="BPM" 
                icon={<Zap />} 
                alert={data.heartRate > 200 || data.heartRate < 40} 
            />
            <VitalCard 
                label="Temperature" 
                value={data.temperature} 
                unit="C" 
                icon={<Thermometer />} 
                alert={data.temperature > 40 || data.temperature < 15} 
            />
            <VitalCard 
                label="Fall Status" 
                value={data.fallDetected ? "FALL!!" : "Normal"} 
                icon={<Activity />} 
                alert={data.fallDetected} 
            />
          </div>
        </div>
      </main>
      <audio ref={audioRef} src="/sounds/preview.mp3" />
    </div>
  );
};

const VitalCard = ({ label, value, unit, icon, alert }) => (
  <div style={{
    ...styles.card,
    backgroundColor: alert ? '#ef4444' : 'white',
    color: alert ? 'white' : '#1a2e28',
    display: 'flex',
    alignItems: 'center',
    gap: '15px'
  }}>
    <div style={styles.iconBox}>{icon}</div>
    <div>
      <p style={{fontSize: '10px', textTransform: 'uppercase'}}>{label}</p>
      <p style={{fontSize: '20px', fontWeight: 800}}>{value ?? "--"} {unit}</p>
    </div>
  </div>
);

const NavItem = ({ icon, active }) => (
  <div style={{ padding: '20px', color: active ? '#A3D9A5' : '#64748b', cursor: 'pointer' }}>
    {icon}
  </div>
);

const styles = {
  container: { display: 'flex', minHeight: '100vh', backgroundColor: '#F8FAFA' },
  sidebar: { width: '70px', backgroundColor: '#0A1612', textAlign: 'center' },
  logo: { color: '#FF8A50', fontSize: '30px', padding: '20px' },
  mainContent: { flex: 1, padding: '30px' },
  header: { display: 'flex', justifyContent: 'space-between', marginBottom: '20px' },
  title: { fontSize: '24px', fontWeight: 800 },
  audioBtn: { backgroundColor: '#8b5cf6', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '10px', cursor: 'pointer' },
  emergencyBanner: { backgroundColor: '#ef4444', color: 'white', padding: '20px', borderRadius: '15px', marginBottom: '20px', fontWeight: 900, textAlign: 'center' },
  grid: { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' },
  card: { backgroundColor: 'white', padding: '20px', borderRadius: '20px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)' },
  rightCol: { display: 'flex', flexDirection: 'column', gap: '15px' },
  loading: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }
};

export default Dashboard;
