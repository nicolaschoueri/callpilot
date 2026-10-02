#!/usr/bin/env node

const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
const authToken = process.env.TWILIO_AUTH_TOKEN || "";
const projectId = process.env.OPENAI_PROJECT_ID || "";

function usage() {
  console.log(`
CallPilot Twilio setup

Commands:
  node scripts/twilio-setup.mjs create-trunk
  node scripts/twilio-setup.mjs search-ca <area-code>
  node scripts/twilio-setup.mjs list-owned
  node scripts/twilio-setup.mjs attach-number <trunk-sid> <phone-number-sid>
  node scripts/twilio-setup.mjs purchase-number <E.164>

Required environment:
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN

create-trunk also requires:
  OPENAI_PROJECT_ID

Safety:
  purchase-number is blocked unless CONFIRM_PHONE_PURCHASE=YES.
`.trim());
}

function requireTwilio() {
  if (!accountSid || !authToken) {
    throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required");
  }
}

function authHeader() {
  return "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
}

async function request(url, options = {}) {
  requireTwilio();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", authHeader());
  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(
      `Twilio API ${response.status}: ${typeof payload === "string" ? payload.slice(0, 400) : JSON.stringify(payload).slice(0, 400)}`
    );
  }
  return payload;
}

async function postForm(url, values) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") {
      body.set(key, String(value));
    }
  }
  return request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
}

async function createTrunk() {
  if (!projectId) throw new Error("OPENAI_PROJECT_ID is required");

  const trunk = await postForm("https://trunking.twilio.com/v1/Trunks", {
    FriendlyName: "CallPilot GPT-Live",
    Secure: "true"
  });

  const sipUrl = `sip:${projectId}@sip.api.openai.com;transport=tls`;
  const origination = await postForm(
    `https://trunking.twilio.com/v1/Trunks/${encodeURIComponent(trunk.sid)}/OriginationUrls`,
    {
      FriendlyName: "OpenAI GPT-Live",
      SipUrl: sipUrl,
      Priority: 10,
      Weight: 10,
      Enabled: "true"
    }
  );

  console.log(
    JSON.stringify(
      {
        trunkSid: trunk.sid,
        secure: trunk.secure,
        originationUrlSid: origination.sid,
        sipUrl,
        next:
          "Attach one hidden Twilio phone number per CallPilot business with attach-number."
      },
      null,
      2
    )
  );
}

async function searchCanada(areaCode) {
  if (!/^\d{3}$/.test(areaCode || "")) {
    throw new Error("Provide a three-digit Canadian area code, for example 438");
  }

  const url = new URL(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      accountSid
    )}/AvailablePhoneNumbers/CA/Local.json`
  );
  url.searchParams.set("AreaCode", areaCode);
  url.searchParams.set("VoiceEnabled", "true");
  url.searchParams.set("PageSize", "20");

  const payload = await request(url.toString());
  console.log(
    JSON.stringify(
      (payload.available_phone_numbers || []).map((n) => ({
        phoneNumber: n.phone_number,
        locality: n.locality,
        region: n.region,
        postalCode: n.postal_code,
        capabilities: n.capabilities,
        addressRequirements: n.address_requirements
      })),
      null,
      2
    )
  );
}

async function listOwned() {
  const url =
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      accountSid
    )}/IncomingPhoneNumbers.json?PageSize=100`;
  const payload = await request(url);
  console.log(
    JSON.stringify(
      (payload.incoming_phone_numbers || []).map((n) => ({
        sid: n.sid,
        phoneNumber: n.phone_number,
        friendlyName: n.friendly_name,
        capabilities: n.capabilities
      })),
      null,
      2
    )
  );
}

async function attachNumber(trunkSid, phoneNumberSid) {
  if (!/^TK[0-9a-fA-F]{32}$/.test(trunkSid || "")) {
    throw new Error("Invalid Twilio trunk SID");
  }
  if (!/^PN[0-9a-fA-F]{32}$/.test(phoneNumberSid || "")) {
    throw new Error("Invalid Twilio phone number SID");
  }

  const result = await postForm(
    `https://trunking.twilio.com/v1/Trunks/${encodeURIComponent(
      trunkSid
    )}/PhoneNumbers`,
    { PhoneNumberSid: phoneNumberSid }
  );

  console.log(
    JSON.stringify(
      {
        attached: true,
        trunkSid,
        phoneNumberSid,
        trunkPhoneNumberResourceSid: result.sid
      },
      null,
      2
    )
  );
}

async function purchaseNumber(phoneNumber) {
  if (process.env.CONFIRM_PHONE_PURCHASE !== "YES") {
    throw new Error(
      "Phone purchase blocked. Set CONFIRM_PHONE_PURCHASE=YES only after reviewing the number and Twilio pricing."
    );
  }
  if (!/^\+\d{10,15}$/.test(phoneNumber || "")) {
    throw new Error("Provide an E.164 phone number such as +14385550123");
  }

  const result = await postForm(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      accountSid
    )}/IncomingPhoneNumbers.json`,
    {
      PhoneNumber: phoneNumber,
      FriendlyName: "CallPilot hidden routing number"
    }
  );

  console.log(
    JSON.stringify(
      {
        purchased: true,
        sid: result.sid,
        phoneNumber: result.phone_number,
        next: "Attach this PN SID to the CallPilot SIP trunk, then add the E.164 number to the business profile."
      },
      null,
      2
    )
  );
}

const [command, ...args] = process.argv.slice(2);

try {
  if (!command || command === "help" || command === "--help") {
    usage();
  } else if (command === "create-trunk") {
    await createTrunk();
  } else if (command === "search-ca") {
    await searchCanada(args[0]);
  } else if (command === "list-owned") {
    await listOwned();
  } else if (command === "attach-number") {
    await attachNumber(args[0], args[1]);
  } else if (command === "purchase-number") {
    await purchaseNumber(args[0]);
  } else {
    usage();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(String(error?.message || error));
  process.exitCode = 1;
}
