import React from "react";


function AccessLog({ history = [] }) {
  return (
    <div className="tableBox">
      <h3>Access Log (Last 50)</h3>

      <table className="table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Temp (°C)</th>
            <th>HR (BPM)</th>
            <th>Posture</th>
            <th>Fall</th>
            <th>Emergency</th>
          </tr>
        </thead>

        <tbody>
          {history.length === 0 ? (
            <tr>
              <td colSpan="6" style={{ textAlign: "center" }}>
                No data available
              </td>
            </tr>
          ) : (
            history.slice(0, 50).map((h, i) => {
              const time = h?.timestamp
                ? new Date(h.timestamp).toLocaleTimeString()
                : "--";

              return (
                <tr
                  key={h.timestamp ?? i}
                  style={{
                    backgroundColor: h?.emergency
                      ? "rgba(255, 0, 0, 0.15)"
                      : "transparent",
                  }}
                >
                  <td>{time}</td>
                  <td>{h?.temperature ?? "--"}</td>
                  <td>{h?.heartRate ?? "--"}</td>
                  <td>{h?.posture ?? "--"}</td>
                  <td>{h?.fallDetected ? "Yes" : "No"}</td>
                  <td>{h?.emergency ? "🚨" : "-"}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export default AccessLog;
