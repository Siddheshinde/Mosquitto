import React, { useEffect, useState, useRef } from "react";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";
import { 
  LayoutDashboard, Calendar, ClipboardList, Settings, 
  Search, Bell, LogOut, Video, ChevronRight, AlertCircle,
  Activity, Thermometer, User, Droplets, ShieldAlert, Zap
} from "lucide-react";

// Assuming these handle your logic for the charts and logs
import Graph from "./Graph";
import AccessLog from "./AccessLog";

const Dashboard = () => {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
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
          setHistory((prev) => {
            const newEntry = { ...json, timestamp: Date.now() };
            return [...prev, newEntry].slice(-50);
          });
        }
      } catch (err) {
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
      audioRef.current.play().catch((e) => console.error("Audio error:", e));
    } else {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [data?.emergency]);

  // Error State Rendering
  if (error && !data) {
    return (
      <div style={styles.errorOverlay}>
        <div style={styles.errorBox}>
          <ShieldAlert size={48} color="#ef4444" />
          <h2 style={{fontWeight: 800, fontSize: '24px'}}>Connection Failed</h2>
          <p style={{color: '#64748b'}}>Ensure the backend is running on port 5000</p>
          <button onClick={() => window.location.reload()} style={styles.retryBtn}>Retry Connection</button>
        </div>
      </div>
    );
  }

  if (!data) return <div style={styles.loading}>Connecting to Bio-Telemetry Unit...</div>;

  return (
    <div style={styles.container}>
      {/* SIDEBAR */}
      <aside style={styles.sidebar}>
        <div style={styles.logo}>✚</div>
        <nav style={styles.navStack}>
          <NavItem icon={<LayoutDashboard />} label="Dashboard" active />
          <NavItem icon={<Calendar />} label="Schedule" />
          <NavItem icon={<ClipboardList />} label="Reports" />
          <NavItem icon={<Settings />} label="Settings" />
        </nav>
        <button onClick={() => signOut(auth)} style={styles.logoutBtn}><LogOut size={24} /></button>
      </aside>

      {/* MAIN PANEL */}
      <main style={styles.mainContent}>
        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>Hi, Jonas Kahnwald</h1>
            <p style={styles.subtitle}>Patient • Room 404</p>
          </div>
          <div style={styles.headerActions}>
            <div style={styles.iconCircle}><Search size={20} /></div>
            <div style={styles.iconCircle} className="relative">
              <Bell size={20} />
              {data?.emergency && <div style={styles.notificationDot} />}
            </div>
            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Jonas" style={styles.avatar} alt="User" />
          </div>
        </header>

        {/* EMERGENCY BANNER */}
        {data?.emergency && (
          <div style={styles.emergencyBanner}>
            <AlertCircle /> 🚨 EMERGENCY DETECTED: {data?.emergencyType} 🚨
          </div>
        )}

        <div style={styles.grid}>
          {/* Left Column */}
          <div style={styles.leftCol}>
            <section style={styles.card}>
              <h3 style={styles.cardTitle}>Live Cardiac Rhythm</h3>
              <div style={{height: '300px'}}>
                <Graph data={history} dataKey="heartRate" color="#A3D9A5" unit="BPM" />
              </div>
            </section>

            <div style={styles.subGrid}>
               <section style={styles.card}>
                  <h3 style={styles.cardTitle}>Access Control</h3>
                  <div style={styles.dataRow}>
                    <span>Last RFID:</span>
                    <span style={styles.dataValue}>{data?.rfid?.cardUID || "---"}</span>
                  </div>
                  <div style={styles.dataRow}>
                    <span>Status:</span>
                    <span style={{...styles.statusBadge, backgroundColor: data?.rfid?.event === 'unauthorized' ? '#fee2e2' : '#f0fdf4'}}>
                       {data?.rfid?.event || "Standby"}
                    </span>
                  </div>
                  <div style={styles.statsRow}>
                    <div style={styles.statItem}>
                      <p style={styles.statLabel}>Visits</p>
                      <p style={styles.statVal}>{data?.accessStats?.doctorVisits}</p>
                    </div>
                    <div style={styles.statItem}>
                      <p style={styles.statLabel}>Alerts</p>
                      <p style={{...styles.statVal, color: '#ef4444'}}>{data?.accessStats?.unauthorizedAttempts}</p>
                    </div>
                  </div>
               </section>
               <section style={styles.card}>
                  <h3 style={styles.cardTitle}>Activity Log</h3>
                  <div style={{maxHeight: '180px', overflowY: 'auto'}}>
                    <AccessLog history={history} />
                  </div>
               </section>
            </div>
          </div>

          {/* Right Column */}
          <div style={styles.rightCol}>
            <h3 style={{...styles.cardTitle, marginLeft: '10px'}}>Current Vitals</h3>
            <VitalCard label="Heart Rate" value={data?.heartRate} unit="BPM" icon={<Zap size={18}/>} alert={data?.heartRate > 100} color="#fff7ed" iconColor="#f97316" />
            <VitalCard label="Temperature" value={data?.temperature} unit="°C" icon={<Thermometer size={18}/>} color="#eff6ff" iconColor="#3b82f6" />
            <VitalCard label="Posture" value={data?.posture} icon={<User size={18}/>} color="#f5f3ff" iconColor="#8b5cf6" />
            <VitalCard label="Fall Detection" value={data?.fallDetected ? "FALL!!" : "Normal"} icon={<Activity size={18}/>} alert={data?.fallDetected} color="#f0fdf4" iconColor="#22c55e" />

            <div style={styles.healthCard}>
              <h4 style={{fontWeight: 700, marginBottom: '8px'}}>System Health</h4>
              <p style={{fontSize: '13px', opacity: 0.9, marginBottom: '20px'}}>Biometric sensors are currently active and transmitting.</p>
              <div style={styles.stabilityIndicator}>
                <div style={styles.stabilityRing}>80%</div>
                <span style={{fontWeight: 800, fontSize: '18px'}}>STABLE</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      <audio ref={audioRef}><source src="/sounds/preview.mp3" type="audio/mpeg" /></audio>
    </div>
  );
};

