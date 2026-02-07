import React, { useEffect, useState } from "react";
import { auth } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import Login from "./Login";
import "./App.css";
import Dashboard from "./components/Dashboard";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // 🔹 Loading screen while checking auth
  if (loading) {
    return (
      <div className="center">
        <div className="loader" />
        <p>Checking authentication...</p>
      </div>
    );
  }

  // 🔹 If not logged in → show login
  if (!user) return <Login />;

  // 🔹 If logged in → show dashboard
  return <Dashboard />;
}

export default App;
