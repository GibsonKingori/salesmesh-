import React from 'react';

// Nodes laid out as a loose mesh + the edges connecting nearby ones —
// a quiet visual nod to "SalesMesh" rather than a stock photo.
const NODES = [
  { id: 0, x: 40, y: 60 },
  { id: 1, x: 140, y: 40 },
  { id: 2, x: 230, y: 90 },
  { id: 3, x: 90, y: 150 },
  { id: 4, x: 200, y: 190 },
  { id: 5, x: 310, y: 150 },
  { id: 6, x: 30, y: 250 },
  { id: 7, x: 150, y: 270 },
  { id: 8, x: 270, y: 260 },
  { id: 9, x: 340, y: 320 },
  { id: 10, x: 100, y: 350 },
  { id: 11, x: 210, y: 380 },
  { id: 12, x: 300, y: 400 },
  { id: 13, x: 50, y: 430 },
  { id: 14, x: 160, y: 460 },
];

const EDGES = [
  [0, 1], [1, 2], [0, 3], [1, 3], [1, 4], [2, 4], [2, 5], [3, 4],
  [4, 5], [3, 6], [3, 7], [4, 7], [4, 8], [5, 8], [5, 9], [6, 7],
  [7, 8], [8, 9], [6, 10], [7, 10], [7, 11], [8, 11], [8, 12], [9, 12],
  [10, 11], [11, 12], [10, 13], [11, 13], [11, 14], [12, 14], [13, 14],
];

const PULSE_NODES = new Set([2, 7, 12]);

export default function NetworkMesh({ className = '' }) {
  return (
    <svg
      viewBox="0 0 380 500"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      {EDGES.map(([a, b], i) => {
        const nodeA = NODES[a];
        const nodeB = NODES[b];
        return (
          <line
            key={i}
            x1={nodeA.x}
            y1={nodeA.y}
            x2={nodeB.x}
            y2={nodeB.y}
            stroke="currentColor"
            strokeOpacity="0.18"
            strokeWidth="1"
          />
        );
      })}
      {NODES.map((n) => (
        <circle
          key={n.id}
          cx={n.x}
          cy={n.y}
          r={PULSE_NODES.has(n.id) ? 4 : 2.5}
          fill="currentColor"
          className={PULSE_NODES.has(n.id) ? 'animate-pulse' : ''}
          opacity={PULSE_NODES.has(n.id) ? 0.7 : 0.35}
        />
      ))}
    </svg>
  );
}
