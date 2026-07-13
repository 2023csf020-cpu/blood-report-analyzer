"""Flask API for Blood Report Analyzer — Groq + SQLite Profiles version."""

import os, json, sys
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from openai import OpenAI

sys.path.insert(0, os.path.dirname(__file__))
from extract import analyze_from_bytes
from analysis import compute_health_score, generate_insights
from prompts import CHAT_SYSTEM_PROMPT
import database

load_dotenv(override=True)



app = Flask(__name__,
    static_folder=os.path.join(os.path.dirname(__file__), "..", "frontend"),
    static_url_path="")
CORS(app)

BASE_URL = os.environ.get("OPENROUTER_BASE_URL") or os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
MODEL = os.environ.get("OPENROUTER_MODEL") or os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
API_KEY = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("GROQ_API_KEY")
SAMPLES_DIR   = os.path.join(os.path.dirname(__file__), "..", "samples")

def get_client():
    return OpenAI(
        base_url=BASE_URL,
        api_key=API_KEY,
    )

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/samples/<path:filename>")
def serve_sample(filename):
    return send_from_directory(os.path.abspath(SAMPLES_DIR), filename)

# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

@app.route("/api/health")
def health():
    provider = "openrouter" if "openrouter" in BASE_URL.lower() else ("groq" if "groq" in BASE_URL.lower() else "openai")
    return jsonify({"status": "ok", "model": MODEL, "backend": provider})

@app.route("/api/test-connection")
def test_connection():
    import requests
    results = {}
    try:
        r = requests.get("https://openrouter.ai/api/v1/models", timeout=5)
        results["dns_and_connectivity"] = f"OK (Status: {r.status_code})"
    except Exception as e:
        results["dns_and_connectivity"] = f"FAILED: {e}"
    try:
        headers = {"Authorization": f"Bearer {API_KEY}"}
        r = requests.get("https://openrouter.ai/api/v1/auth/key", headers=headers, timeout=5)
        results["auth_test"] = f"Status: {r.status_code}, Body: {r.text}"
    except Exception as e:
        results["auth_test"] = f"FAILED: {e}"
    results["env_state"] = {
        "BASE_URL": BASE_URL,
        "MODEL": MODEL,
        "API_KEY_EXISTS": bool(API_KEY),
        "API_KEY_LENGTH": len(API_KEY) if API_KEY else 0,
        "API_KEY_PREFIX": API_KEY[:10] if API_KEY and len(API_KEY) >= 10 else (API_KEY or None)
    }
    return jsonify(results)


# --- Profile Endpoints ---

@app.route("/api/profiles", methods=["GET"])
def get_profiles():
    """GET /api/profiles - Returns all active patient profiles."""
    try:
        profiles = database.list_profiles()
        return jsonify(profiles)
    except Exception as e:
        return jsonify({"error": f"Failed to list profiles: {e}"}), 500

@app.route("/api/profiles", methods=["POST"])
def add_profile():
    """POST /api/profiles - Creates a new patient profile."""
    body = request.get_json(silent=True) or {}
    name = body.get("name")
    relationship = body.get("relationship", "Self")
    if not name:
        return jsonify({"error": "Profile name is required."}), 400
    try:
        profile_id = database.create_profile(name, relationship)
        return jsonify({"id": profile_id, "name": name, "relationship": relationship})
    except Exception as e:
        return jsonify({"error": f"Failed to create profile: {e}"}), 500

@app.route("/api/profiles/<int:profile_id>", methods=["DELETE"])
def remove_profile(profile_id):
    """DELETE /api/profiles/<id> - Deletes a patient profile."""
    try:
        if profile_id == 1:
            return jsonify({"error": "Cannot delete primary profile."}), 400
        success = database.delete_profile(profile_id)
        if not success:
            return jsonify({"error": "Profile not found."}), 404
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": f"Failed to delete profile: {e}"}), 500


# --- Analysis Endpoints ---

