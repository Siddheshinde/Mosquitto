import React, { useEffect, useState, useRef } from "react";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";
import { 
  LayoutDashboard, Search, Bell, LogOut, ChevronRight, 
  AlertCircle, Activity, Thermometer, User, ShieldAlert, 
  Zap, Brain, Volume2
} from "lucide-react";

import Graph from "./Graph";
import AccessLog from "./AccessLog";

const Dashboard = () => {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    const fetchRealtime = async () => {
      try {
        const res = await fetch("https://mosquitto-jshn.onrender.com/data");
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const json = await res.json();
        if (json) {
          setData(json);
          setError(null);
          setHistory((prev) => [...prev, { ...json, timestamp: Date.now() }].slice(-50));
        }
      } catch (err) {
        setError(err.message);
      }
    };
    fetchRealtime();
    const interval = setInterval(fetchRealtime, 1000);
    return () => clearInterval(interval);
  }, []);

  // EMERGENCY SOUND LOGIC
  useEffect(() => {
    if (!audioRef.current || !audioEnabled) return;

    if (data?.emergency) {
      audioRef.current.loop = true;
      audioRef.current.play().catch((e) => console.warn("Audio blocked by browser:", e));
    } else {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [data?.emergency, audioEnabled]);

  const enableAudio = () => {
    setAudioEnabled(true);
    // Silent play to 'unlock' audio context in browser
    if (audioRef.current) {
        audioRef.current.play().then(() => {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        });
    }
  };

  if (error && !data) {
    return (
      <div style={styles.errorOverlay}>
        <div style={styles.errorBox}>
          <ShieldAlert size={48} color="#ef4444" />
          <h2 style={{fontWeight: 800}}>Connection Failed</h2>
          <p>Ensure backend is live</p>
          <button onClick={() => window.location.reload()} style={styles.retryBtn}>Retry</button>
        </div>
      </div>
    );
  }

  if (!data) return <div style={styles.loading}>Connecting to Unit...</div>;

  return (
    <div style={styles.container}>
      <aside style={styles.sidebar}>
        <div style={styles.logo}>+</div>
        <nav style={styles.navStack}>
          <div style={{color: '#A3D9A5'}}><LayoutDashboard size={24} /></div>
        </nav>
        <button onClick={() => signOut(auth)} style={styles.logoutBtn} title="Logout">
            <LogOut size={24} />
        </button>
      </aside>

      <main style={styles.mainContent}>
        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>Unit Dashboard</h1>
            <p style={styles.subtitle}>Patient Room 404</p>
          </div>
          <div style={styles.headerActions}>
            {!audioEnabled && (
                <button onClick={enableAudio} style={styles.audioBtn}>
                    <Volume2 size={16} /> Enable Sound Alerts
                </button>
            )}
            <div style={styles.iconCircle}><Search size={20} /></div>
            <div style={{...styles.iconCircle, position: 'relative'}}>
              <Bell size={20} />
              {data?.emergency && <div style={styles.notificationDot} />}
            </div>
            <div style={styles.avatarPlaceholder}><User size={20} /></div>
          </div>
        </header>

        {/* AI PANEL */}
        {data?.aiBrief && (
          <div style={{...styles.card, borderLeft: '8px solid #ef4444', marginBottom: '25px'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: '12px', color: '#8b5cf6', marginBottom: '10px'}}>
              <Brain size={28} />
              <h3 style={{margin: 0, fontWeight: 800}}>AI Triage: {data.aiBrief.riskLevel} Risk</h3>
            </div>
            <p style={styles.aiText}>{data.aiBrief.explanation}</p>
            <div style={styles.recommendationBox}>RECOMMENDATION: {data.aiBrief.suggestedResponse}</div>
          </div>
        )}

        {/* EMERGENCY ALERT BAR */}
        {data?.emergency && (
          <div style={styles.emergencyBanner}>
            <AlertCircle size={20} /> EMERGENCY: {data?.emergencyType || "Critical Event"}
          </div>
        )}

        <div style={styles.grid}>
          <div style={styles.leftCol}>
            <section style={styles.card}>
              <h3 style={styles.cardTitle}>Cardiac Rhythm</h3>
              <div style={{height: '300px'}}>
                <Graph data={history} dataKey="heartRate" color="#A3D9A5" unit="BPM" />
              </div>
            </section>

            <div style={styles.subGrid}>
               <section style={styles.card}>
                  <h3 style={styles.cardTitle}>Security</h3>
                  <div style={styles.dataRow}>
                    <span>UID:</span>
                    <span style={styles.dataValue}>{data?.rfid?.cardUID || "---"}</span>
                  </div>
                  <div style={{
                      ...styles.statusBadge, 
                      backgroundColor: data?.rfid?.isAuthorized === false ? '#fee2e2' : '#f0fdf4',
                      color: data?.rfid?.isAuthorized === false ? '#ef4444' : '#22c55e'
                    }}>
                       {data?.rfid?.event || "Standby"}
                  </div>
               </section>
               <section style={styles.card}>
                  <h3 style={styles.cardTitle}>Log</h3>
                  <AccessLog history={history} />
               </section>
            </div>
          </div>

          <div style={styles.rightCol}>
            <VitalCard label="Heart Rate" value={data?.heartRate} unit="BPM" icon={<Zap size={18}/>} alert={data?.heartRate > 100} color="#fff7ed" iconColor="#f97316" />
            <VitalCard label="Temperature" value={data?.temperature} unit="C" icon={<Thermometer size={18}/>} alert={data?.temperature > 38} color="#eff6ff" iconColor="#3b82f6" />
            <VitalCard label="Posture" value={data?.posture} icon={<User size={18}/>} color="#f5f3ff" iconColor="#8b5cf6" />
            <VitalCard label="Fall Status" value={data?.fallDetected ? "ALARM" : "Normal"} icon={<Activity size={18}/>} alert={data?.fallDetected} color="#f0fdf4" iconColor="#22c55e" />

            <div style={styles.healthCard}>
              <div style={styles.stabilityIndicator}>
                <div style={styles.stabilityRing}>100%</div>
                <span style={{fontWeight: 800}}>ONLINE</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* HIDDEN AUDIO ELEMENT */}
      <audio ref={audioRef} preload="auto">
        <source src="/sounds/preview.mp3" type="audio/mpeg" />
      </audio>
    </div>
  );
};

