// Broker adapter interfaces and stubs for future direct integrations.
// Current MVP uses CSV-based holdings; these adapters document and
// scaffold how API-based brokers (e.g., Zerodha Kite, Groww, Upstox)
// would plug into MyTicker.

/**
 * Base interface (documented via JSDoc):
 *
 * BrokerAdapter:
 * - id: string              // e.g. "zerodha"
 * - displayName: string
 * - requiresApiKey: boolean
 * - supportsLiveSync: boolean
 * - fetchHoldings(config): Promise<Holding[]>
 */

export class ZerodhaKiteAdapter {
  constructor() {
    this.id = "zerodha-kite";
    this.displayName = "Zerodha Kite Connect";
    this.requiresApiKey = true;
    this.supportsLiveSync = true;
  }

  /**
   * config is expected to contain:
   * - apiKey
   * - accessToken
   *
   * NOTE: Implementing this fully requires:
   * - Setting up a Kite Connect app to obtain apiKey.
   * - Handling the OAuth-like login flow to obtain accessToken.
   * - Calling the holdings endpoint (e.g., /portfolio/holdings) and
   *   mapping results into MyTicker's Holding objects.
   *
   * For now this returns an empty list and serves as a clear stub.
   */
  async fetchHoldings(config) {
    console.warn(
      "[MyTicker] ZerodhaKiteAdapter.fetchHoldings is not implemented in the MVP. Falling back to CSV."
    );
    return [];
  }
}

export class GrowwAdapter {
  constructor() {
    this.id = "groww";
    this.displayName = "Groww";
    this.requiresApiKey = true;
    this.supportsLiveSync = true;
  }

  /**
   * Placeholder for future Groww API integration.
   */
  async fetchHoldings(config) {
    console.warn(
      "[MyTicker] GrowwAdapter.fetchHoldings is not implemented in the MVP. Use CSV upload."
    );
    return [];
  }
}

export class UpstoxAdapter {
  constructor() {
    this.id = "upstox";
    this.displayName = "Upstox";
    this.requiresApiKey = true;
    this.supportsLiveSync = true;
  }

  /**
   * Placeholder for future Upstox API integration.
   */
  async fetchHoldings(config) {
    console.warn(
      "[MyTicker] UpstoxAdapter.fetchHoldings is not implemented in the MVP. Use CSV upload."
    );
    return [];
  }
}

export const REGISTERED_BROKER_ADAPTERS = [
  new ZerodhaKiteAdapter(),
  new GrowwAdapter(),
  new UpstoxAdapter()
];

