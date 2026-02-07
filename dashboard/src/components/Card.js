import React from "react";

function Card({ title, value, icon, alert = false, status = false }) {
  // Determine card styling based on alert status
  const cardClass = alert
    ? "metric-card metric-card-alert"
    : status
    ? "metric-card metric-card-status"
    : "metric-card";

  return (
    <div className={cardClass}>
      <div className="card-header">
        <span className="card-icon">{icon}</span>
        <h4 className="card-title">{title}</h4>
      </div>
      <div className="card-value">{value}</div>
      {alert && <div className="alert-indicator">⚠️ Alert</div>}
    </div>
  );
}

export default Card;