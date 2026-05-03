import "server-only";
import { getDb, ensureIndexes } from "./db";

export type PromptSkillRow = {
  handle: string;
  ens: string;
  ownerAddress: string;
  skillId: string;
  name: string;
  description: string;
  tags: string[];
  prompt: string;
  maxTokens: number;
  pricing: { x402: { token: string; chainId: number; amount: string } } | null;
  status: "active" | "deleted";
  createdAt: Date;
  updatedAt: Date;
};

export async function listPromptSkills(handle: string): Promise<PromptSkillRow[]> {
  await ensureIndexes();
  const db = await getDb();
  return db
    .collection<PromptSkillRow>("prompt_skills")
    .find({ handle, status: "active" })
    .toArray();
}

export async function upsertPromptSkill(input: Omit<PromptSkillRow, "createdAt" | "updatedAt" | "status"> & {
  status?: "active";
}): Promise<void> {
  await ensureIndexes();
  const db = await getDb();
  const now = new Date();
  await db.collection<PromptSkillRow>("prompt_skills").updateOne(
    { handle: input.handle, skillId: input.skillId, status: "active" },
    {
      $set: {
        ens: input.ens,
        ownerAddress: input.ownerAddress.toLowerCase(),
        name: input.name,
        description: input.description,
        tags: input.tags,
        prompt: input.prompt,
        maxTokens: input.maxTokens,
        pricing: input.pricing,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now, status: "active" },
    },
    { upsert: true },
  );
}

export async function deletePromptSkill(handle: string, skillId: string): Promise<boolean> {
  const db = await getDb();
  const r = await db
    .collection<PromptSkillRow>("prompt_skills")
    .updateOne(
      { handle, skillId, status: "active" },
      { $set: { status: "deleted", updatedAt: new Date() } },
    );
  return r.modifiedCount === 1;
}

export async function countActiveSkills(handle: string): Promise<number> {
  const db = await getDb();
  return db.collection("prompt_skills").countDocuments({ handle, status: "active" });
}
