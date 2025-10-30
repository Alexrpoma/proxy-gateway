import express from "express";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
app.use(bodyParser.json({ limit: "1mb" }));

const CONTROL_URL = process.env.CONTROL_URL || "https://cytsjhpqcujhgxplpldo.supabase.co/functions/v1/swift-endpoint/decide";
const TIMEOUT = Number(process.env.TIMEOUT_MS || 5000);
const PORT = process.env.PORT || 8080;

// Logger simple
const log = {
  info: (msg, data) => console.log(JSON.stringify({ level: "info", msg, ...data })),
  error: (msg, data) => console.error(JSON.stringify({ level: "error", msg, ...data }))
};

app.get("/", (_req, res) => res.status(200).send("Proxy Gateway is running"));

app.get("/health", (_req, res) => res.status(200).send("ok"));

app.post("/notify", async (req, res) => {
  // Show all incoming requests in logs
  log.info("incoming_request", { body: req.body });
  try {
    const body = req.body || {};
    const orderId = body.id || body.order_id;
    const amount = parseFloat(body.total_price);
    const currency = body.currency || "USD";
    
    // Mejor extracción de refToken
    const refToken = [
      body.ref_token,
      body.evclid,
      body.custom_attributes?.ref_token
    ].find(t => t && typeof t === "string" && t.trim());

    if (!orderId || !refToken) {
      log.info("missing_required_fields", { orderId, hasRefToken: !!refToken });
      return res.sendStatus(200);
    }

    // Consultar control
    const decision = await axios.post(
      CONTROL_URL,
      { orderId, amount, currency, refToken },
      { timeout: TIMEOUT, validateStatus: () => true }
    );

    const data = decision.data || {};
    
    if (data.forward !== true) {
      log.info("decision_skip", { orderId, forward: data.forward });
      return res.sendStatus(200);
    }

    // Validación estricta de postbackUrl
    const pb = data.postbackUrl;
    if (!pb || typeof pb !== "string") {
      log.error("invalid_postback_type", { orderId, type: typeof pb });
      return res.sendStatus(200);
    }

    let url;
    try {
      url = new URL(pb);
      if (url.protocol !== "https:") throw new Error("not_https");
    } catch (e) {
      log.error("invalid_postback_url", { orderId, pb, error: e.message });
      return res.sendStatus(200);
    }

    // Postback a Everflow
    const pbResult = await axios.get(pb, {
      timeout: TIMEOUT,
      validateStatus: () => true
    }).catch(err => ({ error: err.message }));

    log.info("postback_sent", {
      orderId,
      status: pbResult.status || "error",
      error: pbResult.error
    });

    return res.sendStatus(200);

  } catch (e) {
    log.error("webhook_error", { error: e.message, stack: e.stack });
    return res.sendStatus(200);
  }
});

app.listen(PORT, () => log.info("server_started", { port: PORT }));