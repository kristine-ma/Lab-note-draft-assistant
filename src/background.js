const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "GENERATE_LAB_NOTE") return false;

  generateLabNote(message.payload)
    .then((note) => sendResponse({ ok: true, note }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function generateLabNote(payload) {
  const settings = await chrome.storage.local.get(["apiKey", "model", "proxyUrl"]);
  const model = settings.model || "gpt-4.1";
  const proxyUrl = settings.proxyUrl?.trim();

  if (proxyUrl) {
    return generateViaProxy(proxyUrl, payload, model);
  }

  if (!settings.apiKey) {
    throw new Error("Add an OpenAI API key or an approved proxy URL in settings.");
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      instructions: buildInstructions(),
      input: buildUserInput(payload),
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

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || "The AI request failed.");
  }

  const parsed = parseStructuredOutput(data);
  return appendReviewFlags(parsed.note, parsed.review_flags);
}

async function generateViaProxy(proxyUrl, payload, model) {
  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: buildInstructions(),
      input: buildUserInput(payload)
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || "The proxy request failed.");
  }

  if (typeof data.note === "string") {
    return appendReviewFlags(data.note, data.review_flags || []);
  }

  if (typeof data.output_text === "string") {
    return data.output_text;
  }

  throw new Error("The proxy response did not include a note.");
}

function buildInstructions() {
  return [
    "You draft clinical documentation for a licensed clinician reviewing labs, imaging reports, medication lists, PMH, and screenshots of clinical results.",
    "Follow the requested template exactly.",
    "If a screenshot/image is supplied, first read and extract the visible clinical text from the image, then use that extracted content for the draft.",
    "If the screenshot/image is too blurry, cropped, or unreadable, say so in review_flags instead of guessing.",
    "Use the supplied patient_name in the greeting. If no patient_name is supplied, use Insert_patient-name.",
    "Use only the lab text supplied by the user. Do not infer diagnoses, treatment plans, or missing values.",
    "Call out clinically relevant abnormalities that are explicitly present.",
    "When PMH and medication lists are supplied, use them to contextualize the assessment and plan.",
    "Mention relevant existing medications before recommending a medication-related change.",
    "Do not suggest a new medication class if the supplied medication list already shows the patient is taking it; instead suggest dose optimization, adherence review, contraindication review, or alternate/add-on therapy for clinician review.",
    "Use common medical acronyms when appropriate for chart documentation, such as DM, HTN, CKD, CBC, CMP, A1c, HbA1c, eGFR, LDL, and TSH.",
    "Avoid obscure or ambiguous acronyms.",
    "For chart templates, generate a preliminary clinician-facing assessment and plan with likely diagnoses when strongly supported by the supplied values.",
    "Phrase plans as draft recommendations for clinician review, not final orders.",
    "Mention that the draft requires clinician review before use.",
    "If the supplied text is insufficient or appears to include multiple patients, say so in review_flags.",
    "Do not provide emergency triage instructions unless the supplied clinician text already says to do so."
  ].join(" ");
}

function buildUserInput(payload) {
  const textPayload = JSON.stringify({
    template: payload.template || "chart_labs_assessment_plan",
    template_instructions: getTemplateInstructions(payload.template),
    patient_name: payload.patientName || "Insert_patient-name",
    tone: payload.tone,
    source_text: payload.labText || "",
    screenshot_present: Boolean(payload.screenshotDataUrl),
    image_task: payload.screenshotDataUrl
      ? "Analyze the attached screenshot/image for visible lab, imaging, medication, or PMH text. Extract relevant values/findings and incorporate them into the requested template."
      : ""
  });

  if (!payload.screenshotDataUrl) {
    return textPayload;
  }

  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: textPayload
        },
        {
          type: "input_image",
          image_url: payload.screenshotDataUrl,
          detail: "high"
        }
      ]
    }
  ];
}

function getTemplateInstructions(template) {
  const templates = {
    chart_labs_assessment_plan: [
      "This is for chart documentation, not a patient-facing message.",
      "Put each result on its own line so the note is easy to read.",
      "Use exact values from the supplied text when available.",
      "Use supplied PMH and current medications to shape Imp and plan.",
      "Format exactly as:",
      "Labs reviewed:",
      "- CBC:",
      "  - [Result name]: [value] [flag if abnormal]",
      "  - [Result name]: [value] [flag if abnormal]",
      "- CMP:",
      "  - [Result name]: [value] [flag if abnormal]",
      "  - [Result name]: [value] [flag if abnormal]",
      "- HbA1c:",
      "  - HbA1c: [value] [flag if abnormal]",
      "- Other:",
      "  - [Any other supplied result, imaging finding, PMH item, or medication context relevant to the plan.]",
      "",
      "Imp and plan:",
      "- [Major problem/diagnosis supported by supplied results]:",
      "  - [Sub-problem or key abnormal result]: [brief interpretation with value] - [current relevant medication/PMH context if supplied] - [draft plan].",
      "  - [Sub-problem or related issue]: [brief interpretation with value] - [current relevant medication/PMH context if supplied] - [draft plan].",
      "- [Next major problem/diagnosis supported by supplied results]:",
      "  - [Sub-problem or key abnormal result]: [brief interpretation with value] - [current relevant medication/PMH context if supplied] - [draft plan].",
      "- Example style:",
      "- DM:",
      "  - HbA1c 8.2 - above goal; already on metformin ER 1000 mg BID and empagliflozin 10 mg daily - review adherence/tolerability and consider intensifying therapy.",
      "- Anemia:",
      "  - Hgb 10.8 with PMH iron deficiency anemia; already on ferrous sulfate - review adherence, iron studies, prior baseline, and consider further workup.",
      "- Renal dysfunction/CKD:",
      "  - Cr 1.4 with eGFR 48 and PMH CKD3a; on lisinopril and empagliflozin - trend renal function, review volume status/nephrotoxins, and adjust meds if clinically indicated.",
      "- Put sub-problems of a larger problem on their own indented lines.",
      "- If PMH or medications are not supplied, do not invent them.",
      "- Do not write a prose paragraph such as 'Findings of note'."
    ].join("\n"),
    patient_assessment_plan: [
      "Format exactly as:",
      "Dear [patient name],",
      "",
      "Assessment:",
      "[Clear patient-facing summary of the lab results.]",
      "",
      "Plan:",
      "[Clinician-reviewable follow-up language.]"
    ].join("\n"),
    quick_normal: [
      "Format exactly as:",
      "Dear [patient name],",
      "",
      "Good news, your lab results are within the expected range based on the information reviewed.",
      "",
      "Plan:",
      "[Brief routine follow-up or monitoring statement for clinician review.]"
    ].join("\n"),
    abnormal_followup: [
      "Format exactly as:",
      "Dear [patient name],",
      "",
      "Assessment:",
      "[List the abnormal or notable results in patient-friendly language.]",
      "",
      "Plan:",
      "[State that follow-up is recommended and leave treatment-specific decisions for clinician review.]"
    ].join("\n"),
  };

  return templates[template] || templates.chart_labs_assessment_plan;
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

function appendReviewFlags(note, flags) {
  if (!flags?.length) return note;

  return `${note.trim()}\n\nReview flags:\n${flags.map((flag) => `- ${flag}`).join("\n")}`;
}
