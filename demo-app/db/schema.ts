import { pgTable, text, numeric, timestamp, index, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
    openTimestamp: timestamp("open_timestamp"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ([{
    creatorIdx: index("creator_idx").on(table.creatorPubkey),
    createdAtIdx: index("created_at_idx").on(table.createdAt),
  }])
);

export const options = pgTable(
  "options",
  {
    address: text("address").primaryKey(),
    marketAddress: text("market_address").notNull().references(() => markets.address),
    name: text("name").notNull(),
    description: text("description").notNull(),
    creatorPubkey: text("creator_pubkey").notNull(),
    signature: text("signature").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ([{
    marketIdx: index("options_market_idx").on(table.marketAddress),
    creatorIdx: index("options_creator_idx").on(table.creatorPubkey),
    createdAtIdx: index("options_created_at_idx").on(table.createdAt),
  }])
);

export const shares = pgTable(
  "shares",
  {
    id: text("id").primaryKey(), // composite: `${userPubkey}-${marketAddress}`
    userPubkey: text("user_pubkey").notNull(),
    marketAddress: text("market_address").notNull().references(() => markets.address),
    optionAddress: text("option_address").notNull().references(() => options.address),
    amount: numeric("amount").notNull(),
    revealedInTime: boolean("revealed_in_time"),
    claimedYield: boolean("claimed_yield").default(false),
    signature: text("signature").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ([
    index("shares_user_idx").on(table.userPubkey),
    index("shares_market_idx").on(table.marketAddress),
  ])
);

export const marketsRelations = relations(markets, ({ many }) => ({
  options: many(options),
  shares: many(shares),
}));

export const optionsRelations = relations(options, ({ one, many }) => ({
  market: one(markets, {
    fields: [options.marketAddress],
    references: [markets.address],
  }),
  shares: many(shares),
}));

export const sharesRelations = relations(shares, ({ one }) => ({
  market: one(markets, {
    fields: [shares.marketAddress],
    references: [markets.address],
  }),
  option: one(options, {
    fields: [shares.optionAddress],
    references: [options.address],
  }),
}));

export type Market = typeof markets.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;

export type Option = typeof options.$inferSelect;
export type NewOption = typeof options.$inferInsert;

export type Share = typeof shares.$inferSelect;
export type NewShare = typeof shares.$inferInsert;
