import { Mppx, tempo } from "mppx/express";

const OWNER_WALLET = "0x342fFFBcEbb761bC2c7B512333AF5E397b4cB72d";
const PATH_USD = "0x20c0000000000000000000000000000000000000";

export const ENRICHMENT_PRICE = "0.10";

export const mppx = Mppx.create({
  methods: [
    tempo({
      currency: PATH_USD,
      recipient: OWNER_WALLET,
    }),
  ],
});

export const enrichmentPaywall = mppx.charge({
  amount: ENRICHMENT_PRICE,
  description: "BookMark AI enrichment",
});
