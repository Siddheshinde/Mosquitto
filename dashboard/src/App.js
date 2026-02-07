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
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Loading screen while checking authentication
  if (loading) {
    return (
      <div className="center">
        <div className="loader" />
        <p style={{ color: "#9ca3af", fontSize: "14px" }}>
          Checking authentication...
        </p>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!user) return <Login />;

  // Show dashboard if authenticated
  return <Dashboard />;
}

export default App;