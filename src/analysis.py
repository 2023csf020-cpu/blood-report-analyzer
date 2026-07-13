"""
Analysis module: health scoring and AI-generated insights (Groq version).
"""

import os
import json
from openai import OpenAI
from prompts import INSIGHTS_SYSTEM_PROMPT

BASE_URL = os.environ.get("OPENROUTER_BASE_URL") or os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
MODEL = os.environ.get("OPENROUTER_MODEL") or os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")

# Clean strings to prevent errors from trailing whitespaces, newlines, or quotes
if BASE_URL:
    BASE_URL = BASE_URL.strip().strip("'\"")
if MODEL:
    MODEL = MODEL.strip().strip("'\"")



def compute_health_score(data: dict) -> dict:
    """Compute a health score (0-100) based on the proportion of normal flags."""
    total = 0
    normal = 0
    high_count = 0
    low_count = 0
    unknown_count = 0
    panel_scores = {}

    for panel in data.get("panels", []):
        panel_total = 0
        panel_normal = 0
        panel_name = panel.get("panel_name", "Unknown Panel")

        for test in panel.get("tests", []):
            flag = test.get("flag", "unknown")
            if flag in ("high", "low", "normal"):
                total += 1
                panel_total += 1
                if flag == "normal":
                    normal += 1
                    panel_normal += 1
                elif flag == "high":
                    high_count += 1
                elif flag == "low":
                    low_count += 1
            else:
                unknown_count += 1

        if panel_total > 0:
            panel_scores[panel_name] = round((panel_normal / panel_total) * 100)
        else:
            panel_scores[panel_name] = None

    score = round((normal / total) * 100) if total > 0 else 100

    return {
        "score": score,
        "total_tests": total + unknown_count,
        "normal_count": normal,
        "high_count": high_count,
        "low_count": low_count,
        "unknown_count": unknown_count,
        "panel_scores": panel_scores,
    }


def generate_insights(data: dict, client: OpenAI) -> dict:
    """Call Groq to produce plain-English panel insights."""
    compact = {
        "patient": data.get("patient"),
        "report_date": data.get("report_date"),
        "lab_name": data.get("lab_name"),
        "panels": []
    }
    for panel in data.get("panels", []):
        compact_tests = []
        for test in panel.get("tests", []):
            compact_tests.append({
                "test_name": test.get("test_name"),
                "value": test.get("value"),
                "unit": test.get("unit"),
                "ref_range_raw": test.get("ref_range_raw"),
                "flag": test.get("flag"),
            })
        compact["panels"].append({
            "panel_name": panel.get("panel_name"),
            "tests": compact_tests,
        })

    report_json = json.dumps(compact, indent=2)

    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": INSIGHTS_SYSTEM_PROMPT},
                {"role": "user", "content": report_json},
            ],
            max_tokens=1500,
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        text_output = response.choices[0].message.content or ""
        cleaned = text_output.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```")[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
        cleaned = cleaned.strip("` \n")
        return json.loads(cleaned)
    except Exception as e:
        print(f"Warning: Insights generation failed: {e}")
        return {
            "overall_summary": "Unable to generate insights at this time.",
            "panel_insights": {}
        }
