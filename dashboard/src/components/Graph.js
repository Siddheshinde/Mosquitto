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

function Graph({ title, data, dataKey, color }) {
  const formattedData = data.map((d) => ({
    ...d,
    time: new Date(d.timestamp).toLocaleTimeString(),
  }));

  return (
    <div className="graph">
      <h4>{title}</h4>

      {formattedData.length === 0 ? (
        <p>No data yet</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={formattedData}>
            <CartesianGrid stroke="#333" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={false}
              isAnimationActive
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export default Graph;
