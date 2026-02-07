import {
  AnchorIdl,
  rootNodeFromAnchorWithoutDefaultVisitor,
} from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { visit } from "@codama/visitors-core";
import anchorIdl from "./idl/opportunity_market.json";

async function generateClient() {
  const node = rootNodeFromAnchorWithoutDefaultVisitor(anchorIdl as AnchorIdl);

  try {
    const visitor = renderVisitor("src/generated") as any;
    await visit(node, visitor);
    console.log("Generated Solana Kit client in src/generated/");
  } catch (e) {
    console.error("Error generating client:", e);
    throw e;
  }
}

generateClient();
