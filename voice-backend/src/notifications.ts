import type { BusinessProfile } from "./store.js";

export type NotifyKind = "lead" | "booking" | "emergency";

export type NotifierConfig = {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  messagingServiceSid?: string;
};

function compact(value: unknown, max = 90) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export class OwnerNotifier {
  constructor(private config: NotifierConfig) {}

  isConfigured() {
    return Boolean(
      this.config.accountSid &&
      this.config.authToken &&
      (this.config.fromNumber || this.config.messagingServiceSid)
    );
  }

  async notify(
    business: BusinessProfile,
    kind: NotifyKind,
    details: Record<string, unknown>
  ) {
    if (!business.ownerPhone) {
      return { success: false, skipped: true, reason: "owner_phone_missing" };
    }
    if (!this.isConfigured()) {
      return { success: false, skipped: true, reason: "twilio_sms_not_configured" };
    }

    const prefix =
      kind === "emergency"
        ? "URGENT CallPilot"
        : kind === "booking"
          ? "CallPilot booking"
          : "CallPilot lead";

    const issue = compact(details.issue);
    const city = compact(details.city, 45);
    const name = compact(details.name, 45);
    const phone = compact(details.phone, 30);
    const body = [
      `${prefix} — ${business.name}`,
      name ? `Customer: ${name}` : "",
      phone ? `Callback: ${phone}` : "",
      city ? `City: ${city}` : "",
      issue ? `Request: ${issue}` : "",
      kind === "booking" ? "Status: appointment confirmed" : "Open the CallPilot portal for full details."
    ].filter(Boolean).join("\n");

    const params = new URLSearchParams({
      To: business.ownerPhone,
      Body: body
    });
    if (this.config.messagingServiceSid) {
      params.set("MessagingServiceSid", this.config.messagingServiceSid);
    } else if (this.config.fromNumber) {
      params.set("From", this.config.fromNumber);
    }

    const auth = Buffer.from(
      `${this.config.accountSid}:${this.config.authToken}`
    ).toString("base64");

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
        this.config.accountSid!
      )}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      return {
        success: false,
        reason: "twilio_sms_failed",
        status: response.status,
        detail: detail.slice(0, 200)
      };
    }

    const payload = (await response.json()) as { sid?: string; status?: string };
    return {
      success: true,
      messageSid: payload.sid,
      status: payload.status
    };
  }
}
