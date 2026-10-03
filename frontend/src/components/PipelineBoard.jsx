import React, { useState } from 'react';
import StageBadge from './StageBadge.jsx';
import StageSelect from './StageSelect.jsx';
import { currency, formatDate } from '../lib/format.js';

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

// Kanban view of the pipeline: one column per stage. Cards can be dragged between columns
// (mouse) or moved with the stage dropdown on each card (touch and keyboard).
// `scores` maps deal id → priority score, used to order open columns.
export default function PipelineBoard({ deals, scores, savingId, onMove, onOpen }) {
  const [draggingId, setDraggingId] = useState(null);
  const [overStage, setOverStage] = useState(null);

  const columns = STAGES.map((stage) => {
    const items = deals.filter((d) => d.stage === stage);
    items.sort((a, b) =>
      ['won', 'lost'].includes(stage)
        ? new Date(b.updated_at) - new Date(a.updated_at)
        : (scores[b.id] ?? 0) - (scores[a.id] ?? 0)
    );
    const total = items.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    return { stage, items, total };
  });

  const handleDrop = (stage) => (e) => {
    e.preventDefault();
    const deal = deals.find((d) => d.id === e.dataTransfer.getData('text/plain'));
    setDraggingId(null);
    setOverStage(null);
    if (deal && deal.stage !== stage) onMove(deal, stage);
  };

  return (
    <div className="no-scrollbar flex gap-3 overflow-x-auto p-4">
      {columns.map(({ stage, items, total }) => (
        <section
          key={stage}
          onDragOver={(e) => {
            e.preventDefault();
            if (overStage !== stage) setOverStage(stage);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setOverStage(null);
          }}
          onDrop={handleDrop(stage)}
          className={`flex w-60 shrink-0 flex-col rounded-xl border p-2 transition-colors ${
            overStage === stage && draggingId
              ? 'border-brand-400/60 bg-brand-500/[0.06]'
              : 'border-fg/10 bg-fg/[0.02]'
          }`}
          aria-label={`${stage} column`}
        >
          <header className="mb-2 flex items-center justify-between px-1">
            <StageBadge stage={stage} />
            <span className="text-xs text-subtle">
              {items.length} · {currency(total)}
            </span>
          </header>

          <ul className="flex min-h-[4rem] flex-1 flex-col gap-2">
            {items.map((d) => (
              <li
                key={d.id}
                draggable={savingId !== d.id}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', d.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggingId(d.id);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setOverStage(null);
                }}
                onClick={() => onOpen(d)}
                className={`cursor-grab rounded-lg border border-fg/10 bg-surface p-3 shadow-sm transition-opacity hover:border-fg/20 active:cursor-grabbing ${
                  draggingId === d.id || savingId === d.id ? 'opacity-50' : ''
                }`}
              >
                <p className="text-sm font-medium leading-snug text-fg">{d.title}</p>
                <p className="mt-1 text-sm text-muted">{currency(d.value)}</p>
                <div className="mt-2 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                  <span className="truncate text-xs text-subtle">
                    {d.expected_close_date ? `Close ${formatDate(d.expected_close_date)}` : ''}
                  </span>
                  <StageSelect
                    stage={d.stage}
                    disabled={savingId === d.id}
                    onChange={(s) => onMove(d, s)}
                  />
                </div>
              </li>
            ))}
            {items.length === 0 && (
              <li className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-fg/10 px-2 py-4 text-center text-xs text-faint">
                Drop deals here
              </li>
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
