"""
Blood Report Extractor — Groq version
--------------------------------------
Uses Groq via the OpenAI-compatible SDK.

Usage:
    python src/extract.py samples/chughtai_multi_panel.pdf
    python src/extract.py samples/waseela_cbc_lft.pdf
"""

import sys
import os
import io
import json
import pdfplumber
from dotenv import load_dotenv
from openai import OpenAI
from prompts import EXTRACTION_SYSTEM_PROMPT

load_dotenv(override=True)

BASE_URL = os.environ.get("OPENROUTER_BASE_URL") or os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
MODEL = os.environ.get("OPENROUTER_MODEL") or os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
API_KEY = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("GROQ_API_KEY")

# Clean strings to prevent errors from trailing whitespaces, newlines, or quotes
if BASE_URL:
    BASE_URL = BASE_URL.strip().strip("'\"")
if MODEL:
    MODEL = MODEL.strip().strip("'\"")
if API_KEY:
    API_KEY = API_KEY.strip().strip("'\"")


def get_client():
    return OpenAI(
        base_url=BASE_URL,
        api_key=API_KEY,
    )


def extract_text_from_pdf(pdf_path: str) -> str:
    """Pull raw text out of every page of the PDF (from a file path)."""
    full_text = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            full_text.append(f"--- Page {i + 1} ---\n{text}")
    return "\n\n".join(full_text)


def extract_text_from_bytes(file_bytes: bytes) -> str:
    """Pull raw text out of every page of a PDF given as raw bytes (for API use)."""
    full_text = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            full_text.append(f"--- Page {i + 1} ---\n{text}")
    return "\n\n".join(full_text)


def extract_structured_data(raw_text: str) -> dict:
    """
    Send raw PDF text to the Groq API and get back structured JSON.
    """
    client = get_client()
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": raw_text},
        ],
        max_tokens=4000,
        temperature=0.1,
        response_format={"type": "json_object"},
    )

    text_output = response.choices[0].message.content or ""

    # Strip markdown code fences if present
    cleaned = text_output.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    cleaned = cleaned.strip("` \n")

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        print("Warning: Failed to parse model output as JSON.")
        print("Raw output was:\n", text_output)
        raise e


def compute_flags(data: dict) -> dict:
    """
    Compute high-low-normal flags in code (deterministic, not LLM).
    """
    for panel in data.get("panels", []):
        for test in panel.get("tests", []):
            low   = test.get("ref_range_low")
            high  = test.get("ref_range_high")
            value = test.get("value")

            if not isinstance(value, (int, float)):
                test["flag"] = "unknown"
                continue

            if low is not None and value < low:
                test["flag"] = "low"
            elif high is not None and value > high:
                test["flag"] = "high"
            elif low is not None or high is not None:
                test["flag"] = "normal"
            else:
                test["flag"] = "unknown"
    return data


def analyze_from_bytes(file_bytes: bytes) -> dict:
    """Full pipeline for API use: bytes -> text -> LLM -> flags."""
    raw_text = extract_text_from_bytes(file_bytes)
    data = extract_structured_data(raw_text)
    data = compute_flags(data)
    return data


def main():
    if len(sys.argv) < 2:
        print("Usage: python src/extract.py <path_to_pdf>")
        sys.exit(1)

    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        print(f"File not found: {pdf_path}")
        sys.exit(1)

    print(f"Reading: {pdf_path}")
    raw_text = extract_text_from_pdf(pdf_path)

    print(f"Sending to model ({MODEL}) for extraction...")
    data = extract_structured_data(raw_text)

    print("Computing high/low/normal flags...")
    data = compute_flags(data)

    out_path = os.path.splitext(pdf_path)[0] + "_extracted.json"
    with open(out_path, "w") as f:
        json.dump(data, f, indent=2)

    print(f"Done. Saved to: {out_path}\n")
    print(json.dumps(data, indent=2))


if __name__ == "__main__":
    main()