@app.route("/api/analyze", methods=["POST"])
def analyze():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded."}), 400
    
    file = request.files["file"]
    profile_id = request.form.get("profile_id", 1, type=int)
    
    if not file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are supported."}), 400
    try:
        file_bytes = file.read()
    except Exception as e:
        return jsonify({"error": f"Failed to read file: {e}"}), 500
    
    try:
        data = analyze_from_bytes(file_bytes)
    except Exception as e:
        return jsonify({"error": f"Extraction failed: {e}"}), 500
    
    try:
        data["health_score"] = compute_health_score(data)
    except Exception as e:
        print(f"Warning: Health score failed: {e}"); data["health_score"] = None
        
    try:
        data["insights"] = generate_insights(data, get_client())
    except Exception as e:
        print(f"Warning: Insights failed: {e}"); data["insights"] = {"overall_summary": "", "panel_insights": {}, "action_plan": []}

    try:
        db_id = database.save_report(data, profile_id)
        data["db_id"] = db_id
    except Exception as e:
        print(f"Warning: Failed to save report to database: {e}")

    return jsonify(data)


@app.route("/api/history", methods=["GET"])
def get_history():
    """GET /api/history?profile_id=X - Return list of reports under active profile."""
    profile_id = request.args.get("profile_id", 1, type=int)
    try:
        reports = database.list_reports(profile_id)
        return jsonify(reports)
    except Exception as e:
        return jsonify({"error": f"Failed to fetch history: {e}"}), 500

@app.route("/api/history/<int:report_id>", methods=["GET"])
def get_historical_report(report_id):
    """GET /api/history/<id> - Fetch single historical report."""
    try:
        report = database.get_report(report_id)
        if not report:
            return jsonify({"error": "Report not found"}), 404
        return jsonify(report)
    except Exception as e:
        return jsonify({"error": f"Failed to fetch report: {e}"}), 500

@app.route("/api/history/<int:report_id>", methods=["DELETE"])
def delete_historical_report(report_id):
    """DELETE /api/history/<id> - Delete report."""
    try:
        success = database.delete_report(report_id)
        if not success:
            return jsonify({"error": "Report not found"}), 404
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": f"Failed to delete report: {e}"}), 500

@app.route("/api/trends", methods=["GET"])
def get_trend_data():
    """GET /api/trends?profile_id=X - Query numeric markers over time for active profile."""
    profile_id = request.args.get("profile_id", 1, type=int)
    try:
        trends = database.get_trends(profile_id)
        return jsonify(trends)
    except Exception as e:
        return jsonify({"error": f"Failed to query trends: {e}"}), 500

@app.route("/api/chat", methods=["POST"])
def chat():
    body = request.get_json(silent=True)
    if not body or "message" not in body:
        return jsonify({"error": "Request body must contain 'message'."}), 400
    user_message   = body["message"]
    report_context = body.get("report_context", {})
    history        = body.get("history", [])

    messages = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]
    
    if report_context:
        messages.append({
            "role": "user",
            "content": f"Here is the patient's blood report:\n\n```json\n{json.dumps(report_context, indent=2)}\n```\n\nConfirm you are ready."
        })
        messages.append({
            "role": "assistant",
            "content": "I have reviewed the blood report and I'm ready to help. What would you like to know?"
        })
    for turn in history:
        role = "assistant" if turn["role"] == "assistant" else "user"
        messages.append({"role": role, "content": turn["content"]})
        
    messages.append({"role": "user", "content": user_message})

    try:
        client = get_client()
        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            max_tokens=1000,
            temperature=0.3
        )
        reply = response.choices[0].message.content or "Sorry, no response generated."
        return jsonify({"reply": reply})
    except Exception as e:
        return jsonify({"error": f"Chat failed: {e}"}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"[BloodIQ] Running at http://localhost:{port} | Model: {MODEL}")
    app.run(debug=True, port=port)
