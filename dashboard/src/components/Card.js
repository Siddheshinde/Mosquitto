import React from "react";

function Card({ title, value, color = "#ffffff" }) {
  return (
    <div className="card" style={{ color }}>
      <h4 style={{ opacity: 0.8 }}>{title}</h4>
      <h2 style={{ marginTop: 8 }}>{value}</h2>
    </div>
  );
}

export default Card;
