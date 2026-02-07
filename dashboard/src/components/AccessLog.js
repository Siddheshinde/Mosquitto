import React from "react";

function AccessLog({ history }) {
  return (
    <div className="tableBox">
      <h3>Access Log (Last 50)</h3>

      <table className="table">
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
          {history.map((h, i) => (
            <tr key={i}>
              <td>{h.time}</td>
              <td>{h.temperature}</td>
              <td>{h.heartRate}</td>
              <td>{h.posture}</td>
              <td>{h.fallDetected ? "Yes" : "No"}</td>
              <td>{h.emergency ? "🚨" : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default AccessLog;
