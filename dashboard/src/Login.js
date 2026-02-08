import React, { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebase";
import "./Login.css";

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    
    try {
      await signInWithEmailAndPassword(auth, email, password);
      onLogin();
    } catch (err) {
      setError("Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-split">
        {/* Left Side - Visual */}
        <div className="login-visual">
          <div className="visual-content">
            <div className="medical-icon">
              <div className="heartbeat">
                <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                  <path d="M100,170 L40,110 C20,90 20,60 40,40 C60,20 80,20 100,40 C120,20 140,20 160,40 C180,60 180,90 160,110 Z" 
                        fill="rgba(200, 155, 123, 0.3)" 
                        stroke="rgba(200, 155, 123, 0.8)" 
                        strokeWidth="2"/>
                  <path className="pulse-line" 
                        d="M10,100 L40,100 L50,80 L60,120 L70,60 L80,140 L90,100 L190,100" 
                        fill="none" 
                        stroke="#c89b7b" 
                        strokeWidth="3"/>
                </svg>
              </div>
            </div>
            <h1 className="visual-title">Medical Monitoring System</h1>
            <p className="visual-subtitle">Real-time Patient Health Monitoring</p>
            <div className="features">
              <div className="feature-item">
                <span className="feature-icon"></span>
                <span>Heart Rate Monitoring</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon"></span>
                <span>Temperature Tracking</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon"></span>
                <span>Emergency Alerts</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon"></span>
                <span>Secure Access Control</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side - Form */}
        <div className="login-form-side">
          <div className="form-container">
            <div className="form-header">
              <h2>Welcome Back</h2>
              <p>Sign in to access the patient dashboard</p>
            </div>

            <form onSubmit={handleLogin} className="login-form">
              <div className="input-group">
                <label htmlFor="email">Email Address</label>
                <div className="input-wrapper">
                  <span className="input-icon"></span>
                  <input
                    id="email"
                    type="email"
                    placeholder="doctor@hospital.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="password">Password</label>
                <div className="input-wrapper">
                  <span className="input-icon"></span>
                  <input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              {error && (
                <div className="error-message">
                  <span className="error-icon"></span>
                  {error}
                </div>
              )}

              <button 
                type="submit" 
                className="login-button"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="spinner"></span>
                    Authenticating...
                  </>
                ) : (
                  <>
                    Sign In
                    <span className="arrow">→</span>
                  </>
                )}
              </button>
            </form>

            <div className="form-footer">
              <p> Authorized Personnel Only</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;