// ─────────────────────────────────────────────────────────────────────────────
// Duration Estimator — AI predicts task duration from similar historical tasks.
// Phase 2.10a
// ─────────────────────────────────────────────────────────────────────────────

import { embedText, createEmbedding } from "@/lib/embedding.ts";
import { taskRepository } from "@/repositories/task.repository.ts";
import { logger } from "@/lib/logger.ts";

export interface DurationEstimate {
  similarTasks: Array<{
    taskId: string;
    title: string;
    displayId: string | null;
    estimatedHours: number | null;
    actualHours: number | null;
    similarity: number;
  }>;
  suggestedHours: number;
  rangeMin: number;
  rangeMax: number;
  sampleSize: number;
}

export const durationEstimator = {
  async estimate(input: { title: string; description?: string | null }): Promise<DurationEstimate> {
    const text = embedText({ title: input.title, description: input.description });
    if (!text) throw new Error("Cannot estimate — no text to embed");

    const embedding = await createEmbedding(text);
    const all = await taskRepository.findSimilarTasks(embedding, 15);

    // Filter: only tasks with similarity > 0.5 and at least some hour data
    const relevant = all.filter((t) => t.similarity > 0.5 &&
      (t.estimatedHours != null || t.actualHours != null) &&
      (t.estimatedHours || 0) > 0 || (t.actualHours || 0) > 0);

    if (relevant.length === 0) {
      return {
        similarTasks: [],
        suggestedHours: 0,
        rangeMin: 0,
        rangeMax: 0,
        sampleSize: 0,
      };
    }

    // Use estimated_hours as primary, fall back to actual_hours
    const hours = relevant.map((t) => {
      const v = t.estimatedHours ?? t.actualHours ?? 0;
      return Number(v);
    }).filter((h) => h > 0);

    if (hours.length === 0) {
      return {
        similarTasks: relevant.slice(0, 5),
        suggestedHours: 0,
        rangeMin: 0,
        rangeMax: 0,
        sampleSize: relevant.length,
      };
    }

    // Weighted average by similarity
    const weights = relevant.slice(0, hours.length).map((t) => Math.max(0, t.similarity));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const weightedSum = hours.reduce((sum, h, i) => sum + h * weights[i], 0);
    const avg = totalWeight > 0 ? weightedSum / totalWeight : 0;

    hours.sort((a, b) => a - b);
    const median = hours.length % 2 === 1
      ? hours[Math.floor(hours.length / 2)]
      : (hours[hours.length / 2 - 1] + hours[hours.length / 2]) / 2;

    return {
      similarTasks: relevant.slice(0, 5),
      suggestedHours: Math.round(avg * 10) / 10,
      rangeMin: Math.round(hours[0] * 10) / 10,
      rangeMax: Math.round(hours[hours.length - 1] * 10) / 10,
      sampleSize: relevant.length,
    };
  },
};
