import http from "node:http";

const port = Number(process.env.PORT || 8787);
const apiKey = process.env.OPENAI_API_KEY;
const fallbackModel = process.env.OPENAI_MODEL || "gpt-4.1";

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendCors(response, 204);
    response.end();
    return;
  }

  if (request.method === "GET" && (request.url === "/" || request.url === "/test")) {
    sendHtml(response, testPageHtml());
    return;
  }

  if (request.method !== "POST" || request.url !== "/lab-note") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  try {
    if (!apiKey) {
      sendJson(response, 500, {
        error: "Set OPENAI_API_KEY before generating a note. The test page can still be used without a key."
      });
      return;
    }

    const body = await readJson(request);
    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: body.model || fallbackModel,
        instructions: body.instructions,
        input: body.input,
        text: {
          format: {
            type: "json_schema",
            name: "lab_note_draft",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                note: { type: "string" },
                review_flags: {
                  type: "array",
                  items: { type: "string" }
                }
              },
              required: ["note", "review_flags"]
            }
          }
        }
      })
    });

    const data = await openaiResponse.json();
    if (!openaiResponse.ok) {
      sendJson(response, openaiResponse.status, {
        error: data.error?.message || "OpenAI request failed"
      });
      return;
    }

    sendJson(response, 200, parseStructuredOutput(data));
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the other proxy terminal with Ctrl+C, or run with PORT=8788.`);
    return;
  }

  if (error.code === "EPERM") {
    console.error(`Your computer blocked listening on port ${port}. Try a different port with PORT=8788 node examples/proxy-server.mjs.`);
    return;
  }

  console.error(error.message);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Lab note proxy listening on http://localhost:${port}/lab-note`);
  console.log(`Test page available at http://localhost:${port}/test`);
  if (!apiKey) {
    console.log("OPENAI_API_KEY is not set, so note generation will not work yet.");
  }
});

function sendCors(response, status) {
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": "*"
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8"
  });
  response.end(html);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 25_000_000) {
        request.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    request.on("end", () => resolve(JSON.parse(raw || "{}")));
    request.on("error", reject);
  });
}

function testPageHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Lab Note Extension Test</title>
    <style>
      body {
        color: #17202a;
        font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 40px;
        max-width: 760px;
      }

      .labs {
        border: 1px solid #d7dde6;
        border-radius: 8px;
        padding: 18px;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <h1>Lab Note Extension Test</h1>
    <p>Highlight the fake lab text below, then click the extension and choose Use Selection.</p>
    <div class="labs" contenteditable="true">CBC: WBC 7.2, Hgb 10.8 low, Platelets 240.
CMP: Creatinine 1.4 high, eGFR 48 low, Sodium 139, Potassium 4.6.
A1c 8.2 high.</div>
  </body>
</html>`;
}

function parseStructuredOutput(data) {
  if (typeof data.output_text === "string") {
    return JSON.parse(data.output_text);
  }

  const textItems = data.output
    ?.flatMap((item) => item.content || [])
    ?.filter((content) => content.type === "output_text")
    ?.map((content) => content.text);

  if (textItems?.length) {
    return JSON.parse(textItems.join("\n"));
  }

  throw new Error("The AI response did not include draft text.");
}
