import { pgTable, text, numeric, timestamp, index } from "drizzle-orm/pg-core";

export const markets = pgTable(
  "markets",
  {
    address: text("address").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    creatorPubkey: text("creator_pubkey").notNull(),
    rewardSol: numeric("reward_sol", { precision: 20, scale: 9 }).notNull(),
    marketIndex: numeric("market_index").notNull(),
    signature: text("signature").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    creatorIdx: index("creator_idx").on(table.creatorPubkey),
    createdAtIdx: index("created_at_idx").on(table.createdAt),
  })
);

export type Market = typeof markets.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;