// --- INLINE CSS OBJECT ---
const styles = {
  container: { display: 'flex', minHeight: '100vh', backgroundColor: '#F8FAFA', fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#1a2e28' },
  sidebar: { width: '260px', backgroundColor: '#0A1612', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0' },
  logo: { fontSize: '32px', fontWeight: 900, color: '#FF8A50', marginBottom: '60px' },
  navStack: { display: 'flex', flexDirection: 'column', gap: '40px', flex: 1 },
  mainContent: { flex: 1, padding: '40px', overflowY: 'auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' },
  title: { fontSize: '28px', fontWeight: 800, letterSpacing: '-0.5px' },
  subtitle: { color: '#64748b', fontWeight: 500 },
  headerActions: { display: 'flex', alignItems: 'center', gap: '15px', backgroundColor: 'white', padding: '8px 16px', borderRadius: '50px', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' },
  iconCircle: { padding: '8px', cursor: 'pointer', color: '#64748b' },
  avatar: { width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#ecfdf5' },
  notificationDot: { position: 'absolute', top: '8px', right: '8px', width: '8px', height: '8px', backgroundColor: '#ef4444', borderRadius: '50%', border: '2px solid white' },
  grid: { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '30px' },
  leftCol: { display: 'flex', flexDirection: 'column', gap: '30px' },
  card: { backgroundColor: 'white', padding: '30px', borderRadius: '35px', boxShadow: '0 10px 40px rgba(0,0,0,0.03)', border: '1px solid #f1f5f9' },
  cardTitle: { fontSize: '18px', fontWeight: 700, marginBottom: '20px' },
  subGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' },
  dataRow: { display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f8fafc' },
  dataValue: { fontWeight: 800, fontFamily: 'monospace' },
  statusBadge: { padding: '4px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' },
  statsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '20px' },
  statItem: { backgroundColor: '#f8fafc', padding: '15px', borderRadius: '20px', textAlign: 'center' },
  statLabel: { fontSize: '10px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' },
  statVal: { fontSize: '22px', fontWeight: 900 },
  rightCol: { display: 'flex', flexDirection: 'column', gap: '15px' },
  healthCard: { backgroundColor: '#A3D9A5', color: 'white', padding: '30px', borderRadius: '35px', marginTop: '20px', position: 'relative', overflow: 'hidden' },
  stabilityIndicator: { display: 'flex', alignItems: 'center', gap: '15px' },
  stabilityRing: { width: '50px', height: '50px', borderRadius: '50%', border: '3px solid rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 },
  emergencyBanner: { backgroundColor: '#ef4444', color: 'white', padding: '15px', borderRadius: '20px', marginBottom: '30px', fontWeight: 700, textAlign: 'center', animation: 'pulse 2s infinite' },
  errorOverlay: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff5f5' },
  errorBox: { textAlign: 'center', backgroundColor: 'white', padding: '50px', borderRadius: '40px', boxShadow: '0 20px 50px rgba(239,68,68,0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' },
  retryBtn: { padding: '15px 40px', backgroundColor: '#ef4444', color: 'white', borderRadius: '15px', border: 'none', fontWeight: 700, cursor: 'pointer' },
  loading: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#A3D9A5' }
};

// Helper Components
const NavItem = ({ icon, label, active }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer', color: active ? '#A3D9A5' : '#64748b', fontWeight: 700 }}>
    {icon} <span style={{fontSize: '14px'}}>{label}</span>
  </div>
);

const VitalCard = ({ label, value, unit, icon, alert, color, iconColor }) => (
  <div style={{
    backgroundColor: alert ? '#ef4444' : 'white',
    color: alert ? 'white' : 'inherit',
    padding: '20px',
    borderRadius: '25px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    boxShadow: '0 4px 15px rgba(0,0,0,0.02)',
    border: '1px solid #f1f5f9'
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
      <div style={{ backgroundColor: alert ? 'rgba(255,255,255,0.2)' : color, padding: '12px', borderRadius: '15px', color: alert ? 'white' : iconColor }}>
        {icon}
      </div>
      <div>
        <p style={{fontSize: '10px', fontWeight: 800, opacity: 0.6, textTransform: 'uppercase'}}>{label}</p>
        <p style={{fontSize: '18px', fontWeight: 900}}>{value ?? "--"} <span style={{fontSize: '12px', opacity: 0.5}}>{unit}</span></p>
      </div>
    </div>
    <ChevronRight size={16} opacity={0.3} />
  </div>
);

export default Dashboard;
