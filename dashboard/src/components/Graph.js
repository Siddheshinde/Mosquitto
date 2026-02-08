import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

function Graph({ title, data, dataKey, color, unit = "" }) {
  // Format data with proper timestamps
  const formattedData = (data || []).map((d) => ({
    ...d,
    time: d.timestamp
      ? new Date(d.timestamp).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "",
  }));

  // Filter valid data points
  const validData = formattedData.filter((d) => d[dataKey] !== null && d[dataKey] !== undefined);

  return (
    <div className="graph-card">
      <h3 className="graph-title">{title}</h3>
      {validData.length === 0 ? (
        <div className="graph-empty">
          <p> Waiting for sensor data...</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart
            data={validData}
            margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
          >
            {/* Grid */}
            <CartesianGrid stroke="#2a2f3a" strokeDasharray="3 3" />

            {/* X Axis - Time */}
            <XAxis
              dataKey="time"
              tick={{ fill: "#8b92a7", fontSize: 11 }}
              stroke="#374151"
              tickLine={false}
            />

            {/* Y Axis - Values */}
            <YAxis
              tick={{ fill: "#8b92a7", fontSize: 12 }}
              stroke="#374151"
              tickLine={false}
              domain={["auto", "auto"]}
            />

            {/* Tooltip */}
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                border: "1px solid #374151",
                borderRadius: "8px",
                color: "#fff",
                fontSize: "13px",
              }}
              labelStyle={{ color: "#9ca3af", fontWeight: "600" }}
              formatter={(value) => [`${value} ${unit}`, title]}
            />

            {/* Line */}
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={3}
              dot={false}
              isAnimationActive={true}
              animationDuration={800}
              animationEasing="ease-in-out"
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export default Graph;