const styles = {
  container: { display: 'flex', minHeight: '100vh', backgroundColor: '#F8FAFA', fontFamily: 'sans-serif', color: '#1a2e28' },
  sidebar: { width: '80px', backgroundColor: '#0A1612', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0' },
  logo: { fontSize: '32px', fontWeight: 900, color: '#FF8A50', marginBottom: '60px' },
  navStack: { flex: 1 },
  logoutBtn: { backgroundColor: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '20px' },
  mainContent: { flex: 1, padding: '40px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' },
  title: { fontSize: '28px', fontWeight: 800, margin: 0 },
  subtitle: { color: '#64748b', margin: '5px 0 0 0' },
  headerActions: { display: 'flex', alignItems: 'center', gap: '15px' },
  audioBtn: { padding: '8px 15px', backgroundColor: '#8b5cf6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' },
  iconCircle: { padding: '8px', cursor: 'pointer', color: '#64748b' },
  avatarPlaceholder: { width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' },
  notificationDot: { position: 'absolute', top: '2px', right: '2px', width: '8px', height: '8px', backgroundColor: '#ef4444', borderRadius: '50%', border: '2px solid white' },
  grid: { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '30px' },
  leftCol: { display: 'flex', flexDirection: 'column', gap: '30px' },
  card: { backgroundColor: 'white', padding: '25px', borderRadius: '25px', boxShadow: '0 4px 20px rgba(0,0,0,0.03)', border: '1px solid #f1f5f9' },
  cardTitle: { fontSize: '16px', fontWeight: 700, marginBottom: '20px', textTransform: 'uppercase', color: '#64748b' },
  aiText: { fontSize: '16px', lineHeight: '1.5', color: '#334155' },
  recommendationBox: { display: 'inline-block', padding: '8px 16px', backgroundColor: '#eff6ff', borderRadius: '8px', fontWeight: 800, color: '#3b82f6', fontSize: '14px' },
  emergencyBanner: { backgroundColor: '#ef4444', color: 'white', padding: '15px', borderRadius: '12px', marginBottom: '25px', fontWeight: 700, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' },
  subGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' },
  dataRow: { display: 'flex', justifyContent: 'space-between', padding: '10px 0' },
  dataValue: { fontWeight: 800 },
  statusBadge: { padding: '5px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: 800, textAlign: 'center' },
  rightCol: { display: 'flex', flexDirection: 'column', gap: '15px' },
  healthCard: { backgroundColor: '#A3D9A5', color: 'white', padding: '25px', borderRadius: '25px' },
  stabilityIndicator: { display: 'flex', alignItems: 'center', gap: '10px' },
  stabilityRing: { width: '40px', height: '40px', borderRadius: '50%', border: '2px solid white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' },
  loading: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 },
  errorOverlay: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  errorBox: { textAlign: 'center', padding: '40px', borderRadius: '20px', border: '1px solid #fee2e2' },
  retryBtn: { padding: '10px 30px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', marginTop: '20px' }
};

const VitalCard = ({ label, value, unit, icon, alert, color, iconColor }) => (
  <div style={{
    backgroundColor: alert ? '#ef4444' : 'white',
    color: alert ? 'white' : 'inherit',
    padding: '15px 20px',
    borderRadius: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    border: '1px solid #f1f5f9'
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
      <div style={{ backgroundColor: alert ? 'rgba(255,255,255,0.2)' : color, padding: '10px', borderRadius: '12px', color: alert ? 'white' : iconColor }}>
        {icon}
      </div>
      <div>
        <p style={{fontSize: '10px', fontWeight: 800, margin: 0, textTransform: 'uppercase'}}>{label}</p>
        <p style={{fontSize: '18px', fontWeight: 900, margin: 0}}>{value ?? "--"} <span style={{fontSize: '12px'}}>{unit}</span></p>
      </div>
    </div>
    <ChevronRight size={14} opacity={0.3} />
  </div>
);

export default Dashboard;
